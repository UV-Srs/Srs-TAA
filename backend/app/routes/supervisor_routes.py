from datetime import datetime, timedelta
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import (
    User, InspectionBatch, InspectionDecision, SheetTemplate, BatchCellResponse, TemplateControlItem
)
from backend.app.schemas import (
    SupervisorReviewRequest, SupervisorFieldReviewRequest,
    SupervisorDispositionRequest, SupervisorReadingRequest, SupervisorOosRequest,
    SupervisorSpotRequest, SupervisorCommentRequest, SupervisorCheckRequest, SupervisorItemRequest,
    SupervisorSpotReadingRequest,
)
from backend.app.auth import require_supervisor
from backend.app.audit import log_audit
from backend.app.notifications import send_notification
from backend.app.live_sync import notify_live
from backend.app import supervisor_locks
from backend.app.supervisor_workspace import (
    COMPLETED, PROTO_STATUS, REVIEWABLE, SPOT_CHECKS, build_workspace, get_review, is_dimension, is_visual,
    lot_items, reading_status, sample_columns, serialize_lot, serialize_template, short_name, spots_needed,
)
from backend.app.supervisor_report_pdf import generate_supervisor_report_pdf

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
        batch_code=batch.lot_number,
        kind="review",
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


# ---------------------------------------------------------------------------
# Supervisor UI (ported LotSure prototype screens)
# Lock rules live in backend/app/supervisor_locks.py.
# ---------------------------------------------------------------------------

DISPOSITIONS = {"Approved", "On hold", "Rejected"}
OOS_ACTIONS = {"Re-measured, confirmed", "Lot put on hold", "Process adjusted"}
HOLD_DUE_HOURS = 4  # same default as the existing supervisor review endpoint


def _lock_conflict(db: Session, review) -> HTTPException:
    holder_id = supervisor_locks.lock_holder(review)
    holder = db.query(User).filter(User.user_id == holder_id).first() if holder_id else None
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"message": "Lot is being reviewed by another supervisor.",
                "lockBy": {"id": holder_id, "name": holder.full_name if holder else None}},
    )


def _reviewing(db: Session, batch_id: int, user: User):
    """A reviewable lot whose lock this supervisor holds (every review write goes through here)."""
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Lot not found")
    if batch.status not in REVIEWABLE:
        raise HTTPException(status_code=422, detail={"message": "This lot is not open for review.", "status": batch.status})
    review = get_review(db, batch)
    if not supervisor_locks.is_held_by(review, user):
        if review and supervisor_locks.lock_holder(review):
            raise _lock_conflict(db, review)
        raise HTTPException(status_code=409, detail={"message": "Open the lot before reviewing it."})
    return batch, review


@router.get("/workspace")
def get_supervisor_workspace(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    """Users, templates and lots for the supervisor screens (replaces the prototype's seed() state)."""
    return build_workspace(db, current_user)


@router.get("/lots/{batch_id}/report.pdf")
def download_supervisor_report_pdf(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    """The supervisor lot report (prototype svDownload) as a PDF: the preview while the lot is
    under review, the saved report once it is completed."""
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch or not batch.template:
        raise HTTPException(status_code=404, detail="Lot not found")
    if batch.status not in REVIEWABLE | COMPLETED:
        raise HTTPException(status_code=422, detail={"message": "This lot has no supervisor report yet.", "status": batch.status})
    users = {u.user_id: u for u in db.query(User).all()}
    lot = serialize_lot(db, batch, users)
    tpl = serialize_template(batch.template)
    # Samples beyond the lot's item count don't exist in this lot (sample j is item j+1).
    n_items = len(lot["columns"])
    for p in tpl["params"] + tpl["supChecks"]:
        p["samples"] = p["samples"][:n_items] if n_items else p["samples"]
    pdf = generate_supervisor_report_pdf(lot, tpl, current_user.full_name,
                                         read_only=batch.status in COMPLETED)
    full = f"{batch.lot_number}-lot-report.pdf"
    ascii_name = re.sub(r"[^A-Za-z0-9._-]+", "_", full)
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(full, safe='')}",
    })


@router.post("/lots/{batch_id}/open")
def open_supervisor_lot(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    """
    Prototype ACT.svopen: a reviewable lot (supervisor / onhold) is locked to this
    supervisor and opens in review; a completed lot opens the read-only report.
    Locked by another supervisor -> 409 with their name.
    """
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Lot not found")

    if batch.status in COMPLETED:
        return {"view": "saved", "batch_id": batch.batch_id}
    if batch.status not in REVIEWABLE:
        raise HTTPException(status_code=422, detail={"message": "This lot is not ready for supervisor review.", "status": batch.status})

    review = get_review(db, batch, create=True)
    if not supervisor_locks.can_acquire(review, current_user):
        raise _lock_conflict(db, review)

    supervisor_locks.acquire(review, current_user)
    if batch.status in ("OPERATOR_APPROVED", "OPERATOR_REJECTED"):
        # Prototype supSeen=true: the lot moves from New to Pending.
        batch.status = "SUPERVISOR_IN_PROGRESS"
        log_audit(
            db=db, user_id=current_user.user_id, role=current_user.role,
            action_type="SUPERVISOR_OPENED_REVIEW", sheet_id=batch.sheet_id, batch_id=batch.batch_id,
            details={"round": batch.round},
        )
    db.commit()
    notify_live("BATCH_UPDATED", {"batch_id": batch.batch_id, "status": batch.status, "round": batch.round})
    return {"view": "review", "batch_id": batch.batch_id}


@router.put("/lots/{batch_id}/dispositions/{column_key}")
def set_supervisor_disposition(
    batch_id: int,
    column_key: str,
    payload: SupervisorDispositionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    """Decision for one bad item (Approved / On hold / Rejected): an item the operator marked bad,
    or one the operator marked good that the supervisor found bad (a check answered No)."""
    batch, review = _reviewing(db, batch_id, current_user)
    if payload.disposition is not None and payload.disposition not in DISPOSITIONS:
        raise HTTPException(status_code=422, detail="Decision must be Approved, On hold or Rejected.")
    li = lot_items(batch, review)
    if column_key not in li["columns"]:
        raise HTTPException(status_code=404, detail="Item not found in this lot")
    part = li["parts"][li["columns"].index(column_key)]
    found_bad = bool(part and part["r"] == "OK" and ((review.item_answers or {}).get(column_key) or {}).get("ng"))
    if not part or (part["r"] != "NG" and not found_bad):
        raise HTTPException(status_code=422, detail="Only bad items need a decision.")
    disp = dict(review.dispositions or {})
    if payload.disposition is None:
        disp.pop(column_key, None)
    else:
        disp[column_key] = payload.disposition
    review.dispositions = disp
    db.commit()
    notify_live("BATCH_UPDATED", {"batch_id": batch.batch_id, "status": batch.status, "round": batch.round})
    return {"status": "success", "dispositions": disp}


@router.put("/lots/{batch_id}/readings")
def set_supervisor_reading(
    batch_id: int,
    payload: SupervisorReadingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    """
    Prototype keypad (keyDigit / bksp): one dimension reading. Agreed rule: supervisors may
    write only dimension cells assigned to the supervisor role (operator cells stay locked).
    """
    batch, review = _reviewing(db, batch_id, current_user)
    item = db.query(TemplateControlItem).filter(
        TemplateControlItem.item_id == payload.item_id, TemplateControlItem.sheet_id == batch.sheet_id,
    ).first()
    if not item or not is_dimension(item):
        raise HTTPException(status_code=404, detail="Dimension not found in this lot")
    if item.assigned_role != "supervisor":
        raise HTTPException(status_code=403, detail="Forbidden: this reading is assigned to the operator.")
    if payload.sample not in sample_columns(item, len(lot_items(batch, review)["columns"])):
        raise HTTPException(status_code=422, detail="Unknown sample for this dimension")

    resp = db.query(BatchCellResponse).filter(
        BatchCellResponse.batch_id == batch.batch_id,
        BatchCellResponse.item_id == item.item_id,
        BatchCellResponse.column_key == payload.sample,
    ).first()
    if payload.value is None:
        if resp:
            db.delete(resp)
        cell_value, within = None, True
    else:
        cell_value = f"{payload.value:g}"
        within = reading_status(item, payload.value) != "bad"
        if resp is None:
            resp = BatchCellResponse(batch_id=batch.batch_id, item_id=item.item_id, column_key=payload.sample)
            db.add(resp)
        resp.cell_value = cell_value
        resp.is_within_spec = within
        resp.entered_by = current_user.user_id
    db.commit()
    notify_live("CELL_UPDATED", {
        "batch_id": batch.batch_id, "item_id": item.item_id, "column_key": payload.sample,
        "cell_value": cell_value, "is_within_spec": within, "updated_at": str(datetime.utcnow()),
    })
    return {"status": "success", "value": payload.value}


@router.put("/lots/{batch_id}/checks")
def set_supervisor_check(
    batch_id: int,
    payload: SupervisorCheckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    """A supervisor-assigned pass/fail check for one sample: Good (OK) / Bad (NG); None clears it."""
    batch, review = _reviewing(db, batch_id, current_user)
    item = db.query(TemplateControlItem).filter(
        TemplateControlItem.item_id == payload.item_id, TemplateControlItem.sheet_id == batch.sheet_id,
    ).first()
    if not item or not is_visual(item):
        raise HTTPException(status_code=404, detail="Check not found in this lot")
    if item.assigned_role != "supervisor":
        raise HTTPException(status_code=403, detail="Forbidden: this check is assigned to the operator.")
    if payload.sample not in sample_columns(item, len(lot_items(batch, review)["columns"])):
        raise HTTPException(status_code=422, detail="Unknown sample for this check")
    if payload.value not in (None, "OK", "NG"):
        raise HTTPException(status_code=422, detail="Result must be OK or NG.")

    resp = db.query(BatchCellResponse).filter(
        BatchCellResponse.batch_id == batch.batch_id,
        BatchCellResponse.item_id == item.item_id,
        BatchCellResponse.column_key == payload.sample,
    ).first()
    cell_value = None if payload.value is None else ("Pass" if payload.value == "OK" else "Fail")
    if cell_value is None:
        if resp:
            db.delete(resp)
    else:
        if resp is None:
            resp = BatchCellResponse(batch_id=batch.batch_id, item_id=item.item_id, column_key=payload.sample)
            db.add(resp)
        resp.cell_value = cell_value
        resp.is_within_spec = payload.value == "OK"
        resp.entered_by = current_user.user_id
    db.commit()
    notify_live("CELL_UPDATED", {
        "batch_id": batch.batch_id, "item_id": item.item_id, "column_key": payload.sample,
        "cell_value": cell_value, "is_within_spec": payload.value != "NG", "updated_at": str(datetime.utcnow()),
    })
    return {"status": "success", "value": payload.value}


@router.put("/lots/{batch_id}/oos")
def set_supervisor_oos_action(
    batch_id: int,
    payload: SupervisorOosRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    """Prototype ACT.oos: what was done about out-of-spec readings."""
    batch, review = _reviewing(db, batch_id, current_user)
    if payload.action is not None and payload.action not in OOS_ACTIONS:
        raise HTTPException(status_code=422, detail="Unknown out-of-spec action")
    review.oos_action = payload.action
    db.commit()
    notify_live("BATCH_UPDATED", {"batch_id": batch.batch_id, "status": batch.status, "round": batch.round})
    return {"status": "success", "oos": review.oos_action}


def _spot_ok(li, column_key: str, review) -> None:
    """A spot check is the supervisor confirming an item the operator marked good. Bad items are
    decided (approved / rejected) instead, and an item the supervisor rejected can't be a spot check."""
    part = li["parts"][li["columns"].index(column_key)]
    if not part or part["r"] != "OK":
        raise HTTPException(status_code=422, detail="Spot checks are for items the operator marked good.")
    if ((review.item_answers or {}).get(column_key) or {}).get("ng"):
        raise HTTPException(status_code=422, detail="An item you rejected can't be a spot check.")


@router.put("/lots/{batch_id}/spot/{column_key}")
def set_supervisor_spot_check(
    batch_id: int,
    column_key: str,
    payload: SupervisorSpotRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    """
    Mark / unmark a spot check: the supervisor's own check of an item the operator marked good.
    At most 3 per lot; r=None removes it (with its readings). The result is always OK, and every
    dimension must be measured on the item before the lot can be saved (sample or spot readings).
    """
    batch, review = _reviewing(db, batch_id, current_user)
    li = lot_items(batch, review)
    if column_key not in li["columns"]:
        raise HTTPException(status_code=404, detail="Item not found in this lot")
    spots = {c: dict(v) for c, v in (review.spot_checks or {}).items()}
    if payload.r is None:
        spots.pop(column_key, None)
    else:
        if payload.r != "OK":
            raise HTTPException(status_code=422, detail="A spot check confirms a good item. Rejected items can't be spot checks.")
        _spot_ok(li, column_key, review)
        if column_key not in spots and len([c for c in spots if c in li["columns"]]) >= SPOT_CHECKS:
            raise HTTPException(status_code=422, detail=f"Only {SPOT_CHECKS} spot checks per lot.")
        spots[column_key] = {"r": "OK", "ng": [], "dims": (spots.get(column_key) or {}).get("dims") or {}}
    review.spot_checks = spots
    db.commit()
    notify_live("BATCH_UPDATED", {"batch_id": batch.batch_id, "status": batch.status, "round": batch.round})
    return {"status": "success", "spot": spots}


@router.put("/lots/{batch_id}/spot/{column_key}/readings")
def set_supervisor_spot_reading(
    batch_id: int,
    column_key: str,
    payload: SupervisorSpotReadingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    """One dimension reading the supervisor measured on a spot-checked item; None clears it."""
    batch, review = _reviewing(db, batch_id, current_user)
    li = lot_items(batch, review)
    if column_key not in li["columns"]:
        raise HTTPException(status_code=404, detail="Item not found in this lot")
    spots = {c: dict(v) for c, v in (review.spot_checks or {}).items()}
    if column_key not in spots:
        raise HTTPException(status_code=422, detail="Mark the item as a spot check first.")
    pid = str(payload.item_id)
    if pid not in {str(i.item_id) for i in li["dims_items"]}:
        raise HTTPException(status_code=404, detail="Dimension not found in this lot")
    dims = dict(spots[column_key].get("dims") or {})
    if payload.value is None:
        dims.pop(pid, None)
    else:
        dims[pid] = payload.value
    spots[column_key]["dims"] = dims
    review.spot_checks = spots
    db.commit()
    notify_live("BATCH_UPDATED", {"batch_id": batch.batch_id, "status": batch.status, "round": batch.round})
    return {"status": "success", "dims": dims}


@router.put("/lots/{batch_id}/items/{column_key}")
def save_supervisor_item_answers(
    batch_id: int,
    column_key: str,
    payload: SupervisorItemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    """
    The supervisor's Yes/No answers for one checked item, saved on every tap (no Save button).
    On an item the operator marked good, any No means the supervisor found it bad: the item then
    needs a decision like a bad item, and can no longer be a spot check (an existing one is removed).
    On a bad item the answers are kept for the report; its decision is set separately
    (dispositions: Approved / On hold / Rejected).
    """
    batch, review = _reviewing(db, batch_id, current_user)
    li = lot_items(batch, review)
    if column_key not in li["columns"]:
        raise HTTPException(status_code=404, detail="Item not found in this lot")
    part = li["parts"][li["columns"].index(column_key)]
    if not part:
        raise HTTPException(status_code=422, detail="The operator has not checked this item.")
    check_ids = [str(i.item_id) for i in li["visual"]]
    ng = [x for x in check_ids if x in set(payload.ng)]
    operator_ng = sorted(n["id"] for n in part.get("ng", []))

    answers = dict(review.item_answers or {})
    if sorted(ng) == operator_ng:
        answers.pop(column_key, None)          # same as the operator: nothing to keep
    else:
        answers[column_key] = {"ng": ng}
    review.item_answers = answers
    if part["r"] == "OK" and not ng and column_key in (review.dispositions or {}):
        # Back to good: the item no longer needs (or has) a decision.
        disp = dict(review.dispositions or {})
        disp.pop(column_key, None)
        review.dispositions = disp
    removed_spot = False
    if part["r"] == "OK" and ng and column_key in (review.spot_checks or {}):
        spots = dict(review.spot_checks or {})
        spots.pop(column_key, None)
        review.spot_checks = spots
        removed_spot = True
    db.commit()
    notify_live("BATCH_UPDATED", {"batch_id": batch.batch_id, "status": batch.status, "round": batch.round})
    return {"status": "success", "ng": ng, "removedSpot": removed_spot}


@router.put("/lots/{batch_id}/comment")
def set_supervisor_comment(
    batch_id: int,
    payload: SupervisorCommentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    """Prototype #svcomment: the supervisor's comments printed on the report."""
    batch, review = _reviewing(db, batch_id, current_user)
    review.comment = (payload.comment or "")[:4000] or None
    db.commit()
    return {"status": "success"}


@router.post("/lots/{batch_id}/sign")
def sign_supervisor_lot(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    """
    Prototype ACT.sign (Save). Any item On hold keeps the lot on hold; otherwise it is completed
    and the revision increments. Records reviewer and time, clears the lock and the reopen
    note, notifies the admin (and the operator when completed).
    """
    batch, review = _reviewing(db, batch_id, current_user)
    li = lot_items(batch, review)
    parts, columns = li["parts"], li["columns"]

    # Same completeness rules the prototype enforces before Save is reachable.
    answers = {c: v for c, v in (review.item_answers or {}).items() if c in columns}
    dispositions = review.dispositions or {}
    # Bad items: marked bad by the operator, or marked good and found bad by the supervisor.
    # Both need a decision; found-bad items carry theirs in dispositions too.
    bad = [(columns[i], p) for i, p in enumerate(parts) if p and p["r"] == "NG"]
    bad += [(c, {**p, "disp": dispositions.get(c), "ng": [{"id": x} for x in answers[c]["ng"]]})
            for c, p in zip(columns, parts) if p and p["r"] == "OK" and (answers.get(c) or {}).get("ng")]
    undecided = [c for c, p in bad if p.get("disp") not in DISPOSITIONS]
    missing = sum(1 for it in li["dims_items"] if it.assigned_role == "supervisor"
                  for v in li["dims"][str(it.item_id)] if v is None)
    missing += sum(1 for vals in li["sup_checks"].values() for v in vals if v is None)
    out_of_spec = [(it, v) for it in li["dims_items"] for v in li["dims"][str(it.item_id)]
                   if reading_status(it, v) == "bad"]
    # Spot checks: good items only, never one the supervisor rejected (any check answered No).
    spots = {c: v for c, v in (review.spot_checks or {}).items()
             if c in columns and not (answers.get(c) or {}).get("ng")}
    # Every dimension must be measured on a spot-checked item: its sample reading (items 1..n)
    # or the supervisor's own spot reading.
    spot_vals = []
    for c, v in spots.items():
        k = columns.index(c)
        for it in li["dims_items"]:
            vals = li["dims"][str(it.item_id)]
            val = vals[k] if k < len(vals) and vals[k] is not None else ((v or {}).get("dims") or {}).get(str(it.item_id))
            spot_vals.append((c, it, val))
    spot_missing = sorted({columns.index(c) + 1 for c, _, val in spot_vals if val is None})
    out_of_spec += [(it, val) for _, it, val in spot_vals if reading_status(it, val) == "bad"]
    if undecided:
        raise HTTPException(status_code=422, detail=f"{len(undecided)} bad item(s) still need a decision.")
    if len(spots) < spots_needed(parts):
        raise HTTPException(status_code=422, detail=f"{spots_needed(parts) - len(spots)} spot check(s) still to do.")
    if missing:
        raise HTTPException(status_code=422, detail=f"{missing} reading(s) or check(s) still to do.")
    if spot_missing:
        raise HTTPException(status_code=422, detail="Spot-checked item(s) " + ", ".join(map(str, spot_missing))
                            + " need every dimension reading.")
    if out_of_spec and not review.oos_action:
        raise HTTPException(status_code=422, detail="Say what was done about the out-of-spec readings.")

    now = datetime.utcnow()
    held = [c for c, p in bad if p.get("disp") == "On hold"]
    # Rejected: bad items (operator's or found bad by the supervisor) the supervisor rejected.
    rejected = [c for c, p in bad if p.get("disp") == "Rejected"]
    # The checks behind each rejection: the supervisor's saved answers, else the operator's.
    rej_ids = {x for c in rejected for x in ((answers.get(c) or {}).get("ng")
                                             or [n["id"] for n in (parts[columns.index(c)] or {}).get("ng", [])])}
    names = {str(i.item_id): i.control_item_name for i in li["visual"]}
    rejected_checks = sorted({names.get(x, x) for x in rej_ids})
    me = short_name(current_user.full_name)

    batch.checked_by = current_user.user_id
    batch.supervisor_submitted_at = now
    batch.updated_at = now
    if held:
        batch.status = "ON_HOLD"
        batch.hold_reason = "Items on hold"
        batch.hold_note = f"{len(held)} item{'s' if len(held) > 1 else ''} held by {me} (supervisor review)."
        batch.hold_by = current_user.user_id
        batch.hold_at = now
        batch.hold_due_at = now + timedelta(hours=HOLD_DUE_HOURS)
        batch.hold_alerted = False
        stage, decision = "Hold placed", "On hold"
    else:
        batch.status = "APPROVED"
        batch.approved_by = current_user.user_id
        batch.hold_reason = None
        batch.hold_note = None
        batch.hold_due_at = None
        batch.hold_alerted = False
        stage, decision = "Review", "Approved"

    remarks = [x for x in [
        f"Out-of-spec action: {review.oos_action}" if review.oos_action else "",
        "Supervisor checks failed: " + ", ".join(
            f"{i.control_item_name} [{c}]" for i in li["sup_visual"]
            for c, v in zip([str(x) for x in (i.sample_columns or [])], li["sup_checks"][str(i.item_id)]) if v == "NG"
        ) if any(v == "NG" for vals in li["sup_checks"].values() for v in vals) else "",
        f"Rejected items: {', '.join(rejected)}" if rejected else "",
        f"Held items: {', '.join(held)}" if held else "",
        "Spot checks: " + ", ".join(f"{c} {v.get('r')}" for c, v in spots.items()) if spots else "",
        f"Comment: {review.comment}" if review.comment else "",
    ] if x]
    db.add(InspectionDecision(
        batch_id=batch.batch_id, round=batch.round or 1, stage=stage, decided_by=current_user.user_id,
        role=current_user.role, decision=decision, rejected_fields=rejected_checks,
        rejected_item_ids=sorted({int(x) for x in rej_ids if str(x).isdigit()}),
        remarks="; ".join(remarks) or None, decided_at=now,
    ))
    supervisor_locks.release(review)
    review.reopen_note = None

    code = batch.lot_number
    if held:
        n = len(held)
        send_notification(db, ["admin"], f"{code} kept on hold by {me}: {n} item{'s' if n > 1 else ''} held.",
                          batch_id=batch.batch_id, batch_code=code, kind="hold", severity="warn")
    else:
        # Prototype: `${code} completed by ${sup.by}.` printed "Neha S.."; skip the second period.
        send_notification(db, ["admin"], f"{code} completed by {me}{'' if me.endswith('.') else '.'}",
                          batch_id=batch.batch_id, batch_code=code, kind="review")
        send_notification(db, [] if batch.prepared_by else ["operator"], f"{code} checked and completed.",
                          batch_id=batch.batch_id, batch_code=code, kind="review",
                          user_ids=[batch.prepared_by] if batch.prepared_by else None)
    db.commit()
    log_audit(
        db=db, user_id=current_user.user_id, role=current_user.role, action_type="SUPERVISOR_SAVED_REVIEW",
        sheet_id=batch.sheet_id, batch_id=batch.batch_id,
        details={"status": batch.status, "held": held, "rejected": rejected, "oos_action": review.oos_action},
    )
    notify_live("BATCH_UPDATED", {"batch_id": batch.batch_id, "status": batch.status, "round": batch.round})
    return {"status": PROTO_STATUS[batch.status], "backendStatus": batch.status}
