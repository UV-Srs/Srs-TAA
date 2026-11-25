import sys
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from backend.app.db_base import Base  # re-exported: `from backend.app.database import Base` still works

try:
    from backend.app.config import DATABASE_URL, DB_NAME, DB_HOST, DB_PORT
except ImportError:
    from app.config import DATABASE_URL, DB_NAME, DB_HOST, DB_PORT

logger = logging.getLogger("taa.database")

def init_engine():
    target_url = DATABASE_URL
    print(f"[DB] Initializing PostgreSQL connection: {target_url.split('@')[-1]}")
    
    try:
        # PostgreSQL Engine with connection pooling and pre-ping
        eng = create_engine(
            target_url,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=20,
            pool_recycle=3600
        )
        # Test connection immediately
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        print(f"[DB SUCCESS] Connected to PostgreSQL '{DB_NAME}' successfully on {DB_HOST}:{DB_PORT}!")
        return eng
    except Exception as e:
        error_msg = (
            f"\n[FATAL DATABASE ERROR] Failed to connect to PostgreSQL database '{DB_NAME}' on {DB_HOST}:{DB_PORT}.\n"
            f"Error details: {e}\n"
            f"Please verify PostgreSQL service is running and credentials in backend/.env are valid.\n"
        )
        print(error_msg, file=sys.stderr)
        raise RuntimeError(error_msg) from e

engine = init_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
