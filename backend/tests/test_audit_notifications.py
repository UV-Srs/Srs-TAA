"""
Audit trail and notification tests (admin audit view, audit retention, per-user read state).

Same rules as the other API tests: they only run against a disposable PostgreSQL database
(TAA_TEST_DATABASE_URL), see conftest.py.
"""
import uuid

import pytest

from backend.app.audit import redact


def _uniq(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def _create_user(client, admin, role="operator"):
    username = _uniq("t")
    r = client.post("/api/admin/users", headers=admin, json={
        "username": username, "full_name": f"Test {username}", "password": "Passw0rd!x", "role": role})
    assert r.status_code == 200, r.text
    return r.json()["user_id"], username


def _login(client, username, password="Passw0rd!x"):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def _audit(client, admin, **params):
    r = client.get("/api/admin/audit-logs/search", headers=admin, params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ── redaction ─────────────────────────────────────────────────────────────────────────────────────

def test_redact_hides_sensitive_keys_at_any_depth():
    out = redact({"username": "a", "password": "x", "nested": {"api_token": "t", "ok": 1},
                  "list": [{"Authorization": "Bearer z", "n": 2}], "password_hash": "h"})
    assert out["username"] == "a" and out["nested"]["ok"] == 1 and out["list"][0]["n"] == 2
    assert out["password"] == "[redacted]" and out["nested"]["api_token"] == "[redacted]"
    assert out["list"][0]["Authorization"] == "[redacted]" and out["password_hash"] == "[redacted]"


# ── login events ──────────────────────────────────────────────────────────────────────────────────

def test_login_is_recorded_with_name_and_address_and_no_password(client, admin):
    client.post("/api/auth/login", json={"username": "operator", "password": "oper123"})
    row = _audit(client, admin, action_type="USER_LOGIN", q="operator")["items"][0]
    assert row["actor_username"] == "operator" and row["actor_name"]
    assert row["ip_address"], "the caller's address is recorded"
    assert "oper123" not in str(row)


def test_failed_login_is_audited_without_the_password_and_alerts_admins_once(client, admin):
    name = _uniq("ghost")
    for _ in range(6):
        r = client.post("/api/auth/login", json={"username": name, "password": "super-secret-guess"})
        assert r.status_code == 401
    rows = _audit(client, admin, action_type="LOGIN_FAILED", q=name)
    assert rows["total"] == 6
    assert "super-secret-guess" not in str(rows)
    alerts = client.get("/api/notifications/page", headers=admin, params={"kind": "security", "limit": 100}).json()
    mine = [n for n in alerts["items"] if name in n["text"]]
    assert len(mine) == 1 and mine[0]["severity"] == "critical"


def test_logout_is_audited(client, admin):
    uid, username = _create_user(client, admin)
    h = _login(client, username)
    assert client.post("/api/auth/logout", headers=h).status_code == 200
    assert _audit(client, admin, action_type="USER_LOGOUT", q=username)["total"] == 1


# ── audit retention ───────────────────────────────────────────────────────────────────────────────

def test_deleting_or_deactivating_a_user_keeps_their_audit_history(client, admin):
    uid, username = _create_user(client, admin)
    _login(client, username)  # one audit row by this user

    r = client.patch(f"/api/admin/users/{uid}/deactivate", headers=admin)
    assert r.status_code == 200 and r.json()["purged_audit_logs_count"] == 0
    assert _audit(client, admin, user_id=uid, action_type="USER_LOGIN")["total"] == 1
    client.patch(f"/api/admin/users/{uid}/activate", headers=admin)

    assert client.delete(f"/api/admin/users/{uid}", headers=admin).status_code == 200
    kept = _audit(client, admin, q=username, action_type="USER_LOGIN")
    assert kept["total"] == 1
    assert kept["items"][0]["actor_username"] == username and kept["items"][0]["user_id"] is None
    # the admin's own actions on the account are recorded too
    actions = {i["action_type"] for i in _audit(client, admin, q=username, page_size=100)["items"]}
    assert {"USER_CREATED", "USER_DEACTIVATED", "USER_ACTIVATED", "USER_DELETED"} <= actions


# ── audit search / filters / export ───────────────────────────────────────────────────────────────

def test_audit_search_pages_and_filters(client, admin):
    first = _audit(client, admin, page_size=2)
    assert first["page_size"] == 2 and len(first["items"]) == 2 and first["total"] >= 2
    second = _audit(client, admin, page_size=2, page=2)
    assert {i["log_id"] for i in first["items"]}.isdisjoint({i["log_id"] for i in second["items"]})
    ids = [i["log_id"] for i in first["items"]]
    assert ids == sorted(ids, reverse=True), "newest first"

    only_admin = _audit(client, admin, role="admin", page_size=50)
    assert only_admin["items"] and all(i["role"] == "admin" for i in only_admin["items"])
    assert _audit(client, admin, date_from="2999-01-01")["total"] == 0
    assert _audit(client, admin, date_to="2000-01-01")["total"] == 0
    assert _audit(client, admin, date_from="2000-01-01", date_to="2999-12-31")["total"] == first["total"]
    assert _audit(client, admin, q="no-such-text-" + uuid.uuid4().hex)["total"] == 0


def test_audit_actions_list_and_export(client, admin):
    actions = client.get("/api/admin/audit-logs/actions", headers=admin).json()
    assert "USER_LOGIN" in actions and actions == sorted(actions)

    r = client.get("/api/admin/audit-logs/export", headers=admin, params={"action_type": "USER_LOGIN"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.text.lstrip("﻿").splitlines()
    assert lines[0].startswith('"ID","Time (UTC)"') and len(lines) > 1
    assert _audit(client, admin, action_type="AUDIT_LOG_EXPORTED")["total"] >= 1


def test_audit_endpoints_are_admin_only(client, operator, supervisor):
    for h in (operator, supervisor):
        for path in ("/api/admin/audit-logs/search", "/api/admin/audit-logs/actions", "/api/admin/audit-logs/export"):
            assert client.get(path, headers=h).status_code == 403


# ── notifications: per-user read state ────────────────────────────────────────────────────────────

def test_reading_a_role_notification_only_marks_it_read_for_that_user(client, admin):
    _, other_name = _create_user(client, admin, role="admin")
    other = _login(client, other_name)

    # an admin-wide notification (a user change alerts every admin)
    uid, _ = _create_user(client, admin)
    client.patch(f"/api/admin/users/{uid}/deactivate", headers=admin)

    mine = client.get("/api/notifications/page", headers=admin, params={"unread_only": True, "kind": "user"}).json()
    theirs = client.get("/api/notifications/page", headers=other, params={"unread_only": True, "kind": "user"}).json()
    assert mine["total"] >= 1 and theirs["total"] >= 1

    assert client.post("/api/notifications/mark-read", headers=admin, json={}).status_code == 200
    mine_after = client.get("/api/notifications/page", headers=admin, params={"unread_only": True}).json()
    theirs_after = client.get("/api/notifications/page", headers=other, params={"unread_only": True, "kind": "user"}).json()
    assert mine_after["total"] == 0 and mine_after["unread_total"] == 0
    assert theirs_after["total"] == theirs["total"], "the other admin still has them unread"

    one = theirs_after["items"][0]["notification_id"]
    client.post("/api/notifications/mark-read", headers=other, json={"notification_id": one})
    after_one = client.get("/api/notifications/page", headers=other, params={"unread_only": True, "kind": "user"}).json()
    assert after_one["total"] == theirs_after["total"] - 1


def test_notification_page_filters_and_paging(client, admin):
    page = client.get("/api/notifications/page", headers=admin, params={"limit": 2}).json()
    assert page["limit"] == 2 and len(page["items"]) <= 2 and page["total"] >= len(page["items"])
    assert {"kind", "severity", "is_read"} <= set(page["items"][0])
    users_only = client.get("/api/notifications/page", headers=admin, params={"kind": "user", "limit": 100}).json()
    assert all(n["kind"] == "user" for n in users_only["items"])
    # the older list used by the header bell still works
    assert isinstance(client.get("/api/notifications", headers=admin).json(), list)


def test_users_never_see_other_roles_notifications(client, admin, operator):
    ops = client.get("/api/notifications/page", headers=operator, params={"limit": 100}).json()
    assert all(n["kind"] != "security" and n["kind"] != "user" for n in ops["items"])
