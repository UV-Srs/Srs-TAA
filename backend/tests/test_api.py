import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.database import engine, Base, SessionLocal
from backend.app import models
from backend.app.models import (
    User, SheetTemplate, TemplateControlItem, InspectionBatch,
    AuditLog, BatchCellResponse
)
from backend.app.seed_data import seed_database

@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    seed_database(db)
    db.close()
    yield

@pytest.fixture
def client():
    return TestClient(app)

def get_auth_token(client, username, password):
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, f"Login failed for {username}: {resp.text}"
    return resp.json()["access_token"]

# --- Test 1: Authentication & Audit Logging (FR-001, FR-004) ---
def test_authentication_and_audit(client):
    admin_token = get_auth_token(client, "admin", "admin123")
    assert admin_token is not None

    supervisor_token = get_auth_token(client, "supervisor", "super123")
    assert supervisor_token is not None

    operator_token = get_auth_token(client, "operator", "oper123")
    assert operator_token is not None

    # Check that audit log has recorded logins
    headers = {"Authorization": f"Bearer {admin_token}"}
    logs_resp = client.get("/api/admin/audit-logs", headers=headers)
    assert logs_resp.status_code == 200
    logs = logs_resp.json()
    assert len(logs) > 0
    actions = [l["action_type"] for l in logs]
    assert "USER_LOGIN" in actions

# --- Test 2: FR-005 Audit Purge on User Deactivation and Deletion ---
def test_user_lifecycle_and_audit_purge(client):
    admin_token = get_auth_token(client, "admin", "admin123")
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create a temporary operator
    new_user_payload = {
        "username": "temp_operator_1",
        "full_name": "Temporary Operator",
        "password": "temppassword123",
        "role": "operator"
    }
    create_resp = client.post("/api/admin/users", json=new_user_payload, headers=headers)
    assert create_resp.status_code == 200
    temp_user_id = create_resp.json()["user_id"]

    # 2. Log in as this new operator to generate audit logs
    temp_token = get_auth_token(client, "temp_operator_1", "temppassword123")
    assert temp_token is not None

    # Verify audit logs exist for this user
    db = SessionLocal()
    user_logs = db.query(AuditLog).filter(AuditLog.user_id == temp_user_id).all()
    assert len(user_logs) >= 1
    db.close()

    # 3. Deactivate user and verify FR-005: all audit logs for this user_id are purged!
    deact_resp = client.patch(f"/api/admin/users/{temp_user_id}/deactivate", headers=headers)
    assert deact_resp.status_code == 200
    assert deact_resp.json()["success"] is True
    assert deact_resp.json()["purged_audit_logs_count"] >= 1

    db = SessionLocal()
    purged_logs = db.query(AuditLog).filter(AuditLog.user_id == temp_user_id).all()
    assert len(purged_logs) == 0, "Audit logs were not completely purged on user deactivation!"
    db.close()

    # 4. Delete user completely and verify audit logs remain 0
    del_resp = client.delete(f"/api/admin/users/{temp_user_id}", headers=headers)
    assert del_resp.status_code == 200

    db = SessionLocal()
    remaining = db.query(AuditLog).filter(AuditLog.user_id == temp_user_id).all()
    assert len(remaining) == 0
    db.close()

# --- Test 3: Checksheet Template Creation & QR/Barcode Generation (FR-006 - FR-012, FR-019) ---
def test_sheet_template_and_qr_generation(client):
    admin_token = get_auth_token(client, "admin", "admin123")
    headers = {"Authorization": f"Bearer {admin_token}"}

    sheet_payload = {
        "sheet_id": "TEST-SHEET-001",
        "document_title": "TEST INITIAL FLOW MANAGEMENT CHECKSHEET",
        "part_no": "TEST-PART-999",
        "part_name": "FUEL TUBE ASSEMBLY",
        "model_name": "TEST MODEL",
        "vendor_name": "TEST VENDOR",
        "customer_name": "TEST CUSTOMER",
        "part_category": "MAIN PART",
        "control_items": [
            {
                "serial_no": 1,
                "stage_name": "Visual Stage",
                "control_item_name": "Surface Flaw Check",
                "specification_content": "No scratches or burrs",
                "application_method": "Visual",
                "normal_frequency": "100%",
                "ifm_frequency": "200%",
                "row_mode": "SERIAL_TICKBOX",
                "html_input_type": "checkbox",
                "sample_columns": ["1", "2", "3"],
                "assigned_role": "operator",
                "is_required": True,
                "display_order": 1
            },
            {
                "serial_no": 2,
                "stage_name": "Measurement Stage",
                "control_item_name": "Diameter Check",
                "specification_content": "8.00 ± 0.10 mm",
                "application_method": "Micrometer",
                "normal_frequency": "n=5",
                "ifm_frequency": "n=10",
                "row_mode": "NUMERIC_SAMPLE",
                "html_input_type": "number",
                "sample_columns": ["S1", "S2"],
                "min_val": 7.90,
                "max_val": 8.10,
                "assigned_role": "operator",
                "is_required": True,
                "display_order": 2
            }
        ]
    }

    resp = client.post("/api/admin/sheets", json=sheet_payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["sheet_id"] == "TEST-SHEET-001"
    assert data["qr_code_value"] == "TAA:SHEET:TEST-SHEET-001"
    assert data["barcode_value"] == "TAA-TEST-SHEET-001"
    assert len(data["control_items"]) == 2

    # Verify QR and Barcode image endpoints (FR-019)
    code_resp = client.get("/api/qr/codes/TEST-SHEET-001")
    assert code_resp.status_code == 200
    code_data = code_resp.json()
    assert code_data["qr_image_url"].startswith("data:image/png;base64,")
    assert code_data["barcode_image_url"].startswith("data:image/png;base64,")

# --- Test 4: Batch Creation, QR Resolution, and Rescan Read-Only Rule (FR-020, FR-021, FR-021A) ---
def test_batch_creation_and_qr_resolution(client):
    admin_token = get_auth_token(client, "admin", "admin123")
    headers = {"Authorization": f"Bearer {admin_token}"}

    batch_payload = {
        "sheet_id": "TEST-SHEET-001",
        "lot_number": "LOT-TEST-100",
        "lot_quantity": 250,
        "inspection_mode": "IFM"
    }
    b_resp = client.post("/api/admin/batches", json=batch_payload, headers=headers)
    assert b_resp.status_code == 200
    batch_id = b_resp.json()["batch_id"]

    # Operator scans QR code (FR-020)
    op_token = get_auth_token(client, "operator", "oper123")
    op_headers = {"Authorization": f"Bearer {op_token}"}

    resolve_resp = client.get(f"/api/qr/resolve/TAA:BATCH:{batch_id}", headers=op_headers)
    assert resolve_resp.status_code == 200
    res_data = resolve_resp.json()
    assert res_data["type"] == "BATCH"
    assert res_data["batch_id"] == batch_id
    assert res_data["read_only"] is False, "New batch should be editable for Operator initially"

# --- Test 5: Operator Full-Sheet Completion Enforcement (FR-025A) & Rejection Validation (FR-027) ---
def test_operator_completion_and_rejection_rules(client):
    admin_token = get_auth_token(client, "admin", "admin123")
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Create fresh batch
    batch_payload = {
        "sheet_id": "TEST-SHEET-001",
        "lot_number": "LOT-FULL-COMPLETION-TEST",
        "lot_quantity": 100,
        "inspection_mode": "IFM"
    }
    b_resp = client.post("/api/admin/batches", json=batch_payload, headers=headers)
    batch_id = b_resp.json()["batch_id"]

    # Get template control items
    sheet_resp = client.get("/api/admin/sheets/TEST-SHEET-001", headers=headers)
    items = sheet_resp.json()["control_items"]
    item1_id = items[0]["item_id"] # visual: cols ["1", "2", "3"]
    item2_id = items[1]["item_id"] # numeric: cols ["S1", "S2"], min=7.9, max=8.1

    op_token = get_auth_token(client, "operator", "oper123")
    op_headers = {"Authorization": f"Bearer {op_token}"}

    # Attempt 1: Incomplete submission (missing item2 columns) -> Expect 422 (FR-025A)
    incomplete_payload = {
        "decision": "APPROVE",
        "cells": [
            {"item_id": item1_id, "column_key": "1", "cell_value": "true"},
            {"item_id": item1_id, "column_key": "2", "cell_value": "true"},
            {"item_id": item1_id, "column_key": "3", "cell_value": "true"}
            # item2 S1 and S2 missing!
        ]
    }
    fail_resp = client.post(f"/api/operator/batches/{batch_id}/submit", json=incomplete_payload, headers=op_headers)
    assert fail_resp.status_code == 422
    assert "FR-025A" in fail_resp.text or "All required inspection fields must be completed" in fail_resp.text

    # Attempt 2: Reject without specifying rejected_item_ids -> Expect 422 (FR-027)
    invalid_reject_payload = {
        "decision": "REJECT",
        "rejected_item_ids": [],
        "cells": [
            {"item_id": item1_id, "column_key": "1", "cell_value": "true"},
            {"item_id": item1_id, "column_key": "2", "cell_value": "true"},
            {"item_id": item1_id, "column_key": "3", "cell_value": "true"},
            {"item_id": item2_id, "column_key": "S1", "cell_value": "8.02"},
            {"item_id": item2_id, "column_key": "S2", "cell_value": "8.25"} # out of spec
        ]
    }
    reject_fail_resp = client.post(f"/api/operator/batches/{batch_id}/submit", json=invalid_reject_payload, headers=op_headers)
    assert reject_fail_resp.status_code == 422
    assert "FR-027" in reject_fail_resp.text or "requires multi-selecting" in reject_fail_resp.text

    # Attempt 3: Valid Reject with full sheet complete and rejected_item_ids specified
    valid_reject_payload = {
        "decision": "REJECT",
        "rejected_item_ids": [item2_id],
        "remarks": "Diameter S2 is out of spec (8.25mm vs max 8.10mm)",
        "cells": [
            {"item_id": item1_id, "column_key": "1", "cell_value": "true"},
            {"item_id": item1_id, "column_key": "2", "cell_value": "true"},
            {"item_id": item1_id, "column_key": "3", "cell_value": "true"},
            {"item_id": item2_id, "column_key": "S1", "cell_value": "8.02"},
            {"item_id": item2_id, "column_key": "S2", "cell_value": "8.25"}
        ]
    }
    submit_resp = client.post(f"/api/operator/batches/{batch_id}/submit", json=valid_reject_payload, headers=op_headers)
    assert submit_resp.status_code == 200
    assert submit_resp.json()["status"] == "OPERATOR_REJECTED"

    # Verify Rescan Read-Only Rule for Operator (FR-021A)
    rescan_resp = client.get(f"/api/qr/resolve/TAA:BATCH:{batch_id}", headers=op_headers)
    assert rescan_resp.status_code == 200
    assert rescan_resp.json()["read_only"] is True, "Rescanned submitted batch must be Read-Only for Operator"

# --- Test 6: Supervisor Strict Access Locks (NFR-3) & Review Options (FR-033 - FR-039) ---
def test_supervisor_review_and_access_locks(client):
    admin_token = get_auth_token(client, "admin", "admin123")
    headers = {"Authorization": f"Bearer {admin_token}"}
    sup_token = get_auth_token(client, "supervisor", "super123")
    sup_headers = {"Authorization": f"Bearer {sup_token}"}

    # Use the batch submitted in Test 5
    db = SessionLocal()
    batch = db.query(InspectionBatch).filter(InspectionBatch.lot_number == "LOT-FULL-COMPLETION-TEST").first()
    batch_id = batch.batch_id
    item = db.query(TemplateControlItem).filter(TemplateControlItem.sheet_id == batch.sheet_id).first()
    db.close()

    # NFR-3 Test: Supervisor attempting to edit Operator cell responses after submission -> MUST RETURN HTTP 403!
    cell_edit_resp = client.patch(
        f"/api/batches/{batch_id}/cell",
        json={"item_id": item.item_id, "column_key": "1", "cell_value": "false"},
        headers=sup_headers
    )
    assert cell_edit_resp.status_code == 403, "NFR-3 Violation: Supervisor should be forbidden (403) from editing operator cells!"

    # Test Hold Batch requires validation reason (FR-036)
    hold_empty_resp = client.post(
        f"/api/supervisor/batches/{batch_id}/review",
        json={"decision": "HOLD", "hold_reason": ""},
        headers=sup_headers
    )
    assert hold_empty_resp.status_code == 422
    assert "FR-036" in hold_empty_resp.text or "Hold Batch requires a non-empty validation reason" in hold_empty_resp.text

    # Test Supervisor Override Rejection -> ACCEPT_REJECTION (FR-038)
    override_resp = client.post(
        f"/api/supervisor/batches/{batch_id}/review",
        json={
            "decision": "ACCEPT_REJECTION",
            "remarks": "Engineering deviation approval concession granted for test lot."
        },
        headers=sup_headers
    )
    assert override_resp.status_code == 200
    assert override_resp.json()["status"] == "APPROVED"

    # Now rescanning opens in Read-Only Summary Mode for everyone
    final_rescan = client.get(f"/api/qr/resolve/TAA:BATCH:{batch_id}", headers=sup_headers)
    assert final_rescan.status_code == 200
    assert final_rescan.json()["read_only"] is True

# --- Test 7: Report Exports - PDF and Excel (FR-014, FR-051) ---
def test_report_exports(client):
    admin_token = get_auth_token(client, "admin", "admin123")
    headers = {"Authorization": f"Bearer {admin_token}"}

    db = SessionLocal()
    batch = db.query(InspectionBatch).first()
    batch_id = batch.batch_id
    db.close()

    # Export PDF
    pdf_resp = client.get(f"/api/admin/batches/{batch_id}/export?format=pdf", headers=headers)
    assert pdf_resp.status_code == 200
    assert pdf_resp.headers["content-type"] == "application/pdf"
    assert len(pdf_resp.content) > 1000

    # Export Excel (.xlsx)
    xlsx_resp = client.get(f"/api/admin/batches/{batch_id}/export?format=xlsx", headers=headers)
    assert xlsx_resp.status_code == 200
    assert "spreadsheetml" in xlsx_resp.headers["content-type"]
    assert len(xlsx_resp.content) > 1000

# --- Test 8: Offline Queue Sync (FR-041A) ---
def test_offline_queue_sync(client):
    op_token = get_auth_token(client, "operator", "oper123")
    op_headers = {"Authorization": f"Bearer {op_token}"}

    db = SessionLocal()
    batch = db.query(InspectionBatch).first()
    item = db.query(TemplateControlItem).filter(TemplateControlItem.sheet_id == batch.sheet_id).first()
    db.close()

    mutation_uuid = "123e4567-e89b-12d3-a456-426614174000"
    payload = {
        "mutations": [
            {
                "client_mutation_id": mutation_uuid,
                "batch_id": batch.batch_id,
                "item_id": item.item_id,
                "column_key": "1",
                "cell_value": "true",
                "checker_initials": "OP"
            }
        ]
    }

    # 1. First sync -> processed = 1
    sync_resp1 = client.post("/api/sync/offline-queue", json=payload, headers=op_headers)
    assert sync_resp1.status_code == 200
    assert sync_resp1.json()["processed_mutations"] == 1

    # 2. Replay same mutation -> duplicate = 1 (Idempotent)
    sync_resp2 = client.post("/api/sync/offline-queue", json=payload, headers=op_headers)
    assert sync_resp2.status_code == 200
    assert sync_resp2.json()["duplicate_mutations"] == 1
