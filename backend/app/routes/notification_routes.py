from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from backend.app.database import get_db
from backend.app.models import User
from backend.app.auth import require_any_authenticated
from backend.app.schemas import NotificationResponse
from backend.app.notifications import (
    get_user_notifications, mark_all_user_notifications_read, mark_single_notification_read
)

router = APIRouter(prefix="/api/notifications", tags=["In-App Notifications"])

class MarkReadPayload(BaseModel):
    notification_id: Optional[int] = None

@router.get("", response_model=List[NotificationResponse])
def get_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_authenticated),
    limit: int = Query(50, ge=1, le=200)
):
    return get_user_notifications(db=db, user=current_user, limit=limit)

@router.post("/mark-read")
def mark_read(
    payload: MarkReadPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_authenticated)
):
    if payload.notification_id:
        mark_single_notification_read(db=db, user=current_user, notification_id=payload.notification_id)
    else:
        mark_all_user_notifications_read(db=db, user=current_user)
    return {"status": "success"}
