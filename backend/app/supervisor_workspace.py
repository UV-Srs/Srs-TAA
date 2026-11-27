"""
Builds the supervisor UI's data from live tables, in the shape the ported
LotSure prototype screens read (its in-memory `S` object):

    users     <- users
    templates <- sheet_templates + template_control_items   (SHEET, ITEMS, GROUPS, PARAMS)
    lots      <- inspection_batches + batch_cell_responses + inspection_decisions
                 + audit_logs + supervisor_lot_reviews

Agreed mapping (see design/SUPERVISOR_UI_BRIEF.md):
- An "item" (prototype parts[i]) is one sample column of the template's visual
  checks (tickbox / pass-fail rows). A bad item is a column where any check failed.
- Dimension readings (prototype dims) are the NUMERIC_SAMPLE cells, one list per item.
- Lot name <- product_name; operator clearance <- operator_decision.
- Per-item decisions, lock, out-of-spec action and reopen note <- supervisor_lot_reviews.
Names are returned as stored; the frontend formats them the way the prototype does.
"""
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from backend.app.checksheet_report import TICK_NG_VALUES, TICK_OK_VALUES
from backend.app.models import (
    AuditLog, BatchCellResponse, InspectionBatch, InspectionDecision,
    SheetTemplate, SupervisorLotReview, TemplateControlItem, User,
)
from backend.app.supervisor_locks import lock_holder

# Backend status -> prototype status
PROTO_STATUS = {
    "CREATED_PENDING_OPERATOR": "registered",
    "OPERATOR_IN_PROGRESS": "operator",
    "OPERATOR_APPROVED": "supervisor",
    "OPERATOR_REJECTED": "supervisor",
    "SUPERVISOR_IN_PROGRESS": "supervisor",
    "ON_HOLD": "onhold",
    "APPROVED": "completed",
    "REJECTED": "completed",
}
REVIEWABLE = {"OPERATOR_APPROVED", "OPERATOR_REJECTED", "SUPERVISOR_IN_PROGRESS", "ON_HOLD"}
COMPLETED = {"APPROVED", "REJECTED"}
# Prototype: the supervisor spot checks 3 items the operator marked good.
SPOT_CHECKS = 3


def spots_needed(parts: List[Optional[Dict[str, Any]]]) -> int:
    """3 spot checks, or fewer when the lot has fewer good items to pick from."""
    return min(SPOT_CHECKS, sum(1 for p in parts if p and p["r"] == "OK"))


def lot_spots(columns: List[str], review: Optional["SupervisorLotReview"]) -> Dict[str, Dict[str, Any]]:
    """Spot checks keyed by item index (prototype L.spot), dropping keys no longer in the lot."""
    raw = (review.spot_checks or {}) if review else {}
    return {str(columns.index(c)): v for c, v in raw.items() if c in columns}


def lot_answers(columns: List[str], review: Optional["SupervisorLotReview"]) -> Dict[str, Dict[str, Any]]:
    """The supervisor's Yes/No answers that differ from the operator's, keyed by item index:
    {index: {"ng": [check ids answered No], "d": decision or None}}. d matters for items the
    operator marked good and the supervisor found bad (they need a decision too)."""
    raw = (review.item_answers or {}) if review else {}
    disp = (review.dispositions or {}) if review else {}
    return {str(columns.index(c)): {"ng": list((v or {}).get("ng") or []), "d": disp.get(c)}
            for c, v in raw.items() if c in columns}


def iso(dt: Optional[datetime]) -> Optional[str]:
    """Stored times are naive UTC (datetime.utcnow); mark them as UTC for the browser."""
    return dt.isoformat() + "Z" if dt else None


def is_visual(item: TemplateControlItem) -> bool:
    return item.row_mode == "SERIAL_TICKBOX" or item.html_input_type in ("checkbox", "pf")


def is_dimension(item: TemplateControlItem) -> bool:
    return item.row_mode == "NUMERIC_SAMPLE" or item.html_input_type == "number"


def is_operator_item(item: TemplateControlItem) -> bool:
    """Same rule as the operator inspection screen (isOperatorItem in OperatorInspection.tsx)."""
    return ((item.assigned_role or "operator") not in ("supervisor", "admin")
            and item.editable_by_operator is not False and item.visible_to_operator is not False)


def is_supervisor_item(item: TemplateControlItem) -> bool:
    return item.assigned_role == "supervisor"


def _columns(item: TemplateControlItem) -> List[str]:
    return [str(c) for c in (item.sample_columns or [])]


def _cell_result(resp: Optional[BatchCellResponse]) -> Optional[str]:
    """'OK' | 'NG' | None (not checked), using the same value sets as the report export."""
    if resp is None or resp.cell_value in (None, ""):
        return None
    low = str(resp.cell_value).strip().lower()
    if low in TICK_NG_VALUES or resp.is_within_spec is False:
        return "NG"
    if low in TICK_OK_VALUES:
        return "OK"
    return None


def short_name(full_name: Optional[str]) -> str:
    """Prototype shortName, after dropping our DB's role tag: "Meena Rao (Supervisor)" -> "Meena R."."""
    parts = re.sub(r"\s*\([^)]*\)\s*$", "", full_name or "").split()
    if not parts:
        return ""
    return f"{parts[0]} {parts[-1][0]}." if len(parts) > 1 else parts[0]


def reading_status_values(lo: Optional[float], hi: Optional[float], v: Optional[float]) -> str:
    """Prototype st(p, v): '' | 'bad' | 'warn' (within 10% of the range from a limit) | 'good'."""
    if v is None:
        return ""
    if lo is None or hi is None:
        return "good"
    b, e = (hi - lo) * 0.1, 1e-9
    if v < lo - e or v > hi + e:
        return "bad"
    if v < lo + b - e or v > hi - b + e:
        return "warn"
    return "good"


def reading_status(item: TemplateControlItem, v: Optional[float]) -> str:
    return reading_status_values(item.min_val, item.max_val, v)


def _to_float(value: Optional[str]) -> Optional[float]:
    try:
        return float(str(value).strip()) if value not in (None, "") else None
    except ValueError:
        return None


def get_review(db: Session, batch: InspectionBatch, create: bool = False) -> Optional[SupervisorLotReview]:
    review = db.query(SupervisorLotReview).filter(
        SupervisorLotReview.batch_id == batch.batch_id,
        SupervisorLotReview.round == (batch.round or 1),
    ).first()
    if review is None and create:
        review = SupervisorLotReview(batch_id=batch.batch_id, round=batch.round or 1, dispositions={})
        db.add(review)
        db.flush()
    return review


def serialize_template(t: SheetTemplate) -> Dict[str, Any]:
    items = sorted(t.control_items, key=lambda i: (i.display_order or 0, i.serial_no or 0))
    visual = [i for i in items if is_visual(i) and is_operator_item(i)]
    sup_checks = [i for i in items if is_visual(i) and is_supervisor_item(i)]
    groups: List[str] = []
    for i in visual:
        if i.stage_name not in groups:
            groups.append(i.stage_name)
    return {
        "sheet": {
            "part": t.part_no, "partName": t.part_name,
            "model": t.model_name, "vendor": t.vendor_name, "title": t.document_title,
        },
        "items": [{
            "id": str(i.item_id), "g": i.stage_name, "t": i.control_item_name,
            "desc": i.specification_content, "method": i.application_method or "",
        } for i in visual],
        "groups": groups,
        "params": [{
            "id": str(i.item_id), "grp": i.stage_name, "t": i.control_item_name,
            "min": i.min_val, "max": i.max_val, "spec": i.specification_content,
            "unit": i.unit, "samples": _columns(i), "method": i.application_method or "",
            # Agreed rule: supervisors enter readings only for dimensions assigned to them.
            "editable": i.assigned_role == "supervisor",
        } for i in items if is_dimension(i) and (is_operator_item(i) or is_supervisor_item(i))],
        # Supervisor-assigned pass/fail checks: the supervisor records Good / Bad per sample column.
        "supChecks": [{
            "id": str(i.item_id), "g": i.stage_name, "t": i.control_item_name,
            "desc": i.specification_content, "method": i.application_method or "", "samples": _columns(i),
        } for i in sup_checks],
    }


def _person(user: Optional[User]) -> Optional[Dict[str, Any]]:
    return {"id": user.user_id, "name": user.full_name} if user else None


def sample_columns(item: TemplateControlItem, n_items: int) -> List[str]:
    """The item's sample columns that exist in this lot: sample j is measured on item j+1, so a
    lot of 10 items has at most 10 samples even when the template lists more (S1..S11)."""
    cols = _columns(item)
    return cols[:n_items] if n_items else cols


def piece_count(visual: List[TemplateControlItem], qty: Optional[int]) -> int:
    """Items in the lot: lot_quantity, else the highest numbered column of the operator's checks."""
    if qty:
        return qty
    nums = [int(c) for i in visual for c in _columns(i) if c.isdigit()]
    return max(nums, default=0)


def lot_items(b: InspectionBatch, review: Optional[SupervisorLotReview]) -> Dict[str, Any]:
    """The lot's items (prototype parts) and readings (prototype dims), shared by the
    workspace and the save endpoint so both apply the same rules."""
    t = b.template
    items = sorted(t.control_items, key=lambda i: (i.display_order or 0, i.serial_no or 0)) if t else []
    # Only operator-assigned checks are the operator's results; supervisor checks are filled in review.
    visual = [i for i in items if is_visual(i) and is_operator_item(i)]
    sup_visual = [i for i in items if is_visual(i) and is_supervisor_item(i)]
    dims_items = [i for i in items if is_dimension(i) and (is_operator_item(i) or is_supervisor_item(i))]
    cells = {(c.item_id, str(c.column_key)): c for c in b.cell_responses}
    dispositions = (review.dispositions or {}) if review else {}

    # Items = every piece of the lot, 1..lot_quantity. The operator screen saves one cell per piece
    # and check with column_key = piece number ("1".."N"), whatever the template's sample_columns
    # say (those are often just "1".."5"), so piece k is read from column "k" of every check.
    columns = [str(k) for k in range(1, piece_count(visual, b.lot_quantity) + 1)]

    parts: List[Optional[Dict[str, Any]]] = []
    for col in columns:
        found = [(i, cells.get((i.item_id, col))) for i in visual]
        results = [(i, c, _cell_result(c)) for i, c in found]
        if all(r is None for _, _, r in results):
            parts.append(None)
            continue
        # The operator's result for each check, and who checked the item and when (latest cell).
        res = {str(i.item_id): r for i, _, r in results if r is not None}
        last = max((c for _, c, r in results if r is not None), key=lambda c: c.updated_at or datetime.min)
        part: Dict[str, Any] = {"res": res, "by": last.entered_by, "at": iso(last.updated_at)}
        failed = [{"id": k} for k, r in res.items() if r == "NG"]
        if failed:
            part.update({"r": "NG", "ng": failed, "disp": dispositions.get(col)})
        else:
            part["r"] = "OK"
        parts.append(part)

    dims = {
        str(i.item_id): [_to_float(cells[(i.item_id, c)].cell_value) if (i.item_id, c) in cells else None
                         for c in sample_columns(i, len(columns))]
        for i in dims_items
    }
    # Supervisor checks: 'OK' | 'NG' | None per sample column.
    sup_checks = {str(i.item_id): [_cell_result(cells.get((i.item_id, c))) for c in sample_columns(i, len(columns))]
                  for i in sup_visual}
    return {"columns": columns, "parts": parts, "dims": dims, "visual": visual, "dims_items": dims_items,
            "sup_visual": sup_visual, "sup_checks": sup_checks}


def final_bad_count(
    parts: List[Optional[Dict[str, Any]]],
    spot: Dict[str, Dict[str, Any]],
    svd: Optional[Dict[str, Dict[str, Any]]] = None,
) -> int:
    """Overall (final) bad items in a lot, after the supervisor's review:
      * items the operator marked bad, unless the supervisor changed them to good (Approved);
      * items the operator marked good but the supervisor found bad (a check answered No in the
        review), unless then Approved (`svd`: {item index: {"ng": [...], "d": decision}});
      * problems recorded by older spot checks (r == "NG"), for items not already counted above.
    Rejected, on-hold and undecided items stay bad. One rule for the lot report (PDF and screen) and
    the admin dashboard."""
    svd = svd or {}
    bad = 0
    for k, p in enumerate(parts):
        if p and p["r"] == "NG":
            bad += p.get("disp") != "Approved"
        elif p and p["r"] == "OK" and (svd.get(str(k)) or {}).get("ng"):
            bad += svd[str(k)].get("d") != "Approved"
        elif ((spot or {}).get(str(k)) or {}).get("r") == "NG":
            bad += 1
    return bad


def lot_bad_summary(b: InspectionBatch, review: Optional[SupervisorLotReview]) -> Dict[str, int]:
    """Counts for one lot, worked out fresh from the stored inspection cells every time:
    items_checked - pieces the operator has checked (all pieces once the operator has submitted),
    operator_ng - pieces the operator marked bad, ng_count - overall bad after the supervisor's review."""
    li = lot_items(b, review)
    parts = li["parts"]
    spot = lot_spots(li["columns"], review)
    checked = len(parts) if b.operator_submitted_at else sum(1 for p in parts if p)
    return {
        "items_checked": checked,
        "operator_ng": sum(1 for p in parts if p and p["r"] == "NG"),
        "ng_count": final_bad_count(parts, spot, lot_answers(li["columns"], review)),
    }


def clearance_text(decision: Optional[str], parts: List[Optional[Dict[str, Any]]]) -> str:
    """Prototype clearance wording from the operator's stored decision ('Approved' | 'Rejected'):
    bad items found -> they were tagged and kept aside; none -> cleared, unless the operator
    rejected the lot for out-of-spec readings alone."""
    if any(p and p["r"] == "NG" for p in parts):
        return "Cleared, NG items segregated"
    if decision == "Rejected":
        return "Not cleared, out-of-spec readings"
    return "Lot cleared"


def serialize_lot(db: Session, b: InspectionBatch, users: Dict[int, User]) -> Dict[str, Any]:
    t = b.template
    review = get_review(db, b)
    li = lot_items(b, review)
    columns, parts, dims = li["columns"], li["parts"], li["dims"]

    status = b.status
    proto = PROTO_STATUS.get(status, "registered")

    op = None
    if b.operator_submitted_at:
        op = {"by": _person(users.get(b.prepared_by)), "at": iso(b.operator_submitted_at)}

    # Who is inspecting right now (prototype opBy): last cell writer, else the start event.
    op_by = None
    if status == "OPERATOR_IN_PROGRESS":
        writers = sorted((c for c in b.cell_responses if c.entered_by), key=lambda c: c.updated_at or datetime.min)
        uid = writers[-1].entered_by if writers else None
        if uid is None:
            started = db.query(AuditLog).filter(
                AuditLog.batch_id == b.batch_id, AuditLog.action_type == "OPERATOR_STARTED_INSPECTION",
            ).order_by(AuditLog.created_at.desc()).first()
            uid = started.user_id if started else None
        op_by = _person(users.get(uid)) if uid else None

    sup = None
    if status in COMPLETED and b.supervisor_submitted_at:
        sup = {"by": _person(users.get(b.checked_by)), "at": iso(b.supervisor_submitted_at)}
    elif status == "ON_HOLD":
        sup = {"by": _person(users.get(b.hold_by or b.checked_by)), "at": iso(b.hold_at or b.supervisor_submitted_at)}

    # Prototype rev: increments on every completed save.
    rev = db.query(InspectionDecision).filter(
        InspectionDecision.batch_id == b.batch_id,
        InspectionDecision.stage == "Review",
        InspectionDecision.decision.in_(["Approved", "Rejected"]),
    ).count()

    # Prototype ts: when the lot reached its current state.
    if status in COMPLETED:
        ts = b.supervisor_submitted_at
    elif status == "ON_HOLD":
        ts = b.hold_at or b.supervisor_submitted_at
    elif status in REVIEWABLE:
        ts = (review.reopened_at if review and review.reopened_at else None) or b.operator_submitted_at
    else:
        ts = None

    return {
        "id": b.batch_id,
        "code": b.lot_number,
        "name": b.product_name or (t.part_name if t else None) or b.lot_number,
        "date": iso(b.created_at),
        "qty": b.lot_quantity or 0,
        "sheetId": b.sheet_id,
        "round": b.round or 1,
        "backendStatus": status,
        "status": proto,
        "supSeen": status == "SUPERVISOR_IN_PROGRESS",
        "ts": iso(ts),
        "op": op,
        "opBy": op_by,
        # The operator's own clearance choice; older lots (submitted before it was stored) fall back to the derived wording.
        "clearance": ({"d": b.operator_clearance, "note": b.operator_clearance_note or ""} if b.operator_clearance
                      else {"d": clearance_text(b.operator_decision, parts), "note": ""} if b.operator_decision else None),
        "columns": columns,
        "parts": parts,
        "supChecks": li["sup_checks"],
        "dims": dims,
        "spot": lot_spots(columns, review),
        "svd": lot_answers(columns, review),
        "supComment": (review.comment or "") if review else "",
        "oos": review.oos_action if review else None,
        "sup": sup,
        "rev": rev,
        "lockBy": _person(users.get(lock_holder(review))) if lock_holder(review) else None,
        "returnNote": review.reopen_note if review else None,
    }


def build_workspace(db: Session, me: User) -> Dict[str, Any]:
    users = {u.user_id: u for u in db.query(User).all()}
    batches = db.query(InspectionBatch).order_by(InspectionBatch.created_at.asc()).all()
    templates = {b.template.sheet_id: b.template for b in batches if b.template}
    return {
        "me": {"id": me.user_id, "name": me.full_name, "role": me.role},
        "users": [{"id": u.user_id, "name": u.full_name, "role": u.role, "active": bool(u.is_active)}
                  for u in users.values()],
        "templates": {sid: serialize_template(t) for sid, t in templates.items()},
        "lots": [serialize_lot(db, b, users) for b in batches],
        "serverTime": iso(datetime.utcnow()),
    }
