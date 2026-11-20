import os
import uuid
import base64
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import (
    User, SheetTemplate, TemplateControlItem, InspectionBatch,
    BatchCellResponse, InspectionDecision, InspectionAttachment
)
from backend.app.schemas import (
    InspectionBatchResponse, InspectionBatchDetail, CellResponseItem, AttachmentResponse
)
from backend.app.auth import get_current_user, require_any_authenticated
from backend.app.config import UPLOAD_DIR

router = APIRouter(prefix="/api/batches", tags=["Batches & Cells"])

@router.get("", response_model=List[InspectionBatchResponse])
def list_batches(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_authenticated)
):
    batches = db.query(InspectionBatch).order_by(InspectionBatch.created_at.desc()).all()
    results = []
    for b in batches:
        results.append({
            "batch_id": b.batch_id,
            "sheet_id": b.sheet_id,
            "lot_number": b.lot_number,
            "lot_quantity": b.lot_quantity,
            "inspection_mode": b.inspection_mode,
            "status": b.status,
            "hold_reason": b.hold_reason,
            "operator_submitted_at": b.operator_submitted_at,
            "supervisor_submitted_at": b.supervisor_submitted_at,
            "prepared_by": b.prepared_by,
            "checked_by": b.checked_by,
            "approved_by": b.approved_by,
            "created_at": b.created_at,
            "updated_at": b.updated_at,
            "template": b.template,
            "decisions": b.decisions,
            "attachments": b.attachments,
            "prepared_user_name": b.prepared_user.full_name if b.prepared_user else None,
            "checked_user_name": b.checked_user.full_name if b.checked_user else None,
            "approved_user_name": b.approved_user.full_name if b.approved_user else None,
        })
    return results

@router.get("/{batch_id}", response_model=InspectionBatchDetail)
def get_batch_detail(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_authenticated)
):
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    cells = db.query(BatchCellResponse).filter(BatchCellResponse.batch_id == batch_id).all()

    return {
        "batch_id": batch.batch_id,
        "sheet_id": batch.sheet_id,
        "lot_number": batch.lot_number,
        "lot_quantity": batch.lot_quantity,
        "inspection_mode": batch.inspection_mode,
        "status": batch.status,
        "hold_reason": batch.hold_reason,
        "operator_submitted_at": batch.operator_submitted_at,
        "supervisor_submitted_at": batch.supervisor_submitted_at,
        "prepared_by": batch.prepared_by,
        "checked_by": batch.checked_by,
        "approved_by": batch.approved_by,
        "created_at": batch.created_at,
        "updated_at": batch.updated_at,
        "template": batch.template,
        "cell_responses": cells,
        "decisions": batch.decisions,
        "attachments": batch.attachments,
        "prepared_user_name": batch.prepared_user.full_name if batch.prepared_user else None,
        "checked_user_name": batch.checked_user.full_name if batch.checked_user else None,
        "approved_user_name": batch.approved_user.full_name if batch.approved_user else None,
    }

@router.patch("/{batch_id}/cell")
def update_cell_response(
    batch_id: int,
    payload: CellResponseItem,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_authenticated)
):
    """
    Live real-time cell response update.
    Enforces strict access control:
    - Non-functional requirement 3: Supervisor attempting to modify batch_cell_responses
      after operator_submitted_at is set MUST return HTTP 403 Forbidden.
    - Operator cannot edit once operator_submitted_at is set.
    """
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    # Strict access lock checks
    if current_user.role == "supervisor" and batch.operator_submitted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Supervisor cannot edit Operator entries after Operator submission."
        )

    if current_user.role == "operator" and batch.operator_submitted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Inspection sheet is locked in Read-Only Summary Mode."
        )

    # If batch is approved or rejected, completely locked
    if batch.status in ["APPROVED", "REJECTED"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Forbidden: Batch is finalized with status {batch.status}."
        )

    # Validate specification tolerance
    item = db.query(TemplateControlItem).filter(TemplateControlItem.item_id == payload.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Control item not found")

    is_spec = True
    if item.row_mode == "NUMERIC_SAMPLE" and payload.cell_value:
        try:
            val = float(payload.cell_value)
            if item.min_val is not None and val < item.min_val:
                is_spec = False
            if item.max_val is not None and val > item.max_val:
                is_spec = False
        except ValueError:
            is_spec = False

    # Upsert cell
    cell = db.query(BatchCellResponse).filter(
        BatchCellResponse.batch_id == batch_id,
        BatchCellResponse.item_id == payload.item_id,
        BatchCellResponse.column_key == str(payload.column_key)
    ).first()

    now = datetime.utcnow()
    if cell:
        cell.cell_value = payload.cell_value
        cell.is_within_spec = is_spec
        if payload.checker_initials:
            cell.checker_initials = payload.checker_initials
        cell.entered_by = current_user.user_id
        cell.updated_at = now
    else:
        cell = BatchCellResponse(
            batch_id=batch_id,
            item_id=payload.item_id,
            column_key=str(payload.column_key),
            cell_value=payload.cell_value,
            is_within_spec=is_spec,
            checker_initials=payload.checker_initials,
            entered_by=current_user.user_id,
            client_mutation_id=payload.client_mutation_id
        )
        db.add(cell)

    # If batch was still in CREATED_PENDING_OPERATOR, move to OPERATOR_IN_PROGRESS
    if batch.status == "CREATED_PENDING_OPERATOR":
        batch.status = "OPERATOR_IN_PROGRESS"
        batch.updated_at = now

    db.commit()
    db.refresh(cell)

    return {
        "success": True,
        "response_id": cell.response_id,
        "item_id": cell.item_id,
        "column_key": cell.column_key,
        "cell_value": cell.cell_value,
        "is_within_spec": cell.is_within_spec,
        "checker_initials": cell.checker_initials,
        "batch_status": batch.status
    }

@router.post("/{batch_id}/attachments", response_model=AttachmentResponse)
async def upload_attachment(
    batch_id: int,
    item_id: Optional[int] = Form(None),
    capture_source: str = Form("FILE_UPLOAD"), # 'TFT_CAMERA' | 'FILE_UPLOAD'
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_authenticated)
):
    """
    FR-040, FR-041: Supports attaching inspection photos via file upload
    or direct TFT device camera capture (JPEG/PNG/WebP, max 10MB).
    """
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    # Validate file extension
    ext = os.path.splitext(file.filename)[1].lower() if file.filename else ".jpg"
    if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image format. Allowed formats: JPEG, PNG, WebP."
        )

    # Read and check file size (max 10MB)
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size exceeds maximum limit of 10 MB."
        )

    unique_filename = f"batch_{batch_id}_{uuid.uuid4().hex[:10]}{ext}"
    target_path = UPLOAD_DIR / unique_filename

    with open(target_path, "wb") as f:
        f.write(content)

    rel_path = f"/uploads/{unique_filename}"
    attachment = InspectionAttachment(
        batch_id=batch_id,
        item_id=item_id,
        uploaded_by=current_user.user_id,
        capture_source=capture_source,
        file_path=rel_path,
        file_name=file.filename or unique_filename
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)

    return attachment
