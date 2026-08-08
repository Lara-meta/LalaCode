"""add notifications

Revision ID: b84e19a620d1
Revises: 9d3a21c4b7e8
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "b84e19a620d1"
down_revision: Union[str, None] = "9d3a21c4b7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("message", sa.String(), nullable=False),
        sa.Column("notification_type", sa.String(), nullable=False),
        sa.Column("link", sa.String(), nullable=True),
        sa.Column("read", sa.Boolean(), nullable=False),
        sa.Column("agent_run_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("id", "read", "agent_run_id", "created_at"):
        op.create_index(op.f(f"ix_notifications_{column}"), "notifications", [column], unique=False)


def downgrade() -> None:
    op.drop_table("notifications")
