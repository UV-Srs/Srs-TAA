"""
Backend API tests.

These tests CREATE templates, batches and inspection values, so they must never run against a real
database. They only run when TAA_TEST_DATABASE_URL points at a dedicated, disposable PostgreSQL
database; otherwise the whole suite is skipped.

    # example: a throwaway container
    docker run -d --name taa-test-pg -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=taa_test -p 55432:5432 postgres:16-alpine
    $env:TAA_TEST_DATABASE_URL = "postgresql+psycopg2://postgres:testpw@localhost:55432/taa_test"
    pip install -r backend/requirements-dev.txt
    python -m pytest backend/tests -v

The test database's schema is built with `alembic upgrade head`, exactly like a real fresh database.
The migration tests also create and drop scratch databases on that same server, so use a server you
can afford to lose databases on (never a shared or production server).
"""
import os
import sys
from pathlib import Path

import pytest

TEST_DB_URL = os.getenv("TAA_TEST_DATABASE_URL")
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

if not TEST_DB_URL:
    collect_ignore_glob = ["test_*.py"]


def pytest_report_header(config):
    if not TEST_DB_URL:
        return "TAA_TEST_DATABASE_URL is not set: API tests are skipped (they need a disposable PostgreSQL database)."
    return f"API tests use {TEST_DB_URL.split('@')[-1]}"


@pytest.fixture(scope="session")
def client():
    assert TEST_DB_URL
    # The app no longer creates tables itself, so build the schema with the real migrations first.
    from alembic import command
    from backend.app.migrations_check import alembic_config

    os.environ["ALEMBIC_DATABASE_URL"] = TEST_DB_URL
    command.upgrade(alembic_config(), "head")

    # Point the app at the test database BEFORE it is imported (the engine connects at import).
    os.environ["DATABASE_URL"] = TEST_DB_URL
    os.environ.setdefault("SECRET_KEY", "test-secret-key")
    from fastapi.testclient import TestClient
    from backend.app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


@pytest.fixture(scope="session")
def admin(client):
    return _login(client, "admin", "admin123")


@pytest.fixture(scope="session")
def operator(client):
    return _login(client, "operator", "oper123")


@pytest.fixture(scope="session")
def supervisor(client):
    return _login(client, "supervisor", "super123")
