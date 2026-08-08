"""add integration registry

Revision ID: e82a41f0c9d3
Revises: d91e5f720a44
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e82a41f0c9d3"
down_revision: Union[str, None] = "d91e5f720a44"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "integrations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("purpose", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("health_url", sa.String(), nullable=True),
        sa.Column("configured", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("last_status", sa.String(), nullable=False, server_default="unknown"),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("name"),
    )
    for column in ("id", "name", "category", "last_status"):
        op.create_index(op.f(f"ix_integrations_{column}"), "integrations", [column])


def downgrade() -> None:
    op.drop_table("integrations")
