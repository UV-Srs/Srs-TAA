from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import (
    User, SheetTemplate, TemplateControlItem, InspectionBatch,
    BatchCellResponse, InspectionDecision
)
from backend.app.schemas import OperatorSubmitRequest, InspectionBatchResponse
from backend.app.auth import require_roles
from backend.app.audit import log_audit
from backend.app.notifications import send_notification
from backend.app.live_sync import notify_live

router = APIRouter(prefix="/api/operator", tags=["Operator Workflow"])

@router.post("/batches/{batch_id}/submit")
def submit_operator_inspection(
    batch_id: int,
    payload: OperatorSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["operator"]))
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
            existing_resp.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
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

    # Operator only validates their own assigned rows (not supervisor/NUMERIC_SAMPLE rows)
    required_items = [
        it for it in template.control_items
        if it.is_required and it.row_mode != "NUMERIC_SAMPLE" and it.assigned_role != "supervisor"
    ]
    missing_fields = []
    bad_fields = []

    for item in required_items:
        # OperatorItemView always saves cells with column_key = piece number.
        # Use piece-based cols for SERIAL_TICKBOX OR any item with no explicit sample_columns
        # (visual check items like pf-type may have row_mode != SERIAL_TICKBOX but are still
        # filled per piece by the operator view).
        sample_cols = item.sample_columns if isinstance(item.sample_columns, list) else []
        if batch.lot_quantity and batch.lot_quantity > 0 and (item.row_mode == "SERIAL_TICKBOX" or not sample_cols):
            cols = [str(i) for i in range(1, batch.lot_quantity + 1)]
        elif sample_cols:
            cols = sample_cols
        else:
            cols = ["val"]
        for col in cols:
            cell = resp_map.get((item.item_id, str(col)))
            if not cell or cell.cell_value is None or str(cell.cell_value).strip() == "":
                missing_fields.append(f"{item.control_item_name} (piece {col})")
            elif not cell.is_within_spec:
                bad_fields.append(f"{item.control_item_name} (piece {col})")

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

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    batch.operator_submitted_at = now
    batch.prepared_by = current_user.user_id
    batch.operator_decision = "Approved" if decision_norm == "APPROVE" else "Rejected"
    batch.updated_at = now

    # Both APPROVE and REJECT route to supervisor — operator rejection is a flag,
    # not a terminal state; supervisor makes the final call.
    batch.status = "OPERATOR_APPROVED"
    if decision_norm == "APPROVE":
        batch.operator_rejected_fields = None
    else:
        batch.operator_rejected_fields = payload.rejected_item_ids or []

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
        notif_text = f"{current_user.full_name} approved {batch.lot_number} ({template.document_title or template.sheet_id}). Ready for supervisor review."
    else:
        failed_summary = ", ".join(rejected_names) if rejected_names else "unspecified fields"
        notif_text = f"{current_user.full_name} FLAGGED {batch.lot_number} for rejection. Fields: {failed_summary}. Awaiting supervisor decision."

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
        action_type="OPERATOR_SUBMITTED",
        sheet_id=batch.sheet_id,
        batch_id=batch_id,
        details={
            "decision": decision_norm,
            "round": batch.round,
            "rejected_item_ids": payload.rejected_item_ids,
            "rejected_fields": rejected_names,
            "remarks": payload.remarks
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
