from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from backend.app.database import get_db
from backend.app.models import User, AuditLog
from backend.app.notifications import send_notification
from backend.app.schemas import UserLogin, TokenResponse, UserResponse
from backend.app.auth import verify_password, create_access_token, get_current_user
from backend.app.audit import log_audit

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

# Admins are alerted once when one username fails to sign in this many times within the window.
FAILED_LOGIN_ALERT_AFTER = 5
FAILED_LOGIN_WINDOW = timedelta(minutes=15)


def _record_failed_login(db: Session, username: str, known: User | None, reason: str) -> None:
    """Audit a failed sign-in (never the password) and alert admins on repeated failures."""
    username = (username or "")[:100]
    log_audit(
        db=db,
        user_id=known.user_id if known else None,
        role=known.role if known else None,
        action_type="LOGIN_FAILED",
        details={"username": username, "reason": reason},
    )
    since = datetime.utcnow() - FAILED_LOGIN_WINDOW
    recent = db.query(AuditLog).filter(
        AuditLog.action_type == "LOGIN_FAILED", AuditLog.created_at >= since
    ).order_by(AuditLog.created_at.desc()).limit(200).all()
    failures = sum(1 for r in recent if (r.details or {}).get("username") == username)
    if failures == FAILED_LOGIN_ALERT_AFTER:
        send_notification(
            db=db, roles=["admin"],
            text=f"{failures} failed sign-in attempts for '{username}' in the last "
                 f"{int(FAILED_LOGIN_WINDOW.total_seconds() // 60)} minutes.",
            kind="security", severity="critical",
        )
        db.commit()

@router.post("/login", response_model=TokenResponse)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        _record_failed_login(db, payload.username, user, "Wrong username or password")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    if not user.is_active:
        _record_failed_login(db, payload.username, user, "Account is deactivated")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated"
        )

    # Record login audit event (FR-004)
    log_audit(
        db=db,
        user_id=user.user_id,
        role=user.role,
        action_type="USER_LOGIN",
        details={"username": user.username}
    )

    token = create_access_token(data={"sub": user.username, "role": user.role, "user_id": user.user_id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user
    }

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/logout")
def logout(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Sign-out is client-side (the token is dropped); this only records it in the audit trail."""
    log_audit(db=db, user_id=current_user.user_id, role=current_user.role, action_type="USER_LOGOUT",
              details={"username": current_user.username})
    return {"success": True}
