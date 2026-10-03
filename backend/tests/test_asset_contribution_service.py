from datetime import date
from decimal import Decimal
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset
from app.models.asset_value import AssetValue
from app.models.transaction import Transaction
from app.schemas.asset import AssetUpdate
from app.schemas.transaction import TransactionUpdate
from app.services import asset_service
from app.services.asset_contribution_service import build_contribution_series
from app.services.asset_contribution_service import recalculate_asset_contributions
from app.services.transaction_service import delete_transaction, update_transaction


def test_contribution_is_added_on_its_date_and_compounds_at_annual_rate():
    series = build_contribution_series(
        Decimal("10000"),
        date(2026, 1, 1),
        [(date(2026, 7, 1), Decimal("500"))],
        date(2027, 1, 1),
        Decimal("8"),
    )

    values = dict(series)
    assert values[date(2026, 7, 1)] == Decimal("10889.02")
    assert values[date(2027, 1, 1)] == Decimal("11319.78")


def test_opening_date_and_same_day_contributions_are_included_once():
    series = build_contribution_series(
        Decimal("10000"),
        date(2026, 1, 1),
        [
            (date(2026, 1, 1), Decimal("500")),
            (date(2026, 1, 1), Decimal("250")),
        ],
        date(2026, 1, 1),
        Decimal("8"),
    )
    assert series == [(date(2026, 1, 1), Decimal("10750.00"))]


def test_pre_opening_contributions_are_assumed_in_opening_value():
    series = build_contribution_series(
        Decimal("12500"),
        date(2026, 9, 1),
        [(date(2026, 4, 1), Decimal("500"))],
        date(2026, 9, 1),
        Decimal("8"),
    )
    assert series == [(date(2026, 9, 1), Decimal("12500.00"))]


def test_empty_contribution_list_grows_opening_value_to_today():
    series = build_contribution_series(
        Decimal("10000"), date(2026, 1, 1), [], date(2027, 1, 1), Decimal("8")
    )
    assert series[-1] == (date(2027, 1, 1), Decimal("10800.00"))


@pytest.mark.asyncio
async def test_recalculation_rebuilds_idempotent_asset_values_from_linked_debits(
    session: AsyncSession, test_user, test_workspace, test_account
):
    asset = Asset(
        id=uuid.uuid4(),
        user_id=test_user.id,
        workspace_id=test_workspace.id,
        name="Meesman",
        type="investment",
        currency="EUR",
        valuation_method="growth_rule",
        purchase_date=date(2026, 4, 17),
        purchase_price=Decimal("10000.00"),
        growth_type="percentage",
        growth_rate=Decimal("8"),
        growth_frequency="yearly",
    )
    tx = Transaction(
        user_id=test_user.id,
        workspace_id=test_workspace.id,
        account_id=test_account.id,
        description="Meesman monthly deposit",
        amount=Decimal("500.00"),
        currency="EUR",
        date=date(2026, 5, 1),
        type="debit",
        status="posted",
        source="sync",
        asset_contribution_asset_id=asset.id,
    )
    session.add_all([asset, tx])
    await session.flush()
    session.add(
        AssetValue(
            asset_id=asset.id,
            workspace_id=test_workspace.id,
            amount=Decimal("10100"),
            date=date(2026, 4, 20),
            source="manual",
        )
    )

    await recalculate_asset_contributions(session, asset.id, test_workspace.id)
    first_values = (
        await session.execute(
            select(AssetValue.date, AssetValue.amount, AssetValue.source)
            .where(AssetValue.asset_id == asset.id)
            .order_by(AssetValue.date)
        )
    ).all()
    await recalculate_asset_contributions(session, asset.id, test_workspace.id)
    second_values = (
        await session.execute(
            select(AssetValue.date, AssetValue.amount, AssetValue.source)
            .where(AssetValue.asset_id == asset.id)
            .order_by(AssetValue.date)
        )
    ).all()

    assert first_values == second_values
    assert any(row[2] == "manual" for row in first_values)
    assert any(row[0] == tx.date and row[2] == "contribution" for row in first_values)


@pytest.mark.asyncio
async def test_edit_and_delete_recompute_linked_contribution(
    session: AsyncSession, test_user, test_workspace, test_account
):
    asset = Asset(
        id=uuid.uuid4(),
        user_id=test_user.id,
        workspace_id=test_workspace.id,
        name="Meesman lifecycle",
        type="investment",
        currency="EUR",
        valuation_method="growth_rule",
        purchase_date=date(2026, 4, 17),
        purchase_price=Decimal("10000.00"),
        growth_type="percentage",
        growth_rate=Decimal("8"),
        growth_frequency="yearly",
    )
    tx = Transaction(
        user_id=test_user.id,
        workspace_id=test_workspace.id,
        account_id=test_account.id,
        description="Meesman deposit",
        amount=Decimal("500.00"),
        currency="EUR",
        date=date(2026, 5, 1),
        type="debit",
        status="posted",
        source="sync",
        asset_contribution_asset_id=asset.id,
    )
    session.add_all([asset, tx])
    await session.commit()

    await update_transaction(
        session,
        tx.id,
        test_workspace.id,
        test_user.id,
        TransactionUpdate(amount=Decimal("600.00")),
    )
    edited_history = (
        await session.execute(
            select(AssetValue.amount).where(
                AssetValue.asset_id == asset.id,
                AssetValue.date == tx.date,
                AssetValue.source == "contribution",
            )
        )
    ).scalar_one()
    assert edited_history == Decimal("10629.56")

    await asset_service.update_asset(
        session,
        asset.id,
        test_workspace.id,
        test_user.id,
        AssetUpdate(growth_rate=Decimal("10")),
        regenerate_growth=True,
    )
    updated_rate_history = (
        await session.execute(
            select(AssetValue.amount).where(
                AssetValue.asset_id == asset.id,
                AssetValue.date == tx.date,
                AssetValue.source == "contribution",
            )
        )
    ).scalar_one()
    assert updated_rate_history > edited_history

    assert await delete_transaction(session, tx.id, test_workspace.id)
    post_delete = (
        await session.execute(
            select(AssetValue.amount)
            .where(AssetValue.asset_id == asset.id, AssetValue.source == "contribution")
            .order_by(AssetValue.date.desc())
            .limit(1)
        )
    ).scalar_one()
    assert post_delete < edited_history
