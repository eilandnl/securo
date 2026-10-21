"""add stable_external_id to accounts (Enable Banking reauth duplication)

Revision ID: 099
Revises: 098
Create Date: 2026-10-02

Enable Banking identifies an account by a `uid` that is scoped to a single
session, so reauthorising (which mints a new session) hands back a new uid for
the same real account. The sync matched accounts only on `external_id`, so it
inserted a second row and left the original — with its transactions, rules and
name overrides — behind.

EB publishes an `identification_hash` precisely to match the same account across
sessions. Persist it here so the sync can rebind the existing row to the new uid
instead of duplicating.

Additive and nullable: existing rows are unaffected and backfill themselves on
the next sync, since `stable_external_id` is provider-owned like `masked_number`.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "099"
down_revision: Union[str, None] = "098"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("accounts")}
    if "stable_external_id" not in columns:
        op.add_column("accounts", sa.Column("stable_external_id", sa.String(255), nullable=True))


def downgrade() -> None:
    # Some databases may already have received this column under the collided
    # 097 revision. Preserve it when downgrading through the reconciled graph.
    pass
