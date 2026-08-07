from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func

from ..core.database import Base


class PolicyEvaluation(Base):
    __tablename__ = "policy_evaluations"

    id = Column(Integer, primary_key=True, index=True)
    agent_run_id = Column(Integer, ForeignKey("agent_runs.id"), index=True)
    policy_name = Column(String, index=True)
    passed = Column(Boolean)
    reason = Column(String, nullable=True)
    evaluated_at = Column(DateTime(timezone=True), server_default=func.now())