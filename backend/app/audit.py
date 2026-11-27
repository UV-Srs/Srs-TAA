from contextvars import ContextVar
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from backend.app.models import AuditLog, User

# Client address and browser of the request being handled, set once per request by the
# middleware in main.py, so every audit row can record them without each route passing them.
_request_ctx: ContextVar[Dict[str, Optional[str]]] = ContextVar("audit_request_ctx", default={})


def set_request_context(ip: Optional[str], user_agent: Optional[str]) -> None:
    _request_ctx.set({"ip": ip, "ua": user_agent})


# Anything whose key contains one of these is never written to the audit trail.
_SENSITIVE_KEY_PARTS = ("password", "passwd", "secret", "token", "authorization", "api_key", "apikey", "hash", "cookie")


def redact(value: Any) -> Any:
    """Copy of `value` with sensitive-looking keys replaced by "[redacted]" (recursive)."""
    if isinstance(value, dict):
        return {
            k: ("[redacted]" if any(p in str(k).lower() for p in _SENSITIVE_KEY_PARTS) else redact(v))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    return value


def log_audit(
    db: Session,
    user_id: Optional[int],
    role: Optional[str],
    action_type: str,
    sheet_id: Optional[str] = None,
    batch_id: Optional[int] = None,
    details: Optional[Dict[str, Any]] = None,
) -> AuditLog:
    """Records an audit event in audit_logs.

    The acting user's name and username are copied onto the row, so the history keeps identifying
    them after the account is deactivated or deleted. Sensitive keys in `details` are redacted.
    """
    actor = db.get(User, user_id) if user_id else None
    ctx = _request_ctx.get()
    log_entry = AuditLog(
        user_id=user_id,
        role=role,
        action_type=action_type,
        sheet_id=sheet_id,
        batch_id=batch_id,
        details=redact(details or {}),
        actor_name=actor.full_name if actor else None,
        actor_username=actor.username if actor else None,
        ip_address=(ctx.get("ip") or None),
        user_agent=((ctx.get("ua") or "")[:255] or None),
    )
    db.add(log_entry)
    db.commit()
    db.refresh(log_entry)
    return log_entry
