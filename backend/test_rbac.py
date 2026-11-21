import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

print("=" * 65)
print(" RBAC PERMISSION & AUTHORIZATION INTEGRITY TESTS (POSTGRESQL)")
print("=" * 65)

credentials = [
    ("admin", "admin123", "admin"),
    ("supervisor", "super123", "supervisor"),
    ("operator", "oper123", "operator")
]

tokens = {}

# 1. Test Logins
for username, pwd, role in credentials:
    res = client.post("/api/auth/login", json={"username": username, "password": pwd})
    assert res.status_code == 200, f"Login failed for {username}: {res.text}"
    data = res.json()
    assert data["user"]["role"] == role
    tokens[role] = data["access_token"]
    print(f"[AUTH OK] Login verified for '{username}' (Role: {role})")

# 2. Test Operator Boundaries
op_token = tokens["operator"]
# Operator accessing Admin user management -> 403 Forbidden
r1 = client.get("/api/admin/users", headers={"Authorization": f"Bearer {op_token}"})
assert r1.status_code == 403, f"Expected 403, got {r1.status_code}"
print("[RBAC OK] Operator blocked from /api/admin/users -> 403 Forbidden")

# Operator accessing Admin sheet creation -> 403 Forbidden
r2 = client.post("/api/admin/sheets", json={}, headers={"Authorization": f"Bearer {op_token}"})
assert r2.status_code == 403, f"Expected 403, got {r2.status_code}"
print("[RBAC OK] Operator blocked from /api/admin/sheets -> 403 Forbidden")

# Operator accessing Supervisor review endpoint -> 403 Forbidden
r3 = client.post("/api/supervisor/batches/1/review", json={"decision": "APPROVE"}, headers={"Authorization": f"Bearer {op_token}"})
assert r3.status_code == 403, f"Expected 403, got {r3.status_code}"
print("[RBAC OK] Operator blocked from /api/supervisor/batches/review -> 403 Forbidden")

# 3. Test Supervisor Boundaries
sup_token = tokens["supervisor"]
# Supervisor accessing Admin user management -> 403 Forbidden
r4 = client.get("/api/admin/users", headers={"Authorization": f"Bearer {sup_token}"})
assert r4.status_code == 403, f"Expected 403, got {r4.status_code}"
print("[RBAC OK] Supervisor blocked from /api/admin/users -> 403 Forbidden")

# Supervisor modifying Operator measurement cell directly (FR-034) -> 403 Forbidden
r5 = client.patch("/api/batches/1/cell", json={"item_id": 1, "column_key": "val", "cell_value": "9.99"}, headers={"Authorization": f"Bearer {sup_token}"})
assert r5.status_code == 403, f"Expected 403, got {r5.status_code}"
print("[RBAC OK] Supervisor blocked from modifying Operator measurement cell -> 403 Forbidden (FR-034)")

# 4. Test Admin Privileges
admin_token = tokens["admin"]
r6 = client.get("/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"})
assert r6.status_code == 200, f"Expected 200, got {r6.status_code}"
print(f"[RBAC OK] Admin accessed /api/admin/users -> 200 OK (Found {len(r6.json())} users)")

r7 = client.get("/api/admin/sheets", headers={"Authorization": f"Bearer {admin_token}"})
assert r7.status_code == 200, f"Expected 200, got {r7.status_code}"
print(f"[RBAC OK] Admin accessed /api/admin/sheets -> 200 OK (Found {len(r7.json())} templates)")

print("=" * 65)
print(" ALL RBAC & DATABASE BOUNDARY TESTS PASSED 100% ON POSTGRESQL!")
print("=" * 65)
