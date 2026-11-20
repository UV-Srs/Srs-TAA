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

router = APIRouter(prefix="/api/operator", tags=["Operator Workflow"])

@router.post("/batches/{batch_id}/submit")
def submit_operator_inspection(
    batch_id: int,
    payload: OperatorSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_operator)
):
    """
    FR-025A, FR-026 - FR-030:
    Enforces full-sheet completion before Approve or Reject.
    Saves all cell responses, checks tolerance limits, locks Operator fields.
    """
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    # If already submitted by operator, lock
    if batch.operator_submitted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inspection has already been submitted by an operator and is locked"
        )

    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == batch.sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    required_items = [item for item in template.control_items if item.is_required]
    
    # 1. First, save / update all submitted cells into batch_cell_responses
    submitted_cells_map = {}
    for c in payload.cells:
        submitted_cells_map[(c.item_id, str(c.column_key))] = c

        # Find item definition for tolerance check
        item = next((it for it in template.control_items if it.item_id == c.item_id), None)
        is_spec = True
        if item and item.row_mode == "NUMERIC_SAMPLE" and c.cell_value:
            try:
                num_val = float(c.cell_value)
                if item.min_val is not None and num_val < item.min_val:
                    is_spec = False
                if item.max_val is not None and num_val > item.max_val:
                    is_spec = False
            except ValueError:
                is_spec = False

        # Upsert cell response
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

    # 2. FR-025A: Enforce full-sheet completion check across all required items
    # Check that for each required item, all its sample columns have a non-empty cell response
    all_responses = db.query(BatchCellResponse).filter(BatchCellResponse.batch_id == batch_id).all()
    response_lookup = {(r.item_id, str(r.column_key)): r.cell_value for r in all_responses}

    missing_fields = []
    for item in required_items:
        cols = item.sample_columns if isinstance(item.sample_columns, list) else []
        for col in cols:
            val = response_lookup.get((item.item_id, str(col)))
            if val is None or str(val).strip() == "":
                missing_fields.append(f"{item.control_item_name} (Col {col})")

    if missing_fields:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "FR-025A Violation: All required inspection fields must be completed across the sheet before submitting Approve or Reject.",
                "missing_count": len(missing_fields),
                "missing_fields": missing_fields[:10]  # sample list
            }
        )

    # 3. Decision validation
    decision_val = payload.decision.upper()
    if decision_val not in ["APPROVE", "REJECT"]:
        raise HTTPException(status_code=400, detail="Decision must be 'APPROVE' or 'REJECT'")

    if decision_val == "REJECT":
        if not payload.rejected_item_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="FR-027 Violation: Reject decision requires multi-selecting one or more failed control items."
            )

    # 4. Lock Operator fields & update batch status
    now = datetime.utcnow()
    batch.operator_submitted_at = now
    batch.prepared_by = current_user.user_id
    batch.status = "OPERATOR_APPROVED" if decision_val == "APPROVE" else "OPERATOR_REJECTED"
    batch.updated_at = now

    # Record decision
    decision_record = InspectionDecision(
        batch_id=batch_id,
        decided_by=current_user.user_id,
        role="operator",
        decision=decision_val,
        rejected_item_ids=payload.rejected_item_ids or [],
        remarks=payload.remarks,
        decided_at=now
    )
    db.add(decision_record)

    # Record audit log
    log_audit(
        db=db,
        user_id=current_user.user_id,
        role=current_user.role,
        action_type=f"OPERATOR_INSPECTION_{decision_val}",
        sheet_id=batch.sheet_id,
        batch_id=batch_id,
        details={
            "decision": decision_val,
            "rejected_item_ids": payload.rejected_item_ids,
            "remarks": payload.remarks
        }
    )

    db.commit()
    db.refresh(batch)

    return {
        "success": True,
        "message": f"Inspection submitted successfully as {batch.status}. Operator fields are now locked.",
        "batch_id": batch.batch_id,
        "status": batch.status,
        "operator_submitted_at": batch.operator_submitted_at
    }
