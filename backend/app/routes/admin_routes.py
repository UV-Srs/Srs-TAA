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
    UserCreate, UserResponse, SheetTemplateCreate, SheetTemplateResponse, SHEET_ID_PATTERN,
    BatchCreate, QuickBatchRegisterRequest, InspectionBatchResponse, AuditLogResponse
)
from backend.app.auth import require_admin, hash_password
from backend.app.audit import log_audit, purge_user_audit_logs
from backend.app.config import UPLOAD_DIR
from backend.app.export_pdf import generate_pdf_report
from backend.app.supervisor_report_pdf import generate_supervisor_report_pdf
from backend.app.supervisor_workspace import COMPLETED, get_review, lot_bad_summary, serialize_lot, serialize_template
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

# Every column of a template row that the client controls. One list, used by both create and
# update, so a field can't be saved on one path and silently dropped on the other.
_ITEM_FIELDS = (
    "stage_name", "control_item_name", "specification_content", "application_method",
    "normal_frequency", "ifm_frequency", "row_mode", "html_input_type", "sample_columns",
    "min_val", "max_val", "unit", "assigned_role", "is_supervisor_checkpoint",
    "visible_to_operator", "editable_by_operator", "visible_to_supervisor", "is_required",
)


def _apply_item(target: TemplateControlItem, item, position: int) -> None:
    for field in _ITEM_FIELDS:
        setattr(target, field, getattr(item, field))
    target.serial_no = item.serial_no or position
    target.display_order = item.display_order or position


def _conflict(message: str, errors: List[dict]) -> HTTPException:
    """409 with machine-readable errors the frontend can show beside the right row and field."""
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"message": message, "errors": errors})


@router.post("/sheets", response_model=SheetTemplateResponse)
def create_sheet(payload: SheetTemplateCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    if not SHEET_ID_PATTERN.match(payload.sheet_id):
        raise HTTPException(status_code=422, detail=[{
            "loc": ["body", "sheet_id"], "type": "value_error",
            "msg": "Value error, use letters, numbers, dots, dashes or underscores only",
        }])

    existing = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == payload.sheet_id).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Sheet ID '{payload.sheet_id}' already exists")

    if payload.part_no and db.query(SheetTemplate).filter(
        func.lower(func.trim(SheetTemplate.part_no)) == payload.part_no.strip().lower()
    ).first():
        raise HTTPException(status_code=400, detail=f"Part number '{payload.part_no}' is already linked to a sheet")

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
        c_item = TemplateControlItem(sheet_id=payload.sheet_id)
        _apply_item(c_item, item, idx)
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
    """
    Updates a template IN PLACE.

    Rows are matched by `item_id`: a row that carries the id of an existing row updates that row
    (its id, and therefore every inspection value recorded against it, is untouched); a row
    without an id is inserted. An existing row that is missing from the payload is deleted, but
    only if nothing has been recorded against it. Rows that have inspection data are never
    deleted, and their type / role / recorded sample columns can't be changed, because that would
    orphan or reinterpret historical results.
    """
    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Sheet template not found")

    if payload.sheet_id != sheet_id:
        raise HTTPException(status_code=422, detail=[{
            "loc": ["body", "sheet_id"], "type": "value_error",
            "msg": "Value error, the Sheet ID in the body does not match the URL",
        }])

    if payload.part_no and db.query(SheetTemplate).filter(
        SheetTemplate.sheet_id != sheet_id,
        func.lower(func.trim(SheetTemplate.part_no)) == payload.part_no.strip().lower()
    ).first():
        raise HTTPException(status_code=400, detail=f"Part number '{payload.part_no}' is already linked to another sheet")

    existing = {i.item_id: i for i in template.control_items}

    # 1. Every id the client sent must be a row of THIS template.
    unknown = [
        {"item_id": i.item_id, "field": "control_item_name", "message": "This row does not belong to the template."}
        for i in payload.control_items if i.item_id is not None and i.item_id not in existing
    ]
    if unknown:
        raise _conflict("Some rows no longer exist on this template. Reload the template and try again.", unknown)

    kept_ids = {i.item_id for i in payload.control_items if i.item_id is not None}
    removed = [row for item_id, row in existing.items() if item_id not in kept_ids]

    # 2. What has been recorded against the existing rows.
    recorded_columns: dict = {}
    with_attachments: set = set()
    if existing:
        for item_id, column_key in db.query(BatchCellResponse.item_id, BatchCellResponse.column_key).filter(
            BatchCellResponse.item_id.in_(list(existing))
        ):
            recorded_columns.setdefault(item_id, set()).add(str(column_key))
        with_attachments = {
            item_id for (item_id,) in db.query(InspectionAttachment.item_id).filter(
                InspectionAttachment.item_id.in_(list(existing))
            ).distinct()
        }

    # 3. Refuse anything that would lose or reinterpret recorded data. Nothing is written yet.
    blocked: List[dict] = []
    blocked_names: List[str] = []
    for row in removed:
        if row.item_id in recorded_columns or row.item_id in with_attachments:
            blocked_names.append(row.control_item_name)
    for item in payload.control_items:
        if item.item_id is None:
            continue
        row = existing[item.item_id]
        cols = recorded_columns.get(item.item_id)
        if not cols:
            continue
        if item.row_mode != row.row_mode or item.html_input_type != row.html_input_type:
            blocked.append({
                "item_id": item.item_id, "field": "html_input_type",
                "message": "The input type can't be changed because inspection values are already recorded for this row.",
            })
        if item.assigned_role != row.assigned_role:
            blocked.append({
                "item_id": item.item_id, "field": "assigned_role",
                "message": "The assigned role can't be changed because inspection values are already recorded for this row.",
            })
        # These two decide which checks count as the operator's, so changing them after values are
        # recorded would quietly change an old lot's Good/Bad counts. (A missing value means "yes".)
        if (item.visible_to_operator is not False) != (row.visible_to_operator is not False) \
                or (item.editable_by_operator is not False) != (row.editable_by_operator is not False):
            blocked.append({
                "item_id": item.item_id, "field": "assigned_role",
                "message": "Whether the operator can see or edit this row can't be changed because inspection values are already recorded for it.",
            })
        lost = sorted(cols - set(item.sample_columns))
        if lost:
            blocked.append({
                "item_id": item.item_id, "field": "sample_columns",
                "message": f"Samples {', '.join(lost)} already hold inspection values and can't be removed.",
            })
    if blocked_names:
        names = ", ".join(f"'{n}'" for n in blocked_names)
        raise _conflict(
            f"{names} {'has' if len(blocked_names) == 1 else 'have'} inspection data recorded and can't be deleted. "
            "Discard your changes to bring the row back.",
            blocked,
        )
    if blocked:
        raise _conflict("Some changes would affect inspection values that are already recorded.", blocked)

    # 4. Apply. Template details first.
    template.document_title = payload.document_title
    template.part_no = payload.part_no
    template.part_name = payload.part_name
    template.model_name = payload.model_name
    template.vendor_name = payload.vendor_name
    template.customer_name = payload.customer_name
    template.part_category = payload.part_category

    for row in removed:
        db.delete(row)  # safe: nothing is recorded against these rows (checked above)
    updated = created = 0
    for position, item in enumerate(payload.control_items, start=1):
        if item.item_id is not None:
            _apply_item(existing[item.item_id], item, position)
            updated += 1
        else:
            new_row = TemplateControlItem(sheet_id=sheet_id)
            _apply_item(new_row, item, position)
            db.add(new_row)
            created += 1

    db.commit()
    db.refresh(template)
    notify_live("SHEET_UPDATED", {"sheet_id": template.sheet_id, "action": "UPDATE"})
    log_audit(
        db=db, user_id=current_user.user_id, role=current_user.role,
        action_type="SHEET_TEMPLATE_UPDATED", sheet_id=template.sheet_id,
        details={"updated": updated, "created": created, "removed": len(removed)},
    )
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

        # Bad-item counts, worked out fresh from the stored cells on every request (nothing is cached).
        # A lot nobody has started yet has nothing to count.
        if b.status == "CREATED_PENDING_OPERATOR":
            bad = {"items_checked": 0, "operator_ng": 0, "ng_count": 0}
        else:
            bad = lot_bad_summary(b, get_review(db, b))

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
            "items_checked": bad["items_checked"],
            "operator_ng_count": bad["operator_ng"],
            "ng_count": bad["ng_count"],
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
        headers={"Content-Disposition": 'attachment; filename="ai-smart-scan-records.csv"'}
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

    if format == "pdf" and batch.status in COMPLETED:
        # Completed lot: the admin's lot report (LotSure admin lot view), with the supervisor's
        # review of the operator's work, spot checks, samples and the item grid.
        users = {u.user_id: u for u in db.query(User).all()}
        pdf_bytes = generate_supervisor_report_pdf(
            serialize_lot(db, batch, users), serialize_template(template), current_user.full_name,
            read_only=True, layout="admin",
        )
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": disposition("pdf")}
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
