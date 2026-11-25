"""Schema drift check: does this database match the baseline migration (the current models)?

This is the check that must come back clean BEFORE an existing database is stamped with
`alembic stamp 0001`.

    python backend/scripts/check_schema_drift.py <database-url> [--allow-extra]

* The database URL is required. The script never falls back to backend/.env, so it can only ever
  look at the database you name (use a restored COPY, never the live one).
* It is read-only: the connection is opened with default_transaction_read_only = on, so even a bug
  here could not change the database.
* Exit code 0 = safe to stamp. Exit code 1 = do not stamp.
* Missing or different objects (tables, columns, indexes, types, nullability) always block.
  Extra objects the models do not know about (an extra table, index, or a column the app can ignore)
  block by default and are only accepted with --allow-extra. They are reported and NEVER dropped.
  An extra column that is NOT NULL with no default always blocks, because the app could not insert rows.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from backend.app.migrations_check import current_revision, head_revision, schema_differences  # noqa: E402


def _describe(d: tuple) -> str:
    op = d[0]
    if op in ("add_table", "remove_table"):
        return f"table '{d[1].name}'"
    if op in ("add_column", "remove_column"):
        return f"column '{d[2]}.{d[3].name}'"
    if op in ("add_index", "remove_index"):
        return f"index '{d[1].name}' on '{d[1].table.name}'"
    if op in ("add_constraint", "remove_constraint"):
        return f"constraint '{getattr(d[1], 'name', None)}' on '{d[1].table.name}'"
    if op in ("add_fk", "remove_fk"):
        return f"foreign key '{getattr(d[1], 'name', None)}' on '{d[1].parent.name}'"
    if op.startswith("modify_"):
        return f"{op[len('modify_'):]} of column '{d[2]}.{d[3]}' ({d[5]!r} in the database, {d[6]!r} in the models)"
    return repr(d)


def classify(d: tuple) -> str:
    """'missing' | 'different' | 'extra' | 'extra-blocking'."""
    op = d[0]
    if op.startswith("add_"):
        return "missing"
    if op.startswith("modify_"):
        return "different"
    if op == "remove_column":
        col = d[3]
        if not col.nullable and col.server_default is None and not col.primary_key:
            return "extra-blocking"
    return "extra"


def main(argv) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    allow_extra = "--allow-extra" in argv
    if len(args) != 1:
        print(__doc__)
        return 2
    url = args[0]
    target = make_url(url)
    print(f"Checking {target.host}:{target.port or 5432}/{target.database} against the baseline (read-only)...")

    engine = create_engine(url, connect_args={"options": "-c default_transaction_read_only=on"})
    try:
        rev = current_revision(engine)
        print(f"Migration version recorded in the database: {rev or 'none (not under Alembic yet)'}  | code head: {head_revision()}")
        diffs = schema_differences(engine)
    finally:
        engine.dispose()

    if not diffs:
        print("\nDifferences found: 0")
        print("RESULT: SAFE TO STAMP. The schema matches the baseline exactly.")
        return 0

    labels = {"missing": "MISSING  ", "different": "DIFFERENT", "extra": "EXTRA    ", "extra-blocking": "EXTRA!   "}
    print(f"\nDifferences found: {len(diffs)}")
    blocking = 0
    for d in diffs:
        kind = classify(d)
        if kind in ("missing", "different", "extra-blocking") or not allow_extra:
            blocking += 1
        print(f"  {labels[kind]} {_describe(d)}")
    print()
    print("MISSING   = the models expect it, the database lacks it.   DIFFERENT = present but not the same.")
    print("EXTRA     = in the database, unknown to the models. Never dropped automatically.")
    if blocking:
        print(f"RESULT: DO NOT STAMP. {blocking} difference(s) must be resolved or reviewed first.")
        return 1
    print(f"RESULT: SAFE TO STAMP with {len(diffs)} extra object(s) left untouched (--allow-extra).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
