from sqlalchemy.orm import Session
from backend.app.models import User, SheetTemplate, TemplateControlItem, InspectionBatch, BatchCellResponse
from backend.app.auth import hash_password

def seed_database(db: Session):
    # 1. Users
    existing_admin = db.query(User).filter(User.username == "admin").first()
    if not existing_admin:
        admin_user = User(
            username="admin",
            full_name="Shiva Datta (Admin)",
            password_hash=hash_password("admin123"),
            role="admin",
            is_active=True
        )
        db.add(admin_user)
        db.flush()
    else:
        existing_admin.is_active = True
        existing_admin.password_hash = hash_password("admin123")
        admin_user = existing_admin

    # Second Admin (Backup Admin Account)
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
    else:
        existing_admin2.is_active = True
        existing_admin2.password_hash = hash_password("admin123")

    existing_supervisor = db.query(User).filter(User.username == "supervisor").first()
    if not existing_supervisor:
        supervisor_user = User(
            username="supervisor",
            full_name="Sheetal (Supervisor)",
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
            full_name="Yuvraj (Operator)",
            password_hash=hash_password("oper123"),
            role="operator",
            is_active=True
        )
        db.add(operator_user)
        db.flush()
    else:
        operator_user = existing_operator

    # 2. Reference IFM Sheet Template
    template_id = "18351M62Q50-IFM"
    existing_template = db.query(SheetTemplate).filter(SheetTemplate.sheet_id == template_id).first()
    if not existing_template:
        template = SheetTemplate(
            sheet_id=template_id,
            document_title="DAILY INITIAL FLOW MANAGEMENT CONTROL ITEMS MONITORING CHECKSHEET (PRODUCT PARAMETER)",
            part_no="18351M62Q50",
            part_name="PIPE, PURGE LINE (RH)",
            model_name="YTA MC26 Fuel Line",
            vendor_name="Bundy India Ltd.",
            customer_name="MSIL",
            part_category="MAIN PART",
            qr_code_value=f"TAA:SHEET:{template_id}",
            barcode_value=f"TAA-{template_id}",
            created_by=admin_user.user_id
        )
        db.add(template)
        db.flush()

        # Control Items
        items_data = [
            {
                "serial_no": 1,
                "stage_name": "Appearance",
                "control_item_name": "Appearance & Coating Condition",
                "specification_content": "Be free from burr, scratch, rust, dent & damage",
                "application_method": "Visual",
                "normal_frequency": "100%",
                "ifm_frequency": "200%",
                "row_mode": "SERIAL_TICKBOX",
                "html_input_type": "checkbox",
                "sample_columns": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
                "min_val": None,
                "max_val": None,
                "assigned_role": "operator",
                "is_required": True,
                "display_order": 1,
            },
            {
                "serial_no": 2,
                "stage_name": "Product Inspection",
                "control_item_name": "QR Code / Label Marking",
                "specification_content": "QR code sticker appearance, legibility & correct placement",
                "application_method": "Visual",
                "normal_frequency": "100%",
                "ifm_frequency": "200%",
                "row_mode": "SERIAL_TICKBOX",
                "html_input_type": "checkbox",
                "sample_columns": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
                "min_val": None,
                "max_val": None,
                "assigned_role": "operator",
                "is_required": True,
                "display_order": 2,
            },
            {
                "serial_no": 3,
                "stage_name": "Leak Testing",
                "control_item_name": "Air Leakage Testing",
                "specification_content": "Leakage at 490 Kpa, <150 Pa pressure drop",
                "application_method": "M/C",
                "normal_frequency": "100%",
                "ifm_frequency": "200%",
                "row_mode": "SERIAL_TICKBOX",
                "html_input_type": "checkbox",
                "sample_columns": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
                "min_val": None,
                "max_val": None,
                "assigned_role": "operator",
                "is_required": True,
                "display_order": 3,
            },
            {
                "serial_no": 4,
                "stage_name": "10TSW PP",
                "control_item_name": "Tube Outer Dia",
                "specification_content": "07.97~8.17 mm",
                "application_method": "Micrometer",
                "normal_frequency": "n=5/lot",
                "ifm_frequency": "n=10/lot",
                "row_mode": "NUMERIC_SAMPLE",
                "html_input_type": "number",
                "sample_columns": ["S1", "S2", "S3", "S4", "S5"],
                "min_val": 7.97,
                "max_val": 8.17,
                "assigned_role": "operator",
                "is_required": True,
                "display_order": 4,
            },
            {
                "serial_no": 5,
                "stage_name": "10TSW PP",
                "control_item_name": "Wall Thickness",
                "specification_content": "0.67~0.83 mm",
                "application_method": "Micrometer",
                "normal_frequency": "n=5/lot",
                "ifm_frequency": "n=10/lot",
                "row_mode": "NUMERIC_SAMPLE",
                "html_input_type": "number",
                "sample_columns": ["S1", "S2", "S3", "S4", "S5"],
                "min_val": 0.67,
                "max_val": 0.83,
                "assigned_role": "operator",
                "is_required": True,
                "display_order": 5,
            },
            {
                "serial_no": 6,
                "stage_name": "Product Flare",
                "control_item_name": "Bulge Dia",
                "specification_content": "7.95±0.05 mm (7.90 ~ 8.00)",
                "application_method": "Vernier Caliper VC",
                "normal_frequency": "n=5/lot",
                "ifm_frequency": "n=10/lot",
                "row_mode": "NUMERIC_SAMPLE",
                "html_input_type": "number",
                "sample_columns": ["S1", "S2", "S3", "S4", "S5"],
                "min_val": 7.90,
                "max_val": 8.00,
                "assigned_role": "operator",
                "is_required": True,
                "display_order": 6,
            },
            {
                "serial_no": 7,
                "stage_name": "Product Flare",
                "control_item_name": "SQ-Dia (Single Quick Bead Dia)",
                "specification_content": "8.00±0.10 mm (7.90 ~ 8.10)",
                "application_method": "Vernier Caliper VC",
                "normal_frequency": "n=5/lot",
                "ifm_frequency": "n=10/lot",
                "row_mode": "NUMERIC_SAMPLE",
                "html_input_type": "number",
                "sample_columns": ["S1", "S2", "S3", "S4", "S5"],
                "min_val": 7.90,
                "max_val": 8.10,
                "assigned_role": "operator",
                "is_required": True,
                "display_order": 7,
            }
        ]

        created_items = []
        for d in items_data:
            item = TemplateControlItem(sheet_id=template_id, **d)
            db.add(item)
            created_items.append(item)
        db.flush()

        # 3. Create Sample Inspection Batch
        batch = InspectionBatch(
            sheet_id=template_id,
            lot_number="LOT-2026-495A",
            lot_quantity=495,
            inspection_mode="IFM",
            status="CREATED_PENDING_OPERATOR",
            prepared_by=operator_user.user_id
        )
        db.add(batch)
        db.flush()

    db.commit()
