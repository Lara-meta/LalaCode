"""add policy governance

Revision ID: d91e5f720a44
Revises: c57f4e8a1032
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "d91e5f720a44"
down_revision: Union[str, None] = "c57f4e8a1032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    policy_columns = [
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=True, server_default="active"),
        sa.Column("version", sa.Integer(), nullable=True, server_default="1"),
        sa.Column("field_name", sa.String(), nullable=True),
        sa.Column("operator", sa.String(), nullable=True, server_default="gt"),
        sa.Column("unit", sa.String(), nullable=True),
        sa.Column("action", sa.String(), nullable=True, server_default="block"),
        sa.Column("scope", sa.JSON(), nullable=True),
        sa.Column("fail_mode", sa.String(), nullable=True, server_default="closed"),
        sa.Column("priority", sa.Integer(), nullable=True, server_default="100"),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("effective_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("updated_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("last_simulated_version", sa.Integer(), nullable=True),
        sa.Column("last_simulated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_simulation_summary", sa.JSON(), nullable=True),
    ]
    for column in policy_columns:
        op.add_column("policies", column)
    op.create_index(op.f("ix_policies_status"), "policies", ["status"])

    evaluation_columns = [
        sa.Column("policy_id", sa.Integer(), nullable=True),
        sa.Column("policy_version", sa.Integer(), nullable=True),
        sa.Column("outcome", sa.String(), nullable=True, server_default="pass"),
        sa.Column("input_field", sa.String(), nullable=True),
        sa.Column("input_value", sa.String(), nullable=True),
        sa.Column("operator", sa.String(), nullable=True),
        sa.Column("threshold_value", sa.Float(), nullable=True),
        sa.Column("calculation", sa.String(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("final_effect", sa.String(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
    ]
    for column in evaluation_columns:
        op.add_column("policy_evaluations", column)
    op.create_foreign_key("fk_policy_evaluations_policy", "policy_evaluations", "policies", ["policy_id"], ["id"])
    op.create_index(op.f("ix_policy_evaluations_policy_id"), "policy_evaluations", ["policy_id"])
    op.create_index(op.f("ix_policy_evaluations_outcome"), "policy_evaluations", ["outcome"])

    op.create_table("policy_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("policy_id", sa.Integer(), sa.ForeignKey("policies.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("change_reason", sa.String(), nullable=True),
        sa.Column("changed_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    for column in ("id", "policy_id", "created_at"):
        op.create_index(op.f(f"ix_policy_versions_{column}"), "policy_versions", [column])
    op.create_table("policy_audits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("policy_id", sa.Integer(), sa.ForeignKey("policies.id"), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("from_version", sa.Integer(), nullable=True),
        sa.Column("to_version", sa.Integer(), nullable=True),
        sa.Column("actor", sa.String(), nullable=True),
        sa.Column("reason", sa.String(), nullable=True),
        sa.Column("changes", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    for column in ("id", "policy_id", "action", "created_at"):
        op.create_index(op.f(f"ix_policy_audits_{column}"), "policy_audits", [column])

    op.execute("""UPDATE policies SET
      description = CASE policy_type WHEN 'severity_threshold' THEN 'Blocks disruptions whose severity exceeds the configured score.' WHEN 'expedite_spend_limit' THEN 'Blocks expedited recovery when estimated cost exceeds the configured limit.' ELSE 'Blocks disruptions containing an escalation clause.' END,
      field_name = CASE policy_type WHEN 'severity_threshold' THEN 'severity' WHEN 'expedite_spend_limit' THEN 'expedite_cost' ELSE 'x_escalation_clause' END,
      operator = CASE WHEN policy_type = 'contract_clause_block' THEN 'not_empty' ELSE 'gt' END,
      unit = CASE policy_type WHEN 'severity_threshold' THEN 'score_10' WHEN 'expedite_spend_limit' THEN 'USD' ELSE NULL END,
      status = CASE WHEN enabled THEN 'active' ELSE 'draft' END,
      version = 1, action = 'block', fail_mode = 'closed', priority = 100""")


def downgrade() -> None:
    op.drop_table("policy_audits")
    op.drop_table("policy_versions")
    op.drop_constraint("fk_policy_evaluations_policy", "policy_evaluations", type_="foreignkey")
    for name in ("duration_ms", "final_effect", "details", "calculation", "threshold_value", "operator", "input_value", "input_field", "outcome", "policy_version", "policy_id"):
        op.drop_column("policy_evaluations", name)
    for name in ("last_simulation_summary", "last_simulated_at", "last_simulated_version", "updated_at", "created_at", "updated_by", "created_by", "effective_until", "effective_from", "priority", "fail_mode", "scope", "action", "unit", "operator", "field_name", "version", "status", "description"):
        op.drop_column("policies", name)
