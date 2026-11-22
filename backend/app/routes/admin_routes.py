import io
import csv
import re
from urllib.parse import quote
from datetime import datetime
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
    BatchCreate, QuickBatchRegisterRequest, InspectionBatchResponse, AuditLogResponse
)
from backend.app.auth import require_admin, hash_password
from backend.app.audit import log_audit, purge_user_audit_logs
from backend.app.config import UPLOAD_DIR
from backend.app.export_pdf import generate_pdf_report
from backend.app.export_excel import generate_excel_report
from backend.app.checksheet_report import generate_checksheet_csv
from backend.app.report_people import resolve_report_people
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
    notify_live("SHEET_UPDATED", {"sheet_id": template.sheet_id, "action": "UPDATE"})
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
        product_name=payload.product_name,
        line_name=payload.line_name or "Line 1",
        lot_quantity=payload.lot_quantity,
        inspection_mode=payload.inspection_mode or "IFM",
        status="CREATED_PENDING_OPERATOR",
        round=1
    )
    db.add(batch)
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
    """
    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == payload.sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail=f"Sheet template '{payload.sheet_id}' not found")

    batch = InspectionBatch(
        sheet_id=payload.sheet_id,
        lot_number=payload.code,
        product_name=payload.product_name,
        line_name=payload.line_name,
        lot_quantity=payload.lot_quantity,
        status="CREATED_PENDING_OPERATOR",
        round=1
    )
    db.add(batch)
    db.flush()

    notify_live("BATCH_CREATED", {"batch_id": batch.batch_id, "sheet_id": batch.sheet_id, "lot_number": batch.lot_number})

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
        sheet_id=payload.sheet_id,
        batch_id=batch.batch_id,
        details={"code": payload.code, "line": payload.line_name, "product": payload.product_name}
    )

    db.commit()
    db.refresh(batch)
    return format_batch_response(batch)

@router.get("/progress")
def get_progress_dashboard(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """
    Returns real-time progress across all batches, including status counts,
    overdue holds, completion percentages, and bottleneck stages.
    """
    check_overdue_holds(db)
    now = datetime.utcnow()
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

    overdue_count = 0
    batch_list = []
    for b in batches:
        counts[b.status] = counts.get(b.status, 0) + 1
        is_over = bool(b.status == "ON_HOLD" and b.hold_due_at and b.hold_due_at <= now)
        if is_over:
            overdue_count += 1
        
        # Calculate completion %
        total_items = db.query(TemplateControlItem).filter(TemplateControlItem.sheet_id == b.sheet_id).count()
        answered_cells = db.query(BatchCellResponse).filter(
            BatchCellResponse.batch_id == b.batch_id,
            BatchCellResponse.cell_value.isnot(None),
            BatchCellResponse.cell_value != ""
        ).count()
        
        template_items = db.query(TemplateControlItem).filter(TemplateControlItem.sheet_id == b.sheet_id).all()
        expected_cells = sum(len(it.sample_columns) if isinstance(it.sample_columns, list) else 1 for it in template_items) or 1
        
        pct = min(100, int((answered_cells / expected_cells) * 100)) if expected_cells > 0 else 0
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

        prep_user = db.query(User).filter(User.user_id == b.prepared_by).first() if b.prepared_by else None
        chk_user = db.query(User).filter(User.user_id == b.checked_by).first() if b.checked_by else None

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
        "Operator", "Supervisor",
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
        people = resolve_report_people(b, decisions)

        writer.writerow([
            b.lot_number,
            b.sheet_id,
            b.template.document_title if b.template else b.sheet_id,
            b.product_name or (b.template.part_name if b.template else ""),
            b.line_name or "Line 1",
            b.lot_quantity or "",
            b.status,
            b.round or 1,
            people["operator"],
            people["supervisor"],
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
    format: str = Query("pdf", pattern="^(pdf|xlsx|csv)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    FR-014 / FR-051: Downloads the exact IFM checksheet in PDF, Excel (.xlsx) or CSV.
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

    def disposition(ext: str) -> str:
        # ASCII-safe filename (lot numbers may contain spaces, slashes or non-Latin characters)
        # plus an RFC 5987 UTF-8 version for browsers that support it.
        full = f"{filename_base}.{ext}"
        ascii_name = re.sub(r"[^A-Za-z0-9._-]+", "_", full)
        return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(full, safe='')}"

    if format == "csv":
        csv_bytes = generate_checksheet_csv(
            batch=batch,
            template=template,
            cell_responses=cell_responses,
            decisions=decisions,
            attachments=attachments
        )
        return Response(
            content=csv_bytes,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": disposition("csv")}
        )

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
            headers={"Content-Disposition": disposition("pdf")}
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
            headers={"Content-Disposition": disposition("xlsx")}
        )

# --- Activity / Audit Logs (FR-015) ---

@router.get("/audit-logs", response_model=List[AuditLogResponse])
def get_audit_logs(
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    return db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).all()
