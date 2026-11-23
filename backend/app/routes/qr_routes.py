import json
import os
import pathlib
import re
from urllib.parse import urlparse, parse_qs
from typing import Optional, Dict, Any, Tuple
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import User, SheetTemplate, InspectionBatch
from backend.app.schemas import QRResolveResponse
from backend.app.auth import get_current_user
from backend.app.qr_engine import generate_qr_base64, generate_barcode_base64
from backend.app.live_sync import notify_live, notify_user
from backend.app.config import UPLOAD_DIR

router = APIRouter(prefix="/api/qr", tags=["QR & Barcode Engine"])

# File-backed pending scan store — polling fallback when WebSocket isn't connected
_PENDING_FILE = pathlib.Path(UPLOAD_DIR) / "pending_scans.json"

def _load_pending() -> dict:
    try:
        if _PENDING_FILE.exists():
            return json.loads(_PENDING_FILE.read_text())
    except Exception:
        pass
    return {}

def _save_pending(data: dict):
    try:
        _PENDING_FILE.parent.mkdir(parents=True, exist_ok=True)
        _PENDING_FILE.write_text(json.dumps(data))
    except Exception:
        pass

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

    # Query by template QR or barcode value
    if not batch and not template:
        template = db.query(SheetTemplate).filter(
            (SheetTemplate.qr_code_value == clean_code) | (SheetTemplate.barcode_value == clean_code)
        ).first()

    # Query by batch_id directly (int)
    if not batch and not template:
        try:
            batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == int(clean_code)).first()
        except ValueError:
            pass

    # Query by sheet_id directly (str)
    if not batch and not template:
        template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == clean_code).first()

    # Part labels commonly contain the part number rather than the internal sheet ID.
    # Match the scanned value to the admin-created template's part_no.
    if not batch and not template:
        template = db.query(SheetTemplate).filter(
            func.lower(func.trim(SheetTemplate.part_no)) == clean_code.lower()
        ).first()

    # If template found without batch, find the most recent open batch
    if template and not batch:
        batch = db.query(InspectionBatch).filter(
            InspectionBatch.sheet_id == template.sheet_id
        ).order_by(InspectionBatch.created_at.desc()).first()

    if not template and not batch:
        # Emit SCAN_NOT_FOUND so the admin desktop can open CreateBatchModal immediately
        _not_found_payload = {
            "type": "SCAN_NOT_FOUND",
            "raw_code": code,
            "format_detected": format_detected,
            "suggested_sheet_id": None,
            "part_no": None,
            "part_name": None,
            "vendor": None,
            "customer": None,
            "model": None,
            "lot_number": None,
            "gtin": None,
            "user_id": current_user.user_id,
            "role": current_user.role,
        }
        store = _load_pending()
        store[str(current_user.user_id)] = _not_found_payload
        _save_pending(store)
        notify_user(current_user.user_id, "SCAN_NOT_FOUND", _not_found_payload)
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

@router.post("/templates/{sheet_id}/start")
def start_inspection_from_template(
    sheet_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create the first inspection batch when an operator scans a known part label."""
    if current_user.role not in {"operator", "supervisor", "admin"}:
        raise HTTPException(status_code=403, detail="Not allowed to start an inspection")

    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Sheet template not found")

    batch = db.query(InspectionBatch).filter(
        InspectionBatch.sheet_id == template.sheet_id
    ).order_by(InspectionBatch.created_at.desc()).first()
    if batch:
        return {"batch_id": batch.batch_id}

    lot_number = f"PART-{template.part_no or template.sheet_id}"
    batch = InspectionBatch(
        sheet_id=template.sheet_id,
        lot_number=lot_number,
        product_name=template.part_name or template.document_title,
        status="CREATED_PENDING_OPERATOR",
        round=1,
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    notify_live("BATCH_CREATED", {"batch_id": batch.batch_id, "sheet_id": batch.sheet_id, "lot_number": batch.lot_number})
    return {"batch_id": batch.batch_id}

@router.get("/codes/{sheet_id}")
def get_template_codes(
    sheet_id: str,
    db: Session = Depends(get_db)
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

@router.get("/pending-scan")
def get_pending_scan(current_user: User = Depends(get_current_user)):
    """Polling fallback: returns and clears the latest SCAN_NOT_FOUND event for this user."""
    store = _load_pending()
    key = str(current_user.user_id)
    scan = store.pop(key, None)
    if scan is not None:
        _save_pending(store)
    return {"scan": scan}
