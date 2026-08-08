from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func

from ..core.database import Base


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id = Column(Integer, primary_key=True, index=True)
    disruption_id = Column(Integer, ForeignKey("disruptions.id"), index=True)
    supervity_run_id = Column(String, nullable=True, index=True)
    status = Column(String, default="running", index=True)
    result = Column(JSON, nullable=True)
    policy_context = Column(JSON, nullable=True)
    policy_context_stage = Column(String, nullable=True)
    triggered_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
