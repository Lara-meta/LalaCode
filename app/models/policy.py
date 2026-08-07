# app/models/policy.py
from sqlalchemy import Column, Integer, String, Boolean, Float
from ..core.database import Base

class Policy(Base):
    __tablename__ = "policies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    policy_type = Column(String)  # "severity_threshold" | "expedite_spend_limit" | "contract_clause_block"
    threshold_value = Column(Float, nullable=True)  # used by severity/spend rules
    enabled = Column(Boolean, default=True)