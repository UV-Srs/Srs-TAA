"""Apply database migrations safely (what Docker runs before the app starts).

    python backend/scripts/migrate.py

Equivalent to `alembic upgrade head`, with one extra safeguard: if the database already has TAA
tables but was never put under migration control, this REFUSES to run. Such a database must be
adopted through the documented procedure (backup, drift check, stamp), never upgraded blindly.

Exit code 0 = the database is now at the head migration. Anything else = do not start the app.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alembic import command  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from backend.app.migrations_check import alembic_config, current_revision, has_app_tables, head_revision  # noqa: E402


def main() -> int:
    url = os.getenv("ALEMBIC_DATABASE_URL")
    if not url:
        from backend.app.config import DATABASE_URL  # reads backend/.env; opens no connection
        url = DATABASE_URL
    target = make_url(url)
    print(f"[migrate] target database: {target.host}:{target.port or 5432}/{target.database}")

    engine = create_engine(url)
    try:
        current = current_revision(engine)
        if current is None and has_app_tables(engine):
            print(
                "[migrate] REFUSING: this database already has TAA tables but no migration version.\n"
                "          Adopt it with the backup -> drift check -> stamp procedure in README.md "
                "('Database migrations -> Adopting an existing database'). Nothing was changed.",
                file=sys.stderr,
            )
            return 3
    finally:
        engine.dispose()

    os.environ["ALEMBIC_DATABASE_URL"] = url  # make env.py use exactly the database checked above
    command.upgrade(alembic_config(), "head")
    print(f"[migrate] database is at migration {head_revision()}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # a failed migration must stop the app from starting
        print(f"[migrate] FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
