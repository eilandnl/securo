"""The mortgage payment API against real PostgreSQL: foreign-key cascades and the
principal-cleanup trigger only behave like production there."""
from datetime import date

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select

from app.core.database import get_async_session
from app.main import app
from app.models.mortgage_payment_allocation import (
    MORTGAGE_PRINCIPAL_SOURCE,
    MortgagePaymentAllocation,
)
from app.models.transaction import Transaction
from tests.test_mortgage_payments_api import (  # noqa: F401 -- rerun on PostgreSQL
    _make_payment_and_loan,
    _post_breakdown,
    test_bank_connected_loan_keeps_split_without_posting_principal,
    test_breakdown_payment_cannot_be_ignored,
    test_breakdown_rows_cannot_become_transfers,
    test_breakdown_can_be_removed_before_editing_payment,
    test_deleting_payment_removes_its_principal_entry,
    test_historical_mortgage_payment_links_without_double_reducing_current_balance,
    test_linked_loan_without_breakdowns_can_become_another_type,
    test_loan_with_breakdowns_cannot_be_deleted_or_retyped,
    test_moving_the_opening_balance_reapplies_the_posting_rule,
    test_payment_after_balance_snapshot_posts_principal_to_loan_ledger,
    test_payment_can_allocate_principal_and_interest_across_loan_parts,
    test_payment_on_snapshot_date_is_already_in_the_balance,
    test_principal_entry_is_owned_by_its_breakdown,
    test_replacing_payment_removes_only_its_previous_principal_transaction,
)


@pytest_asyncio.fixture
async def session(postgres_sessions):
    async with postgres_sessions() as session:
        yield session
        await session.rollback()


@pytest.fixture
def clean_db(postgres_sessions):
    """Each test starts in a fresh per-test PostgreSQL schema."""


@pytest_asyncio.fixture
async def client(postgres_sessions, monkeypatch):
    async def pg_session():
        async with postgres_sessions() as session:
            yield session

    monkeypatch.setitem(app.dependency_overrides, get_async_session, pg_session)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest.mark.asyncio
async def test_one_statement_deleting_payment_and_principal_succeeds(
    client, auth_headers, session, test_user, test_workspace
):
    """Deleting a user's or workspace's rows hits the payment and its principal
    entry in one statement; the cleanup trigger must not reject that."""
    payment, loan = await _make_payment_and_loan(
        session, test_user, test_workspace, snapshot_date=date(2026, 5, 31)
    )
    await _post_breakdown(client, auth_headers, payment, loan)

    await session.execute(delete(Transaction).where(Transaction.user_id == test_user.id))
    await session.commit()

    assert await session.scalar(select(func.count()).select_from(MortgagePaymentAllocation)) == 0
    assert (
        await session.scalar(
            select(func.count())
            .select_from(Transaction)
            .where(Transaction.source == MORTGAGE_PRINCIPAL_SOURCE)
        )
        == 0
    )
