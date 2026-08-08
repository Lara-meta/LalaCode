"""allow resumed workbench status

Revision ID: f4a8c2d7e901
Revises: e02f93ac31b7
"""
from alembic import op


revision = "f4a8c2d7e901"
down_revision = "e02f93ac31b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE workbench_items "
        "DROP CONSTRAINT IF EXISTS workbench_items_status_check"
    )
    op.execute(
        "ALTER TABLE workbench_items ADD CONSTRAINT "
        "workbench_items_status_check CHECK "
        "(status IN ('pending', 'held', 'approved', 'modified', "
        "'rejected', 'resumed'))"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE workbench_items SET status = 'approved' "
        "WHERE status = 'resumed'"
    )
    op.execute(
        "ALTER TABLE workbench_items "
        "DROP CONSTRAINT IF EXISTS workbench_items_status_check"
    )
    op.execute(
        "ALTER TABLE workbench_items ADD CONSTRAINT "
        "workbench_items_status_check CHECK "
        "(status IN ('pending', 'held', 'approved', 'modified', 'rejected'))"
    )
