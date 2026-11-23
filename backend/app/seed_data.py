import os
import secrets
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from backend.app.models import (
    User, SheetTemplate, TemplateControlItem
)
from backend.app.auth import hash_password


def seed_database(db: Session):
    """
    Runs on every backend startup. All operations are idempotent.

    User accounts:
      - If no admin exists at all, one is bootstrapped using ADMIN_INITIAL_PASSWORD
        from the environment. If the env var is not set, a random one-time password
        is generated and printed to the console once.
      - Demo / sample accounts (admin2, supervisor, operator) are NOT created here.
        All users are managed exclusively through the Admin → User Management UI.

    Sheet templates:
      - Three example templates are seeded on first run only.
        They can be deleted or replaced from the Admin → Sheet Builder UI.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # ── Bootstrap first admin ────────────────────────────────────────────────
    existing_admin = db.query(User).filter(User.role == "admin", User.is_active == True).first()
    if not existing_admin:
        initial_password = os.getenv("ADMIN_INITIAL_PASSWORD", "").strip()
        if not initial_password:
            initial_password = secrets.token_urlsafe(16)
            border = "=" * 62
            print(f"\n{border}")
            print("[TAA SETUP] No active admin account found in the database.")
            print("[TAA SETUP] A new admin account has been created:")
            print(f"[TAA SETUP]   Username : admin")
            print(f"[TAA SETUP]   Password : {initial_password}")
            print("[TAA SETUP] Log in and change this password immediately.")
            print(f"{border}\n")
        else:
            print("[TAA SETUP] Creating first admin account from ADMIN_INITIAL_PASSWORD.")

        admin_user = User(
            username="admin",
            full_name="Administrator",
            password_hash=hash_password(initial_password),
            role="admin",
            is_active=True,
            password_version=1,
        )
        db.add(admin_user)
        db.flush()
        admin_user_id = admin_user.user_id
    else:
        admin_user_id = existing_admin.user_id

    # ── Seed sheet templates (no credentials involved) ───────────────────────

    # Template 1: Flagship IFM Checksheet (18351M62Q50-IFM)
    t1_id = "18351M62Q50-IFM"
    if not db.query(SheetTemplate).filter(SheetTemplate.sheet_id == t1_id).first():
        t1 = SheetTemplate(
            sheet_id=t1_id,
            document_title="DAILY INITIAL FLOW MANAGEMENT CONTROL ITEMS MONITORING CHECKSHEET (PRODUCT PARAMETER)",
            part_no="18351M62Q50",
            part_name="PIPE, PURGE LINE (RH)",
            model_name="YTA MC26 Fuel Line",
            vendor_name="Bundy India Ltd.",
            customer_name="MSIL",
            part_category="MAIN PART",
            is_default=True,
            qr_code_value=f"TAA:SHEET:{t1_id}",
            barcode_value=f"TAA-{t1_id}",
            created_by=admin_user_id,
        )
        db.add(t1)
        db.flush()

        t1_items = [
            {"serial_no": 1, "stage_name": "Appearance", "control_item_name": "Appearance & Coating Condition", "specification_content": "Be free from burr, scratch, rust, dent & damage", "application_method": "Visual", "normal_frequency": "100%", "ifm_frequency": "200%", "row_mode": "SERIAL_TICKBOX", "html_input_type": "checkbox", "sample_columns": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], "min_val": None, "max_val": None, "assigned_role": "operator"},
            {"serial_no": 2, "stage_name": "Appearance", "control_item_name": "QR Code Sticker Appearance", "specification_content": "QR sticker pasted properly & readable without smudge", "application_method": "Visual / Scanner", "normal_frequency": "100%", "ifm_frequency": "200%", "row_mode": "SERIAL_TICKBOX", "html_input_type": "checkbox", "sample_columns": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], "min_val": None, "max_val": None, "assigned_role": "operator"},
            {"serial_no": 3, "stage_name": "10TSW PP", "control_item_name": "Tube Outer Diameter (OD)", "specification_content": "07.97 ~ 08.17 mm", "application_method": "Micrometer", "normal_frequency": "n=5/lot", "ifm_frequency": "n=10/lot", "row_mode": "NUMERIC_SAMPLE", "html_input_type": "number", "sample_columns": ["S1", "S2", "S3", "S4", "S5"], "min_val": 7.97, "max_val": 8.17, "unit": "mm", "assigned_role": "supervisor"},
            {"serial_no": 4, "stage_name": "10TSW PP", "control_item_name": "Wall Thickness", "specification_content": "0.67 ~ 0.83 mm", "application_method": "Vernier Caliper", "normal_frequency": "n=5/lot", "ifm_frequency": "n=10/lot", "row_mode": "NUMERIC_SAMPLE", "html_input_type": "number", "sample_columns": ["S1", "S2", "S3", "S4", "S5"], "min_val": 0.67, "max_val": 0.83, "unit": "mm", "assigned_role": "supervisor"},
            {"serial_no": 5, "stage_name": "Product Flare", "control_item_name": "Bulge Outer Diameter", "specification_content": "7.90 ~ 8.00 mm", "application_method": "Vernier Caliper", "normal_frequency": "n=5/lot", "ifm_frequency": "n=10/lot", "row_mode": "NUMERIC_SAMPLE", "html_input_type": "number", "sample_columns": ["S1", "S2", "S3", "S4", "S5"], "min_val": 7.90, "max_val": 8.00, "unit": "mm", "assigned_role": "supervisor"},
            {"serial_no": 6, "stage_name": "Leak Testing", "control_item_name": "Helium Leak Check", "specification_content": "Leakage < 150 Pa at 490 kPa pressure", "application_method": "Leak Tester M/C", "normal_frequency": "100%", "ifm_frequency": "200%", "row_mode": "SERIAL_TICKBOX", "html_input_type": "checkbox", "sample_columns": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], "min_val": None, "max_val": None, "assigned_role": "operator"},
            {"serial_no": 7, "stage_name": "Remarks", "control_item_name": "Operator Observations", "specification_content": "Any process or tooling anomalies", "application_method": "Text entry", "normal_frequency": "Per Lot", "ifm_frequency": "Per Lot", "row_mode": "STANDARD_INPUT", "html_input_type": "text", "sample_columns": ["Notes"], "min_val": None, "max_val": None, "is_required": False, "assigned_role": "operator"},
        ]
        for it in t1_items:
            db.add(TemplateControlItem(
                sheet_id=t1_id,
                serial_no=it["serial_no"],
                stage_name=it["stage_name"],
                control_item_name=it["control_item_name"],
                specification_content=it["specification_content"],
                application_method=it.get("application_method"),
                normal_frequency=it.get("normal_frequency"),
                ifm_frequency=it.get("ifm_frequency"),
                row_mode=it["row_mode"],
                html_input_type=it["html_input_type"],
                sample_columns=it["sample_columns"],
                min_val=it.get("min_val"),
                max_val=it.get("max_val"),
                unit=it.get("unit"),
                assigned_role=it.get("assigned_role", "operator"),
                is_supervisor_checkpoint=False,
                is_required=it.get("is_required", True),
                display_order=it["serial_no"],
            ))

    # Template 2: PCB Final Visual Inspection (SH-PCB-01)
    t2_id = "SH-PCB-01"
    if not db.query(SheetTemplate).filter(SheetTemplate.sheet_id == t2_id).first():
        t2 = SheetTemplate(
            sheet_id=t2_id,
            document_title="PCB Final Visual Inspection",
            part_no="PCB-CB-700",
            part_name="Controller Board CB-7",
            model_name="CB-7 Control Unit",
            vendor_name="TAA Electronics Ltd.",
            customer_name="Auto OEM",
            part_category="MAIN PART",
            qr_code_value=f"TAA:SHEET:{t2_id}",
            barcode_value=f"TAA-{t2_id}",
            created_by=admin_user_id,
        )
        db.add(t2)
        db.flush()

        t2_items = [
            {"serial_no": 1, "stage_name": "Soldering", "control_item_name": "Solder joints", "specification_content": "Free from bridges, cold joints, and voids", "application_method": "Microscope", "row_mode": "STANDARD_INPUT", "html_input_type": "pf", "sample_columns": ["val"], "assigned_role": "operator"},
            {"serial_no": 2, "stage_name": "Assembly", "control_item_name": "Component orientation", "specification_content": "Polarized components correctly seated", "application_method": "Visual AOI", "row_mode": "STANDARD_INPUT", "html_input_type": "pf", "sample_columns": ["val"], "assigned_role": "operator"},
            {"serial_no": 3, "stage_name": "Coating", "control_item_name": "Conformal coating thickness", "specification_content": "25 - 75 µm", "application_method": "Eddy Current Gauge", "row_mode": "NUMERIC_SAMPLE", "html_input_type": "number", "sample_columns": ["val"], "min_val": 25.0, "max_val": 75.0, "unit": "µm", "assigned_role": "supervisor"},
            {"serial_no": 4, "stage_name": "Traceability", "control_item_name": "Label and traceability", "specification_content": "Serial label clean, legible and scanned", "application_method": "Visual / Scanner", "row_mode": "STANDARD_INPUT", "html_input_type": "pf", "sample_columns": ["val"], "assigned_role": "operator"},
            {"serial_no": 5, "stage_name": "Remarks", "control_item_name": "Operator remarks", "specification_content": "General assembly notes", "application_method": "Text entry", "row_mode": "STANDARD_INPUT", "html_input_type": "text", "sample_columns": ["val"], "is_required": False, "assigned_role": "operator"},
        ]
        for it in t2_items:
            db.add(TemplateControlItem(
                sheet_id=t2_id,
                serial_no=it["serial_no"],
                stage_name=it["stage_name"],
                control_item_name=it["control_item_name"],
                specification_content=it["specification_content"],
                application_method=it.get("application_method"),
                row_mode=it["row_mode"],
                html_input_type=it["html_input_type"],
                sample_columns=it["sample_columns"],
                min_val=it.get("min_val"),
                max_val=it.get("max_val"),
                unit=it.get("unit"),
                assigned_role=it.get("assigned_role", "operator"),
                is_supervisor_checkpoint=False,
                is_required=it.get("is_required", True),
                display_order=it["serial_no"],
            ))

    # Template 3: Casting Dimensional Check (SH-CAST-02)
    t3_id = "SH-CAST-02"
    if not db.query(SheetTemplate).filter(SheetTemplate.sheet_id == t3_id).first():
        t3 = SheetTemplate(
            sheet_id=t3_id,
            document_title="Casting Dimensional Check",
            part_no="CAST-PH-50",
            part_name="Pump housing PH-50",
            model_name="PH-50 Hydraulic Assembly",
            vendor_name="TAA Foundry Division",
            customer_name="Auto OEM",
            part_category="MAIN PART",
            qr_code_value=f"TAA:SHEET:{t3_id}",
            barcode_value=f"TAA-{t3_id}",
            created_by=admin_user_id,
        )
        db.add(t3)
        db.flush()

        t3_items = [
            {"serial_no": 1, "stage_name": "Machining", "control_item_name": "Outer diameter", "specification_content": "49.90 - 50.10 mm", "application_method": "Micrometer", "row_mode": "NUMERIC_SAMPLE", "html_input_type": "number", "sample_columns": ["val"], "min_val": 49.90, "max_val": 50.10, "unit": "mm", "assigned_role": "supervisor"},
            {"serial_no": 2, "stage_name": "Machining", "control_item_name": "Wall thickness", "specification_content": "4.80 - 5.20 mm", "application_method": "Ultrasonic Gauge", "row_mode": "NUMERIC_SAMPLE", "html_input_type": "number", "sample_columns": ["val"], "min_val": 4.80, "max_val": 5.20, "unit": "mm", "assigned_role": "supervisor"},
            {"serial_no": 3, "stage_name": "Foundry", "control_item_name": "Surface porosity", "specification_content": "Zero pinholes on sealing faces", "application_method": "Visual / Dye Penetrant", "row_mode": "STANDARD_INPUT", "html_input_type": "pf", "sample_columns": ["val"], "assigned_role": "operator"},
            {"serial_no": 4, "stage_name": "Deburring", "control_item_name": "Burr removal", "specification_content": "All parting lines completely deburred", "application_method": "Visual / Tactile", "row_mode": "STANDARD_INPUT", "html_input_type": "pf", "sample_columns": ["val"], "assigned_role": "operator"},
            {"serial_no": 5, "stage_name": "Remarks", "control_item_name": "Operator remarks", "specification_content": "General casting notes", "application_method": "Text entry", "row_mode": "STANDARD_INPUT", "html_input_type": "text", "sample_columns": ["val"], "is_required": False, "assigned_role": "operator"},
        ]
        for it in t3_items:
            db.add(TemplateControlItem(
                sheet_id=t3_id,
                serial_no=it["serial_no"],
                stage_name=it["stage_name"],
                control_item_name=it["control_item_name"],
                specification_content=it["specification_content"],
                application_method=it.get("application_method"),
                row_mode=it["row_mode"],
                html_input_type=it["html_input_type"],
                sample_columns=it["sample_columns"],
                min_val=it.get("min_val"),
                max_val=it.get("max_val"),
                unit=it.get("unit"),
                assigned_role=it.get("assigned_role", "operator"),
                is_supervisor_checkpoint=False,
                is_required=it.get("is_required", True),
                display_order=it["serial_no"],
            ))

    db.commit()
