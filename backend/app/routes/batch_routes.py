import os
import uuid
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import or_

from backend.app.database import get_db
from backend.app.models import (
    User, SheetTemplate, TemplateControlItem, InspectionBatch,
    BatchCellResponse, InspectionDecision, InspectionAttachment, AuditLog
)
from backend.app.schemas import (
    InspectionBatchResponse, InspectionBatchDetail, CellResponseItem, AttachmentResponse,
    HoldReleaseRequest
)
from backend.app.auth import get_current_user, require_any_authenticated, require_supervisor
from backend.app.config import UPLOAD_DIR
from backend.app.notifications import check_overdue_holds, send_notification
from backend.app.audit import log_audit
from backend.app.live_sync import notify_live

router = APIRouter(prefix="/api/batches", tags=["Batches & Cells"])

def format_batch_response(b: InspectionBatch) -> dict:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    is_overdue = bool(b.status == "ON_HOLD" and b.hold_due_at and b.hold_due_at <= now)

    decisions_list = []
    for d in b.decisions:
        decisions_list.append({
            "decision_id": d.decision_id,
            "round": d.round,
            "stage": d.stage,
            "decided_by": d.decided_by,
            "role": d.role,
            "decision": d.decision,
            "rejected_fields": d.rejected_fields,
            "rejected_item_ids": d.rejected_item_ids,
            "remarks": d.remarks,
            "decided_at": d.decided_at,
            "decided_by_name": d.user.full_name if d.user else (f"User #{d.decided_by}" if d.decided_by else None)
        })

    return {
        "batch_id": b.batch_id,
        "sheet_id": b.sheet_id,
        "lot_number": b.lot_number,
        "product_name": b.product_name or (b.template.part_name if b.template else None),
        "line_name": b.line_name or "Line 1",
        "lot_quantity": b.lot_quantity,
        "inspection_mode": b.inspection_mode,
        "round": b.round or 1,
        "status": b.status,
        "operator_decision": b.operator_decision,
        "operator_rejected_fields": b.operator_rejected_fields,
        "supervisor_reviews": b.supervisor_reviews or {},
        "hold_reason": b.hold_reason,
        "hold_note": b.hold_note,
        "hold_by": b.hold_by,
        "hold_at": b.hold_at,
        "hold_due_at": b.hold_due_at,
        "hold_alerted": b.hold_alerted,
        "is_overdue": is_overdue,
        "operator_submitted_at": b.operator_submitted_at,
        "supervisor_submitted_at": b.supervisor_submitted_at,
        "prepared_by": b.prepared_by,
        "checked_by": b.checked_by,
        "approved_by": b.approved_by,
        "created_at": b.created_at,
        "updated_at": b.updated_at,
        "template": b.template,
        "decisions": decisions_list,
        "attachments": b.attachments,
        "prepared_user_name": b.prepared_user.full_name if b.prepared_user else None,
        "checked_user_name": b.checked_user.full_name if b.checked_user else None,
        "approved_user_name": b.approved_user.full_name if b.approved_user else None,
        "hold_user_name": b.hold_user.full_name if b.hold_user else None,
    }

@router.get("", response_model=List[InspectionBatchResponse])
def list_batches(
    search: Optional[str] = None,
    limit: int = 150,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_authenticated)
):
    check_overdue_holds(db)
    q = db.query(InspectionBatch)

    # Role-scoped visibility
    if current_user.role == "operator":
        # Operators see: their own batches OR unclaimed batches ready to be claimed
        q = q.filter(
            or_(
                InspectionBatch.prepared_by == current_user.user_id,
                (InspectionBatch.prepared_by == None) & (InspectionBatch.status == "CREATED_PENDING_OPERATOR")
            )
        )
    elif current_user.role == "supervisor":
        # Supervisors see: batches they already claimed (checked_by) OR
        # any batch awaiting supervisor review (operator submitted, not yet claimed)
        q = q.filter(
            or_(
                InspectionBatch.checked_by == current_user.user_id,
                InspectionBatch.status.in_(["OPERATOR_APPROVED", "OPERATOR_REJECTED"])
            )
        )
    # admin: unrestricted

    # Optional lot-number / part-name / sheet-id search (case-insensitive contains)
    if search and search.strip():
        s = f"%{search.strip()}%"
        q = q.filter(
            (InspectionBatch.lot_number.ilike(s)) |
            (InspectionBatch.product_name.ilike(s)) |
            (InspectionBatch.sheet_id.ilike(s))
        )

    batches = q.order_by(InspectionBatch.created_at.desc()).offset(offset).limit(limit).all()
    return [format_batch_response(b) for b in batches]

@router.get("/{batch_id}", response_model=InspectionBatchDetail)
def get_batch_detail(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_authenticated)
):
    check_overdue_holds(db)
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    # Enforce ownership — allow own batches AND unclaimed pending batches (so operator can view before claiming)
    if current_user.role == "operator":
        is_unclaimed = batch.prepared_by is None and batch.status == "CREATED_PENDING_OPERATOR"
        if not is_unclaimed and batch.prepared_by != current_user.user_id:
            raise HTTPException(status_code=403, detail="Forbidden: This batch belongs to another operator.")
    elif current_user.role == "supervisor":
        allowed_statuses = {"OPERATOR_APPROVED", "OPERATOR_REJECTED", "SUPERVISOR_IN_PROGRESS", "ON_HOLD", "APPROVED", "REJECTED"}
        if batch.checked_by != current_user.user_id and batch.status not in allowed_statuses:
            raise HTTPException(status_code=403, detail="Forbidden: This batch is not yet in supervisor review.")

    cells = db.query(BatchCellResponse).filter(BatchCellResponse.batch_id == batch_id).all()
    resp = format_batch_response(batch)
    resp["cell_responses"] = cells
    return resp

@router.post("/{batch_id}/open")
def open_batch_workflow(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_authenticated)
):
    """
    Transitions status upon user opening/scanning a batch:
    - Operator opening PENDING -> OPERATOR_IN_PROGRESS
    - Supervisor opening OPERATOR_APPROVED/OPERATOR_REJECTED -> SUPERVISOR_IN_PROGRESS
    """
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    changed = False
    if current_user.role == "operator" and batch.status in ["CREATED_PENDING_OPERATOR", "pending"]:
        batch.status = "OPERATOR_IN_PROGRESS"
        batch.prepared_by = current_user.user_id  # claim the batch for this operator
        changed = True
        log_audit(
            db=db, user_id=current_user.user_id, role=current_user.role,
            action_type="OPERATOR_STARTED_INSPECTION", sheet_id=batch.sheet_id, batch_id=batch.batch_id,
            details={"round": batch.round}
        )
    elif current_user.role == "operator" and batch.status == "OPERATOR_IN_PROGRESS" and batch.prepared_by == current_user.user_id:
        # Re-scan: batch already in progress for this operator — just return it (no status change)
        pass
    elif current_user.role == "supervisor" and batch.status in ["OPERATOR_APPROVED", "OPERATOR_REJECTED", "op_approved", "op_rejected"]:
        # Race guard: prevent two supervisors from claiming the same batch simultaneously
        if batch.checked_by is not None and batch.checked_by != current_user.user_id:
            raise HTTPException(status_code=409, detail="Conflict: This batch has already been claimed by another supervisor.")
        batch.status = "SUPERVISOR_IN_PROGRESS"
        batch.checked_by = current_user.user_id  # claim the batch for this supervisor
        changed = True
        log_audit(
            db=db, user_id=current_user.user_id, role=current_user.role,
            action_type="SUPERVISOR_OPENED_REVIEW", sheet_id=batch.sheet_id, batch_id=batch.batch_id,
            details={"round": batch.round}
        )
    elif current_user.role == "supervisor" and batch.status == "SUPERVISOR_IN_PROGRESS" and batch.checked_by == current_user.user_id:
        # Re-scan: batch already in review for this supervisor — just return it
        pass

    if changed:
        db.commit()
        db.refresh(batch)
        notify_live("BATCH_UPDATED", {"batch_id": batch.batch_id, "status": batch.status, "round": batch.round})

    return format_batch_response(batch)

@router.patch("/{batch_id}/cell")
def update_cell_response(
    batch_id: int,
    payload: CellResponseItem,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_authenticated)
):
    """
    Live real-time cell response update.
    Supervisor attempting to modify cell responses is rejected with 403 Forbidden.
    """
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    item = db.query(TemplateControlItem).filter(TemplateControlItem.item_id == payload.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Control item not found")

    if current_user.role == "operator":
        # Ownership check: operator can only edit their own batch
        if batch.prepared_by is not None and batch.prepared_by != current_user.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: This batch belongs to another operator."
            )
        # Status check: operator fields are locked once submitted or in supervisor's hands
        if batch.status not in ["CREATED_PENDING_OPERATOR", "OPERATOR_IN_PROGRESS"] or batch.operator_submitted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: This sheet has already been submitted and is locked for edits."
            )
        if item.editable_by_operator is False or item.assigned_role == "supervisor":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: Operators cannot edit fields assigned to Supervisors."
            )

    elif current_user.role == "supervisor":
        supervisor_turn_statuses = ["OPERATOR_APPROVED", "SUPERVISOR_IN_PROGRESS", "ON_HOLD"]
        if batch.status not in supervisor_turn_statuses:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: Sheet is not yet in supervisor review stage."
            )
        if item.assigned_role != "supervisor":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: Supervisors can only edit fields assigned to the Supervisor role."
            )

    is_spec = True
    if payload.cell_value is not None and str(payload.cell_value).strip() != "":
        val_str = str(payload.cell_value).strip()
        if item.row_mode == "NUMERIC_SAMPLE" or item.html_input_type == "number":
            try:
                num = float(val_str)
                if item.min_val is not None and num < item.min_val:
                    is_spec = False
                if item.max_val is not None and num > item.max_val:
                    is_spec = False
            except ValueError:
                is_spec = False
        elif item.html_input_type == "pf" or val_str in ["Pass", "Fail"]:
            if val_str.lower() == "fail":
                is_spec = False

    resp = db.query(BatchCellResponse).filter(
        BatchCellResponse.batch_id == batch_id,
        BatchCellResponse.item_id == payload.item_id,
        BatchCellResponse.column_key == payload.column_key
    ).first()

    if resp:
        resp.cell_value = payload.cell_value
        resp.is_within_spec = is_spec
        if payload.checker_initials:
            resp.checker_initials = payload.checker_initials
        resp.entered_by = current_user.user_id
        resp.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    else:
        resp = BatchCellResponse(
            batch_id=batch_id,
            item_id=payload.item_id,
            column_key=payload.column_key,
            cell_value=payload.cell_value,
            is_within_spec=is_spec,
            checker_initials=payload.checker_initials,
            entered_by=current_user.user_id,
            client_mutation_id=payload.client_mutation_id or str(uuid.uuid4())
        )
        db.add(resp)

    # Auto-progress to IN_PROGRESS if pending (operator only, claim the batch)
    if current_user.role == "operator" and batch.status in ["CREATED_PENDING_OPERATOR", "pending"]:
        batch.status = "OPERATOR_IN_PROGRESS"
        if not batch.prepared_by:
            batch.prepared_by = current_user.user_id

    db.commit()
    db.refresh(resp)

    notify_live("CELL_UPDATED", {
        "batch_id": resp.batch_id,
        "item_id": resp.item_id,
        "column_key": resp.column_key,
        "cell_value": resp.cell_value,
        "is_within_spec": resp.is_within_spec,
        "checker_initials": resp.checker_initials,
        "updated_at": str(resp.updated_at)
    })

    return {
        "status": "success",
        "response_id": resp.response_id,
        "batch_id": resp.batch_id,
        "item_id": resp.item_id,
        "column_key": resp.column_key,
        "cell_value": resp.cell_value,
        "is_within_spec": resp.is_within_spec,
        "updated_at": resp.updated_at
    }

@router.post("/{batch_id}/release-hold")
def release_batch_hold(
    batch_id: int,
    payload: HoldReleaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor)
):
    """
    FR-057 & FR-058: Release a hold.
    Outcomes:
    - 'approve': Batch becomes APPROVED.
    - 'reject': Batch becomes REJECTED.
    - 'reinspect': Increments round, returns to CREATED_PENDING_OPERATOR, preserves sign-off history.
    """

    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    if batch.status != "ON_HOLD":
        raise HTTPException(status_code=400, detail="Batch is not currently on hold.")

    outcome = payload.outcome.lower()
    if outcome not in ["approve", "reject", "reinspect"]:
        raise HTTPException(status_code=400, detail="Invalid outcome. Must be 'approve', 'reject', or 'reinspect'.")

    if not payload.release_note.strip():
        raise HTTPException(status_code=422, detail="Release note is required.")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    decision_label = {
        "approve": "Approved",
        "reject": "Rejected",
        "reinspect": "Sent for reinspection"
    }[outcome]

    # Save sign-off record
    signoff = InspectionDecision(
        batch_id=batch_id,
        round=batch.round,
        stage="Hold released",
        decided_by=current_user.user_id,
        role=current_user.role,
        decision=decision_label,
        rejected_item_ids=payload.rejected_item_ids if outcome == "reject" else None,
        remarks=payload.release_note.strip(),
        decided_at=now
    )
    db.add(signoff)

    holder_id = batch.hold_by
    batch.hold_reason = None
    batch.hold_note = None
    batch.hold_due_at = None
    batch.hold_alerted = False

    if outcome == "approve":
        batch.status = "APPROVED"
        batch.approved_by = current_user.user_id
        batch.supervisor_submitted_at = now
    elif outcome == "reject":
        batch.status = "REJECTED"
        batch.supervisor_submitted_at = now
    else:  # reinspect
        batch.status = "CREATED_PENDING_OPERATOR"
        batch.round = (batch.round or 1) + 1
        batch.operator_decision = None
        batch.operator_rejected_fields = None
        batch.supervisor_reviews = {}
        batch.operator_submitted_at = None
        batch.supervisor_submitted_at = None
        # Clear prior-round cell data so operator starts with a clean sheet
        db.query(BatchCellResponse).filter(BatchCellResponse.batch_id == batch.batch_id).delete()

    batch.updated_at = now

    # Dispatch notifications
    notify_roles = ["op", "operator"] if outcome == "reinspect" else ["op", "operator", "admin"]
    notif_msg = f"{current_user.full_name} released hold on {batch.lot_number}: {decision_label.lower()}."
    if outcome == "reinspect":
        notif_msg += f" Round {batch.round} is ready for inspection."

    send_notification(
        db=db,
        roles=["operator", "admin"],
        text=notif_msg,
        batch_id=batch.batch_id,
        batch_code=batch.lot_number,
        user_ids=[holder_id] if holder_id and holder_id != current_user.user_id else None
    )

    log_audit(
        db=db,
        user_id=current_user.user_id,
        role=current_user.role,
        action_type=f"HOLD_RELEASED_{outcome.upper()}",
        sheet_id=batch.sheet_id,
        batch_id=batch.batch_id,
        details={"outcome": outcome, "note": payload.release_note, "round": batch.round}
    )

    db.commit()
    db.refresh(batch)

    notify_live("BATCH_UPDATED", {"batch_id": batch.batch_id, "status": batch.status, "round": batch.round})

    return format_batch_response(batch)

@router.post("/{batch_id}/attachments")
async def upload_attachment(
    batch_id: int,
    file: UploadFile = File(...),
    capture_source: str = Form("TFT_CAMERA"),
    item_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_authenticated)
):
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    # Operators can only attach to their own batch while it is still in progress
    if current_user.role == "operator":
        if batch.prepared_by is not None and batch.prepared_by != current_user.user_id:
            raise HTTPException(status_code=403, detail="Forbidden: This batch belongs to another operator.")
        if batch.status not in ["CREATED_PENDING_OPERATOR", "OPERATOR_IN_PROGRESS"] or batch.operator_submitted_at is not None:
            raise HTTPException(status_code=403, detail="Forbidden: Batch is locked — attachments cannot be added after submission.")

    _ALLOWED_CAPTURE_SOURCES = {"TFT_CAMERA", "MOBILE_CAMERA", "FILE_UPLOAD", "WEBCAM"}
    if capture_source not in _ALLOWED_CAPTURE_SOURCES:
        capture_source = "FILE_UPLOAD"

    _ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".pdf", ".webp", ".gif"}
    _MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB

    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    if ext not in _ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail=f"File type '{ext}' is not allowed. Allowed: jpg, jpeg, png, pdf, webp, gif")

    contents = await file.read()
    if len(contents) > _MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 10 MB size limit.")

    unique_filename = f"batch_{batch_id}_{uuid.uuid4().hex[:10]}{ext}"
    target_path = os.path.join(UPLOAD_DIR, unique_filename)

    with open(target_path, "wb") as f:
        f.write(contents)

    rel_path = f"/uploads/{unique_filename}"
    attachment = InspectionAttachment(
        batch_id=batch_id,
        item_id=item_id,
        uploaded_by=current_user.user_id,
        capture_source=capture_source,
        file_path=rel_path,
        file_name=file.filename
    )
    db.add(attachment)

    log_audit(
        db=db,
        user_id=current_user.user_id,
        role=current_user.role,
        action_type="ATTACHMENT_UPLOADED",
        sheet_id=batch.sheet_id,
        batch_id=batch_id,
        details={"file_name": file.filename, "source": capture_source, "path": rel_path}
    )

    db.commit()
    db.refresh(attachment)

    return {
        "status": "success",
        "attachment_id": attachment.attachment_id,
        "file_path": attachment.file_path,
        "file_name": attachment.file_name,
        "capture_source": attachment.capture_source
    }
