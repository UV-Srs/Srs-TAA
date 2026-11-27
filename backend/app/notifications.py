from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.app.models import InAppNotification, NotificationRead, InspectionBatch, User, AuditLog
from backend.app.live_sync import notify_live

def send_notification(
    db: Session,
    roles: List[str],
    text: str,
    batch_id: Optional[int] = None,
    batch_code: Optional[str] = None,
    user_ids: Optional[List[int]] = None,
    kind: str = "info",
    severity: str = "info",
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
            kind=kind,
            severity=severity,
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
                kind=kind,
                severity=severity,
                created_at=datetime.utcnow()
            )
            db.add(notif)
    db.flush()

    notify_live("NOTIFICATION_DISPATCHED", {
        "roles": roles,
        "text": text,
        "batch_id": batch_id,
        "batch_code": batch_code,
        "kind": kind,
        "severity": severity,
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
            user_ids=[b.hold_by] if b.hold_by else None,
            kind="hold",
            severity="critical",
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

def _visible(user: User):
    """Notifications addressed to the user's role or to the user directly."""
    return or_(
        InAppNotification.recipient_role == user.role,
        InAppNotification.recipient_user_id == user.user_id,
    )


def _read_ids(db: Session, user: User):
    return db.query(NotificationRead.notification_id).filter(NotificationRead.user_id == user.user_id)


def _is_unread():
    return func.coalesce(InAppNotification.is_read, False).is_(False)


def _as_dict(n: InAppNotification, read: bool) -> dict:
    return {
        "notification_id": n.notification_id,
        "recipient_role": n.recipient_role,
        "recipient_user_id": n.recipient_user_id,
        "batch_id": n.batch_id,
        "batch_code": n.batch_code,
        "text": n.text,
        "kind": n.kind or "info",
        "severity": n.severity or "info",
        "is_read": read,
        "created_at": n.created_at,
    }


def list_user_notifications(
    db: Session, user: User, limit: int = 50, offset: int = 0,
    unread_only: bool = False, kind: Optional[str] = None,
) -> dict:
    """One page of the user's notifications plus totals. Read state is per user."""
    read_ids = _read_ids(db, user)
    q = db.query(InAppNotification).filter(_visible(user))
    if kind:
        q = q.filter(InAppNotification.kind == kind)
    if unread_only:
        q = q.filter(~InAppNotification.notification_id.in_(read_ids), _is_unread())
    total = q.count()
    rows = q.order_by(InAppNotification.created_at.desc(), InAppNotification.notification_id.desc())         .offset(offset).limit(limit).all()
    seen = {r[0] for r in db.query(NotificationRead.notification_id).filter(
        NotificationRead.user_id == user.user_id,
        NotificationRead.notification_id.in_([n.notification_id for n in rows] or [0]),
    ).all()}
    items = [_as_dict(n, n.notification_id in seen or bool(n.is_read)) for n in rows]
    unread_total = db.query(InAppNotification).filter(
        _visible(user), ~InAppNotification.notification_id.in_(read_ids), _is_unread()
    ).count()
    return {"items": items, "total": total, "unread_total": unread_total, "offset": offset, "limit": limit}


def get_user_notifications(db: Session, user: User, limit: int = 50) -> List[dict]:
    """The latest notifications for the logged in user (the header bell)."""
    return list_user_notifications(db, user, limit=limit)["items"]


def _mark_read(db: Session, user: User, notification_ids: List[int]) -> None:
    if not notification_ids:
        return
    now = datetime.utcnow()
    db.execute(
        pg_insert(NotificationRead).values(
            [{"notification_id": i, "user_id": user.user_id, "read_at": now} for i in notification_ids]
        ).on_conflict_do_nothing()
    )
    # Notifications addressed to this one user also carry the flag on the row itself.
    db.query(InAppNotification).filter(
        InAppNotification.notification_id.in_(notification_ids),
        InAppNotification.recipient_user_id == user.user_id,
    ).update({"is_read": True}, synchronize_session=False)
    db.commit()


def mark_all_user_notifications_read(db: Session, user: User):
    ids = [r[0] for r in db.query(InAppNotification.notification_id).filter(
        _visible(user), ~InAppNotification.notification_id.in_(_read_ids(db, user)), _is_unread()
    ).all()]
    _mark_read(db, user, ids)


def mark_single_notification_read(db: Session, user: User, notification_id: int):
    exists = db.query(InAppNotification.notification_id).filter(
        InAppNotification.notification_id == notification_id, _visible(user)
    ).first()
    if exists:
        _mark_read(db, user, [notification_id])
