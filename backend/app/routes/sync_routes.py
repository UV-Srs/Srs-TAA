from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import (
    User, InspectionBatch, BatchCellResponse, TemplateControlItem, InspectionDecision
)
from backend.app.schemas import OfflineSyncPayload
from backend.app.auth import require_operator
from backend.app.audit import log_audit

router = APIRouter(prefix="/api/sync", tags=["Offline Wi-Fi Sync"])

@router.post("/offline-queue")
def sync_offline_queue(
    payload: OfflineSyncPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_operator)
):
    """
    FR-041A: Batch-processes queued IndexedDB cell edits, photos, and decisions
    after factory Wi-Fi reconnects, using idempotency keys.
    """
    processed_count = 0
    duplicate_count = 0

    for m in payload.mutations:
        # Check idempotency key
        if m.client_mutation_id:
            exists = db.query(BatchCellResponse).filter(
                BatchCellResponse.client_mutation_id == m.client_mutation_id
            ).first()
            if exists:
                duplicate_count += 1
                continue

        # Look up item specification for numeric validation
        item = db.query(TemplateControlItem).filter(TemplateControlItem.item_id == m.item_id).first()
        if not item or (item.editable_by_operator is False or item.assigned_role == "supervisor"):
            continue
        is_spec = True
        if item and item.row_mode == "NUMERIC_SAMPLE" and m.cell_value:
            try:
                num = float(m.cell_value)
                if item.min_val is not None and num < item.min_val:
                    is_spec = False
                if item.max_val is not None and num > item.max_val:
                    is_spec = False
            except ValueError:
                is_spec = False
        elif m.cell_value and str(m.cell_value).strip().lower() in ("fail", "false"):
            # Pass/fail and tick-box results: a "Fail" is out of spec (matches PATCH /cell)
            is_spec = False

        # Auto-progress to IN_PROGRESS on the first synced result (matches PATCH /cell)
        target_batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == m.batch_id).first()
        if target_batch and target_batch.status in ["CREATED_PENDING_OPERATOR", "pending"]:
            target_batch.status = "OPERATOR_IN_PROGRESS"

        # Upsert cell response
        resp = db.query(BatchCellResponse).filter(
            BatchCellResponse.batch_id == m.batch_id,
            BatchCellResponse.item_id == m.item_id,
            BatchCellResponse.column_key == str(m.column_key)
        ).first()

        if resp:
            resp.cell_value = m.cell_value
            resp.is_within_spec = is_spec
            if m.checker_initials:
                resp.checker_initials = m.checker_initials
            resp.client_mutation_id = m.client_mutation_id
            resp.entered_by = current_user.user_id
            resp.updated_at = datetime.utcnow()
        else:
            resp = BatchCellResponse(
                batch_id=m.batch_id,
                item_id=m.item_id,
                column_key=str(m.column_key),
                cell_value=m.cell_value,
                is_within_spec=is_spec,
                checker_initials=m.checker_initials,
                client_mutation_id=m.client_mutation_id,
                entered_by=current_user.user_id
            )
            db.add(resp)

        processed_count += 1

    # Process any queued decisions if present
    decisions_processed = 0
    if payload.decisions:
        for d in payload.decisions:
            batch_id = d.get("batch_id")
            dec_type = d.get("decision", "").upper()
            batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
            if batch and not batch.operator_submitted_at:
                now = datetime.utcnow()
                batch.operator_submitted_at = now
                batch.prepared_by = current_user.user_id
                batch.status = "OPERATOR_APPROVED" if dec_type == "APPROVE" else "OPERATOR_REJECTED"
                
                rec = InspectionDecision(
                    batch_id=batch_id,
                    decided_by=current_user.user_id,
                    role="operator",
                    decision=dec_type,
                    rejected_item_ids=d.get("rejected_item_ids", []),
                    remarks=d.get("remarks"),
                    decided_at=now
                )
                db.add(rec)
                decisions_processed += 1

    db.commit()

    return {
        "success": True,
        "processed_mutations": processed_count,
        "duplicate_mutations": duplicate_count,
        "decisions_processed": decisions_processed,
        "synced_at": datetime.utcnow().isoformat()
    }
