from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.database import get_db
from backend.app.models import (
    User, SheetTemplate, TemplateControlItem, InspectionBatch,
    BatchCellResponse, InspectionDecision, InspectionAttachment, AuditLog
)
from backend.app.schemas import (
    UserCreate, UserResponse, SheetTemplateCreate, SheetTemplateResponse,
    BatchCreate, InspectionBatchResponse, AuditLogResponse
)
from backend.app.auth import require_admin, hash_password
from backend.app.audit import log_audit, purge_user_audit_logs
from backend.app.config import UPLOAD_DIR
from backend.app.export_pdf import generate_pdf_report
from backend.app.export_excel import generate_excel_report

router = APIRouter(prefix="/api/admin", tags=["Admin Management"])

# --- User Management (FR-002, FR-005) ---

@router.get("/users", response_model=List[UserResponse])
def list_users(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    return db.query(User).order_by(User.user_id.asc()).all()

@router.post("/users", response_model=UserResponse)
def create_user(payload: UserCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    existing = db.query(User).filter(User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    user = User(
        username=payload.username,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    log_audit(
        db=db,
        user_id=current_user.user_id,
        role=current_user.role,
        action_type="USER_CREATED",
        details={"created_user_id": user.user_id, "username": user.username, "role": user.role}
    )
    return user

@router.patch("/users/{user_id}/deactivate")
def deactivate_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """
    FR-005: When an Admin deactivates a user account, the system automatically detects
    all audit_logs associated with that user_id and removes them from the database
    while preserving anonymized historical batch records.
    """
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.is_active = False
    db.commit()

    # FR-005: Purge audit logs for this user
    purged_count = purge_user_audit_logs(db, user_id=user_id)

    return {
        "success": True,
        "message": f"User {user.username} deactivated. {purged_count} audit logs purged.",
        "purged_audit_logs_count": purged_count
    }

@router.patch("/users/{user_id}/activate")
def activate_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.is_active = True
    db.commit()
    return {"success": True, "message": f"User {user.username} activated."}

@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """
    FR-005: When an Admin deletes a user account, all audit_logs associated with that
    user_id are removed, preserving historical batch records (anonymized via SET NULL).
    """
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # FR-005: Purge audit logs
    purged_count = purge_user_audit_logs(db, user_id=user_id)

    db.delete(user)
    db.commit()

    return {
        "success": True,
        "message": f"User deleted. {purged_count} audit logs purged.",
        "purged_audit_logs_count": purged_count
    }

# --- Checksheet Templates (FR-006 - FR-012, FR-019) ---

@router.get("/sheets", response_model=List[SheetTemplateResponse])
def list_sheets(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    return db.query(SheetTemplate).order_by(SheetTemplate.created_at.desc()).all()

@router.post("/sheets", response_model=SheetTemplateResponse)
def create_sheet(payload: SheetTemplateCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    existing = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == payload.sheet_id).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Sheet ID '{payload.sheet_id}' already exists")

    qr_val = f"TAA:SHEET:{payload.sheet_id}"
    barcode_val = f"TAA-{payload.sheet_id}"

    template = SheetTemplate(
        sheet_id=payload.sheet_id,
        document_title=payload.document_title,
        part_no=payload.part_no,
        part_name=payload.part_name,
        model_name=payload.model_name,
        vendor_name=payload.vendor_name,
        customer_name=payload.customer_name,
        part_category=payload.part_category or "MAIN PART",
        qr_code_value=qr_val,
        barcode_value=barcode_val,
        created_by=current_user.user_id
    )
    db.add(template)
    db.flush()

    for idx, item in enumerate(payload.control_items, start=1):
        c_item = TemplateControlItem(
            sheet_id=payload.sheet_id,
            serial_no=item.serial_no or idx,
            stage_name=item.stage_name,
            control_item_name=item.control_item_name,
            specification_content=item.specification_content,
            application_method=item.application_method,
            normal_frequency=item.normal_frequency,
            ifm_frequency=item.ifm_frequency,
            row_mode=item.row_mode,
            html_input_type=item.html_input_type,
            sample_columns=item.sample_columns,
            min_val=item.min_val,
            max_val=item.max_val,
            assigned_role=item.assigned_role,
            visible_to_operator=item.visible_to_operator,
            editable_by_operator=item.editable_by_operator,
            visible_to_supervisor=item.visible_to_supervisor,
            is_required=item.is_required,
            display_order=item.display_order or idx
        )
        db.add(c_item)

    db.commit()
    db.refresh(template)

    log_audit(
        db=db,
        user_id=current_user.user_id,
        role=current_user.role,
        action_type="SHEET_TEMPLATE_CREATED",
        sheet_id=template.sheet_id,
        details={"items_count": len(payload.control_items)}
    )

    return template

@router.get("/sheets/{sheet_id}", response_model=SheetTemplateResponse)
def get_sheet(sheet_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Sheet template not found")
    return template

@router.put("/sheets/{sheet_id}", response_model=SheetTemplateResponse)
def update_sheet(sheet_id: str, payload: SheetTemplateCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Sheet template not found")

    template.document_title = payload.document_title
    template.part_no = payload.part_no
    template.part_name = payload.part_name
    template.model_name = payload.model_name
    template.vendor_name = payload.vendor_name
    template.customer_name = payload.customer_name
    template.part_category = payload.part_category

    # Replace control items
    db.query(TemplateControlItem).filter(TemplateControlItem.sheet_id == sheet_id).delete()
    for idx, item in enumerate(payload.control_items, start=1):
        c_item = TemplateControlItem(
            sheet_id=sheet_id,
            serial_no=item.serial_no or idx,
            stage_name=item.stage_name,
            control_item_name=item.control_item_name,
            specification_content=item.specification_content,
            application_method=item.application_method,
            normal_frequency=item.normal_frequency,
            ifm_frequency=item.ifm_frequency,
            row_mode=item.row_mode,
            html_input_type=item.html_input_type,
            sample_columns=item.sample_columns,
            min_val=item.min_val,
            max_val=item.max_val,
            assigned_role=item.assigned_role,
            visible_to_operator=item.visible_to_operator,
            editable_by_operator=item.editable_by_operator,
            visible_to_supervisor=item.visible_to_supervisor,
            is_required=item.is_required,
            display_order=item.display_order or idx
        )
        db.add(c_item)

    db.commit()
    db.refresh(template)
    return template

# --- Batches & Progress Dashboard (FR-013, FR-049, FR-050) ---

@router.post("/batches", response_model=InspectionBatchResponse)
def create_batch(payload: BatchCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == payload.sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail=f"Sheet template '{payload.sheet_id}' not found")

    batch = InspectionBatch(
        sheet_id=payload.sheet_id,
        lot_number=payload.lot_number,
        lot_quantity=payload.lot_quantity,
        inspection_mode=payload.inspection_mode or "IFM",
        status="CREATED_PENDING_OPERATOR"
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    log_audit(
        db=db,
        user_id=current_user.user_id,
        role=current_user.role,
        action_type="BATCH_CREATED",
        sheet_id=payload.sheet_id,
        batch_id=batch.batch_id,
        details={"lot_number": payload.lot_number, "mode": payload.inspection_mode}
    )

    return batch

@router.get("/progress")
def get_progress_dashboard(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """
    Returns real-time progress across all batches, including status counts,
    completion percentages, and bottleneck stages.
    """
    batches = db.query(InspectionBatch).order_by(InspectionBatch.created_at.desc()).all()
    
    total = len(batches)
    counts = {
        "CREATED_PENDING_OPERATOR": 0,
        "OPERATOR_IN_PROGRESS": 0,
        "OPERATOR_APPROVED": 0,
        "OPERATOR_REJECTED": 0,
        "SUPERVISOR_IN_PROGRESS": 0,
        "ON_HOLD": 0,
        "APPROVED": 0,
        "REJECTED": 0
    }

    batch_list = []
    for b in batches:
        counts[b.status] = counts.get(b.status, 0) + 1
        
        # Calculate completion %
        total_items = db.query(TemplateControlItem).filter(TemplateControlItem.sheet_id == b.sheet_id).count()
        answered_cells = db.query(BatchCellResponse).filter(
            BatchCellResponse.batch_id == b.batch_id,
            BatchCellResponse.cell_value.isnot(None),
            BatchCellResponse.cell_value != ""
        ).count()
        
        # Estimate total expected cells: sum of length of sample_columns
        template_items = db.query(TemplateControlItem).filter(TemplateControlItem.sheet_id == b.sheet_id).all()
        expected_cells = sum(len(it.sample_columns) if isinstance(it.sample_columns, list) else 1 for it in template_items) or 1
        
        pct = min(100, int((answered_cells / expected_cells) * 100)) if expected_cells > 0 else 0
        if b.status in ["APPROVED", "REJECTED", "OPERATOR_APPROVED", "OPERATOR_REJECTED"]:
            pct = 100

        # Bottleneck stage identification
        bottleneck = "None"
        if b.status == "CREATED_PENDING_OPERATOR":
            bottleneck = "Pending Operator Scan"
        elif b.status == "OPERATOR_IN_PROGRESS":
            bottleneck = "Operator Field Inspection"
        elif b.status in ["OPERATOR_APPROVED", "OPERATOR_REJECTED"]:
            bottleneck = "Awaiting Supervisor Review"
        elif b.status == "ON_HOLD":
            bottleneck = f"Supervisor Hold: {b.hold_reason or 'Validation required'}"
        elif b.status == "APPROVED":
            bottleneck = "Completed (Pass)"
        elif b.status == "REJECTED":
            bottleneck = "Completed (Rejected)"

        prep_user = db.query(User).filter(User.user_id == b.prepared_by).first() if b.prepared_by else None
        chk_user = db.query(User).filter(User.user_id == b.checked_by).first() if b.checked_by else None

        batch_list.append({
            "batch_id": b.batch_id,
            "sheet_id": b.sheet_id,
            "part_no": b.template.part_no if b.template else None,
            "part_name": b.template.part_name if b.template else None,
            "lot_number": b.lot_number,
            "lot_quantity": b.lot_quantity,
            "inspection_mode": b.inspection_mode,
            "status": b.status,
            "completion_pct": pct,
            "bottleneck_stage": bottleneck,
            "operator_name": prep_user.full_name if prep_user else None,
            "supervisor_name": chk_user.full_name if chk_user else None,
            "created_at": b.created_at,
            "updated_at": b.updated_at
        })

    return {
        "summary": {
            "total_batches": total,
            "pending_operator": counts["CREATED_PENDING_OPERATOR"] + counts["OPERATOR_IN_PROGRESS"],
            "awaiting_supervisor": counts["OPERATOR_APPROVED"] + counts["OPERATOR_REJECTED"],
            "on_hold": counts["ON_HOLD"],
            "approved": counts["APPROVED"],
            "rejected": counts["REJECTED"],
            "counts_by_status": counts
        },
        "batches": batch_list
    }

# --- Report Exports (FR-014, FR-051) ---

@router.get("/batches/{batch_id}/export")
def export_batch_report(
    batch_id: int,
    format: str = Query("pdf", pattern="^(pdf|xlsx)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    FR-014 / FR-051: Downloads the exact IFM checksheet in PDF or Excel (.xlsx).
    """
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == batch.sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    cell_responses = db.query(BatchCellResponse).filter(BatchCellResponse.batch_id == batch_id).all()
    decisions = db.query(InspectionDecision).filter(InspectionDecision.batch_id == batch_id).order_by(InspectionDecision.decided_at.asc()).all()
    attachments = db.query(InspectionAttachment).filter(InspectionAttachment.batch_id == batch_id).all()

    filename_base = f"IFM_Checksheet_{template.sheet_id}_{batch.lot_number}"

    if format == "pdf":
        pdf_bytes = generate_pdf_report(
            batch=batch,
            template=template,
            cell_responses=cell_responses,
            decisions=decisions,
            attachments=attachments,
            upload_dir=UPLOAD_DIR
        )
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.pdf"'}
        )
    else:
        xlsx_bytes = generate_excel_report(
            batch=batch,
            template=template,
            cell_responses=cell_responses,
            decisions=decisions,
            attachments=attachments
        )
        return Response(
            content=xlsx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.xlsx"'}
        )

# --- Activity / Audit Logs (FR-015) ---

@router.get("/audit-logs", response_model=List[AuditLogResponse])
def get_audit_logs(
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    return db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).all()
