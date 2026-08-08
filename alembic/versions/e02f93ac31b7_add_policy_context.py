"""add normalized policy context

Revision ID: e02f93ac31b7
Revises: e82a41f0c9d3
"""
from alembic import op
import sqlalchemy as sa

revision = "e02f93ac31b7"
down_revision = "e82a41f0c9d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("policies", sa.Column("comparison_value", sa.JSON(), nullable=True))
    op.add_column("policy_evaluations", sa.Column("comparison_value", sa.JSON(), nullable=True))
    op.add_column("agent_runs", sa.Column("policy_context", sa.JSON(), nullable=True))
    op.add_column("agent_runs", sa.Column("policy_context_stage", sa.String(), nullable=True))
    op.execute("UPDATE policies SET field_name = 'contract_clauses' WHERE field_name = 'x_escalation_clause'")


def downgrade() -> None:
    op.drop_column("agent_runs", "policy_context_stage")
    op.drop_column("agent_runs", "policy_context")
    op.drop_column("policies", "comparison_value")
    op.drop_column("policy_evaluations", "comparison_value")
