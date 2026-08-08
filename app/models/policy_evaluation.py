from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float, JSON
from sqlalchemy.sql import func

from ..core.database import Base


class PolicyEvaluation(Base):
    __tablename__ = "policy_evaluations"

    id = Column(Integer, primary_key=True, index=True)
    agent_run_id = Column(Integer, ForeignKey("agent_runs.id"), index=True)
    policy_name = Column(String, index=True)
    passed = Column(Boolean)
    reason = Column(String, nullable=True)
    policy_id = Column(Integer, ForeignKey("policies.id"), nullable=True, index=True)
    policy_version = Column(Integer, nullable=True)
    outcome = Column(String, default="pass", index=True)
    input_field = Column(String, nullable=True)
    input_value = Column(String, nullable=True)
    operator = Column(String, nullable=True)
    threshold_value = Column(Float, nullable=True)
    calculation = Column(String, nullable=True)
    details = Column(JSON, nullable=True)
    final_effect = Column(String, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    evaluated_at = Column(DateTime(timezone=True), server_default=func.now())
