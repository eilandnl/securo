"""link loan accounts to the real-estate asset they are secured against

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
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("accounts")}
    if "secured_asset_id" not in columns:
        op.add_column(
            "accounts",
            sa.Column("secured_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
    indexes = {index["name"] for index in sa.inspect(bind).get_indexes("accounts")}
    if "ix_accounts_secured_asset_id" not in indexes:
        op.create_index("ix_accounts_secured_asset_id", "accounts", ["secured_asset_id"])
    foreign_keys = {fk["name"] for fk in sa.inspect(bind).get_foreign_keys("accounts")}
    if "fk_accounts_secured_asset_id_assets" not in foreign_keys:
        op.create_foreign_key(
            "fk_accounts_secured_asset_id_assets",
            "accounts",
            "assets",
            ["secured_asset_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    op.drop_constraint("fk_accounts_secured_asset_id_assets", "accounts", type_="foreignkey")
    op.drop_index("ix_accounts_secured_asset_id", table_name="accounts")
    op.drop_column("accounts", "secured_asset_id")
