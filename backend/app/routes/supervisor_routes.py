from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import (
    User, InspectionBatch, InspectionDecision
)
from backend.app.schemas import SupervisorReviewRequest
from backend.app.auth import require_supervisor
from backend.app.audit import log_audit

router = APIRouter(prefix="/api/supervisor", tags=["Supervisor Workflow"])

@router.post("/batches/{batch_id}/review")
def review_batch(
    batch_id: int,
    payload: SupervisorReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor)
):
    """
    FR-033 - FR-039:
    Supervisor executes batch decision:
    - APPROVE
    - HOLD (requires non-empty validation hold_reason)
    - REJECT (requires multi-select of failed items)
    - ACCEPT_REJECTION (Supervisor override of Operator rejection)
    - CONTINUE_REJECTION (Permanently marks entire batch REJECTED)
    """
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    decision_val = payload.decision.upper()
    valid_decisions = ["APPROVE", "REJECT", "HOLD", "ACCEPT_REJECTION", "CONTINUE_REJECTION"]
    if decision_val not in valid_decisions:
        raise HTTPException(status_code=400, detail=f"Invalid decision. Must be one of: {valid_decisions}")

    # Hold validation (FR-036)
    if decision_val == "HOLD":
        if not payload.hold_reason or not payload.hold_reason.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="FR-036 Violation: Hold Batch requires a non-empty validation reason."
            )

    # Rejection validation (FR-035)
    if decision_val == "REJECT" and not payload.rejected_item_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="FR-035 Violation: Rejection requires multi-selecting one or more failed items."
        )

    now = datetime.utcnow()
    batch.supervisor_submitted_at = now
    batch.checked_by = current_user.user_id
    batch.updated_at = now

    if decision_val == "APPROVE" or decision_val == "ACCEPT_REJECTION":
        batch.status = "APPROVED"
        batch.hold_reason = None
    elif decision_val == "HOLD":
        batch.status = "ON_HOLD"
        batch.hold_reason = payload.hold_reason
    elif decision_val in ["REJECT", "CONTINUE_REJECTION"]:
        batch.status = "REJECTED"

    # Record decision
    decision_record = InspectionDecision(
        batch_id=batch_id,
        decided_by=current_user.user_id,
        role="supervisor",
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
        action_type=f"SUPERVISOR_DECISION_{decision_val}",
        sheet_id=batch.sheet_id,
        batch_id=batch_id,
        details={
            "decision": decision_val,
            "hold_reason": payload.hold_reason,
            "rejected_item_ids": payload.rejected_item_ids,
            "remarks": payload.remarks
        }
    )

    db.commit()
    db.refresh(batch)

    return {
        "success": True,
        "message": f"Supervisor review recorded. Batch status is now {batch.status}.",
        "batch_id": batch.batch_id,
        "status": batch.status,
        "supervisor_submitted_at": batch.supervisor_submitted_at
    }
