from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func

from ..core.database import Base


class OperatorResult(Base):
    __tablename__ = "operator_results"

    id = Column(Integer, primary_key=True, index=True)
    agent_run_id = Column(Integer, ForeignKey("agent_runs.id"), index=True)
    operator_name = Column(String, index=True)
    status = Column(String)
    output = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())