from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import (
    User, InspectionBatch, BatchCellResponse, TemplateControlItem, InspectionDecision
)
from backend.app.schemas import OfflineSyncPayload
from backend.app.auth import require_any_authenticated
from backend.app.audit import log_audit

router = APIRouter(prefix="/api/sync", tags=["Offline Wi-Fi Sync"])

@router.post("/offline-queue")
def sync_offline_queue(
    payload: OfflineSyncPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_authenticated)
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

        # Skip mutations for finalized or inappropriate-status batches
        sync_batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == m.batch_id).first()
        if not sync_batch or sync_batch.status in ["APPROVED", "REJECTED"]:
            continue
        # Operators cannot sync cells once the batch is in supervisor's hands
        if current_user.role == "operator" and sync_batch.status in ["OPERATOR_APPROVED", "SUPERVISOR_IN_PROGRESS", "ON_HOLD"]:
            continue

        # Look up item specification for numeric validation
        item = db.query(TemplateControlItem).filter(TemplateControlItem.item_id == m.item_id).first()
        if not item:
            continue
        # Strict role-based item ownership (matches live PATCH enforcement)
        if current_user.role == "operator" and item.assigned_role == "supervisor":
            continue
        if current_user.role == "supervisor" and item.assigned_role != "supervisor":
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
            resp.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
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
            # Only operators may submit offline decisions
            if current_user.role != "operator":
                continue
            batch_id = d.get("batch_id")
            dec_type = d.get("decision", "").upper()
            batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
            if batch and not batch.operator_submitted_at:
                # Ownership check: only the operator who claimed the batch may submit it offline
                if batch.prepared_by is not None and batch.prepared_by != current_user.user_id:
                    continue
                now = datetime.now(timezone.utc).replace(tzinfo=None)
                batch.operator_submitted_at = now
                batch.prepared_by = current_user.user_id
                # Both approve and reject route to supervisor — matches live submission behaviour
                batch.status = "OPERATOR_APPROVED"
                batch.operator_decision = "Approved" if dec_type == "APPROVE" else "Rejected"

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
        "synced_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    }
