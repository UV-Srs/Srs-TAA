from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from backend.app.models import (
    User, SheetTemplate, TemplateControlItem, InspectionBatch,
    BatchCellResponse, InspectionDecision, InAppNotification, AuditLog
)
from backend.app.auth import hash_password

def seed_database(db: Session):
    now = datetime.utcnow()

    # 1. Users
    existing_admin = db.query(User).filter(User.username == "admin").first()
    if not existing_admin:
        admin_user = User(
            username="admin",
            full_name="Kiran Shah (Admin)",
            password_hash=hash_password("admin123"),
            role="admin",
            is_active=True
        )
        db.add(admin_user)
        db.flush()
    else:
        # Never overwrite an existing admin's password or reactivate a deactivated account on restart
        admin_user = existing_admin

    existing_admin2 = db.query(User).filter(User.username == "admin2").first()
    if not existing_admin2:
        admin2_user = User(
            username="admin2",
            full_name="System Administrator (Backup)",
            password_hash=hash_password("admin123"),
            role="admin",
            is_active=True
        )
        db.add(admin2_user)
        db.flush()

    existing_supervisor = db.query(User).filter(User.username == "supervisor").first()
    if not existing_supervisor:
        supervisor_user = User(
            username="supervisor",
            full_name="Meena Rao (Supervisor)",
            password_hash=hash_password("super123"),
            role="supervisor",
            is_active=True
        )
        db.add(supervisor_user)
        db.flush()
    else:
        supervisor_user = existing_supervisor

    existing_operator = db.query(User).filter(User.username == "operator").first()
    if not existing_operator:
        operator_user = User(
            username="operator",
            full_name="Ravi Kumar (Operator)",
            password_hash=hash_password("oper123"),
            role="operator",
            is_active=True
        )
        db.add(operator_user)
        db.flush()
    else:
        operator_user = existing_operator

    # 2. Template 1: Flagship IFM Checksheet (18351M62Q50-IFM)
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
            qr_code_value=f"TAA:SHEET:{t1_id}",
            barcode_value=f"TAA-{t1_id}",
            created_by=admin_user.user_id
        )
        db.add(t1)
        db.flush()

        t1_items = [
            {"serial_no": 1, "stage_name": "Appearance", "control_item_name": "Appearance & Coating Condition", "specification_content": "Be free from burr, scratch, rust, dent & damage", "application_method": "Visual", "normal_frequency": "100%", "ifm_frequency": "200%", "row_mode": "SERIAL_TICKBOX", "html_input_type": "checkbox", "sample_columns": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], "min_val": None, "max_val": None, "is_supervisor_checkpoint": False},
            {"serial_no": 2, "stage_name": "Appearance", "control_item_name": "QR Code Sticker Appearance", "specification_content": "QR sticker pasted properly & readable without smudge", "application_method": "Visual / Scanner", "normal_frequency": "100%", "ifm_frequency": "200%", "row_mode": "SERIAL_TICKBOX", "html_input_type": "checkbox", "sample_columns": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], "min_val": None, "max_val": None, "is_supervisor_checkpoint": True},
            {"serial_no": 3, "stage_name": "10TSW PP", "control_item_name": "Tube Outer Diameter (OD)", "specification_content": "07.97 ~ 08.17 mm", "application_method": "Micrometer", "normal_frequency": "n=5/lot", "ifm_frequency": "n=10/lot", "row_mode": "NUMERIC_SAMPLE", "html_input_type": "number", "sample_columns": ["S1", "S2", "S3", "S4", "S5"], "min_val": 7.97, "max_val": 8.17, "unit": "mm", "is_supervisor_checkpoint": True},
            {"serial_no": 4, "stage_name": "10TSW PP", "control_item_name": "Wall Thickness", "specification_content": "0.67 ~ 0.83 mm", "application_method": "Vernier Caliper", "normal_frequency": "n=5/lot", "ifm_frequency": "n=10/lot", "row_mode": "NUMERIC_SAMPLE", "html_input_type": "number", "sample_columns": ["S1", "S2", "S3", "S4", "S5"], "min_val": 0.67, "max_val": 0.83, "unit": "mm", "is_supervisor_checkpoint": False},
            {"serial_no": 5, "stage_name": "Product Flare", "control_item_name": "Bulge Outer Diameter", "specification_content": "7.90 ~ 8.00 mm", "application_method": "Vernier Caliper", "normal_frequency": "n=5/lot", "ifm_frequency": "n=10/lot", "row_mode": "NUMERIC_SAMPLE", "html_input_type": "number", "sample_columns": ["S1", "S2", "S3", "S4", "S5"], "min_val": 7.90, "max_val": 8.00, "unit": "mm", "is_supervisor_checkpoint": False},
            {"serial_no": 6, "stage_name": "Leak Testing", "control_item_name": "Helium Leak Check", "specification_content": "Leakage < 150 Pa at 490 kPa pressure", "application_method": "Leak Tester M/C", "normal_frequency": "100%", "ifm_frequency": "200%", "row_mode": "SERIAL_TICKBOX", "html_input_type": "checkbox", "sample_columns": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], "min_val": None, "max_val": None, "is_supervisor_checkpoint": True},
            {"serial_no": 7, "stage_name": "Remarks", "control_item_name": "Operator Observations", "specification_content": "Any process or tooling anomalies", "application_method": "Text entry", "normal_frequency": "Per Lot", "ifm_frequency": "Per Lot", "row_mode": "STANDARD_INPUT", "html_input_type": "text", "sample_columns": ["Notes"], "min_val": None, "max_val": None, "is_required": False, "is_supervisor_checkpoint": False}
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
                assigned_role="operator",
                is_supervisor_checkpoint=it.get("is_supervisor_checkpoint", False),
                is_required=it.get("is_required", True),
                display_order=it["serial_no"]
            ))

    # 3. Template 2: PCB Final Visual Inspection (SH-PCB-01)
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
            created_by=admin_user.user_id
        )
        db.add(t2)
        db.flush()

        t2_items = [
            {"serial_no": 1, "stage_name": "Soldering", "control_item_name": "Solder joints", "specification_content": "Free from bridges, cold joints, and voids", "application_method": "Microscope", "row_mode": "STANDARD_INPUT", "html_input_type": "pf", "sample_columns": ["val"], "is_supervisor_checkpoint": False},
            {"serial_no": 2, "stage_name": "Assembly", "control_item_name": "Component orientation", "specification_content": "Polarized components correctly seated", "application_method": "Visual AOI", "row_mode": "STANDARD_INPUT", "html_input_type": "pf", "sample_columns": ["val"], "is_supervisor_checkpoint": False},
            {"serial_no": 3, "stage_name": "Coating", "control_item_name": "Conformal coating thickness", "specification_content": "25 - 75 µm", "application_method": "Eddy Current Gauge", "row_mode": "NUMERIC_SAMPLE", "html_input_type": "number", "sample_columns": ["val"], "min_val": 25.0, "max_val": 75.0, "unit": "µm", "is_supervisor_checkpoint": False},
            {"serial_no": 4, "stage_name": "Traceability", "control_item_name": "Label and traceability", "specification_content": "Serial label clean, legible and scanned", "application_method": "Visual / Scanner", "row_mode": "STANDARD_INPUT", "html_input_type": "pf", "sample_columns": ["val"], "is_supervisor_checkpoint": True},
            {"serial_no": 5, "stage_name": "Remarks", "control_item_name": "Operator remarks", "specification_content": "General assembly notes", "application_method": "Text entry", "row_mode": "STANDARD_INPUT", "html_input_type": "text", "sample_columns": ["val"], "is_required": False, "is_supervisor_checkpoint": False}
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
                is_supervisor_checkpoint=it.get("is_supervisor_checkpoint", False),
                is_required=it.get("is_required", True),
                display_order=it["serial_no"]
            ))

    # 4. Template 3: Casting Dimensional Check (SH-CAST-02)
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
            created_by=admin_user.user_id
        )
        db.add(t3)
        db.flush()

        t3_items = [
            {"serial_no": 1, "stage_name": "Machining", "control_item_name": "Outer diameter", "specification_content": "49.90 - 50.10 mm", "application_method": "Micrometer", "row_mode": "NUMERIC_SAMPLE", "html_input_type": "number", "sample_columns": ["val"], "min_val": 49.90, "max_val": 50.10, "unit": "mm", "is_supervisor_checkpoint": True},
            {"serial_no": 2, "stage_name": "Machining", "control_item_name": "Wall thickness", "specification_content": "4.80 - 5.20 mm", "application_method": "Ultrasonic Gauge", "row_mode": "NUMERIC_SAMPLE", "html_input_type": "number", "sample_columns": ["val"], "min_val": 4.80, "max_val": 5.20, "unit": "mm", "is_supervisor_checkpoint": False},
            {"serial_no": 3, "stage_name": "Foundry", "control_item_name": "Surface porosity", "specification_content": "Zero pinholes on sealing faces", "application_method": "Visual / Dye Penetrant", "row_mode": "STANDARD_INPUT", "html_input_type": "pf", "sample_columns": ["val"], "is_supervisor_checkpoint": True},
            {"serial_no": 4, "stage_name": "Deburring", "control_item_name": "Burr removal", "specification_content": "All parting lines completely deburred", "application_method": "Visual / Tactile", "row_mode": "STANDARD_INPUT", "html_input_type": "pf", "sample_columns": ["val"], "is_supervisor_checkpoint": False},
            {"serial_no": 5, "stage_name": "Remarks", "control_item_name": "Operator remarks", "specification_content": "General casting notes", "application_method": "Text entry", "row_mode": "STANDARD_INPUT", "html_input_type": "text", "sample_columns": ["val"], "is_required": False, "is_supervisor_checkpoint": False}
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
                is_supervisor_checkpoint=it.get("is_supervisor_checkpoint", False),
                is_required=it.get("is_required", True),
                display_order=it["serial_no"]
            ))

    db.flush()

    # 5. Seed POC Batches
    # Batch B-24117 (Pending Operator on Line 2)
    b1 = db.query(InspectionBatch).filter(InspectionBatch.lot_number == "B-24117").first()
    if not b1:
        b1 = InspectionBatch(
            sheet_id=t2_id,
            lot_number="B-24117",
            product_name="Controller board CB-7",
            line_name="Line 2",
            lot_quantity=480,
            status="CREATED_PENDING_OPERATOR",
            round=1,
            created_at=now - timedelta(hours=2)
        )
        db.add(b1)

    # Batch B-24118 (Pending Operator on Line 2)
    b2 = db.query(InspectionBatch).filter(InspectionBatch.lot_number == "B-24118").first()
    if not b2:
        b2 = InspectionBatch(
            sheet_id=t2_id,
            lot_number="B-24118",
            product_name="Controller board CB-7",
            line_name="Line 2",
            lot_quantity=500,
            status="CREATED_PENDING_OPERATOR",
            round=1,
            created_at=now - timedelta(hours=1)
        )
        db.add(b2)

    # Batch B-24119 (Operator Rejected, with Supervisor for Review)
    b3 = db.query(InspectionBatch).filter(InspectionBatch.lot_number == "B-24119").first()
    if not b3:
        b3 = InspectionBatch(
            sheet_id=t3_id,
            lot_number="B-24119",
            product_name="Pump housing PH-50",
            line_name="Line 4",
            lot_quantity=120,
            status="OPERATOR_REJECTED",
            round=1,
            operator_decision="Rejected",
            operator_rejected_fields=["Surface porosity"],
            operator_submitted_at=now - timedelta(minutes=40),
            prepared_by=operator_user.user_id,
            created_at=now - timedelta(hours=3)
        )
        db.add(b3)
        db.flush()

        # Add cells for B-24119
        cast_items = db.query(TemplateControlItem).filter(TemplateControlItem.sheet_id == t3_id).all()
        for ci in cast_items:
            val = "50.02" if ci.control_item_name == "Outer diameter" else ("4.96" if ci.control_item_name == "Wall thickness" else ("Fail" if ci.control_item_name == "Surface porosity" else ("Pass" if ci.control_item_name == "Burr removal" else "Pin holes near gate")))
            is_ok = False if ci.control_item_name == "Surface porosity" else True
            db.add(BatchCellResponse(
                batch_id=b3.batch_id,
                item_id=ci.item_id,
                column_key="val",
                cell_value=val,
                is_within_spec=is_ok,
                entered_by=operator_user.user_id
            ))

        # Sign-off record for B-24119
        db.add(InspectionDecision(
            batch_id=b3.batch_id,
            round=1,
            stage="Inspection",
            decided_by=operator_user.user_id,
            role="operator",
            decision="Rejected",
            rejected_fields=["Surface porosity"],
            remarks="Pin holes near gate",
            decided_at=now - timedelta(minutes=40)
        ))

    # Batch B-24120 (On Hold, Overdue)
    b4 = db.query(InspectionBatch).filter(InspectionBatch.lot_number == "B-24120").first()
    if not b4:
        b4 = InspectionBatch(
            sheet_id=t2_id,
            lot_number="B-24120",
            product_name="Controller board CB-7",
            line_name="Line 1",
            lot_quantity=450,
            status="ON_HOLD",
            round=1,
            operator_decision="Approved",
            operator_submitted_at=now - timedelta(hours=7),
            prepared_by=operator_user.user_id,
            hold_reason="Awaiting lab or test result",
            hold_note="X-ray sample sent to lab for void check",
            hold_by=supervisor_user.user_id,
            hold_at=now - timedelta(hours=6),
            hold_due_at=now - timedelta(hours=2),  # 2 hours overdue!
            hold_alerted=True,
            created_at=now - timedelta(hours=8)
        )
        db.add(b4)
        db.flush()

        # Sign-off records for B-24120
        db.add(InspectionDecision(
            batch_id=b4.batch_id,
            round=1,
            stage="Inspection",
            decided_by=operator_user.user_id,
            role="operator",
            decision="Approved",
            decided_at=now - timedelta(hours=7)
        ))
        db.add(InspectionDecision(
            batch_id=b4.batch_id,
            round=1,
            stage="Hold placed",
            decided_by=supervisor_user.user_id,
            role="supervisor",
            decision="On hold",
            remarks="Awaiting lab or test result: X-ray sample sent to lab for void check",
            decided_at=now - timedelta(hours=6)
        ))

    # Batch B-24112 (Approved & Finalized)
    b5 = db.query(InspectionBatch).filter(InspectionBatch.lot_number == "B-24112").first()
    if not b5:
        b5 = InspectionBatch(
            sheet_id=t3_id,
            lot_number="B-24112",
            product_name="Pump housing PH-50",
            line_name="Line 4",
            lot_quantity=120,
            status="APPROVED",
            round=1,
            operator_decision="Approved",
            operator_submitted_at=now - timedelta(hours=26),
            prepared_by=operator_user.user_id,
            supervisor_submitted_at=now - timedelta(hours=25),
            checked_by=supervisor_user.user_id,
            approved_by=supervisor_user.user_id,
            created_at=now - timedelta(hours=28)
        )
        db.add(b5)
        db.flush()

        db.add(InspectionDecision(
            batch_id=b5.batch_id,
            round=1,
            stage="Inspection",
            decided_by=operator_user.user_id,
            role="operator",
            decision="Approved",
            decided_at=now - timedelta(hours=26)
        ))
        db.add(InspectionDecision(
            batch_id=b5.batch_id,
            round=1,
            stage="Review",
            decided_by=supervisor_user.user_id,
            role="supervisor",
            decision="Approved",
            decided_at=now - timedelta(hours=25)
        ))

    # Flagship batch LOT-2026-495A
    b_flag = db.query(InspectionBatch).filter(InspectionBatch.lot_number == "LOT-2026-495A").first()
    if not b_flag:
        b_flag = InspectionBatch(
            sheet_id=t1_id,
            lot_number="LOT-2026-495A",
            product_name="PIPE, PURGE LINE (RH)",
            line_name="Line 1",
            lot_quantity=495,
            status="OPERATOR_IN_PROGRESS",
            round=1,
            created_at=now - timedelta(minutes=30)
        )
        db.add(b_flag)

    # 6. Seed In-App Notifications
    existing_notifs = db.query(InAppNotification).count()
    if existing_notifs == 0:
        db.add(InAppNotification(
            recipient_role="supervisor",
            batch_code="B-24119",
            text="Ravi Kumar rejected B-24119 (Casting dimensional check). Rejected: Surface porosity.",
            is_read=False,
            created_at=now - timedelta(minutes=40)
        ))
        db.add(InAppNotification(
            recipient_role="admin",
            batch_code="B-24119",
            text="Ravi Kumar rejected B-24119 (Casting dimensional check). Rejected: Surface porosity.",
            is_read=False,
            created_at=now - timedelta(minutes=40)
        ))
        db.add(InAppNotification(
            recipient_role="admin",
            batch_code="B-24120",
            text="Hold on B-24120 is overdue. Reason: Awaiting lab or test result.",
            is_read=False,
            created_at=now - timedelta(hours=2)
        ))

    db.commit()
