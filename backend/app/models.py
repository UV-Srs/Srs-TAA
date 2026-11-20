from datetime import datetime
from sqlalchemy import (
    Column, Integer, BigInteger, String, Text, Boolean, DateTime,
    ForeignKey, Float, JSON
)
from sqlalchemy.orm import relationship
from backend.app.database import Base

class User(Base):
    __tablename__ = "users"

    user_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    full_name = Column(String(150), nullable=False)
    password_hash = Column(Text, nullable=False)
    role = Column(String(20), nullable=False)  # 'admin', 'supervisor', 'operator'
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    audit_logs = relationship("AuditLog", back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    decisions = relationship("InspectionDecision", back_populates="user")
    attachments = relationship("InspectionAttachment", back_populates="user")

class SheetTemplate(Base):
    __tablename__ = "sheet_templates"

    sheet_id = Column(String(64), primary_key=True, index=True)  # Admin-controlled unique ID
    document_title = Column(String(255), nullable=False)
    part_no = Column(String(100), nullable=True)
    part_name = Column(String(150), nullable=True)
    model_name = Column(String(150), nullable=True)
    vendor_name = Column(String(150), nullable=True)
    customer_name = Column(String(150), nullable=True)
    part_category = Column(String(50), default="MAIN PART")  # 'MAIN PART' | 'CHILD PART'
    qr_code_value = Column(String(255), unique=True, nullable=False, index=True)
    barcode_value = Column(String(255), unique=True, nullable=False, index=True)
    created_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    control_items = relationship("TemplateControlItem", back_populates="template", cascade="all, delete-orphan", order_by="TemplateControlItem.display_order")
    batches = relationship("InspectionBatch", back_populates="template", cascade="all, delete-orphan")

class TemplateControlItem(Base):
    __tablename__ = "template_control_items"

    item_id = Column(Integer, primary_key=True, autoincrement=True)
    sheet_id = Column(String(64), ForeignKey("sheet_templates.sheet_id", ondelete="CASCADE"), nullable=False, index=True)
    serial_no = Column(Integer, nullable=False)
    stage_name = Column(String(100), nullable=False)
    control_item_name = Column(String(255), nullable=False)
    specification_content = Column(Text, nullable=False)
    application_method = Column(String(100), nullable=True)
    normal_frequency = Column(String(50), nullable=True)
    ifm_frequency = Column(String(50), nullable=True)
    row_mode = Column(String(30), nullable=False)  # 'SERIAL_TICKBOX' | 'NUMERIC_SAMPLE' | 'STANDARD_INPUT'
    html_input_type = Column(String(30), nullable=False)  # 'checkbox', 'number', 'text', 'select', 'radio', 'date'
    sample_columns = Column(JSON, nullable=False)  # e.g., ["1","2",..."30"] or ["S1","S2","S3","S4","S5"]
    min_val = Column(Float, nullable=True)
    max_val = Column(Float, nullable=True)
    assigned_role = Column(String(20), nullable=False, default="operator")  # 'operator' | 'supervisor' | 'admin'
    visible_to_operator = Column(Boolean, default=True)
    editable_by_operator = Column(Boolean, default=True)
    visible_to_supervisor = Column(Boolean, default=True)
    is_required = Column(Boolean, default=True)
    display_order = Column(Integer, default=0)

    # Relationships
    template = relationship("SheetTemplate", back_populates="control_items")
    cell_responses = relationship("BatchCellResponse", back_populates="item", cascade="all, delete-orphan")
    attachments = relationship("InspectionAttachment", back_populates="item")

class InspectionBatch(Base):
    __tablename__ = "inspection_batches"

    batch_id = Column(Integer, primary_key=True, autoincrement=True)
    sheet_id = Column(String(64), ForeignKey("sheet_templates.sheet_id", ondelete="CASCADE"), nullable=False, index=True)
    lot_number = Column(String(100), nullable=False)
    lot_quantity = Column(Integer, nullable=True)
    inspection_mode = Column(String(30), default="IFM")  # 'NORMAL' | 'IFM'
    status = Column(String(40), default="CREATED_PENDING_OPERATOR")
    # 'CREATED_PENDING_OPERATOR', 'OPERATOR_IN_PROGRESS', 'OPERATOR_APPROVED',
    # 'OPERATOR_REJECTED', 'SUPERVISOR_IN_PROGRESS', 'ON_HOLD', 'APPROVED', 'REJECTED'
    hold_reason = Column(Text, nullable=True)
    operator_submitted_at = Column(DateTime, nullable=True)
    supervisor_submitted_at = Column(DateTime, nullable=True)
    prepared_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    checked_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    approved_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    template = relationship("SheetTemplate", back_populates="batches")
    cell_responses = relationship("BatchCellResponse", back_populates="batch", cascade="all, delete-orphan")
    decisions = relationship("InspectionDecision", back_populates="batch", cascade="all, delete-orphan")
    attachments = relationship("InspectionAttachment", back_populates="batch", cascade="all, delete-orphan")
    prepared_user = relationship("User", foreign_keys=[prepared_by])
    checked_user = relationship("User", foreign_keys=[checked_by])
    approved_user = relationship("User", foreign_keys=[approved_by])

class BatchCellResponse(Base):
    __tablename__ = "batch_cell_responses"

    response_id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(Integer, ForeignKey("inspection_batches.batch_id", ondelete="CASCADE"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("template_control_items.item_id", ondelete="CASCADE"), nullable=False, index=True)
    column_key = Column(String(50), nullable=False)  # '1', '2', 'S1', 'S2', etc.
    cell_value = Column(Text, nullable=True)  # 'true'/'false' or numeric reading '8.04'
    is_within_spec = Column(Boolean, default=True)
    checker_initials = Column(String(20), nullable=True)  # e.g., 'MP', 'NA'
    entered_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    client_mutation_id = Column(String(64), unique=True, nullable=True)  # UUID for offline sync idempotency
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    batch = relationship("InspectionBatch", back_populates="cell_responses")
    item = relationship("TemplateControlItem", back_populates="cell_responses")
    user = relationship("User")

class InspectionDecision(Base):
    __tablename__ = "inspection_decisions"

    decision_id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(Integer, ForeignKey("inspection_batches.batch_id", ondelete="CASCADE"), nullable=False, index=True)
    decided_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    role = Column(String(20), nullable=False)  # 'operator', 'supervisor', 'admin'
    decision = Column(String(30), nullable=False)  # 'APPROVE', 'REJECT', 'HOLD', 'ACCEPT_REJECTION', 'CONTINUE_REJECTION'
    rejected_item_ids = Column(JSON, nullable=True)  # list of ints
    remarks = Column(Text, nullable=True)
    decided_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    batch = relationship("InspectionBatch", back_populates="decisions")
    user = relationship("User", back_populates="decisions")

class InspectionAttachment(Base):
    __tablename__ = "inspection_attachments"

    attachment_id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(Integer, ForeignKey("inspection_batches.batch_id", ondelete="CASCADE"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("template_control_items.item_id", ondelete="SET NULL"), nullable=True)
    uploaded_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    capture_source = Column(String(30), nullable=False)  # 'TFT_CAMERA' | 'FILE_UPLOAD'
    file_path = Column(Text, nullable=False)
    file_name = Column(String(255), nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    batch = relationship("InspectionBatch", back_populates="attachments")
    item = relationship("TemplateControlItem", back_populates="attachments")
    user = relationship("User", back_populates="attachments")

class AuditLog(Base):
    __tablename__ = "audit_logs"

    log_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=True, index=True)
    role = Column(String(20), nullable=True)
    action_type = Column(String(100), nullable=False)
    sheet_id = Column(String(64), nullable=True)
    batch_id = Column(Integer, nullable=True)
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="audit_logs")
