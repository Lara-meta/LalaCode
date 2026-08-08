from sqlalchemy import Boolean, Column, DateTime, Integer, JSON, String, Text
from sqlalchemy.sql import func

from ..core.database import Base


class AIChatMessage(Base):
    __tablename__ = "ai_chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(String, nullable=False, default="default", index=True)
    role = Column(String, nullable=False, index=True)
    content = Column(Text, nullable=False)
    actor_email = Column(String, nullable=True, index=True)
    page_context = Column(String, nullable=True)
    grounded = Column(Boolean, nullable=True)
    refused = Column(Boolean, nullable=True)
    citations = Column(JSON, nullable=True)
    tool_calls = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
