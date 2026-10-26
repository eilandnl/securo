"""Ensure feature schema exists for databases from the legacy migration chain.

Revision ID: 101
Revises: 100
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "101"
down_revision = "100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    account_columns = {column["name"] for column in inspector.get_columns("accounts")}
    if "stable_external_id" not in account_columns:
        op.add_column("accounts", sa.Column("stable_external_id", sa.String(255), nullable=True))
    if "secured_asset_id" not in account_columns:
        op.add_column(
            "accounts",
            sa.Column("secured_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
    if "mortgage_type" not in account_columns:
        op.add_column("accounts", sa.Column("mortgage_type", sa.String(20), nullable=True))
    if "annual_interest_rate" not in account_columns:
        op.add_column(
            "accounts", sa.Column("annual_interest_rate", sa.Numeric(8, 5), nullable=True)
        )
    if "maturity_date" not in account_columns:
        op.add_column("accounts", sa.Column("maturity_date", sa.Date(), nullable=True))

    inspector = sa.inspect(bind)
    account_indexes = {index["name"] for index in inspector.get_indexes("accounts")}
    if "ix_accounts_secured_asset_id" not in account_indexes:
        op.create_index("ix_accounts_secured_asset_id", "accounts", ["secured_asset_id"])
    account_fks = {fk["name"] for fk in inspector.get_foreign_keys("accounts")}
    if "fk_accounts_secured_asset_id_assets" not in account_fks:
        op.create_foreign_key(
            "fk_accounts_secured_asset_id_assets",
            "accounts",
            "assets",
            ["secured_asset_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if "mortgage_payment_allocations" not in inspector.get_table_names():
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
            sa.CheckConstraint(
                "interest_amount >= 0", name="ck_mortgage_payment_interest_nonnegative"
            ),
            sa.UniqueConstraint(
                "payment_transaction_id", "loan_account_id", name="uq_mortgage_payment_loan"
            ),
        )

    inspector = sa.inspect(bind)
    transaction_columns = {column["name"] for column in inspector.get_columns("transactions")}
    if "asset_contribution_asset_id" not in transaction_columns:
        op.add_column(
            "transactions",
            sa.Column("asset_contribution_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
    transaction_indexes = {
        index["name"] for index in sa.inspect(bind).get_indexes("transactions")
    }
    if "ix_transactions_asset_contribution_asset_id" not in transaction_indexes:
        op.create_index(
            "ix_transactions_asset_contribution_asset_id",
            "transactions",
            ["asset_contribution_asset_id"],
        )
    transaction_foreign_keys = {
        fk["name"] for fk in sa.inspect(bind).get_foreign_keys("transactions")
    }
    if "fk_transactions_asset_contribution_asset_id_assets" not in transaction_foreign_keys:
        op.create_foreign_key(
            "fk_transactions_asset_contribution_asset_id_assets",
            "transactions",
            "assets",
            ["asset_contribution_asset_id"],
            ["id"],
            ondelete="SET NULL",
        )

    inspector = sa.inspect(bind)
    allocation_indexes = {
        index["name"] for index in inspector.get_indexes("mortgage_payment_allocations")
    }
    for index_name, column in (
        ("ix_mortgage_payment_allocations_workspace_id", "workspace_id"),
        ("ix_mortgage_payment_allocations_payment_transaction_id", "payment_transaction_id"),
        ("ix_mortgage_payment_allocations_loan_account_id", "loan_account_id"),
    ):
        if index_name not in allocation_indexes:
            op.create_index(index_name, "mortgage_payment_allocations", [column])

    op.execute(
        """
        CREATE OR REPLACE FUNCTION delete_mortgage_principal_entry() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            DELETE FROM transactions
            WHERE id = OLD.loan_transaction_id
              AND source = 'mortgage_principal';
            RETURN NULL;
        END;
        $$;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_trigger
                WHERE tgname = 'trg_delete_mortgage_principal_entry'
                  AND tgrelid = 'mortgage_payment_allocations'::regclass
                  AND NOT tgisinternal
            ) THEN
                CREATE TRIGGER trg_delete_mortgage_principal_entry
                AFTER DELETE ON mortgage_payment_allocations
                FOR EACH ROW WHEN (OLD.loan_transaction_id IS NOT NULL)
                EXECUTE FUNCTION delete_mortgage_principal_entry();
            END IF;
        END;
        $$;
        """
    )


def downgrade() -> None:
    # This is a reconciliation migration. Dropping this schema could destroy
    # mortgage data created by the earlier 097 migration, so downgrade is safe.
    pass
