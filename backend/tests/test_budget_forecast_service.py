import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.transaction import Transaction
from app.schemas.budget import BudgetCreate
from app.services.budget_forecast_service import (
    Payment,
    SpendingHistory,
    RecurringCharge,
    forecast_category,
    get_budget_forecast,
    learn_spending_history,
)
from app.services.budget_service import create_budget


def _zeros(days: int) -> list[Decimal]:
    return [Decimal("0")] * (days + 1)


# ---------------------------------------------------------------------------
# learn_spending_history
# ---------------------------------------------------------------------------


def test_learn_spending_history_keeps_payments_that_come_back():
    months = [
        [Payment("rent", 1, Decimal("950")), Payment("food", 1, Decimal("230")), Payment("insurance", 28, Decimal("102"))],
        [Payment("rent", 2, Decimal("950")), Payment("food", 2, Decimal("41")), Payment("insurance", 27, Decimal("98"))],
        [Payment("hobby", 15, Decimal("900"))],
    ]

    history = learn_spending_history(months, 31)

    charges = {(c.category_id, c.amount, c.day) for c in history.charges}
    assert charges == {("rent", Decimal("950"), 2), ("insurance", Decimal("100"), 28)}
    # Groceries of different amounts and a one-off purchase are variable spending.
    assert history.variable[0]["food"][1] == Decimal("230")
    assert history.variable[2]["hobby"][15] == Decimal("900")
    assert "rent" not in history.variable[0]


def test_learn_spending_history_needs_two_months():
    history = learn_spending_history([[Payment("rent", 1, Decimal("950"))]], 31)
    assert history.charges == []
    assert history.variable == []


# ---------------------------------------------------------------------------
# forecast_category
# ---------------------------------------------------------------------------


def _forecast(category_id, *, actual="0", scheduled="0", this_month=None, history=None, elapsed=3, days=31):
    this_month = this_month or []
    return forecast_category(
        category_id=category_id,
        actual=Decimal(actual),
        scheduled=Decimal(scheduled),
        scheduled_shape=_zeros(days),
        this_month=this_month,
        matched=[False] * len(this_month),
        history=history or SpendingHistory(charges=[], variable=[]),
        elapsed=elapsed,
        days=days,
    )


def test_forecast_adds_unpaid_recurring_charges_on_their_day():
    history = SpendingHistory(
        charges=[RecurringCharge("rent", Decimal("950"), 1), RecurringCharge("insurance", Decimal("100"), 28)],
        variable=[],
    )

    rent = _forecast("rent", actual="950", this_month=[Payment("rent", 1, Decimal("950"))], history=history)
    insurance = _forecast("insurance", history=history)

    assert rent[:2] == (Decimal("950"), Decimal("0"))
    expected, fixed, upcoming, from_history = insurance
    assert (expected, fixed, from_history) == (Decimal("100"), Decimal("100"), True)
    assert upcoming[28] == Decimal("100")


def test_forecast_expects_an_overdue_charge_tomorrow_and_prefers_larger_schedules():
    history = SpendingHistory(charges=[RecurringCharge("rent", Decimal("950"), 1)], variable=[])

    _, _, upcoming, _ = _forecast("rent", history=history)
    assert upcoming[4] == Decimal("950")

    expected, fixed, _, from_history = _forecast("rent", scheduled="1200", history=history)
    assert (expected, fixed, from_history) == (Decimal("1200"), Decimal("1200"), False)


def test_forecast_adds_the_median_variable_spending_for_the_rest_of_the_month():
    def month(after_today):
        series = _zeros(31)
        series[2] = Decimal("50")  # before today: already behind us
        series[20] = Decimal(after_today)
        return {"food": series}

    history = SpendingHistory(charges=[], variable=[month("300"), month("250"), month("2000")])
    expected, fixed, upcoming, from_history = _forecast("food", actual="40", history=history)

    # The one 2000 month does not set the forecast.
    assert (expected, fixed, from_history) == (Decimal("340"), Decimal("0"), True)
    assert upcoming[4] == pytest.approx(Decimal("300") / 28)


def test_forecast_adds_nothing_to_a_closed_month():
    history = SpendingHistory(charges=[RecurringCharge("rent", Decimal("950"), 1)], variable=[])
    expected, fixed, _, _ = _forecast("rent", actual="900", history=history, elapsed=31)
    assert (expected, fixed) == (Decimal("900"), Decimal("0"))


# ---------------------------------------------------------------------------
# get_budget_forecast
# ---------------------------------------------------------------------------


@pytest.fixture
def forecast_today(monkeypatch):
    today = date(2025, 4, 3)
    for module in (
        "app.services.budget_forecast_service",
        "app.services.budget_service",
        "app.services.dashboard_service",
    ):
        monkeypatch.setattr(f"{module}.app_today", lambda: today)
    return today


@pytest.mark.asyncio
async def test_get_budget_forecast_learns_from_complete_months(
    session: AsyncSession, test_user, test_workspace, test_categories, forecast_today
):
    account = Account(
        id=uuid.uuid4(),
        user_id=test_user.id,
        workspace_id=test_workspace.id,
        name="Forecast",
        type="checking",
        balance=Decimal("5000"),
        currency="BRL",
    )
    session.add(account)
    await session.commit()
    rent = test_categories[0]
    await create_budget(
        session, test_workspace.id, test_user.id,
        BudgetCreate(category_id=rent.id, amount=Decimal("1000"), month=date(2025, 4, 1)),
    )

    def spend(day: date, amount: str, description: str = "Rent") -> Transaction:
        return Transaction(
            id=uuid.uuid4(),
            user_id=test_user.id,
            workspace_id=test_workspace.id,
            account_id=account.id,
            category_id=rent.id,
            description=description,
            amount=Decimal(amount),
            date=day,
            type="debit",
            source="manual",
            created_at=datetime.now(timezone.utc),
        )

    session.add_all([
        spend(date(2025, 1, 5), "950"),
        spend(date(2025, 2, 5), "950"),
        spend(date(2025, 3, 6), "960"),
        spend(date(2025, 4, 2), "20", "Small fee"),
    ])
    await session.commit()

    forecast = await get_budget_forecast(session, test_workspace.id, test_user.id, date(2025, 4, 1))

    assert (forecast.days_in_month, forecast.days_elapsed, forecast.learned_months) == (30, 3, 3)
    category = next(c for c in forecast.categories if c.category_id == rent.id)
    # Rent has not been paid yet this month: 950 is due on the 5th.
    assert category.fixed_upcoming == Decimal("950.00")
    assert category.expected == Decimal("970.00")
    assert category.daily_upcoming[4] == Decimal("950.00")
    assert category.daily_actual[1] == Decimal("20.00")
    assert len(category.daily_actual) == 30
