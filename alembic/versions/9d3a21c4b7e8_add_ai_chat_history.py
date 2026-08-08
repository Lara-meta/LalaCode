"""add ai chat history

Revision ID: 9d3a21c4b7e8
Revises: 3eabb5364fac
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "9d3a21c4b7e8"
down_revision: Union[str, None] = "3eabb5364fac"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_chat_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("actor_email", sa.String(), nullable=True),
        sa.Column("page_context", sa.String(), nullable=True),
        sa.Column("grounded", sa.Boolean(), nullable=True),
        sa.Column("refused", sa.Boolean(), nullable=True),
        sa.Column("citations", sa.JSON(), nullable=True),
        sa.Column("tool_calls", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("id", "conversation_id", "role", "actor_email", "created_at"):
        op.create_index(op.f(f"ix_ai_chat_messages_{column}"), "ai_chat_messages", [column], unique=False)


def downgrade() -> None:
    op.drop_table("ai_chat_messages")
