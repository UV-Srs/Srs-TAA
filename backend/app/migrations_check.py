"""Database migration checks. Read-only: nothing here changes a database.

Used by application startup (the app refuses to start unless the database is at the current
migration) and by backend/scripts/check_schema_drift.py (the check that must come back clean before
an existing database is stamped).

Importing this module has no side effects: it does not import backend.app.database or main.
"""
from pathlib import Path
from typing import List, Optional

from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect
from sqlalchemy.engine import Engine

from backend.app.db_base import Base
from backend.app import models  # noqa: F401  (registers every table on Base.metadata)

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = ROOT / "backend" / "migrations"


class DatabaseNotReady(RuntimeError):
    """The database schema is not at the migration this version of the code expects."""


def alembic_config() -> Config:
    cfg = Config(str(ROOT / "alembic.ini"))
    # Absolute path, so this works from any working directory (Docker, tests, a service manager).
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    return cfg


def head_revision() -> Optional[str]:
    """The newest migration shipped with this code."""
    return ScriptDirectory.from_config(alembic_config()).get_current_head()


def current_revision(engine: Engine) -> Optional[str]:
    """The migration the database says it is at (None if it was never put under Alembic)."""
    with engine.connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def has_app_tables(engine: Engine) -> bool:
    tables = set(inspect(engine).get_table_names())
    return bool(tables & set(Base.metadata.tables))


def missing_tables(engine: Engine) -> List[str]:
    """Application tables the models define that the database does not have."""
    return sorted(set(Base.metadata.tables) - set(inspect(engine).get_table_names()))


def verify_database_is_current(engine: Engine) -> str:
    """Raises DatabaseNotReady with the exact next step unless the database is at the head revision.

    It never creates, alters or stamps anything. Returns the revision when it is current."""
    head = head_revision()
    current = current_revision(engine)

    if current is None:
        if has_app_tables(engine):
            raise DatabaseNotReady(
                "\n[DATABASE NOT UNDER MIGRATION CONTROL] This database already has TAA tables but no "
                "migration version.\nIt must be adopted, never stamped blindly: back it up, restore a "
                "copy, run the schema drift check on the copy, and only then stamp it.\n"
                "See 'Database migrations -> Adopting an existing database' in README.md.\n"
            )
        raise DatabaseNotReady(
            "\n[DATABASE NOT INITIALISED] This database is empty. Create the schema first:\n"
            "    alembic upgrade head\n"
            "(see 'Database migrations -> Fresh database' in README.md), then start the app again.\n"
        )

    if current != head:
        script = ScriptDirectory.from_config(alembic_config())
        try:
            script.get_revision(current)
        except Exception:
            raise DatabaseNotReady(
                f"\n[DATABASE IS NEWER THAN THIS CODE] The database is at migration '{current}', which this "
                f"version of the application does not know (it ships up to '{head}').\n"
                "Deploy the matching application version. Do not downgrade the database without a backup.\n"
            )
        raise DatabaseNotReady(
            f"\n[DATABASE NEEDS MIGRATION] The database is at migration '{current}' but this version of the "
            f"application needs '{head}'.\nBack it up, then run:\n    alembic upgrade head\n"
        )

    # A version number alone does not prove the tables are there (for example a database that was
    # stamped without running the drift check first). Cheap sanity check: every table must exist.
    missing = missing_tables(engine)
    if missing:
        raise DatabaseNotReady(
            f"\n[SCHEMA INCOMPLETE] The database says it is at migration '{current}', but these tables are "
            f"missing: {', '.join(missing)}.\nIt was probably stamped without checking its schema. Nothing was "
            "changed. Restore from your backup, or if this database is empty/new, clear the mistaken stamp "
            "with `alembic stamp base` and run `alembic upgrade head`.\n"
            "See 'Database migrations' in README.md.\n"
        )
    return current


def schema_differences(engine: Engine) -> List[tuple]:
    """Every difference between the live database and the models, in Alembic's compare format.

    Pure comparison: does not touch the database. Alembic's own version table is ignored."""
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": True, "compare_server_default": True})
        diffs = compare_metadata(ctx, Base.metadata)
    return [d for d in _flatten(diffs) if "alembic_version" not in repr(d)]


def _flatten(diffs):
    for d in diffs:
        if isinstance(d, list):  # modify_* operations arrive as a list of tuples
            yield from d
        else:
            yield d
