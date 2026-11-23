"""
Builds the printable IFM checksheet structure (shared by the PDF and per-batch CSV exports)
so both outputs mirror the physical "DAILY INITIAL FLOW MANAGEMENT CONTROL ITEMS MONITORING
CHECKSHEET" layout:

  header (Part No / Part Name / Model / Vendor | title | Date)
  -> matrix: S.NO | Stage | Control Items | Content | Process Capability Application |
             Checking Methods | Normal Frequency | IFM Frequency | per-sample result columns
  -> CHK BY / APP BY rows -> notes -> Prepared / Checked / Approved sign-off -> images.

Every value comes from the database; nothing is hard-coded per part.
"""
import csv
import io
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

from backend.app.report_people import resolve_report_people

TITLE_FALLBACK = "DAILY INITIAL FLOW MANAGEMENT CONTROL ITEMS MONITORING CHECKSHEET (PRODUCT PARAMETER)"

FIXED_COLUMNS = [
    "S.NO", "Stage", "Control Items", "Content", "Process Capability Application",
    "Checking Methods", "Normal Frequency", "IFM Frequency",
]

SHEET_NOTES = [
    "(1) Record is Required on first 5000 Parts or for first 3 months whichever is Earlier.",
    "(2) During IFM period Frequency of visual inspection parameter is 200 % (100% normal + 100% IFM station).",
]

TICK_OK_VALUES = {"true", "pass", "ok", "1", "checked", "yes", "accepted"}
TICK_NG_VALUES = {"false", "fail", "ng", "0", "no", "reject", "rejected", "not ok"}

# Cell states
BLANK, OK, NG, VALUE, OUT_OF_SPEC = "blank", "ok", "ng", "value", "oos"

APPROVING_REVIEW_DECISIONS = {"approved", "accepted", "accept (override rejection)"}


@dataclass
class ResultCell:
    state: str = BLANK
    text: str = ""          # value text for VALUE / OUT_OF_SPEC states

    @property
    def csv_text(self) -> str:
        if self.state == OK:
            return "✓"
        if self.state == NG:
            return "✗ NG"
        if self.state == OUT_OF_SPEC:
            return f"{self.text} (OUT OF SPEC)"
        return self.text


@dataclass
class SheetRow:
    serial_no: str
    stage: str
    control_item: str
    content: str
    process_capability: str
    checking_method: str
    normal_frequency: str
    ifm_frequency: str
    cells: List[ResultCell] = field(default_factory=list)
    remark: Optional[str] = None          # free-text row: spans all result columns
    is_rejected: bool = False             # flagged by Operator / Supervisor rejection


@dataclass
class SignOff:
    role_label: str
    name: str
    when: str


@dataclass
class ImageEntry:
    path: Optional[str]     # absolute local path, None when the file is missing
    caption: str


@dataclass
class Checksheet:
    title: str
    sheet_id: str
    part_no: str
    part_name: str
    model: str
    vendor: str
    customer: str
    date: str
    lot_number: str
    lot_quantity: str
    mode: str
    status: str
    result_summary: str
    slot_labels: List[str]
    slot_dates: List[str]
    rows: List[SheetRow]
    chk_by: List[str]
    app_by: List[str]
    signoffs: List[SignOff]
    notes: List[str]
    remarks: List[str]
    history: List[dict]
    images: List[ImageEntry]


def _s(v) -> str:
    return "" if v is None else str(v)


def _fmt_dt(dt, fmt="%d-%m-%Y %H:%M") -> str:
    return dt.strftime(fmt) if isinstance(dt, datetime) else ""


def initials(name: Optional[str]) -> str:
    if not name or name == "Pending":
        return ""
    name = re.sub(r"\(.*?\)", "", name).strip()
    parts = [p for p in re.split(r"\s+", name) if p]
    return "".join(p[0].upper() for p in parts[:3])


def _sample_columns(item) -> List[str]:
    cols = item.sample_columns if isinstance(item.sample_columns, list) else []
    return [str(c) for c in cols]


def _is_remark_item(item) -> bool:
    return item.row_mode == "STANDARD_INPUT" and (item.html_input_type or "").lower() in ("text", "textarea")


def _classify(item, resp) -> ResultCell:
    if resp is None or resp.cell_value in (None, ""):
        return ResultCell()
    raw = str(resp.cell_value).strip()
    low = raw.lower()
    if low in TICK_OK_VALUES and item.row_mode != "NUMERIC_SAMPLE":
        return ResultCell(NG if resp.is_within_spec is False else OK)
    if low in TICK_NG_VALUES and item.row_mode != "NUMERIC_SAMPLE":
        return ResultCell(NG)
    if resp.is_within_spec is False:
        return ResultCell(OUT_OF_SPEC, raw)
    return ResultCell(VALUE, raw)


def _process_capability(item) -> str:
    # Measured characteristics with a tolerance band are process-capability (Cp/Cpk) items.
    return "Yes" if item.row_mode == "NUMERIC_SAMPLE" or item.min_val is not None or item.max_val is not None else "---"


def _resolve_upload(file_path: Optional[str], upload_dir) -> Optional[str]:
    if not file_path or not upload_dir:
        return None
    candidate = os.path.join(str(upload_dir), os.path.basename(file_path))
    return candidate if os.path.isfile(candidate) else None


def build_checksheet(batch, template, cell_responses, decisions, attachments, upload_dir=None) -> Checksheet:
    items = sorted(template.control_items, key=lambda i: (i.display_order or 0, i.serial_no or 0, i.item_id))
    item_names = {i.item_id: i.control_item_name for i in items}

    # Result columns: one slot per sample position; the longest item defines the labels (S.No).
    grid_items = [i for i in items if not _is_remark_item(i)]
    slot_labels = max((_sample_columns(i) for i in grid_items), key=len, default=[]) or ["1"]
    n_slots = len(slot_labels)

    resp_map = {(r.item_id, str(r.column_key)): r for r in cell_responses}

    # Rejected items (Operator rejection or Supervisor-confirmed rejection)
    rejected_ids = set()
    for d in decisions:
        for rid in (d.rejected_item_ids or []):
            try:
                rejected_ids.add(int(rid))
            except (TypeError, ValueError):
                pass
    for rid in (batch.operator_rejected_fields or []):
        try:
            rejected_ids.add(int(rid))
        except (TypeError, ValueError):
            pass

    slot_first_seen: List[Optional[datetime]] = [None] * n_slots
    slot_checker: List[str] = [""] * n_slots
    slot_has_data = [False] * n_slots

    freq_ifm = (batch.inspection_mode or "IFM").upper() == "IFM"
    rows: List[SheetRow] = []
    for item in items:
        row = SheetRow(
            serial_no=_s(item.serial_no),
            stage=_s(item.stage_name),
            control_item=_s(item.control_item_name),
            content=_s(item.specification_content),
            process_capability=_process_capability(item),
            checking_method=_s(item.application_method) or "-",
            normal_frequency=_s(item.normal_frequency) or "-",
            ifm_frequency=_s(item.ifm_frequency) or "-",
            is_rejected=item.item_id in rejected_ids,
        )
        cols = _sample_columns(item)
        if _is_remark_item(item):
            texts = [_s(resp_map[(item.item_id, c)].cell_value) for c in cols
                     if (item.item_id, c) in resp_map and resp_map[(item.item_id, c)].cell_value]
            row.remark = "; ".join(texts)
        else:
            row.cells = [ResultCell() for _ in range(n_slots)]
            for idx, col in enumerate(cols[:n_slots]):
                resp = resp_map.get((item.item_id, col))
                cell = _classify(item, resp)
                row.cells[idx] = cell
                if resp is not None and cell.state != BLANK:
                    slot_has_data[idx] = True
                    ts = resp.updated_at
                    if ts and (slot_first_seen[idx] is None or ts < slot_first_seen[idx]):
                        slot_first_seen[idx] = ts
                    if not slot_checker[idx]:
                        slot_checker[idx] = (resp.checker_initials or "").strip() or initials(
                            resp.user.full_name if getattr(resp, "user", None) else None)
        rows.append(row)

    people = resolve_report_people(batch, decisions)

    # APP BY: Supervisor initials on every inspected slot once the Supervisor has approved / accepted.
    review = next((d for d in reversed(list(decisions)) if d.stage == "Review"), None)
    approved = review is not None and (review.decision or "").strip().lower() in APPROVING_REVIEW_DECISIONS
    sup_initials = initials(people["supervisor"]) if approved else ""
    app_by = [sup_initials if (approved and slot_has_data[i]) else "" for i in range(n_slots)]

    # Lot result summary, as written in the "Result" box of the physical sheet.
    inspected = sum(slot_has_data)
    any_ng = any(c.state in (NG, OUT_OF_SPEC) for r in rows for c in r.cells) or bool(rejected_ids)
    status = (batch.status or "").upper()
    if status == "APPROVED":
        verdict = "OK"
    elif status == "REJECTED":
        verdict = "NG"
    elif status == "ON_HOLD":
        verdict = "ON HOLD"
    elif inspected == 0:
        verdict = "PENDING"
    else:
        verdict = "NG" if any_ng else "OK"
    qty = _s(batch.lot_quantity) or "-"
    result_summary = f"{inspected:02d}/{qty}  Result: {verdict}"

    first_entry = min((r.updated_at for r in cell_responses if r.updated_at), default=None)
    sheet_date = first_entry or batch.created_at

    signoffs = [
        SignOff("PREPARED BY", people["operator"], _fmt_dt(batch.operator_submitted_at)),
        SignOff("CHECKED BY", people["supervisor"], _fmt_dt(batch.supervisor_submitted_at or batch.hold_at)),
        SignOff("APPROVED BY", people["approver"],
                _fmt_dt(batch.supervisor_submitted_at) if batch.approved_by else ""),
    ]

    remarks = [r.remark for r in rows if r.remark]
    if batch.hold_reason:
        remarks.append(f"On hold: {batch.hold_reason}" + (f" - {batch.hold_note}" if batch.hold_note else ""))

    history = []
    for d in decisions:
        if d.stage == "Registered":
            continue
        failed = [item_names.get(int(i), f"Item {i}") for i in (d.rejected_item_ids or []) if str(i).isdigit()]
        failed += [f for f in (d.rejected_fields or []) if f not in failed]
        who = d.user.full_name if getattr(d, "user", None) else ""
        history.append({
            "stage": d.stage or "",
            "role": (d.role or "").title(),
            "by": who,
            "decision": d.decision or "",
            "failed_items": ", ".join(failed),
            "remarks": d.remarks or "",
            "when": _fmt_dt(d.decided_at),
        })

    images = []
    for a in attachments:
        src = "Camera" if a.capture_source == "TFT_CAMERA" else "Upload"
        label = item_names.get(a.item_id, "General") if a.item_id else "General"
        who = a.user.full_name if getattr(a, "user", None) else ""
        caption = f"{label} | {src}" + (f" | {who}" if who else "") + (f" | {_fmt_dt(a.uploaded_at)}" if a.uploaded_at else "")
        images.append(ImageEntry(_resolve_upload(a.file_path, upload_dir), caption))

    return Checksheet(
        title=template.document_title or TITLE_FALLBACK,
        sheet_id=template.sheet_id,
        part_no=_s(template.part_no),
        part_name=_s(template.part_name),
        model=_s(template.model_name),
        vendor=_s(template.vendor_name),
        customer=_s(template.customer_name) or "Customer",
        date=_fmt_dt(sheet_date, "%d-%m-%Y"),
        lot_number=_s(batch.lot_number),
        lot_quantity=qty,
        mode=_s(batch.inspection_mode) or "IFM",
        status=status.replace("_", " "),
        result_summary=result_summary,
        slot_labels=slot_labels,
        slot_dates=[_fmt_dt(d, "%d/%m") for d in slot_first_seen],
        rows=rows,
        chk_by=slot_checker,
        app_by=app_by,
        signoffs=signoffs,
        notes=SHEET_NOTES,
        remarks=remarks,
        history=history,
        images=images,
    )


def generate_checksheet_csv(batch, template, cell_responses, decisions, attachments) -> bytes:
    """Per-batch CSV mirroring the physical checksheet: header block, matrix, CHK/APP BY, notes, sign-off."""
    sheet = build_checksheet(batch, template, cell_responses, decisions, attachments)
    n_fixed = len(FIXED_COLUMNS)
    width = n_fixed + len(sheet.slot_labels)

    def pad(cells):
        cells = list(cells)
        return cells + [""] * (width - len(cells))

    out = io.StringIO()
    w = csv.writer(out, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")

    # Header block
    w.writerow(pad([sheet.title]))
    w.writerow(pad(["PART NO.", sheet.part_no, "", "", "", "", "DATE", sheet.date]))
    w.writerow(pad(["PART NAME", sheet.part_name, "", "", "", "", "LOT NO.", sheet.lot_number]))
    w.writerow(pad(["MODEL", sheet.model, "", "", "", "", "LOT QTY", sheet.lot_quantity]))
    w.writerow(pad(["VENDOR", sheet.vendor, "", "", "", "", "STATUS", sheet.status]))
    w.writerow(pad(["SHEET ID", sheet.sheet_id, "", "", "", "", "MODE", f"{sheet.mode} FREQUENCY"]))
    w.writerow(pad([]))

    # Matrix header (3 lines, as on the sheet: Result / Date / S.No)
    w.writerow(pad([""] * (n_fixed - 1) + ["Result", sheet.result_summary]))
    w.writerow(pad([""] * (n_fixed - 1) + ["Date"] + sheet.slot_dates))
    w.writerow(FIXED_COLUMNS + [f"S.No {lbl}" for lbl in sheet.slot_labels])

    for r in sheet.rows:
        fixed = [r.serial_no, r.stage, r.control_item + (" [REJECTED]" if r.is_rejected else ""), r.content,
                 r.process_capability, r.checking_method, r.normal_frequency, r.ifm_frequency]
        if r.remark is not None:
            w.writerow(pad(fixed + [r.remark]))
        else:
            w.writerow(fixed + [c.csv_text for c in r.cells])

    w.writerow([""] * (n_fixed - 1) + ["CHK BY"] + sheet.chk_by)
    w.writerow([""] * (n_fixed - 1) + ["APP BY"] + sheet.app_by)
    w.writerow(pad([]))

    w.writerow(pad(["Note:"]))
    for n in sheet.notes:
        w.writerow(pad([n]))
    w.writerow(pad([]))

    w.writerow(pad(["", "Vendor", "Date / Time", sheet.customer]))
    for s in sheet.signoffs:
        w.writerow(pad([s.role_label, s.name, s.when, ""]))
    w.writerow(pad([]))

    w.writerow(pad(["REMARKS"]))
    for rem in (sheet.remarks or ["-"]):
        w.writerow(pad([rem]))
    w.writerow(pad([]))

    w.writerow(pad(["DECISION HISTORY"]))
    w.writerow(pad(["Stage", "Role", "By", "Decision", "Failed Items", "Remarks", "Date / Time"]))
    for h in sheet.history:
        w.writerow(pad([h["stage"], h["role"], h["by"], h["decision"], h["failed_items"], h["remarks"], h["when"]]))
    w.writerow(pad([]))

    w.writerow(pad(["IMAGES"]))
    for img in sheet.images:
        w.writerow(pad([img.caption]))
    if not sheet.images:
        w.writerow(pad(["No images attached"]))

    # UTF-8 BOM so Excel renders the check marks correctly.
    return ("﻿" + out.getvalue()).encode("utf-8")
