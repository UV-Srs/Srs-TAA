"""
AI-Smart Scan Inspection Management System - Database Connection & Health Verification Script
Run: python backend/check_db.py
"""
import sys
from pathlib import Path
from dotenv import load_dotenv

# Ensure backend directory is in python path
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR.parent))

load_dotenv(BASE_DIR / ".env")

from backend.app.config import DB_NAME, DB_HOST, DB_PORT, DB_USER, DATABASE_URL
from backend.app.database import engine, Base, SessionLocal
from backend.app.models import User, SheetTemplate, InspectionBatch, AuditLog

def check_database():
    print("=" * 65)
    print(" AI-SMART SCAN INSPECTION MANAGEMENT SYSTEM - POSTGRESQL VERIFICATION")
    print("=" * 65)
    print(f"[*] Target Database: {DB_NAME}")
    print(f"[*] Host:            {DB_HOST}:{DB_PORT}")
    print(f"[*] User:            {DB_USER}")
    print(f"[*] URL:             {DATABASE_URL.split('@')[-1]}")
    print("-" * 65)

    try:
        # Create all tables on PostgreSQL if they don't exist
        print("[1/3] Verifying / Initializing database schema on PostgreSQL...")
        Base.metadata.create_all(bind=engine)
        print("  -> Schema initialized successfully.")

        # Test querying tables
        print("[2/3] Checking seeded data & roles...")
        db = SessionLocal()
        try:
            users = db.query(User).all()
            print(f"  -> Found {len(users)} registered users:")
            for u in users:
                status = "ACTIVE" if u.is_active else "INACTIVE"
                print(f"     * [{u.role.upper():10}] {u.username:12} | {u.full_name:20} | {status}")

            templates = db.query(SheetTemplate).all()
            print(f"  -> Found {len(templates)} sheet templates:")
            for t in templates:
                print(f"     * Sheet ID: {t.sheet_id} | Part: {t.part_no} ({t.part_name}) | Items: {len(t.control_items)}")

            batches = db.query(InspectionBatch).all()
            print(f"  -> Found {len(batches)} batches in PostgreSQL:")
            for b in batches:
                print(f"     * Batch #{b.batch_id} (Lot {b.lot_number}): Status = {b.status} | Round = {b.round}")

            logs_count = db.query(AuditLog).count()
            print(f"  -> Audit trail entries: {logs_count}")

        finally:
            db.close()

        print("-" * 65)
        print("[3/3] ALL POSTGRESQL CONNECTION & SCHEMA CHECKS PASSED!")
        print("=" * 65)
        return True

    except Exception as e:
        print("\n[!] POSTGRESQL CONNECTION FAILED:")
        print(f"    {e}\n")
        print("=" * 65)
        return False

if __name__ == "__main__":
    success = check_database()
    sys.exit(0 if success else 1)
