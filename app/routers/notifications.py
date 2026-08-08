from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.notification import Notification


router = APIRouter(prefix="/notifications", tags=["notifications"])


def _serialize(item: Notification) -> dict:
    return {
        "id": item.id,
        "type": item.notification_type,
        "title": item.title,
        "message": item.message,
        "link": item.link,
        "read": item.read,
        "agent_run_id": item.agent_run_id,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


@router.get("")
def list_notifications(limit: int = 30, db: Session = Depends(get_db)):
    items = (db.query(Notification).order_by(Notification.created_at.desc(), Notification.id.desc())
             .limit(max(1, min(limit, 100))).all())
    return {"notifications": [_serialize(item) for item in items],
            "unread_count": db.query(Notification).filter(Notification.read.is_(False)).count()}


@router.patch("/{notification_id}/read")
def mark_notification_read(notification_id: int, db: Session = Depends(get_db)):
    item = db.query(Notification).filter(Notification.id == notification_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Notification not found.")
    item.read = True
    db.commit()
    return _serialize(item)


@router.post("/read-all")
def mark_all_notifications_read(db: Session = Depends(get_db)):
    updated = (db.query(Notification).filter(Notification.read.is_(False))
               .update({Notification.read: True}, synchronize_session=False))
    db.commit()
    return {"updated": updated}
