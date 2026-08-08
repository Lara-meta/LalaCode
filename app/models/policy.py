# app/models/policy.py
from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, JSON
from sqlalchemy.sql import func
from ..core.database import Base

class Policy(Base):
    __tablename__ = "policies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    policy_type = Column(String)  # "severity_threshold" | "expedite_spend_limit" | "contract_clause_block"
    threshold_value = Column(Float, nullable=True)  # used by severity/spend rules
    enabled = Column(Boolean, default=True)
    description = Column(String, nullable=True)
    status = Column(String, default="active", index=True)
    version = Column(Integer, default=1)
    field_name = Column(String, nullable=True)
    operator = Column(String, default="gt")
    unit = Column(String, nullable=True)
    action = Column(String, default="block")
    scope = Column(JSON, nullable=True)
    fail_mode = Column(String, default="closed")
    priority = Column(Integer, default=100)
    effective_from = Column(DateTime(timezone=True), nullable=True)
    effective_until = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(String, nullable=True)
    updated_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_simulated_version = Column(Integer, nullable=True)
    last_simulated_at = Column(DateTime(timezone=True), nullable=True)
    last_simulation_summary = Column(JSON, nullable=True)
