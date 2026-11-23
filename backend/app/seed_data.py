from sqlalchemy.orm import Session
from backend.app.models import User
from backend.app.auth import hash_password


def seed_database(db: Session):
    """Ensure default user accounts exist. No demo sheets or batches are seeded."""

    defaults = [
        {"username": "admin",      "full_name": "Admin",      "password": "admin123",  "role": "admin"},
        {"username": "admin2",     "full_name": "Admin 2",    "password": "admin123",  "role": "admin"},
        {"username": "supervisor", "full_name": "Supervisor", "password": "super123",  "role": "supervisor"},
        {"username": "operator",   "full_name": "Operator",   "password": "oper123",   "role": "operator"},
    ]

    for d in defaults:
        if not db.query(User).filter(User.username == d["username"]).first():
            db.add(User(
                username=d["username"],
                full_name=d["full_name"],
                password_hash=hash_password(d["password"]),
                role=d["role"],
                is_active=True,
            ))

    db.commit()
