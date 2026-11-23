from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import (
    User, InspectionBatch, InspectionDecision, SheetTemplate,
    BatchCellResponse, TemplateControlItem
)
from backend.app.schemas import SupervisorReviewRequest, SupervisorFieldReviewRequest
from backend.app.auth import require_supervisor
from backend.app.audit import log_audit
from backend.app.notifications import send_notification
from backend.app.live_sync import notify_live

router = APIRouter(prefix="/api/supervisor", tags=["Supervisor Workflow"])

@router.post("/batches/{batch_id}/review-field")
def review_single_field(
    batch_id: int,
    payload: SupervisorFieldReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor)
):
    """
    FR-038: Granular field-level rejection review.
    Supervisor individually confirms or overrules each Operator-rejected item.
    """
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if batch.checked_by and batch.checked_by != current_user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden: This batch is already claimed by another supervisor.")
    _SUPERVISOR_REVIEW_STATUSES = {"OPERATOR_APPROVED", "OPERATOR_REJECTED", "SUPERVISOR_IN_PROGRESS", "ON_HOLD"}
    if batch.status not in _SUPERVISOR_REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail=f"Batch is not in supervisor review stage (current status: {batch.status}).")

    rev_dict = dict(batch.supervisor_reviews or {})
    rev_dict[payload.field_key] = payload.review
    batch.supervisor_reviews = rev_dict

    log_audit(
        db=db,
        user_id=current_user.user_id,
        role=current_user.role,
        action_type="SUPERVISOR_FIELD_REVIEW",
        sheet_id=batch.sheet_id,
        batch_id=batch.batch_id,
        details={"field_key": payload.field_key, "review": payload.review}
    )

    db.commit()
    db.refresh(batch)

    notify_live("BATCH_UPDATED", {
        "batch_id": batch.batch_id,
        "status": batch.status,
        "round": batch.round,
        "supervisor_reviews": batch.supervisor_reviews
    })

    return {"status": "success", "supervisor_reviews": batch.supervisor_reviews}

@router.post("/batches/{batch_id}/review")
def review_batch(
    batch_id: int,
    payload: SupervisorReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor)
):
    """
    FR-033 - FR-039, FR-053, FR-054, FR-055:
    Supervisor executes batch decision:
    - APPROVE: Allowed only if all Operator rejections are overruled and no items confirmed failing.
    - REJECT: Multi-select failed items or confirms rejections.
    - HOLD: Requires reason category, note, and review-by timer.
    """
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if batch.checked_by and batch.checked_by != current_user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden: This batch is already claimed by another supervisor.")
    _SUPERVISOR_REVIEW_STATUSES = {"OPERATOR_APPROVED", "OPERATOR_REJECTED", "SUPERVISOR_IN_PROGRESS", "ON_HOLD"}
    if batch.status not in _SUPERVISOR_REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail=f"Batch is not in supervisor review stage (current status: {batch.status}).")

    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == batch.sheet_id).first()
    decision_val = payload.decision.upper()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    sup_revs = batch.supervisor_reviews or {}

    # Validate supervisor-assigned NUMERIC_SAMPLE fields are all filled before APPROVE
    if decision_val in ["APPROVE", "ACCEPT_REJECTION"]:
        all_responses = db.query(BatchCellResponse).filter(BatchCellResponse.batch_id == batch_id).all()
        resp_map = {(r.item_id, str(r.column_key)): r for r in all_responses}

        sup_items = [
            it for it in (template.control_items if template else [])
            if it.is_required and it.assigned_role == "supervisor"
        ]
        missing_meas = []
        oosfields = []
        for item in sup_items:
            cols = item.sample_columns if isinstance(item.sample_columns, list) else ["val"]
            for col in cols:
                cell = resp_map.get((item.item_id, str(col)))
                if not cell or cell.cell_value is None or str(cell.cell_value).strip() == "":
                    missing_meas.append(f"{item.control_item_name} (sample {col})")
                elif not cell.is_within_spec:
                    oosfields.append(f"{item.control_item_name} (sample {col})")

        if missing_meas:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"All dimensional measurements must be completed before approval. Missing: {', '.join(missing_meas[:5])}"
            )
        if oosfields:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Some measurements are out of specification. Reject the batch or correct values: {', '.join(oosfields[:5])}"
            )

    # FR-038 Check: Any confirmed rejection blocks approval
    if decision_val in ["APPROVE", "ACCEPT_REJECTION"]:
        has_confirmed = any(v == "confirm" for v in sup_revs.values())
        if has_confirmed:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="FR-038 Violation: Cannot approve batch because one or more rejections are confirmed failing."
            )

    # Hold validation (FR-036 & FR-055)
    if decision_val == "HOLD":
        if not payload.hold_reason or not payload.hold_reason.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="FR-036 Violation: Hold Batch requires selecting a validation reason category."
            )
        if not payload.hold_note and not payload.remarks:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="FR-055 Violation: Hold Batch requires a note explaining what the hold is waiting for."
            )

    # Rejection validation (FR-035)
    if decision_val in ["REJECT", "CONTINUE_REJECTION"] and not payload.rejected_item_ids:
        # Check if any rejections were confirmed
        confirmed_keys = [k for k, v in sup_revs.items() if v == "confirm"]
        if not confirmed_keys and not (batch.operator_rejected_fields):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="FR-035 Violation: Rejection requires selecting or confirming one or more failed items."
            )

    batch.supervisor_submitted_at = now
    batch.checked_by = current_user.user_id
    batch.updated_at = now

    decision_label = "Approved"
    note_text = payload.remarks or ""

    if decision_val in ["APPROVE", "ACCEPT_REJECTION"]:
        batch.status = "APPROVED"
        batch.approved_by = current_user.user_id
        batch.hold_reason = None
        batch.hold_note = None
        batch.hold_due_at = None
        decision_label = "Approved"
        # Overruled note
        overruled = [k for k, v in sup_revs.items() if v == "overrule"]
        if overruled and not note_text:
            note_text = f"Overruled rejections on: {', '.join(overruled)}"
    elif decision_val == "HOLD":
        batch.status = "ON_HOLD"
        batch.hold_reason = payload.hold_reason
        batch.hold_note = payload.hold_note or payload.remarks
        batch.hold_by = current_user.user_id
        batch.hold_at = now
        hrs = payload.hold_due_hours or 4
        batch.hold_due_at = now + timedelta(hours=hrs)
        batch.hold_alerted = False
        decision_label = "On hold"
        note_text = f"{payload.hold_reason}: {batch.hold_note}"
    elif decision_val in ["REJECT", "CONTINUE_REJECTION"]:
        batch.status = "REJECTED"
        decision_label = "Rejected"

    # Save sign-off record (FR-054)
    signoff = InspectionDecision(
        batch_id=batch_id,
        round=batch.round or 1,
        stage="Hold placed" if decision_val == "HOLD" else "Review",
        decided_by=current_user.user_id,
        role="supervisor",
        decision=decision_label,
        rejected_item_ids=payload.rejected_item_ids or [],
        remarks=note_text,
        decided_at=now
    )
    db.add(signoff)

    # FR-053: Dispatch Notifications to Operator & Admin
    if decision_label == "Approved":
        msg = f"{current_user.full_name} approved {batch.lot_number}."
    elif decision_label == "Rejected":
        msg = f"{current_user.full_name} rejected {batch.lot_number}."
    else:
        due_str = batch.hold_due_at.strftime("%I:%M %p") if batch.hold_due_at else ""
        msg = f"{current_user.full_name} put {batch.lot_number} on hold: {payload.hold_reason}. Review by {due_str}."

    send_notification(
        db=db,
        roles=["operator", "admin"],
        text=msg,
        batch_id=batch.batch_id,
        batch_code=batch.lot_number
    )

    log_audit(
        db=db,
        user_id=current_user.user_id,
        role=current_user.role,
        action_type="SUPERVISOR_REVIEWED",
        sheet_id=batch.sheet_id,
        batch_id=batch_id,
        details={
            "decision": decision_label,
            "decision_type": decision_val,
            "round": batch.round,
            "hold_reason": payload.hold_reason,
            "rejected_item_ids": payload.rejected_item_ids,
            "remarks": note_text
        }
    )

    db.commit()
    db.refresh(batch)

    notify_live("BATCH_UPDATED", {
        "batch_id": batch.batch_id,
        "status": batch.status,
        "round": batch.round
    })

    return {
        "status": batch.status,
        "batch_id": batch.batch_id,
        "new_status": batch.status,
        "decision": decision_label,
        "round": batch.round
    }
