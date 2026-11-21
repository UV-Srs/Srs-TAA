from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import (
    User, InspectionBatch, InspectionDecision, SheetTemplate
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

    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == batch.sheet_id).first()
    decision_val = payload.decision.upper()

    now = datetime.utcnow()
    sup_revs = batch.supervisor_reviews or {}

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
        action_type=f"SUPERVISOR_DECISION_{decision_val}",
        sheet_id=batch.sheet_id,
        batch_id=batch_id,
        details={
            "decision": decision_label,
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
