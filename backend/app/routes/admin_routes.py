import io
import csv
import os
from datetime import datetime, timezone
from typing import List, Optional, Union
from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.database import get_db
from backend.app.models import (
    User, SheetTemplate, TemplateControlItem, InspectionBatch,
    BatchCellResponse, InspectionDecision, InspectionAttachment, AuditLog
)
from backend.app.schemas import (
    UserCreate, UserResponse, PasswordResetRequest, SheetTemplateCreate, SheetTemplateResponse,
    BatchCreate, QuickBatchRegisterRequest, InspectionBatchResponse, AuditLogResponse
)
from backend.app.auth import require_admin, require_any_authenticated, hash_password
from backend.app.audit import log_audit, purge_user_audit_logs
from backend.app.config import UPLOAD_DIR
from backend.app.export_pdf import generate_pdf_report
from backend.app.export_excel import generate_excel_report
from backend.app.notifications import check_overdue_holds, send_notification
from backend.app.live_sync import notify_live
from backend.app.routes.batch_routes import format_batch_response

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
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    user = User(
        username=payload.username,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=True
    )
    db.add(user)
    db.flush()  # get user_id before commit

    log_audit(
        db=db,
        user_id=current_user.user_id,
        role=current_user.role,
        action_type="USER_CREATED",
        details={"created_user_id": user.user_id, "username": user.username, "role": user.role}
    )

    db.commit()
    db.refresh(user)
    return user

@router.patch("/users/{user_id}/deactivate")
def deactivate_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """
    FR-005: When an Admin deactivates a user account, the system automatically detects
    all audit_logs associated with that user_id and removes them from the database
    while preserving anonymized historical batch records.
    """
    if user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Admins cannot deactivate their own account.")
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

@router.patch("/users/{user_id}/reset-password")
def admin_reset_password(
    user_id: int,
    payload: PasswordResetRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Admin resets another user's password without knowing their current password."""
    from backend.app.auth import hash_password as _hash
    new_password = payload.new_password
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = _hash(new_password)
    user.password_version = (user.password_version or 1) + 1  # invalidate all existing sessions
    log_audit(
        db=db,
        user_id=current_user.user_id,
        role=current_user.role,
        action_type="ADMIN_RESET_PASSWORD",
        details={"target_user_id": user_id, "target_username": user.username}
    )
    db.commit()
    return {"success": True, "message": f"Password reset for {user.username}. All existing sessions invalidated."}

@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """
    FR-005: When an Admin deletes a user account, all audit_logs associated with that
    user_id are removed, preserving historical batch records (anonymized via SET NULL).
    """
    if user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Admins cannot delete their own account.")
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

# NOTE: /sheets/default MUST be before /sheets/{sheet_id} so FastAPI doesn't
# swallow "default" as a sheet_id parameter.
@router.get("/sheets/default", response_model=Optional[SheetTemplateResponse])
def get_default_sheet(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """Return the currently active default sheet template, or null if none is set."""
    return db.query(SheetTemplate).filter(SheetTemplate.is_default == True).first()

@router.post("/sheets", response_model=SheetTemplateResponse)
def create_sheet(payload: SheetTemplateCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    existing = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == payload.sheet_id).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Sheet ID '{payload.sheet_id}' already exists")

    qr_val = f"TAA:SHEET:{payload.sheet_id}"
    barcode_val = f"TAA-{payload.sheet_id}"

    # Check external_barcode uniqueness if provided
    ext_bc = payload.external_barcode.strip() if payload.external_barcode else None
    if ext_bc:
        conflict = db.query(SheetTemplate).filter(SheetTemplate.external_barcode == ext_bc).first()
        if conflict:
            raise HTTPException(status_code=400, detail=f"External barcode '{ext_bc}' is already assigned to sheet '{conflict.sheet_id}'")

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
        external_barcode=ext_bc,
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
            unit=item.unit,
            assigned_role=item.assigned_role,
            is_supervisor_checkpoint=item.is_supervisor_checkpoint,
            visible_to_operator=item.visible_to_operator,
            editable_by_operator=item.editable_by_operator,
            visible_to_supervisor=item.visible_to_supervisor,
            is_required=item.is_required,
            display_order=item.display_order or idx
        )
        db.add(c_item)

    db.commit()
    db.refresh(template)

    notify_live("SHEET_UPDATED", {"sheet_id": template.sheet_id, "action": "CREATE"})

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
    ext_bc_upd = payload.external_barcode.strip() if payload.external_barcode else None
    if ext_bc_upd and ext_bc_upd != template.external_barcode:
        conflict = db.query(SheetTemplate).filter(
            SheetTemplate.external_barcode == ext_bc_upd,
            SheetTemplate.sheet_id != sheet_id
        ).first()
        if conflict:
            raise HTTPException(status_code=400, detail=f"External barcode '{ext_bc_upd}' is already assigned to sheet '{conflict.sheet_id}'")
    template.external_barcode = ext_bc_upd

    # Block edit if active (non-terminal) batches exist — deleting items cascades to cell responses
    active_statuses = ["CREATED_PENDING_OPERATOR", "OPERATOR_IN_PROGRESS", "OPERATOR_APPROVED",
                       "OPERATOR_REJECTED", "SUPERVISOR_IN_PROGRESS", "ON_HOLD"]
    active_batch_count = db.query(InspectionBatch).filter(
        InspectionBatch.sheet_id == sheet_id,
        InspectionBatch.status.in_(active_statuses)
    ).count()
    if active_batch_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot edit template: {active_batch_count} active batch(es) are using this sheet. "
                   "Complete or delete them first."
        )

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
            unit=item.unit,
            assigned_role=item.assigned_role,
            is_supervisor_checkpoint=item.is_supervisor_checkpoint,
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
        db=db, user_id=current_user.user_id, role=current_user.role,
        action_type="SHEET_UPDATED", sheet_id=template.sheet_id,
        details={"control_items_count": len(template.control_items)}
    )
    notify_live("SHEET_UPDATED", {"sheet_id": template.sheet_id, "action": "UPDATE"})
    return template

@router.patch("/sheets/{sheet_id}/set-default", response_model=SheetTemplateResponse)
def set_default_sheet(sheet_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """Mark one sheet template as the active default. Clears is_default on all others."""
    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Sheet template not found")
    # Clear existing default
    db.query(SheetTemplate).filter(SheetTemplate.is_default == True).update({"is_default": False})
    template.is_default = True
    db.commit()
    db.refresh(template)
    notify_live("SHEET_UPDATED", {"sheet_id": template.sheet_id, "action": "SET_DEFAULT"})
    log_audit(db=db, user_id=current_user.user_id, role=current_user.role,
              action_type="SHEET_SET_DEFAULT", sheet_id=sheet_id, details={})
    return template

@router.delete("/sheets/{sheet_id}")
def delete_sheet(sheet_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """
    Delete a sheet template and ALL associated data:
    control items, batches, cell responses, decisions, attachments.
    """
    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Sheet template not found")
    if template.is_default:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete the active default template. Set another template as default first."
        )
    batch_count = db.query(InspectionBatch).filter(InspectionBatch.sheet_id == sheet_id).count()
    db.delete(template)
    db.commit()
    log_audit(db=db, user_id=current_user.user_id, role=current_user.role,
              action_type="SHEET_DELETED", sheet_id=sheet_id,
              details={"batches_deleted": batch_count})
    notify_live("SHEET_UPDATED", {"sheet_id": sheet_id, "action": "DELETED"})
    return {"success": True, "sheet_id": sheet_id, "batches_deleted": batch_count}


@router.delete("/batches/{batch_id}")
def delete_batch(batch_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """
    Permanently delete a single inspection batch and all its data
    (cell responses, decisions, attachments).
    """
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    lot = batch.lot_number
    sheet = batch.sheet_id
    # Delete uploaded attachment files from disk before cascade-deleting DB rows
    for att in batch.attachments:
        try:
            file_path = str(UPLOAD_DIR / att.file_path.lstrip("/").replace("uploads/", "", 1))
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception:
            pass
    db.delete(batch)
    db.commit()
    log_audit(db=db, user_id=current_user.user_id, role=current_user.role,
              action_type="BATCH_DELETED", sheet_id=sheet,
              details={"batch_id": batch_id, "lot_number": lot})
    notify_live("BATCH_UPDATED", {"batch_id": batch_id, "action": "DELETED"})
    return {"success": True, "batch_id": batch_id, "lot_number": lot}


# --- Batches & Progress Dashboard (FR-013, FR-049, FR-050) ---

@router.post("/batches", response_model=InspectionBatchResponse)
def create_batch(payload: BatchCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == payload.sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail=f"Sheet template '{payload.sheet_id}' not found")

    # Enforce barcode uniqueness — each lot number (barcode) can only be used once
    existing = db.query(InspectionBatch).filter(
        InspectionBatch.lot_number == payload.lot_number.strip()
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Barcode '{payload.lot_number}' is already registered as Batch #{existing.batch_id}. Each barcode can only be used once."
        )

    # If a scanned barcode was provided (from SCAN_NOT_FOUND flow), link it to the template
    # so future scans of the same barcode always resolve to this sheet.
    if payload.link_barcode and payload.link_barcode.strip():
        template.external_barcode = payload.link_barcode.strip()

    batch = InspectionBatch(
        sheet_id=payload.sheet_id,
        lot_number=payload.lot_number,
        product_name=payload.product_name,
        line_name=payload.line_name or "Line 1",
        lot_quantity=payload.lot_quantity,
        inspection_mode=payload.inspection_mode or "IFM",
        status="CREATED_PENDING_OPERATOR",
        round=1
    )
    db.add(batch)
    db.flush()  # get batch_id before commit

    # FR-054: Sign-off record for creation (approval ledger entry)
    signoff = InspectionDecision(
        batch_id=batch.batch_id,
        round=1,
        stage="Registered",
        decided_by=current_user.user_id,
        role="admin",
        decision="Registered",
        remarks=f"Batch {payload.lot_number} created for {payload.line_name or 'Line 1'}"
    )
    db.add(signoff)

    # FR-052: Notify operators that a new batch is ready
    send_notification(
        db=db,
        roles=["operator"],
        text=f"New batch {payload.lot_number} ({template.part_name or template.document_title}) is ready for inspection on {payload.line_name or 'Line 1'}.",
        batch_id=batch.batch_id,
        batch_code=batch.lot_number
    )

    db.commit()
    db.refresh(batch)

    notify_live("BATCH_CREATED", {"batch_id": batch.batch_id, "sheet_id": batch.sheet_id, "lot_number": batch.lot_number})

    log_audit(
        db=db,
        user_id=current_user.user_id,
        role=current_user.role,
        action_type="BATCH_CREATED",
        sheet_id=payload.sheet_id,
        batch_id=batch.batch_id,
        details={"lot_number": payload.lot_number, "mode": payload.inspection_mode}
    )

    return format_batch_response(batch)

@router.post("/batches/quick-register", response_model=InspectionBatchResponse)
def quick_register_batch(
    payload: QuickBatchRegisterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    FR-019: On-the-fly registration when Admin scans an unregistered code.
    Links the code to a template, product, line, and quantity immediately.
    If no sheet_id is provided, the active default template is used automatically.
    """
    sheet_id = payload.sheet_id
    if not sheet_id:
        default_tpl = db.query(SheetTemplate).filter(SheetTemplate.is_default == True).first()
        if not default_tpl:
            raise HTTPException(
                status_code=400,
                detail="No sheet_id provided and no active default template is set. Set a default template first."
            )
        sheet_id = default_tpl.sheet_id

    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail=f"Sheet template '{sheet_id}' not found")

    existing = db.query(InspectionBatch).filter(
        InspectionBatch.lot_number == payload.code.strip()
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Barcode '{payload.code}' is already registered as Batch #{existing.batch_id}. Each barcode can only be used once."
        )

    batch = InspectionBatch(
        sheet_id=sheet_id,
        lot_number=payload.code,
        product_name=payload.product_name,
        line_name=payload.line_name,
        lot_quantity=payload.lot_quantity,
        status="CREATED_PENDING_OPERATOR",
        round=1
    )
    db.add(batch)
    db.flush()

    # Sign-off record for registration (FR-054)
    signoff = InspectionDecision(
        batch_id=batch.batch_id,
        round=1,
        stage="Registered",
        decided_by=current_user.user_id,
        role="admin",
        decision="Registered",
        remarks=f"Registered batch {payload.code} for {payload.line_name}"
    )
    db.add(signoff)

    # In-app notification to Operators
    send_notification(
        db=db,
        roles=["operator"],
        text=f"New batch {payload.code} ({template.part_name or template.document_title}) is ready for inspection on {payload.line_name}.",
        batch_id=batch.batch_id,
        batch_code=batch.lot_number
    )

    log_audit(
        db=db,
        user_id=current_user.user_id,
        role=current_user.role,
        action_type="BATCH_QUICK_REGISTERED",
        sheet_id=sheet_id,
        batch_id=batch.batch_id,
        details={"code": payload.code, "line": payload.line_name, "product": payload.product_name}
    )

    db.commit()
    db.refresh(batch)
    notify_live("BATCH_CREATED", {"batch_id": batch.batch_id, "sheet_id": batch.sheet_id, "lot_number": batch.lot_number})
    return format_batch_response(batch)

@router.get("/progress")
def get_progress_dashboard(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """
    Returns real-time progress across all batches, including status counts,
    overdue holds, completion percentages, and bottleneck stages.
    """
    check_overdue_holds(db)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
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

    # Pre-aggregate to eliminate N+1 queries
    # Map sheet_id -> expected cell count
    sheet_items = db.query(TemplateControlItem).all()
    sheet_expected_cells: dict = {}
    for it in sheet_items:
        sheet_expected_cells[it.sheet_id] = sheet_expected_cells.get(it.sheet_id, 0) + 1

    # Map batch_id -> answered cell count
    answered_rows = (
        db.query(BatchCellResponse.batch_id, func.count(BatchCellResponse.response_id))
        .filter(BatchCellResponse.cell_value.isnot(None), BatchCellResponse.cell_value != "")
        .group_by(BatchCellResponse.batch_id)
        .all()
    )
    batch_answered: dict = {row[0]: row[1] for row in answered_rows}

    # Pre-fetch all referenced users in one query
    user_ids = set()
    for b in batches:
        if b.prepared_by:
            user_ids.add(b.prepared_by)
        if b.checked_by:
            user_ids.add(b.checked_by)
    users_map: dict = {}
    if user_ids:
        for u in db.query(User).filter(User.user_id.in_(user_ids)).all():
            users_map[u.user_id] = u

    overdue_count = 0
    batch_list = []
    for b in batches:
        counts[b.status] = counts.get(b.status, 0) + 1
        is_over = bool(b.status == "ON_HOLD" and b.hold_due_at and b.hold_due_at <= now)
        if is_over:
            overdue_count += 1

        # Completion % — no per-batch queries
        expected_cells = sheet_expected_cells.get(b.sheet_id, 1) or 1
        answered_cells = batch_answered.get(b.batch_id, 0)
        pct = min(100, int((answered_cells / expected_cells) * 100))
        if b.status in ["APPROVED", "REJECTED", "OPERATOR_APPROVED", "OPERATOR_REJECTED"]:
            pct = 100

        bottleneck = "None"
        if b.status == "CREATED_PENDING_OPERATOR":
            bottleneck = "Pending Operator Scan"
        elif b.status == "OPERATOR_IN_PROGRESS":
            bottleneck = "Operator Field Inspection"
        elif b.status in ["OPERATOR_APPROVED", "OPERATOR_REJECTED"]:
            bottleneck = "Awaiting Supervisor Review"
        elif b.status == "ON_HOLD":
            bottleneck = f"Supervisor Hold: {b.hold_reason or 'Validation required'}{' (OVERDUE)' if is_over else ''}"
        elif b.status == "APPROVED":
            bottleneck = "Completed (Pass)"
        elif b.status == "REJECTED":
            bottleneck = "Completed (Rejected)"

        prep_user = users_map.get(b.prepared_by) if b.prepared_by else None
        chk_user = users_map.get(b.checked_by) if b.checked_by else None

        batch_list.append({
            "batch_id": b.batch_id,
            "sheet_id": b.sheet_id,
            "part_no": b.template.part_no if b.template else None,
            "part_name": b.template.part_name if b.template else None,
            "product_name": b.product_name,
            "line_name": b.line_name,
            "lot_number": b.lot_number,
            "lot_quantity": b.lot_quantity,
            "inspection_mode": b.inspection_mode,
            "round": b.round,
            "status": b.status,
            "is_overdue": is_over,
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
            "with_operator": counts["CREATED_PENDING_OPERATOR"] + counts["OPERATOR_IN_PROGRESS"],
            "with_supervisor": counts["OPERATOR_APPROVED"] + counts["OPERATOR_REJECTED"] + counts["SUPERVISOR_IN_PROGRESS"],
            "on_hold": counts["ON_HOLD"],
            "overdue_holds": overdue_count,
            "approved": counts["APPROVED"],
            "rejected": counts["REJECTED"],
            "counts_by_status": counts
        },
        "batches": batch_list
    }

@router.get("/export-csv")
def export_all_records_csv(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """
    Exports comprehensive inspection ledger to CSV conforming to the POC spec:
    Batch, Sheet ID, Sheet, Product, Line, Qty, Status, Round, Inspected by,
    Inspection decision, Inspected at, Reviewed by, Review decision, Reviewed at,
    Hold reason, Hold placed by, Hold released by, Field values.
    """
    check_overdue_holds(db)
    batches = db.query(InspectionBatch).order_by(InspectionBatch.created_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)

    head = [
        "Batch", "Sheet ID", "Sheet", "Product", "Line", "Qty", "Status", "Round",
        "Inspected by", "Inspection decision", "Inspected at",
        "Reviewed by", "Review decision", "Reviewed at",
        "Hold reason", "Hold placed by", "Hold released by", "Field values"
    ]
    writer.writerow(head)

    for b in batches:
        decisions = b.decisions or []
        last_ins = next((d for d in reversed(decisions) if d.stage == "Inspection"), None)
        last_rev = next((d for d in reversed(decisions) if d.stage == "Review"), None)
        last_hp = next((d for d in reversed(decisions) if d.stage == "Hold placed"), None)
        last_hr = next((d for d in reversed(decisions) if d.stage == "Hold released"), None)

        def fmt_user(d):
            if not d:
                return ""
            return d.user.full_name if d.user else f"User #{d.decided_by}"

        cells = db.query(BatchCellResponse).filter(BatchCellResponse.batch_id == b.batch_id).all()
        cell_summary = "; ".join([f"{c.item.control_item_name if c.item else c.item_id}[{c.column_key}]={c.cell_value}" for c in cells])

        writer.writerow([
            b.lot_number,
            b.sheet_id,
            b.template.document_title if b.template else b.sheet_id,
            b.product_name or (b.template.part_name if b.template else ""),
            b.line_name or "Line 1",
            b.lot_quantity or "",
            b.status,
            b.round or 1,
            fmt_user(last_ins),
            last_ins.decision if last_ins else "",
            last_ins.decided_at.isoformat() if last_ins and last_ins.decided_at else "",
            fmt_user(last_rev),
            last_rev.decision if last_rev else "",
            last_rev.decided_at.isoformat() if last_rev and last_rev.decided_at else "",
            b.hold_reason or "",
            fmt_user(last_hp),
            fmt_user(last_hr),
            cell_summary
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="taa-inspection-records.csv"'}
    )

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
    limit: int = 200,
    offset: int = 0,
    action_type: Optional[str] = None,
    user_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    q = db.query(AuditLog)
    if action_type:
        q = q.filter(AuditLog.action_type.ilike(f"%{action_type}%"))
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if date_from:
        try:
            q = q.filter(AuditLog.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            q = q.filter(AuditLog.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    return q.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()
