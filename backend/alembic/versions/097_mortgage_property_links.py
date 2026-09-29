"""link loan accounts to real estate and store mortgage payment breakdowns

Revision ID: 097
Revises: 096
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "097"
down_revision = "096"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("secured_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_accounts_secured_asset_id", "accounts", ["secured_asset_id"])
    op.create_foreign_key(
        "fk_accounts_secured_asset_id_assets",
        "accounts",
        "assets",
        ["secured_asset_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("accounts", sa.Column("mortgage_type", sa.String(20), nullable=True))
    op.add_column("accounts", sa.Column("annual_interest_rate", sa.Numeric(8, 5), nullable=True))
    op.add_column("accounts", sa.Column("maturity_date", sa.Date(), nullable=True))

    op.create_table(
        "mortgage_payment_allocations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "payment_transaction_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("transactions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "loan_account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("principal_amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("interest_amount", sa.Numeric(15, 2), nullable=False),
        # Null when no principal entry was posted: interest-only, a payment
        # already covered by the loan's opening balance, or a bank-connected loan.
        sa.Column(
            "loan_transaction_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("transactions.id", ondelete="CASCADE"),
            nullable=True,
            unique=True,
        ),
        sa.CheckConstraint(
            "principal_amount >= 0", name="ck_mortgage_payment_principal_nonnegative"
        ),
        sa.CheckConstraint("interest_amount >= 0", name="ck_mortgage_payment_interest_nonnegative"),
        sa.UniqueConstraint(
            "payment_transaction_id", "loan_account_id", name="uq_mortgage_payment_loan"
        ),
    )
    op.create_index(
        "ix_mortgage_payment_allocations_workspace_id",
        "mortgage_payment_allocations",
        ["workspace_id"],
    )
    op.create_index(
        "ix_mortgage_payment_allocations_payment_transaction_id",
        "mortgage_payment_allocations",
        ["payment_transaction_id"],
    )
    op.create_index(
        "ix_mortgage_payment_allocations_loan_account_id",
        "mortgage_payment_allocations",
        ["loan_account_id"],
    )

    # A bank payment can be deleted from many places (single and bulk delete,
    # account or user deletion, provider sync). Deleting it cascades to its
    # breakdown rows, and each of those takes its principal entry with it, or
    # the loan would stay reduced. AFTER DELETE on the breakdown table, because
    # a BEFORE trigger on transactions fails when one statement deletes both
    # the payment and its principal entry.
    op.execute("""
        CREATE FUNCTION delete_mortgage_principal_entry() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            DELETE FROM transactions
            WHERE id = OLD.loan_transaction_id
              AND source = 'mortgage_principal';
            RETURN NULL;
        END;
        $$;
    """)
    op.execute("""
        CREATE TRIGGER trg_delete_mortgage_principal_entry
        AFTER DELETE ON mortgage_payment_allocations
        FOR EACH ROW WHEN (OLD.loan_transaction_id IS NOT NULL)
        EXECUTE FUNCTION delete_mortgage_principal_entry();
    """)


def downgrade() -> None:
    # Principal entries only exist because of a breakdown; drop them with it
    # (the trigger removes each one as its breakdown row goes).
    op.execute("DELETE FROM mortgage_payment_allocations")
    op.execute("DELETE FROM transactions WHERE source = 'mortgage_principal'")
    op.drop_table("mortgage_payment_allocations")
    op.execute("DROP FUNCTION delete_mortgage_principal_entry()")
    op.drop_column("accounts", "maturity_date")
    op.drop_column("accounts", "annual_interest_rate")
    op.drop_column("accounts", "mortgage_type")
    op.drop_constraint("fk_accounts_secured_asset_id_assets", "accounts", type_="foreignkey")
    op.drop_index("ix_accounts_secured_asset_id", table_name="accounts")
    op.drop_column("accounts", "secured_asset_id")
