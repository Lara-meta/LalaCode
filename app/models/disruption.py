from sqlalchemy import Column, Integer, String, DateTime, JSON
from sqlalchemy.sql import func

from ..core.database import Base


class Disruption(Base):
    __tablename__ = "disruptions"

    id = Column(Integer, primary_key=True, index=True)
    external_id = Column(String, index=True, unique=True)
    raw_data = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())