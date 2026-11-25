"""Alembic environment for the TAA database.

Loads the app's SQLAlchemy metadata WITHOUT running application startup: it imports
backend.app.db_base and backend.app.models only. It never imports backend.app.main or
backend.app.database, so nothing here can call create_all(), seed demo users or open the app's own
database engine.
"""
import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import create_engine, pool
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.db_base import Base  # noqa: E402
from backend.app import models  # noqa: E402,F401  (importing registers every table on Base.metadata)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _database_url() -> str:
    """ALEMBIC_DATABASE_URL wins, so a migration can be pointed at a specific (for example restored
    or disposable) database on purpose. Otherwise use the app's own configuration."""
    explicit = os.getenv("ALEMBIC_DATABASE_URL")
    if explicit:
        return explicit
    from backend.app.config import DATABASE_URL  # reads backend/.env; opens no connection
    return DATABASE_URL


URL = _database_url()
_target = make_url(URL)
print(
    f"[alembic] target database: {_target.host}:{_target.port or 5432}/{_target.database} "
    f"(from {'ALEMBIC_DATABASE_URL' if os.getenv('ALEMBIC_DATABASE_URL') else 'backend/.env'})",
    file=sys.stderr,
)


def run_migrations_offline() -> None:
    context.configure(
        url=URL, target_metadata=target_metadata, literal_binds=True, compare_type=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(URL, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata,
            compare_type=True, compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
