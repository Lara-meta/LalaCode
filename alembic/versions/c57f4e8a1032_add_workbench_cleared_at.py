"""add workbench cleared at

Revision ID: c57f4e8a1032
Revises: b84e19a620d1
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "c57f4e8a1032"
down_revision: Union[str, None] = "b84e19a620d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("workbench_items", sa.Column("cleared_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_workbench_items_cleared_at"), "workbench_items", ["cleared_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_workbench_items_cleared_at"), table_name="workbench_items")
    op.drop_column("workbench_items", "cleared_at")
