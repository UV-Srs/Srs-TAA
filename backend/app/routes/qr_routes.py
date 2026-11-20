from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import User, SheetTemplate, InspectionBatch
from backend.app.schemas import QRResolveResponse
from backend.app.auth import get_current_user
from backend.app.qr_engine import generate_qr_base64, generate_barcode_base64

router = APIRouter(prefix="/api/qr", tags=["QR & Barcode Engine"])

@router.get("/resolve/{code}", response_model=QRResolveResponse)
def resolve_code(
    code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    FR-020, FR-021, FR-021A:
    Resolves wired/wireless TFT QR or Barcode scan.
    Returns target sheet/batch and enforces strict read_only flag if saved/finalized.
    """
    clean_code = code.strip()

    # Formats:
    # 1. TAA:BATCH:{batch_id}
    # 2. TAA:SHEET:{sheet_id}
    # 3. TAA-{sheet_id}
    # 4. Raw batch_id (int) or sheet_id (str)

    batch: Optional[InspectionBatch] = None
    template: Optional[SheetTemplate] = None

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
        s_id = clean_code.replace("TAA-", "")
        template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == s_id).first()
    else:
        # Try finding by qr_code_value or barcode_value
        template = db.query(SheetTemplate).filter(
            (SheetTemplate.qr_code_value == clean_code) | (SheetTemplate.barcode_value == clean_code)
        ).first()

        # If not, try by batch_id
        if not template:
            try:
                batch = db.query(InspectionBatch).filter(InspectionBatch.batch_id == int(clean_code)).first()
            except ValueError:
                pass

        # If not, try by sheet_id directly
        if not template and not batch:
            template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == clean_code).first()

    # If template found without batch, find the most recent open batch or link to template
    if template and not batch:
        batch = db.query(InspectionBatch).filter(
            InspectionBatch.sheet_id == template.sheet_id
        ).order_by(InspectionBatch.created_at.desc()).first()

    if not template and not batch:
        raise HTTPException(status_code=404, detail=f"No matching checksheet or batch found for scanned code: {code}")

    if batch:
        target_sheet_id = batch.sheet_id
        # FR-021A: Rescan Read-Only Rule
        # If Operator submitted -> read_only = True for Operator
        # If Supervisor submitted / finalized -> read_only = True for all
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
            "data": {
                "lot_number": batch.lot_number,
                "lot_quantity": batch.lot_quantity,
                "inspection_mode": batch.inspection_mode,
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
            "status": "TEMPLATE_ONLY",
            "data": {
                "document_title": template.document_title,
                "part_no": template.part_no,
                "part_name": template.part_name
            }
        }

@router.get("/codes/{sheet_id}")
def get_sheet_codes(sheet_id: str, db: Session = Depends(get_db)):
    """
    FR-019: Returns built-in QR code and 1D Code128 barcode images as base64 PNG data URLs.
    """
    template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == sheet_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Sheet template not found")

    qr_image = generate_qr_base64(template.qr_code_value)
    barcode_image = generate_barcode_base64(template.barcode_value)

    return {
        "sheet_id": template.sheet_id,
        "document_title": template.document_title,
        "part_no": template.part_no,
        "qr_code_value": template.qr_code_value,
        "barcode_value": template.barcode_value,
        "qr_image_url": qr_image,
        "barcode_image_url": barcode_image
    }
