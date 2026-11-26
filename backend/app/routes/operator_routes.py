from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import (
    User, SheetTemplate, TemplateControlItem, InspectionBatch,
    BatchCellResponse, InspectionDecision
)
from backend.app.schemas import OperatorSubmitRequest, InspectionBatchResponse
from backend.app.auth import require_operator
from backend.app.audit import log_audit
from backend.app.notifications import send_notification
from backend.app.live_sync import notify_live
from backend.app.routes.batch_routes import bad_item_counts

router = APIRouter(prefix="/api/operator", tags=["Operator Workflow"])

CLEARANCE_CLEARED = "Lot cleared"
CLEARANCE_SEGREGATED = "Cleared, NG items segregated"
CLEARANCE_HOLD = "Not cleared, hold the lot"

@router.post("/batches/{batch_id}/submit")
def submit_operator_inspection(
    batch_id: int,
    payload: OperatorSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_operator)
):
    """
    FR-025A, FR-026, FR-027, FR-028, FR-052, FR-054:
    Enforces full-sheet completion before Approve or Reject.
    Saves submitted cells, checks tolerance limits, locks Operator fields,
    dispatches notification to Supervisor & Admin, and writes to Approval Record.
    """
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    if batch.operator_submitted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inspection has already been submitted by an operator for this round and is locked"
        )

    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == batch.sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # 1. Upsert submitted cells
    for c in payload.cells:
        item = next((it for it in template.control_items if it.item_id == c.item_id), None)
        is_spec = True
        if item and c.cell_value is not None and str(c.cell_value).strip() != "":
            val_str = str(c.cell_value).strip()
            if item.row_mode == "NUMERIC_SAMPLE" or item.html_input_type == "number":
                try:
                    num_val = float(val_str)
                    if item.min_val is not None and num_val < item.min_val:
                        is_spec = False
                    if item.max_val is not None and num_val > item.max_val:
                        is_spec = False
                except ValueError:
                    is_spec = False
            elif item.html_input_type == "pf" or val_str in ["Pass", "Fail"]:
                if val_str.lower() == "fail":
                    is_spec = False

        existing_resp = db.query(BatchCellResponse).filter(
            BatchCellResponse.batch_id == batch_id,
            BatchCellResponse.item_id == c.item_id,
            BatchCellResponse.column_key == str(c.column_key)
        ).first()

        if existing_resp:
            existing_resp.cell_value = c.cell_value
            existing_resp.is_within_spec = is_spec
            if c.checker_initials:
                existing_resp.checker_initials = c.checker_initials
            existing_resp.entered_by = current_user.user_id
            existing_resp.updated_at = datetime.utcnow()
        else:
            new_resp = BatchCellResponse(
                batch_id=batch_id,
                item_id=c.item_id,
                column_key=str(c.column_key),
                cell_value=c.cell_value,
                is_within_spec=is_spec,
                checker_initials=c.checker_initials,
                entered_by=current_user.user_id,
                client_mutation_id=c.client_mutation_id
            )
            db.add(new_resp)

    db.flush()

    # 2. Query all cells for validation
    all_responses = db.query(BatchCellResponse).filter(BatchCellResponse.batch_id == batch_id).all()
    resp_map = {(r.item_id, str(r.column_key)): r for r in all_responses}

    required_items = [
        it for it in template.control_items
        if it.is_required
        and it.assigned_role not in ('supervisor', 'admin')
        and it.editable_by_operator is not False
    ]
    missing_fields = []
    bad_fields = []

    for item in required_items:
        cols = item.sample_columns if isinstance(item.sample_columns, list) else []
        for col in cols:
            cell = resp_map.get((item.item_id, str(col)))
            if not cell or cell.cell_value is None or str(cell.cell_value).strip() == "":
                missing_fields.append(f"{item.control_item_name} [{col}]")
            elif not cell.is_within_spec:
                bad_fields.append(f"{item.control_item_name} [{col}]")

    decision_norm = payload.decision.upper()

    # 3. FR-025A: Full sheet completion enforcement
    if decision_norm == "APPROVE":
        if missing_fields:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"FR-025A Violation: All required inspection fields must be completed before submitting approval or rejection. Missing {len(missing_fields)} fields: {', '.join(missing_fields[:5])}"
            )
        if bad_fields:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Values fail or are out of spec. Correct the values or submit a rejection: {', '.join(bad_fields[:5])}"
            )

    # 4. FR-027: Rejection multi-select enforcement
    if decision_norm == "REJECT":
        if not payload.rejected_item_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="FR-027 Violation: Rejecting a batch requires multi-selecting one or more failed items."
            )

    # 4b. Lot clearance. "Lot cleared" only when no item is bad; "Cleared, NG items segregated" only
    # when some are; "Not cleared, hold the lot" is always allowed but needs a reason.
    clearance = (payload.clearance or "").strip() or None
    clearance_note = (payload.clearance_note or "").strip() or None
    if clearance is not None:
        bad_items = bad_item_counts(db, [batch_id]).get(batch_id, 0)
        allowed = {
            CLEARANCE_CLEARED: bad_items == 0,
            CLEARANCE_SEGREGATED: bad_items > 0,
            CLEARANCE_HOLD: True,
        }
        if not allowed.get(clearance):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"'{clearance}' can't be used for this lot ({bad_items} bad item{'s' if bad_items != 1 else ''})."
            )
        if clearance == CLEARANCE_HOLD and not clearance_note:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Add a short reason for holding the lot."
            )

    now = datetime.utcnow()
    batch.operator_submitted_at = now
    batch.prepared_by = current_user.user_id
    batch.operator_clearance = clearance
    batch.operator_clearance_note = clearance_note
    batch.operator_decision = "Approved" if decision_norm == "APPROVE" else "Rejected"
    batch.updated_at = now

    if decision_norm == "APPROVE":
        batch.status = "OPERATOR_APPROVED"
        batch.operator_rejected_fields = None
    else:
        batch.status = "OPERATOR_REJECTED"
        batch.operator_rejected_fields = payload.rejected_item_ids

    # Find human-readable names of rejected items
    rejected_names = []
    if payload.rejected_item_ids:
        for it in template.control_items:
            if it.item_id in payload.rejected_item_ids:
                rejected_names.append(it.control_item_name)

    # 5. FR-054: Write to Approval Record
    decision_record = InspectionDecision(
        batch_id=batch_id,
        round=batch.round or 1,
        stage="Inspection",
        decided_by=current_user.user_id,
        role="operator",
        decision="Approved" if decision_norm == "APPROVE" else "Rejected",
        rejected_item_ids=payload.rejected_item_ids or [],
        rejected_fields=rejected_names,
        remarks=payload.remarks,
        decided_at=now
    )
    db.add(decision_record)

    # 6. FR-052: In-app Notification to Supervisor & Admin
    if decision_norm == "APPROVE":
        notif_text = f"{current_user.full_name} approved {batch.lot_number} ({template.document_title or template.sheet_id}). Ready for review."
    else:
        failed_summary = ", ".join(rejected_names) if rejected_names else "items failed"
        notif_text = f"{current_user.full_name} rejected {batch.lot_number}. Rejected: {failed_summary}."

    send_notification(
        db=db,
        roles=["supervisor", "admin"],
        text=notif_text,
        batch_id=batch.batch_id,
        batch_code=batch.lot_number
    )

    # 7. Audit log
    log_audit(
        db=db,
        user_id=current_user.user_id,
        role=current_user.role,
        action_type=f"OPERATOR_SUBMIT_{decision_norm}",
        sheet_id=batch.sheet_id,
        batch_id=batch_id,
        details={
            "decision": decision_norm,
            "round": batch.round,
            "rejected_item_ids": payload.rejected_item_ids,
            "rejected_fields": rejected_names,
            "remarks": payload.remarks,
            "clearance": clearance,
            "clearance_note": clearance_note,
        }
    )

    db.commit()
    db.refresh(batch)

    notify_live("BATCH_UPDATED", {"batch_id": batch.batch_id, "status": batch.status, "round": batch.round})

    return {
        "status": batch.status,
        "batch_id": batch.batch_id,
        "new_status": batch.status,
        "round": batch.round,
        "operator_decision": batch.operator_decision,
        "operator_submitted_at": batch.operator_submitted_at
    }
