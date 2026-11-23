from datetime import datetime, timezone
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from backend.app.database import get_db
from backend.app.models import User
from backend.app.schemas import UserLogin, TokenResponse, UserResponse
from backend.app.auth import verify_password, hash_password, create_access_token, get_current_user
from backend.app.audit import log_audit

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

# Simple in-memory brute-force throttle: {ip: [timestamp, ...]}
_login_attempts: dict = defaultdict(list)
_MAX_ATTEMPTS = 10
_WINDOW_SECONDS = 60

def _check_rate_limit(ip: str):
    now = datetime.now(timezone.utc).timestamp()
    attempts = [t for t in _login_attempts[ip] if now - t < _WINDOW_SECONDS]
    _login_attempts[ip] = attempts
    if len(attempts) >= _MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many login attempts. Please wait {_WINDOW_SECONDS} seconds."
        )
    _login_attempts[ip].append(now)

@router.post("/login", response_model=TokenResponse)
def login(payload: UserLogin, request: Request, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated"
        )
    # Successful login — clear attempt counter
    _login_attempts.pop(client_ip, None)

    # Record login audit event (FR-004)
    log_audit(
        db=db,
        user_id=user.user_id,
        role=user.role,
        action_type="USER_LOGIN",
        details={"username": user.username}
    )

    token = create_access_token(data={"sub": user.username, "role": user.role, "user_id": user.user_id, "pwd_ver": user.password_version or 1})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user
    }

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect"
        )
    if len(payload.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be at least 6 characters"
        )
    current_user.password_hash = hash_password(payload.new_password)
    current_user.password_version = (current_user.password_version or 1) + 1  # invalidates all existing tokens
    log_audit(
        db=db,
        user_id=current_user.user_id,
        role=current_user.role,
        action_type="USER_CHANGE_PASSWORD",
        details={"username": current_user.username}
    )
    db.commit()
    # Issue a new token with the incremented password version
    new_token = create_access_token(data={
        "sub": current_user.username,
        "role": current_user.role,
        "user_id": current_user.user_id,
        "pwd_ver": current_user.password_version,
    })
    return {"success": True, "message": "Password changed successfully", "new_token": new_token}
