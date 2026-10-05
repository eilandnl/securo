"""Month-end forecast for the budget overview.

Per category the forecast is what was spent so far, plus
- fixed charges still to come: whichever is larger of the scheduled
  transactions (recurring rules and forecast rows) and the charges that came
  back month after month but have not been paid yet this month;
- variable spending: the median of what the category's other spending was
  in the rest of the month over the last complete months.

Every amount still to come is placed on the day it usually falls, so the
overview can draw the forecast line without fetching transaction history.
"""

import calendar
import statistics
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_clock import app_today
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.budget import BudgetCategoryForecast, BudgetForecast
from app.services._query_filters import counts_as_user_pnl, reporting_date_col
from app.services.admin_service import get_credit_card_accounting_mode
from app.services.budget_service import get_budget_vs_actual
from app.services.dashboard_service import (
    _counts_as_user_pnl_row,
    _get_forecast_transactions,
    _get_recurring_projections,
)
from app.services.fx_rate_service import convert
from app.core.config import get_settings

# Complete months the forecast learns from.
LEARN_MONTHS = 3
# How far back to look for those months.
LOOKBACK_MONTHS = 6
# The same bill again: an amount within 10% around the same day of the month.
AMOUNT_TOLERANCE = Decimal("0.10")
DAY_TOLERANCE = 5


@dataclass
class Payment:
    category_id: str
    day: int
    amount: Decimal


@dataclass
class RecurringCharge:
    category_id: str
    amount: Decimal
    day: int


@dataclass
class SpendingHistory:
    charges: list[RecurringCharge]
    # Per learned month: variable (non-recurring) spending per category by day.
    variable: list[dict[str, list[Decimal]]]


def _shift_month(month: date, offset: int) -> date:
    index = month.year * 12 + month.month - 1 + offset
    return date(index // 12, index % 12 + 1, 1)


def _month_end(month: date) -> date:
    return _shift_month(month, 1)


def _days_in_month(month: date) -> int:
    return calendar.monthrange(month.year, month.month)[1]


def _elapsed_days(month: date, today: date) -> int:
    current = today.replace(day=1)
    if month < current:
        return _days_in_month(month)
    if month > current:
        return 0
    return today.day


def _zeros(days: int) -> list[Decimal]:
    # Index 1..days; index 0 is unused so a day number is its own index.
    return [Decimal("0")] * (days + 1)


def _median(values: list[Decimal]) -> Decimal:
    return Decimal(str(statistics.median(values))) if values else Decimal("0")


def _is_same_payment(payment: Payment, category_id: str, amount: Decimal, day: Optional[int]) -> bool:
    if payment.category_id != category_id:
        return False
    if abs(payment.amount - amount) > max(Decimal("1"), amount * AMOUNT_TOLERANCE):
        return False
    return day is None or abs(payment.day - day) <= DAY_TOLERANCE


async def _payments(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    month: date,
    report_date,
) -> list[Payment]:
    """Posted, categorized spending (debits) of one month, by day."""
    result = await session.execute(
        select(
            Transaction.category_id,
            report_date,
            func.abs(func.coalesce(Transaction.amount_primary, Transaction.amount)),
        )
        .where(
            Transaction.workspace_id == workspace_id,
            Transaction.type == "debit",
            Transaction.status == "posted",
            Transaction.category_id.isnot(None),
            report_date >= month,
            report_date < _month_end(month),
            report_date <= app_today(),
            counts_as_user_pnl(),
        )
    )
    return [
        Payment(category_id=str(row[0]), day=row[1].day, amount=Decimal(str(row[2])))
        for row in result.all()
    ]


def learn_spending_history(months: list[list[Payment]], days: int) -> SpendingHistory:
    """Split earlier months into recurring charges and variable spending.

    A charge is recurring when a payment in the same category, for about the
    same amount, around the same day comes back in at least two of the
    months (rent, insurance, subscriptions). Everything else is variable
    spending (groceries, fuel, one-off purchases). Needs two months.
    """
    if len(months) < 2:
        return SpendingHistory(charges=[], variable=[])

    used = [[False] * len(payments) for payments in months]
    charges: list[RecurringCharge] = []
    for month_index, payments in enumerate(months):
        for payment_index, payment in enumerate(payments):
            if used[month_index][payment_index]:
                continue
            matches = [payment]
            claimed = [(month_index, payment_index)]
            for other in range(month_index + 1, len(months)):
                for candidate_index, candidate in enumerate(months[other]):
                    if not used[other][candidate_index] and _is_same_payment(
                        candidate, payment.category_id, payment.amount, payment.day
                    ):
                        matches.append(candidate)
                        claimed.append((other, candidate_index))
                        break
            if len(matches) < 2:
                continue
            for m, i in claimed:
                used[m][i] = True
            charges.append(RecurringCharge(
                category_id=payment.category_id,
                amount=_median([match.amount for match in matches]),
                day=min(days, round(statistics.median([match.day for match in matches]))),
            ))

    variable: list[dict[str, list[Decimal]]] = []
    for month_index, payments in enumerate(months):
        by_category: dict[str, list[Decimal]] = {}
        for payment_index, payment in enumerate(payments):
            if used[month_index][payment_index]:
                continue
            series = by_category.setdefault(payment.category_id, _zeros(days))
            series[min(payment.day, days)] += payment.amount
        variable.append(by_category)
    return SpendingHistory(charges=charges, variable=variable)


def _spread(target: list[Decimal], shape: list[Decimal], start: int, end: int, amount: Decimal) -> None:
    """Add `amount` to target[start..end] in proportion to `shape`; evenly when it is empty."""
    if amount <= 0 or end < start:
        return
    weights = [max(Decimal("0"), shape[day]) if day < len(shape) else Decimal("0") for day in range(start, end + 1)]
    total = sum(weights, Decimal("0"))
    for offset, day in enumerate(range(start, end + 1)):
        target[day] += amount * (weights[offset] / total if total > 0 else Decimal("1") / (end - start + 1))


def forecast_category(
    *,
    category_id: str,
    actual: Decimal,
    scheduled: Decimal,
    scheduled_shape: list[Decimal],
    this_month: list[Payment],
    matched: list[bool],
    history: SpendingHistory,
    elapsed: int,
    days: int,
) -> tuple[Decimal, Decimal, list[Decimal], bool]:
    """(expected, fixed_upcoming, upcoming by day, from_history) for one category.

    `matched` marks this month's payments already paid against a recurring
    charge; it is shared across categories and updated in place.
    """
    upcoming = _zeros(days)
    if elapsed >= days:
        return actual, Decimal("0"), upcoming, False

    recurring = _zeros(days)
    for charge in history.charges:
        if charge.category_id != category_id:
            continue
        # Already paid this month counts whatever the day: bills shift around.
        paid = next((
            index for index, payment in enumerate(this_month)
            if not matched[index] and _is_same_payment(payment, charge.category_id, charge.amount, None)
        ), None)
        if paid is not None:
            matched[paid] = True
            continue
        # Not paid yet: expected on its usual day, or tomorrow when that day has passed.
        recurring[max(charge.day, elapsed + 1)] += charge.amount

    recurring_total = sum(recurring[elapsed + 1:], Decimal("0"))
    if recurring_total > scheduled:
        fixed = recurring_total
        for day in range(elapsed + 1, days + 1):
            upcoming[day] += recurring[day]
    else:
        fixed = scheduled
        _spread(upcoming, scheduled_shape, elapsed + 1, days, scheduled)

    variable_rest = _median([
        max(Decimal("0"), sum(by_category.get(category_id, _zeros(days))[elapsed + 1:], Decimal("0")))
        for by_category in history.variable
    ]) if history.variable else Decimal("0")
    _spread(upcoming, [], elapsed + 1, days, variable_rest)

    return (
        actual + fixed + variable_rest,
        fixed,
        upcoming,
        recurring_total > scheduled or variable_rest > 0,
    )


async def get_budget_forecast(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    month: Optional[date] = None,
) -> BudgetForecast:
    today = app_today()
    month = (month or today).replace(day=1)
    days = _days_in_month(month)
    elapsed = _elapsed_days(month, today)

    accounting_mode = await get_credit_card_accounting_mode(session)
    report_date = reporting_date_col(accounting_mode)
    user = await session.get(User, user_id)
    primary_currency = user.primary_currency if user else get_settings().default_currency

    rows = await get_budget_vs_actual(session, workspace_id, user_id, month)

    # Only complete months show what a whole month looks like.
    current_month = today.replace(day=1)
    learn = [
        candidate
        for candidate in (_shift_month(month, -offset) for offset in range(1, LOOKBACK_MONTHS + 1))
        if candidate < current_month
    ][:LEARN_MONTHS]
    history_payments = []
    for learned in learn:
        payments = await _payments(session, workspace_id, learned, report_date)
        for payment in payments:
            payment.day = min(payment.day, days)
        history_payments.append(payments)
    history = learn_spending_history(history_payments, days)

    this_month = await _payments(session, workspace_id, month, report_date)
    matched = [False] * len(this_month)

    # Net daily spending so far (refunds offset), the shape of the actual line.
    daily_actual: dict[str, list[Decimal]] = {}
    net_result = await session.execute(
        select(
            Transaction.category_id,
            report_date,
            Transaction.type,
            func.abs(func.coalesce(Transaction.amount_primary, Transaction.amount)),
        )
        .where(
            Transaction.workspace_id == workspace_id,
            Transaction.status == "posted",
            Transaction.category_id.isnot(None),
            report_date >= month,
            report_date < _month_end(month),
            report_date <= today,
            counts_as_user_pnl(),
        )
    )
    for category_id, booked, kind, amount in net_result.all():
        series = daily_actual.setdefault(str(category_id), _zeros(days))
        signed = Decimal(str(amount))
        series[booked.day] += signed if kind == "debit" else -signed

    # Scheduled transactions by day, the shape of the scheduled part.
    scheduled_shape: dict[str, list[Decimal]] = {}
    for projection in await _get_recurring_projections(session, workspace_id, month, _month_end(month)):
        if projection["type"] != "debit" or not projection["category_id"]:
            continue
        converted, _ = await convert(
            session, Decimal(str(projection["amount"])), projection["currency"], primary_currency,
        )
        series = scheduled_shape.setdefault(str(projection["category_id"]), _zeros(days))
        series[projection["date"].day] += abs(converted)
    for tx in await _get_forecast_transactions(
        session, workspace_id, month, _month_end(month), range_date_col=report_date,
    ):
        if tx.type != "debit" or not tx.category_id or not _counts_as_user_pnl_row(tx):
            continue
        booked = tx.effective_bill_date or (tx.effective_date if accounting_mode == "accrual" else None) or tx.date
        series = scheduled_shape.setdefault(str(tx.category_id), _zeros(days))
        series[min(booked.day, days)] += abs(Decimal(str(tx.amount_primary if tx.amount_primary is not None else tx.amount)))

    categories = []
    for row in rows:
        category_id = str(row.category_id)
        expected, fixed, upcoming, from_history = forecast_category(
            category_id=category_id,
            actual=row.actual_amount,
            scheduled=max(Decimal("0"), row.projected_amount - row.actual_amount),
            scheduled_shape=scheduled_shape.get(category_id, _zeros(days)),
            this_month=this_month,
            matched=matched,
            history=history,
            elapsed=elapsed,
            days=days,
        )
        categories.append(BudgetCategoryForecast(
            category_id=row.category_id,
            expected=expected.quantize(Decimal("0.01")),
            fixed_upcoming=fixed.quantize(Decimal("0.01")),
            daily_actual=[value.quantize(Decimal("0.01")) for value in daily_actual.get(category_id, _zeros(days))[1:]],
            daily_upcoming=[value.quantize(Decimal("0.01")) for value in upcoming[1:]],
            from_history=from_history,
        ))

    return BudgetForecast(
        month=month,
        days_in_month=days,
        days_elapsed=elapsed,
        learned_months=len(learn),
        categories=categories,
    )
