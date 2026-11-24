import json
import re
import threading
from urllib.parse import urlparse, parse_qs
from typing import Optional, Dict, Any, Tuple
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import User, SheetTemplate, InspectionBatch
from backend.app.schemas import QRResolveResponse
from backend.app.auth import get_current_user
from backend.app.qr_engine import generate_qr_base64, generate_barcode_base64
from backend.app.live_sync import notify_live
from backend.app.audit import log_audit
from backend.app.config import UPLOAD_DIR

router = APIRouter(prefix="/api/qr", tags=["QR & Barcode Engine"])

# File-backed pending scan store — stored in UPLOAD_DIR (runtime data, never in repo)
import os, pathlib

_PENDING_FILE = pathlib.Path(UPLOAD_DIR) / "pending_scans.json"
_pending_lock = threading.Lock()  # C-5: serialize concurrent read-modify-write


def _load_pending() -> dict:
    try:
        if _PENDING_FILE.exists():
            data = json.loads(_PENDING_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
            _PENDING_FILE.write_text("{}", encoding="utf-8")
    except Exception:
        pass
    return {}


def _save_pending(data: dict):
    try:
        _PENDING_FILE.write_text(json.dumps(data), encoding="utf-8")
    except Exception:
        pass


def _update_pending(user_id: int | str, payload: dict) -> None:
    """Atomically set one user's pending entry (C-5: protected by _pending_lock)."""
    with _pending_lock:
        store = _load_pending()
        store[str(user_id)] = payload
        _save_pending(store)


def _pop_pending(user_id: int | str) -> dict | None:
    """Atomically pop and return one user's pending entry."""
    with _pending_lock:
        store = _load_pending()
        payload = store.pop(str(user_id), None)
        if payload is not None:
            _save_pending(store)
    return payload

def parse_scan_code(raw: str) -> Tuple[str, str]:
    """
    FR-018: Multi-format barcode/QR parser.
    Detects plain codes, QR JSON, QR URLs, and GS1 barcodes (AI 10).
    Returns (normalized_code, format_name).
    """
    raw_str = raw.strip()
    if not raw_str:
        return "", "Unknown"

    format_name = "Plain code"
    extracted_id = None

    # 1. Try QR JSON payload
    try:
        data = json.loads(raw_str)
        if isinstance(data, dict):
            extracted_id = data.get("batch") or data.get("batchId") or data.get("b") or data.get("sheet") or data.get("sheet_id")
            format_name = "QR with JSON payload"
    except Exception:
        pass

    # 2. Try QR URL
    if not extracted_id and (raw_str.startswith("http://") or raw_str.startswith("https://")):
        try:
            parsed = urlparse(raw_str)
            qs = parse_qs(parsed.query)
            if "batch" in qs:
                extracted_id = qs["batch"][0]
            elif "b" in qs:
                extracted_id = qs["b"][0]
            elif "sheet" in qs:
                extracted_id = qs["sheet"][0]
            else:
                extracted_id = parsed.path.strip("/").split("/")[-1]
            format_name = "QR with URL"
        except Exception:
            pass

    # 3. Try GS1 barcode with AI 10 (lot number)
    if not extracted_id:
        gs1_match = re.search(r"\(10\)([A-Za-z0-9-_]+)", raw_str)
        if gs1_match:
            extracted_id = gs1_match.group(1)
            format_name = "GS1 barcode (lot, AI 10)"

    if not extracted_id:
        extracted_id = raw_str

    # Normalize code
    code = extracted_id.strip()
    return code, format_name

@router.get("/resolve/{code:path}", response_model=QRResolveResponse)
def resolve_code(
    code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    FR-017, FR-018, FR-020, FR-021, FR-021A:
    Resolves any barcode/QR format to an inspection sheet or batch.
    Enforces read-only locks on finalized batches.
    Returns 404 with NOT_REGISTERED if unknown code.
    """
    clean_code, format_detected = parse_scan_code(code)

    batch: Optional[InspectionBatch] = None
    template: Optional[SheetTemplate] = None
    candidate = clean_code  # fallback alias used in subsequent plain-text queries

    # Prefix checks
    if clean_code.startswith("TAA:BATCH:"):
        b_id_str = clean_code.replace("TAA:BATCH:", "")
        try:
            batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == int(b_id_str)).first()
        except ValueError:
            pass
    elif clean_code.startswith("TAA:SHEET:"):
        s_id = clean_code.replace("TAA:SHEET:", "")
        template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == s_id).first()
    elif clean_code.startswith("TAA-"):
        # Could be batch like TAA-B-24117 or template like TAA-18351M62Q50-IFM
        candidate = clean_code.replace("TAA-", "")
        batch = db.query(InspectionBatch).filter(
            (InspectionBatch.lot_number == clean_code) | (InspectionBatch.lot_number == candidate)
        ).first()
        if not batch:
            template = db.query(SheetTemplate).filter(
                (SheetTemplate.sheet_id == clean_code) | (SheetTemplate.sheet_id == candidate)
            ).first()

    # Query by lot_number directly (e.g. B-24117, LOT-2026-495A)
    if not batch and not template:
        batch = db.query(InspectionBatch).filter(
            (InspectionBatch.lot_number == clean_code) | (InspectionBatch.lot_number == f"TAA-{clean_code}")
        ).first()

    # Query by template QR, barcode, or physical external barcode
    if not batch and not template:
        template = db.query(SheetTemplate).filter(
            (SheetTemplate.qr_code_value == clean_code) |
            (SheetTemplate.barcode_value == clean_code) |
            (SheetTemplate.external_barcode == clean_code)
        ).first()

    # Query by batch_id directly (int) — ADMIN ONLY to prevent batch enumeration (C-2)
    if not batch and not template and current_user.role == 'admin' and clean_code.isdigit() and len(clean_code) <= 9:
        try:
            batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == int(clean_code)).first()
        except (ValueError, OverflowError):
            pass

    # Query by sheet_id directly (str)
    if not batch and not template:
        template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == clean_code).first()

    # Query by part_no — ADMIN ONLY to prevent cross-lot data exposure (C-3)
    if not batch and not template and current_user.role == 'admin':
        template = db.query(SheetTemplate).filter(
            SheetTemplate.part_no.ilike(clean_code)
        ).first()

    # Case-insensitive lot_number fallback — ADMIN ONLY (C-3)
    if not batch and not template and current_user.role == 'admin':
        batch = db.query(InspectionBatch).filter(
            InspectionBatch.lot_number.ilike(clean_code)
        ).first()

    # If template found without batch, find the most recent active batch for it (unless explicit sheet QR)
    if template and not batch and not clean_code.startswith("TAA:SHEET:"):
        batch = db.query(InspectionBatch).filter(
            InspectionBatch.sheet_id == template.sheet_id
        ).order_by(InspectionBatch.created_at.desc()).first()

    # Last attempt: parse the barcode and search by the extracted part_no
    if not batch and not template:
        _p = _parse_gs1(code)
        extracted_part = _p.get("part_no") or _p.get("customer_part_no") or _p.get("gtin")
        if extracted_part and extracted_part != clean_code:
            template = db.query(SheetTemplate).filter(
                (SheetTemplate.part_no.ilike(extracted_part)) |
                (SheetTemplate.external_barcode == extracted_part) |
                (SheetTemplate.barcode_value == extracted_part)
            ).first()
            if template and not batch and not clean_code.startswith("TAA:SHEET:"):
                batch = db.query(InspectionBatch).filter(
                    InspectionBatch.sheet_id == template.sheet_id
                ).order_by(InspectionBatch.created_at.desc()).first()

    if not template and not batch:
        # Parse whatever info is embedded in the barcode itself so the laptop
        # can pre-fill the new-sheet form without the admin having to retype anything.
        parsed = _parse_gs1(code)   # use original raw code, not clean_code
        suggested_id = _suggest_sheet_id(parsed)
        _not_found_payload = {
            "type": "SCAN_NOT_FOUND",
            "raw_code": code,
            "format_detected": format_detected,
            "suggested_sheet_id": suggested_id,
            "part_no":    parsed.get("part_no"),
            "part_name":  parsed.get("part_name"),
            "vendor":     parsed.get("vendor"),
            "customer":   parsed.get("customer"),
            "model":      parsed.get("model"),
            "lot_number": parsed.get("lot_number"),
            "gtin":       parsed.get("gtin"),
            "user_id":    current_user.user_id,
            "role":       current_user.role,
        }
        _update_pending(current_user.user_id, _not_found_payload)
        notify_live("SCAN_NOT_FOUND", _not_found_payload)
        log_audit(db, current_user.user_id, current_user.role, "SCAN_NOT_FOUND",
                  details={"scanned_code": clean_code, "format": format_detected,
                           "part_no": parsed.get("part_no"), "suggested_id": suggested_id})
        raise HTTPException(
            status_code=404,
            detail={
                "code": "NOT_REGISTERED",
                "scanned_code": clean_code,
                "format": format_detected,
                "message": f"{clean_code} isn't registered yet."
            }
        )

    if batch:
        target_sheet_id = batch.sheet_id
        # FR-021A: Rescan Read-Only Rule
        read_only = False
        if current_user.role == "operator" and batch.operator_submitted_at is not None:
            read_only = True
        elif batch.supervisor_submitted_at is not None or batch.status in ["APPROVED", "REJECTED"]:
            read_only = True

        # Store for laptop polling (reliable fallback when WebSocket is unavailable).
        _scan_resolved = {
            "type": "SCAN_RESOLVED",
            "batch_id": batch.batch_id,
            "sheet_id": target_sheet_id,
            "lot_number": batch.lot_number,
            "status": batch.status,
            "user_id": current_user.user_id,
            "role": current_user.role,
            "part_name": batch.template.part_name if batch.template else None,
            "part_no": batch.template.part_no if batch.template else None,
        }
        _update_pending(current_user.user_id, _scan_resolved)
        notify_live("SCAN_RESOLVED", _scan_resolved)
        log_audit(db, current_user.user_id, current_user.role, "SCAN_RESOLVED",
                  batch_id=batch.batch_id, sheet_id=batch.sheet_id,
                  details={"lot_number": batch.lot_number, "scanned_code": clean_code, "format": format_detected})

        return {
            "type": "BATCH",
            "sheet_id": target_sheet_id,
            "batch_id": batch.batch_id,
            "read_only": read_only,
            "status": batch.status,
            "format_detected": format_detected,
            "data": {
                "lot_number": batch.lot_number,
                "lot_quantity": batch.lot_quantity,
                "inspection_mode": batch.inspection_mode,
                "round": batch.round,
                "product_name": batch.product_name or (batch.template.part_name if batch.template else None),
                "line_name": batch.line_name,
                "part_no": batch.template.part_no if batch.template else None,
                "part_name": batch.template.part_name if batch.template else None
            }
        }
    else:
        return {
            "type": "TEMPLATE",
            "sheet_id": template.sheet_id,
            "batch_id": None,
            "read_only": False,
            "status": None,
            "format_detected": format_detected,
            "data": {
                "document_title": template.document_title,
                "part_no": template.part_no,
                "part_name": template.part_name
            }
        }

@router.get("/pending-scan")
def get_pending_scan(
    current_user: User = Depends(get_current_user)
):
    """
    Laptop polls this every 2 s. Returns the latest scan event for this user
    (from their phone) and immediately clears it so it only fires once.
    Returns null when nothing is pending.
    """
    return _pop_pending(current_user.user_id)  # None → frontend gets null


def _parse_gs1(raw: str) -> dict:
    """
    Parse any barcode / QR payload into a structured dict.
    Priority order: JSON QR → GS1-128 (parenthesised) → GS1 FNC1 → Plain.
    """
    import re as _re
    result: dict = {"raw_code": raw, "format": "Plain"}

    # 1. JSON QR — richest source: may contain part_name, part_no, sheet_id, etc.
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            result["format"] = "JSON QR"
            result["part_no"]   = data.get("part_no") or data.get("partNo") or data.get("part_number")
            result["part_name"] = data.get("part_name") or data.get("partName") or data.get("name")
            result["sheet_id"]  = data.get("sheet_id") or data.get("sheetId")
            result["lot_number"]= data.get("lot") or data.get("lot_number") or data.get("batch")
            result["vendor"]    = data.get("vendor") or data.get("vendor_name")
            result["customer"]  = data.get("customer") or data.get("customer_name")
            result["model"]     = data.get("model") or data.get("model_name")
            result["serial_number"] = data.get("serial") or data.get("serial_number")
            return result
    except Exception:
        pass

    # 2. Parenthesised GS1 — e.g. (01)12345(10)LOT001(240)PCB-700
    ai_map = {
        "01": "gtin", "10": "lot_number", "21": "serial_number",
        "11": "manufacture_date", "17": "expiry_date",
        "240": "part_no", "241": "customer_part_no", "30": "quantity"
    }
    paren_matches = _re.findall(r'\((\d{2,3})\)([^\(]+)', raw)
    if paren_matches:
        result["format"] = "GS1-128"
        for ai, val in paren_matches:
            key = ai_map.get(ai)
            if key:
                result[key] = val.strip()
        return result

    # 3. Bracket-less GS1 (FNC1 prefix)
    if raw.startswith('\x1d') or raw.startswith(']C1') or raw.startswith(']d1'):
        raw_stripped = raw.lstrip('\x1d').lstrip(']C1').lstrip(']d1')
        if raw_stripped[:2] == '01' and len(raw_stripped) >= 16:
            result["format"] = "GS1-128"
            result["gtin"] = raw_stripped[2:16]
            rest = raw_stripped[16:]
            if rest.startswith('10'):
                lot_end = rest.find('\x1d', 2) if '\x1d' in rest else len(rest)
                result["lot_number"] = rest[2:lot_end]
        return result

    # 4. Plain Code-128 / Code-39 / EAN — entire value is the part number
    if raw and not raw.startswith('http'):
        result["part_no"] = raw.strip()
    return result


def _suggest_sheet_id(parsed: dict) -> str:
    """Generate a sensible sheet ID suggestion from parsed barcode data."""
    import re as _re
    base = (
        parsed.get("sheet_id") or
        parsed.get("part_no") or
        parsed.get("customer_part_no") or
        parsed.get("gtin")
    )
    if base:
        # Sanitise: uppercase, replace spaces/special chars with hyphens, max 30 chars
        clean = _re.sub(r'[^A-Za-z0-9\-_]', '-', str(base)).upper().strip('-')[:30]
        return f"{clean}-IFM"
    return f"IFM-{parsed['raw_code'][:12].upper()}"


@router.get("/parse-part/{code:path}")
def parse_part_barcode(
    code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Decode a raw barcode/QR from a physical part and return structured part
    details for auto-filling the sheet creation form. Also suggests a Sheet ID
    and checks if this barcode is already assigned to a sheet.
    """
    raw = code.strip()
    parsed = _parse_gs1(raw)

    suggested_sheet_id = _suggest_sheet_id(parsed)

    # Check if this barcode already maps to a sheet
    existing = db.query(SheetTemplate).filter(
        (SheetTemplate.external_barcode == raw) |
        (SheetTemplate.qr_code_value == raw) |
        (SheetTemplate.barcode_value == raw)
    ).first()

    return {
        "raw_code": raw,
        "format_detected": parsed.get("format", "Plain"),
        "suggested_sheet_id": suggested_sheet_id,
        "part_no":   parsed.get("part_no") or parsed.get("customer_part_no"),
        "part_name": parsed.get("part_name"),
        "vendor":    parsed.get("vendor"),
        "customer":  parsed.get("customer"),
        "model":     parsed.get("model"),
        "lot_number": parsed.get("lot_number"),
        "serial_number": parsed.get("serial_number"),
        "gtin": parsed.get("gtin"),
        "manufacture_date": parsed.get("manufacture_date"),
        "already_assigned_to": existing.sheet_id if existing else None,
    }


@router.get("/batch-codes/{batch_id}")
def get_batch_codes(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return QR + barcode images for a specific batch, used by the Print Label modal."""
    batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    template = batch.template  # relationship

    # Batch QR encodes TAA:BATCH:{id} → resolve goes straight to this batch
    batch_qr_value = f"TAA:BATCH:{batch.batch_id}"
    batch_qr_b64   = generate_qr_base64(batch_qr_value)
    # Lot barcode uses the lot_number (plain text — most scanners can read Code-128)
    lot_barcode_b64 = generate_barcode_base64(batch.lot_number)

    return {
        "batch_id":        batch.batch_id,
        "lot_number":      batch.lot_number,
        "sheet_id":        batch.sheet_id,
        "product_name":    batch.product_name or (template.part_name if template else ""),
        "part_no":         template.part_no if template else "",
        "part_name":       template.part_name if template else "",
        "vendor":          template.vendor_name if template else "",
        "customer":        template.customer_name if template else "",
        "line_name":       batch.line_name or "",
        "lot_quantity":    batch.lot_quantity,
        "status":          batch.status,
        "batch_qr_value":  batch_qr_value,
        "batch_qr_url":    batch_qr_b64,
        "lot_barcode_url": lot_barcode_b64,
    }


@router.get("/codes/{sheet_id}")
def get_template_codes(
    sheet_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Sheet template not found")

    qr_b64 = generate_qr_base64(template.qr_code_value)
    barcode_b64 = generate_barcode_base64(template.barcode_value)

    return {
        "sheet_id": template.sheet_id,
        "qr_code_value": template.qr_code_value,
        "barcode_value": template.barcode_value,
        "qr_image_url": f"data:image/png;base64,{qr_b64}",
        "barcode_image_url": f"data:image/png;base64,{barcode_b64}",
        "qr_base64": qr_b64,
        "barcode_base64": barcode_b64
    }
