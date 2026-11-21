import sys
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from backend.app.config import DATABASE_URL, BASE_DIR

logger = logging.getLogger("taa.database")

Base = declarative_base()

def init_engine():
    target_url = DATABASE_URL
    connect_args = {}
    
    if target_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
        eng = create_engine(target_url, connect_args=connect_args)
        print(f"[DB] Connected to SQLite database: {target_url}")
        return eng

    # If PostgreSQL URL is configured, test the connection
    try:
        print(f"[DB] Attempting connection to PostgreSQL: {target_url.split('@')[-1]}")
        eng = create_engine(target_url, pool_pre_ping=True, pool_size=10, max_overflow=20)
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        print(f"[DB SUCCESS] Connected to PostgreSQL successfully!")
        return eng
    except Exception as e:
        print(f"[DB WARNING] PostgreSQL connection failed: {e}")
        sqlite_fallback = f"sqlite:///{BASE_DIR}/taa_inspection.db"
        print(f"[DB FALLBACK] Seamlessly falling back to local SQLite database: {sqlite_fallback}")
        eng = create_engine(sqlite_fallback, connect_args={"check_same_thread": False})
        return eng

engine = init_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
