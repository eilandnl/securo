"""Replay linked bank deposits into percentage-growth investment history."""

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_clock import app_today
from app.models.asset import Asset
from app.models.asset_value import AssetValue
from app.models.transaction import Transaction

CENT = Decimal("0.01")


def _actual_year_fraction(start: date, end: date) -> Decimal:
    """Actual/actual year fraction, so calendar anniversaries equal one year."""
    total = Decimal("0")
    cursor = start
    while cursor < end:
        boundary = date(cursor.year + 1, 1, 1)
        segment_end = min(boundary, end)
        year_days = Decimal("366" if _is_leap_year(cursor.year) else "365")
        total += Decimal((segment_end - cursor).days) / year_days
        cursor = segment_end
    return total


def _is_leap_year(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def build_contribution_series(
    opening_value: Decimal,
    opening_date: date,
    contributions: list[tuple[date, Decimal]],
    through: date,
    annual_rate_percent: Decimal,
) -> list[tuple[date, Decimal]]:
    """Return dated values after contributions and effective annual growth.

    The opening value is the already-owned position on ``opening_date``.
    Contributions before that date are ignored because they are part of that
    opening balance. Deposits on the opening date are included. Fractional
    years use calendar days, while values are rounded to cents at each emitted
    point. Duplicate deposits on a date are added together.
    """
    if through < opening_date:
        return []

    by_date: dict[date, Decimal] = {}
    for contribution_date, amount in contributions:
        if contribution_date < opening_date or contribution_date > through or amount <= 0:
            continue
        by_date[contribution_date] = by_date.get(contribution_date, Decimal("0")) + amount

    # Monthly chart points plus transaction dates. Each point is reconstructed
    # from the previous one, so later edits/unlinks are deterministic.
    month_dates: set[date] = set()
    year, month = opening_date.year, opening_date.month
    while True:
        month += 1
        if month == 13:
            month = 1
            year += 1
        day = min(opening_date.day, 28)
        point = date(year, month, day)
        if point > through:
            break
        month_dates.add(point)

    timeline = sorted({opening_date, through, *month_dates, *by_date})
    value = opening_value
    previous = opening_date
    out: list[tuple[date, Decimal]] = []
    annual_factor = Decimal("1") + annual_rate_percent / Decimal("100")
    for point in timeline:
        if point > previous:
            years = _actual_year_fraction(previous, point)
            value *= annual_factor**years
        value += by_date.get(point, Decimal("0"))
        if point >= opening_date:
            out.append((point, value.quantize(CENT, rounding=ROUND_HALF_UP)))
        previous = point
    return out


async def recalculate_asset_contributions(
    session: AsyncSession,
    asset_id,
    workspace_id,
) -> None:
    """Rebuild growth snapshots for an investment asset from linked debits."""
    asset_result = await session.execute(
        select(Asset).where(
            Asset.id == asset_id,
            Asset.workspace_id == workspace_id,
        )
    )
    asset = asset_result.scalar_one_or_none()
    if (
        asset is None
        or asset.type != "investment"
        or asset.valuation_method != "growth_rule"
        or asset.growth_type != "percentage"
        or asset.growth_rate is None
        or asset.purchase_price is None
    ):
        return

    # A hand-recorded value is the safest opening snapshot when a user is
    # enabling links on an asset that already includes older contributions.
    # Deposits on or before that snapshot are already represented in its value,
    # so replay only starts after it. Newer generated rows are deliberately
    # excluded here because this service replaces those rows on every replay.
    opening_value = Decimal(asset.purchase_price)
    opening_date = asset.purchase_date or asset.growth_start_date
    manual_query = select(AssetValue).where(
        AssetValue.asset_id == asset.id,
        AssetValue.source.in_(("manual", "sync")),
    )
    if asset.purchase_date is not None:
        manual_query = manual_query.where(AssetValue.date >= asset.purchase_date)
    manual_result = await session.execute(
        manual_query.order_by(AssetValue.date.desc(), AssetValue.id.desc()).limit(1)
    )
    manual_opening = manual_result.scalar_one_or_none()
    opening_includes_contributions = manual_opening is not None
    if manual_opening is not None:
        opening_value = Decimal(manual_opening.amount)
        opening_date = manual_opening.date
    if opening_date is None:
        return

    tx_result = await session.execute(
        select(Transaction.date, Transaction.amount)
        .where(
            Transaction.workspace_id == workspace_id,
            Transaction.asset_contribution_asset_id == asset.id,
            Transaction.type == "debit",
            Transaction.status == "posted",
            Transaction.is_ignored.is_(False),
            Transaction.currency == asset.currency,
        )
        .order_by(Transaction.date, Transaction.id)
    )
    contributions = [(row.date, Decimal(row.amount)) for row in tx_result.all()]
    if opening_includes_contributions:
        contributions = [item for item in contributions if item[0] > opening_date]
    values = build_contribution_series(
        opening_value=opening_value,
        opening_date=opening_date,
        contributions=contributions,
        through=app_today(),
        annual_rate_percent=Decimal(asset.growth_rate),
    )

    await session.execute(
        delete(AssetValue).where(
            AssetValue.asset_id == asset.id,
            AssetValue.source.in_(("rule", "contribution")),
        )
    )
    for value_date, amount in values:
        session.add(
            AssetValue(
                asset_id=asset.id,
                workspace_id=workspace_id,
                amount=amount,
                date=value_date,
                source="contribution",
            )
        )
    await session.flush()
