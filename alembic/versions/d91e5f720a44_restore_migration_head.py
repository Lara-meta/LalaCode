"""restore migration head

Revision ID: d91e5f720a44
Revises: c57f4e8a1032

The database was previously advanced to this revision, but the no-op head
migration was not retained in source control. Keeping it restores a complete
Alembic revision graph without changing the already-migrated schema.
"""
from typing import Sequence, Union


revision: str = "d91e5f720a44"
down_revision: Union[str, None] = "c57f4e8a1032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
