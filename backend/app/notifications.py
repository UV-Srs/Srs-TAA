from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_

from backend.app.models import InAppNotification, InspectionBatch, User, AuditLog
from backend.app.live_sync import notify_live

def send_notification(
    db: Session,
    roles: List[str],
    text: str,
    batch_id: Optional[int] = None,
    batch_code: Optional[str] = None,
    user_ids: Optional[List[int]] = None
):
    """
    FR-052 & FR-053: Dispatches in-app notifications to roles or specific user IDs.
    """
    for role in roles:
        notif = InAppNotification(
            recipient_role=role,
            batch_id=batch_id,
            batch_code=batch_code,
            text=text,
            is_read=False,
            created_at=datetime.utcnow()
        )
        db.add(notif)

    if user_ids:
        for uid in user_ids:
            notif = InAppNotification(
                recipient_user_id=uid,
                batch_id=batch_id,
                batch_code=batch_code,
                text=text,
                is_read=False,
                created_at=datetime.utcnow()
            )
            db.add(notif)
    db.flush()

    notify_live("NOTIFICATION_DISPATCHED", {
        "roles": roles,
        "text": text,
        "batch_id": batch_id,
        "batch_code": batch_code
    })

def check_overdue_holds(db: Session):
    """
    FR-056: Checks if any ON_HOLD batches have exceeded their hold_due_at deadline.
    Alerts Admin and the supervisor who placed the hold, and flags hold_alerted.
    """
    now = datetime.utcnow()
    overdue_batches = db.query(InspectionBatch).filter(
        InspectionBatch.status == "ON_HOLD",
        InspectionBatch.hold_due_at != None,
        InspectionBatch.hold_due_at <= now,
        InspectionBatch.hold_alerted == False
    ).all()

    for b in overdue_batches:
        b.hold_alerted = True
        msg = f"Hold on {b.lot_number} is overdue. Reason: {b.hold_reason or 'No reason specified'}."

        # Alert admin and hold owner
        send_notification(
            db=db,
            roles=["admin"],
            text=msg,
            batch_id=b.batch_id,
            batch_code=b.lot_number,
            user_ids=[b.hold_by] if b.hold_by else None
        )

        # Audit log entry
        audit = AuditLog(
            user_id=None,
            role="system",
            action_type="HOLD_OVERDUE_ESCALATION",
            sheet_id=b.sheet_id,
            batch_id=b.batch_id,
            details={
                "batch_code": b.lot_number,
                "hold_due_at": b.hold_due_at.isoformat() if b.hold_due_at else None,
                "reason": b.hold_reason
            },
            created_at=now
        )
        db.add(audit)

    if overdue_batches:
        db.commit()

def get_user_notifications(db: Session, user: User, limit: int = 50) -> List[InAppNotification]:
    """
    Returns unread and recent notifications for the logged in user based on role or user_id.
    """
    check_overdue_holds(db)
    return db.query(InAppNotification).filter(
        or_(
            InAppNotification.recipient_role == user.role,
            InAppNotification.recipient_user_id == user.user_id
        )
    ).order_by(InAppNotification.created_at.desc()).limit(limit).all()

def mark_all_user_notifications_read(db: Session, user: User):
    db.query(InAppNotification).filter(
        or_(
            InAppNotification.recipient_role == user.role,
            InAppNotification.recipient_user_id == user.user_id
        ),
        InAppNotification.is_read == False
    ).update({"is_read": True}, synchronize_session=False)
    db.commit()

def mark_single_notification_read(db: Session, user: User, notification_id: int):
    notif = db.query(InAppNotification).filter(
        InAppNotification.notification_id == notification_id,
        or_(
            InAppNotification.recipient_role == user.role,
            InAppNotification.recipient_user_id == user.user_id
        )
    ).first()
    if notif:
        notif.is_read = True
        db.commit()
