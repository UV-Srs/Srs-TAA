"""Alembic foundation: fresh setup, adopting an existing database, safeguards, rollback.

Every test works on its own scratch PostgreSQL database that is created and dropped on the test
server (TAA_TEST_DATABASE_URL). Nothing here touches any other database.
"""
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

from backend.app import migrations_check as mc
from backend.app.db_base import Base

ROOT = Path(__file__).resolve().parents[2]
SERVER = make_url(os.environ["TAA_TEST_DATABASE_URL"])
APP_TABLES = set(Base.metadata.tables)
HEAD = "0004"  # the newest migration; bump this when a new one is added


@pytest.fixture
def scratch_db():
    """Factory for empty, disposable databases (dropped after the test)."""
    admin = create_engine(SERVER.set(database="postgres"), isolation_level="AUTOCOMMIT")
    made = []

    def make() -> str:
        name = f"taa_mig_{uuid.uuid4().hex[:10]}"
        with admin.connect() as c:
            c.execute(text(f'CREATE DATABASE "{name}"'))
        made.append(name)
        return SERVER.set(database=name).render_as_string(hide_password=False)

    yield make
    with admin.connect() as c:
        for name in made:
            c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


def run_alembic(monkeypatch, url, action, *args):
    monkeypatch.setenv("ALEMBIC_DATABASE_URL", url)
    return getattr(command, action)(mc.alembic_config(), *args)


def legacy_style_database(url):
    """A database built the way the app used to build it on startup: create_all(), no version table."""
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    return engine


def app_tables(engine):
    return set(inspect(engine).get_table_names()) & APP_TABLES


def run_script(script, url, *extra, env=None):
    e = {**os.environ, "ALEMBIC_DATABASE_URL": url, "DATABASE_URL": url, "SECRET_KEY": "test-secret-key", **(env or {})}
    # check_schema_drift.py takes the database URL as an argument (it never reads configuration).
    args = [url, *extra] if script == "check_schema_drift.py" else [*extra]
    return subprocess.run([sys.executable, str(ROOT / "backend" / "scripts" / script), *args],
                          cwd=ROOT, env=e, capture_output=True, text=True, timeout=120)


def import_app(url):
    """Start the app the way uvicorn does (import backend.app.main) against `url`."""
    e = {**os.environ, "DATABASE_URL": url, "SECRET_KEY": "test-secret-key"}
    e.pop("ALEMBIC_DATABASE_URL", None)
    return subprocess.run([sys.executable, "-c", "import backend.app.main"], cwd=ROOT, env=e,
                          capture_output=True, text=True, timeout=120)


# ── Loading the metadata is free of side effects ──────────────────────────────────────────────────

def test_alembic_and_checks_load_without_the_app_engine():
    """Importing what Alembic needs must not import main, the engine, or run create_all / seeding."""
    code = (
        "import sys, backend.app.migrations_check, backend.app.models;"
        "bad=[m for m in ('backend.app.main','backend.app.database','backend.app.seed_data') if m in sys.modules];"
        "print('LOADED:',bad); sys.exit(1 if bad else 0)"
    )
    env = {**os.environ}
    env.pop("DATABASE_URL", None)  # no database is configured at all, so any connection attempt would fail
    r = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_head_is_the_newest_migration():
    assert mc.head_revision() == HEAD


# ── Fresh database ────────────────────────────────────────────────────────────────────────────────

def test_fresh_database_builds_with_upgrade_head(scratch_db, monkeypatch):
    url = scratch_db()
    engine = create_engine(url)
    assert app_tables(engine) == set()
    run_alembic(monkeypatch, url, "upgrade", "head")
    assert app_tables(engine) == APP_TABLES
    assert mc.current_revision(engine) == mc.head_revision()
    assert mc.schema_differences(engine) == []
    run_alembic(monkeypatch, url, "upgrade", "head")  # running it again changes nothing
    assert mc.current_revision(engine) == HEAD


def test_baseline_equals_what_the_old_startup_created(scratch_db, monkeypatch):
    migrated, legacy = scratch_db(), scratch_db()
    run_alembic(monkeypatch, migrated, "upgrade", "head")
    e_new, e_old = create_engine(migrated), legacy_style_database(legacy)

    def shape(engine):
        insp = inspect(engine)
        out = {}
        for t in sorted(APP_TABLES):
            out[t] = (
                sorted((c["name"], str(c["type"]), c["nullable"]) for c in insp.get_columns(t)),
                sorted((i["name"], tuple(i["column_names"]), i["unique"]) for i in insp.get_indexes(t)),
                sorted((tuple(f["constrained_columns"]), f["referred_table"], f["options"].get("ondelete")) for f in insp.get_foreign_keys(t)),
                sorted((tuple(u["column_names"])) for u in insp.get_unique_constraints(t)),
            )
        return out

    assert shape(e_new) == shape(e_old)
    assert mc.schema_differences(e_old) == []


def test_baseline_downgrade_is_refused_and_drops_nothing(scratch_db, monkeypatch):
    url = scratch_db()
    run_alembic(monkeypatch, url, "upgrade", "0001")
    engine = create_engine(url)
    with engine.begin() as c:
        c.execute(text("INSERT INTO users (username, full_name, password_hash, role) VALUES ('keep','Keep','x','operator')"))
    with pytest.raises(RuntimeError, match="Refusing to downgrade past the baseline"):
        run_alembic(monkeypatch, url, "downgrade", "base")
    assert mc.current_revision(engine) == "0001"
    assert {"users", "audit_logs", "in_app_notifications"} <= app_tables(engine)
    with engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM users WHERE username='keep'")).scalar() == 1


# ── The app only verifies; it never creates or alters ─────────────────────────────────────────────

def test_app_refuses_to_start_on_an_empty_database_and_creates_nothing(scratch_db):
    url = scratch_db()
    r = import_app(url)
    assert r.returncode != 0
    assert "DATABASE NOT INITIALISED" in r.stderr + r.stdout
    assert app_tables(create_engine(url)) == set(), "startup must not create the schema (no create_all)"


def test_a_wrongly_stamped_empty_database_is_caught_at_startup(scratch_db, monkeypatch):
    """Stamping without the drift check leaves a version row but no tables. Startup must not accept it."""
    url = scratch_db()
    run_alembic(monkeypatch, url, "stamp", "head")  # the mistake
    engine = create_engine(url)
    assert app_tables(engine) == set()
    with pytest.raises(mc.DatabaseNotReady, match="SCHEMA INCOMPLETE"):
        mc.verify_database_is_current(engine)
    r = import_app(url)
    assert r.returncode != 0 and "SCHEMA INCOMPLETE" in r.stderr + r.stdout
    assert app_tables(engine) == set(), "and it must not create anything"
    # the documented recovery for an empty database
    run_alembic(monkeypatch, url, "stamp", "base")
    run_alembic(monkeypatch, url, "upgrade", "head")
    assert mc.verify_database_is_current(engine) == HEAD


def test_a_database_missing_one_table_is_caught_at_startup(scratch_db, monkeypatch):
    url = scratch_db()
    run_alembic(monkeypatch, url, "upgrade", "head")
    engine = create_engine(url)
    with engine.begin() as c:
        c.execute(text("DROP TABLE in_app_notifications CASCADE"))
    with pytest.raises(mc.DatabaseNotReady, match="in_app_notifications"):
        mc.verify_database_is_current(engine)


def test_app_refuses_to_start_on_an_unstamped_existing_database(scratch_db):
    url = scratch_db()
    engine = legacy_style_database(url)
    with engine.begin() as c:
        c.execute(text("INSERT INTO users (username, full_name, password_hash, role) VALUES ('keep','Keep','x','operator')"))
    r = import_app(url)
    assert r.returncode != 0
    assert "NOT UNDER MIGRATION CONTROL" in r.stderr + r.stdout
    with engine.connect() as c:
        assert "alembic_version" not in inspect(engine).get_table_names(), "the app must never stamp"
        assert c.execute(text("SELECT count(*) FROM users")).scalar() == 1, "and must not seed or change data"


def test_app_starts_on_a_migrated_database_and_seeds_after_migration(scratch_db, monkeypatch):
    url = scratch_db()
    run_alembic(monkeypatch, url, "upgrade", "head")
    r = import_app(url)
    assert r.returncode == 0, r.stderr + r.stdout
    with create_engine(url).connect() as c:
        assert c.execute(text("SELECT count(*) FROM users")).scalar() == 4  # the four demo users


def test_verify_states(scratch_db, monkeypatch):
    url = scratch_db()
    engine = create_engine(url)
    with pytest.raises(mc.DatabaseNotReady, match="NOT INITIALISED"):
        mc.verify_database_is_current(engine)

    run_alembic(monkeypatch, url, "upgrade", "head")
    assert mc.verify_database_is_current(engine) == HEAD

    monkeypatch.setattr(mc, "head_revision", lambda: "0099")  # code ships a newer migration than the DB has
    with pytest.raises(mc.DatabaseNotReady, match="NEEDS MIGRATION"):
        mc.verify_database_is_current(engine)
    monkeypatch.undo()

    with engine.begin() as c:
        c.execute(text("UPDATE alembic_version SET version_num='9999'"))  # database from a newer release
    with pytest.raises(mc.DatabaseNotReady, match="NEWER THAN THIS CODE"):
        mc.verify_database_is_current(engine)


# ── migrate.py (what Docker runs) ─────────────────────────────────────────────────────────────────

def test_migrate_script_builds_a_fresh_database(scratch_db):
    url = scratch_db()
    r = run_script("migrate.py", url)
    assert r.returncode == 0, r.stderr + r.stdout
    assert mc.current_revision(create_engine(url)) == HEAD


def test_migrate_script_refuses_an_unstamped_existing_database(scratch_db):
    url = scratch_db()
    engine = legacy_style_database(url)
    with engine.begin() as c:
        c.execute(text("INSERT INTO users (username, full_name, password_hash, role) VALUES ('keep','Keep','x','operator')"))
    r = run_script("migrate.py", url)
    assert r.returncode == 3 and "REFUSING" in r.stderr
    assert "alembic_version" not in inspect(engine).get_table_names()
    with engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM users")).scalar() == 1


def test_migrate_script_fails_loudly_when_the_database_is_unreachable():
    r = run_script("migrate.py", "postgresql+psycopg2://nobody:wrong@localhost:1/none")
    assert r.returncode == 1 and "FAILED" in r.stderr


# ── Adopting an existing database: drift check, then stamp ────────────────────────────────────────

def test_adoption_flow_changes_no_data(scratch_db, monkeypatch):
    url = scratch_db()
    engine = legacy_style_database(url)
    with engine.begin() as c:
        c.execute(text("INSERT INTO users (username, full_name, password_hash, role) VALUES ('keep','Keep','x','operator')"))
        c.execute(text("INSERT INTO sheet_templates (sheet_id, document_title, qr_code_value, barcode_value, is_default) VALUES ('S1','T','q','b',false)"))

    check = run_script("check_schema_drift.py", url)
    assert check.returncode == 0 and "SAFE TO STAMP" in check.stdout, check.stdout + check.stderr

    run_alembic(monkeypatch, url, "stamp", "head")  # the old startup built the current models, so it matches the newest migration
    assert mc.current_revision(engine) == HEAD
    with engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM users")).scalar() == 1
        assert c.execute(text("SELECT count(*) FROM sheet_templates")).scalar() == 1
    assert app_tables(engine) == APP_TABLES
    run_alembic(monkeypatch, url, "upgrade", "head")  # nothing left to do
    assert import_app(url).returncode == 0


def test_drift_check_blocks_a_missing_column(scratch_db):
    url = scratch_db()
    engine = legacy_style_database(url)
    with engine.begin() as c:
        c.execute(text("ALTER TABLE supervisor_lot_reviews DROP COLUMN spot_checks, DROP COLUMN comment"))
    r = run_script("check_schema_drift.py", url, "--allow-extra")
    assert r.returncode == 1 and "DO NOT STAMP" in r.stdout
    assert "MISSING" in r.stdout and "supervisor_lot_reviews.spot_checks" in r.stdout and "supervisor_lot_reviews.comment" in r.stdout


def test_drift_check_extra_objects_are_reported_never_dropped(scratch_db):
    url = scratch_db()
    engine = legacy_style_database(url)
    with engine.begin() as c:
        c.execute(text("ALTER TABLE users ADD COLUMN legacy_note text"))
        c.execute(text("CREATE TABLE stray_notes (id serial primary key, note text)"))
    strict = run_script("check_schema_drift.py", url)
    assert strict.returncode == 1 and "EXTRA" in strict.stdout
    lenient = run_script("check_schema_drift.py", url, "--allow-extra")
    assert lenient.returncode == 0 and "left untouched" in lenient.stdout
    cols = {c["name"] for c in inspect(engine).get_columns("users")}
    assert "legacy_note" in cols and "stray_notes" in inspect(engine).get_table_names(), "nothing was dropped"


def test_drift_check_always_blocks_an_extra_required_column(scratch_db):
    url = scratch_db()
    engine = legacy_style_database(url)
    with engine.begin() as c:
        c.execute(text("ALTER TABLE users ADD COLUMN must_have text NOT NULL DEFAULT 'x'"))
        c.execute(text("ALTER TABLE users ALTER COLUMN must_have DROP DEFAULT"))
    r = run_script("check_schema_drift.py", url, "--allow-extra")
    assert r.returncode == 1 and "EXTRA!" in r.stdout


def test_drift_check_blocks_a_different_column_type(scratch_db):
    url = scratch_db()
    engine = legacy_style_database(url)
    with engine.begin() as c:
        c.execute(text("ALTER TABLE users ALTER COLUMN username TYPE text"))
    r = run_script("check_schema_drift.py", url, "--allow-extra")
    assert r.returncode == 1 and "DIFFERENT" in r.stdout


def test_drift_check_is_read_only_and_needs_an_explicit_url(scratch_db):
    url = scratch_db()
    engine = legacy_style_database(url)
    before = sorted(inspect(engine).get_table_names())
    run_script("check_schema_drift.py", url)
    assert sorted(inspect(engine).get_table_names()) == before
    r = subprocess.run([sys.executable, str(ROOT / "backend" / "scripts" / "check_schema_drift.py")],
                       cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 2, "without a URL it must not fall back to the configured database"


# ── A later migration: upgrade and safe rollback (uses a temporary revision) ──────────────────────

def test_later_migration_upgrades_and_rolls_back_without_touching_data(scratch_db, monkeypatch, tmp_path):
    """Adds a throwaway 0099 next to the real versions in a copy of the migrations folder."""
    import shutil
    work = tmp_path / "migrations"
    shutil.copytree(mc.MIGRATIONS_DIR, work, ignore=shutil.ignore_patterns("__pycache__"))
    (work / "versions" / "0002_probe.py").write_text(
        '"""probe"""\nfrom alembic import op\nimport sqlalchemy as sa\n'
        f"revision='0099'\ndown_revision='{HEAD}'\nbranch_labels=None\ndepends_on=None\n"
        "def upgrade():\n    op.add_column('template_control_items', sa.Column('probe_col', sa.JSON(), nullable=True))\n"
        "def downgrade():\n    op.drop_column('template_control_items', 'probe_col')\n"
    )
    cfg = mc.alembic_config()
    cfg.set_main_option("script_location", str(work))

    url = scratch_db()
    monkeypatch.setenv("ALEMBIC_DATABASE_URL", url)
    command.upgrade(cfg, HEAD)
    engine = create_engine(url)
    with engine.begin() as c:
        c.execute(text("INSERT INTO sheet_templates (sheet_id, document_title, qr_code_value, barcode_value, is_default) VALUES ('S1','T','q','b',false)"))
        c.execute(text("INSERT INTO template_control_items (sheet_id, serial_no, stage_name, control_item_name, specification_content, row_mode, html_input_type, sample_columns, assigned_role) "
                       "VALUES ('S1',1,'s','n','',  'SERIAL_TICKBOX','pf','[\"1\"]','operator')"))

    def cols():
        return {c["name"] for c in inspect(engine).get_columns("template_control_items")}

    def rows():
        with engine.connect() as c:
            return c.execute(text("SELECT item_id, control_item_name, sample_columns::text FROM template_control_items")).all()

    before = rows()
    command.upgrade(cfg, "head")
    assert "probe_col" in cols() and rows() == before
    command.downgrade(cfg, "-1")
    assert "probe_col" not in cols() and rows() == before
    assert mc.current_revision(engine) == HEAD


# ── 0004: audit history survives user removal, per-user notification reads ────────────────────────

def test_0004_keeps_existing_data_and_backfills(scratch_db, monkeypatch):
    url = scratch_db()
    run_alembic(monkeypatch, url, "upgrade", "0003")
    engine = create_engine(url)
    with engine.begin() as c:
        c.execute(text("INSERT INTO users (user_id, username, full_name, password_hash, role) VALUES "
                       "(1,'adm1','Admin One','x','admin'),(2,'adm2','Admin Two','x','admin'),(3,'op1','Op One','x','operator')"))
        c.execute(text("INSERT INTO audit_logs (user_id, role, action_type, details) VALUES (1,'admin','USER_LOGIN','{}'),(NULL,'system','HOLD_OVERDUE_ESCALATION','{}')"))
        c.execute(text("INSERT INTO in_app_notifications (recipient_role, text, is_read) VALUES "
                       "('admin','was read',true),('admin','was unread',false),('operator','op read',true)"))

    run_alembic(monkeypatch, url, "upgrade", "0004")
    assert mc.current_revision(engine) == "0004" and mc.schema_differences(engine) == []

    with engine.connect() as c:
        # existing audit rows are kept and get the name copied from the user
        assert c.execute(text("SELECT count(*) FROM audit_logs")).scalar() == 2
        row = c.execute(text("SELECT actor_name, actor_username FROM audit_logs WHERE user_id=1")).one()
        assert tuple(row) == ("Admin One", "adm1")
        # notifications keep their text; new columns default to info
        assert c.execute(text("SELECT count(*) FROM in_app_notifications WHERE kind='info' AND severity='info'")).scalar() == 3
        # what was read stays read, for every user of that role; unread stays unread
        reads = c.execute(text("SELECT n.text, r.user_id FROM notification_reads r JOIN in_app_notifications n USING (notification_id) ORDER BY 1, 2")).all()
        assert [tuple(r) for r in reads] == [("op read", 3), ("was read", 1), ("was read", 2)]

    # deleting the user no longer deletes their audit rows
    with engine.begin() as c:
        c.execute(text("DELETE FROM users WHERE user_id=1"))
    with engine.connect() as c:
        row = c.execute(text("SELECT user_id, actor_username FROM audit_logs WHERE actor_username='adm1'")).one()
        assert tuple(row) == (None, "adm1")

    # and the migration rolls back without losing the rows
    run_alembic(monkeypatch, url, "downgrade", "0003")
    assert mc.current_revision(engine) == "0003"
    with engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM audit_logs")).scalar() == 2
        assert c.execute(text("SELECT count(*) FROM in_app_notifications")).scalar() == 3
