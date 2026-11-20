from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from backend.app.models import AuditLog

def log_audit(
    db: Session,
    user_id: Optional[int],
    role: Optional[str],
    action_type: str,
    sheet_id: Optional[str] = None,
    batch_id: Optional[int] = None,
    details: Optional[Dict[str, Any]] = None,
) -> AuditLog:
    """Records an audit event in audit_logs."""
    log_entry = AuditLog(
        user_id=user_id,
        role=role,
        action_type=action_type,
        sheet_id=sheet_id,
        batch_id=batch_id,
        details=details or {},
    )
    db.add(log_entry)
    db.commit()
    db.refresh(log_entry)
    return log_entry

def purge_user_audit_logs(db: Session, user_id: int) -> int:
    """
    FR-005: Purges all audit_logs associated with a user_id upon
    deactivation or deletion, preserving historical batch records.
    Returns the count of purged logs.
    """
    deleted_count = db.query(AuditLog).filter(AuditLog.user_id == user_id).delete(synchronize_session=False)
    db.commit()
    return deleted_count
