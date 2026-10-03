"""link bank transactions to investment contributions

Revision ID: 098
Revises: 097
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "098"
down_revision = "097"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column("asset_contribution_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "ix_transactions_asset_contribution_asset_id",
        "transactions",
        ["asset_contribution_asset_id"],
    )
    op.create_foreign_key(
        "fk_transactions_asset_contribution_asset_id_assets",
        "transactions",
        "assets",
        ["asset_contribution_asset_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_transactions_asset_contribution_asset_id_assets",
        "transactions",
        type_="foreignkey",
    )
    op.drop_index("ix_transactions_asset_contribution_asset_id", table_name="transactions")
    op.drop_column("transactions", "asset_contribution_asset_id")
