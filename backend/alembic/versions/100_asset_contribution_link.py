"""link bank transactions to investment contributions

Revision ID: 100
Revises: 099
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "100"
down_revision = "099"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("transactions")}
    if "asset_contribution_asset_id" not in columns:
        op.add_column(
            "transactions",
            sa.Column("asset_contribution_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
    indexes = {index["name"] for index in sa.inspect(bind).get_indexes("transactions")}
    if "ix_transactions_asset_contribution_asset_id" not in indexes:
        op.create_index(
            "ix_transactions_asset_contribution_asset_id",
            "transactions",
            ["asset_contribution_asset_id"],
        )
    foreign_keys = {fk["name"] for fk in sa.inspect(bind).get_foreign_keys("transactions")}
    if "fk_transactions_asset_contribution_asset_id_assets" not in foreign_keys:
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
