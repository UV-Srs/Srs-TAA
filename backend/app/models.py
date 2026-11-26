from datetime import datetime
from sqlalchemy import (
    Column, Integer, BigInteger, String, Text, Boolean, DateTime,
    ForeignKey, Float, JSON, UniqueConstraint
)
from sqlalchemy.orm import relationship
from backend.app.db_base import Base

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
    notifications = relationship("InAppNotification", back_populates="user", cascade="all, delete-orphan")

class SheetTemplate(Base):
    __tablename__ = "sheet_templates"

    sheet_id = Column(String(64), primary_key=True, index=True)  # Unique ID e.g. 18351M62Q50-IFM, SH-PCB-01
    document_title = Column(String(255), nullable=False)
    part_no = Column(String(100), nullable=True)
    part_name = Column(String(150), nullable=True)
    model_name = Column(String(150), nullable=True)
    vendor_name = Column(String(150), nullable=True)
    customer_name = Column(String(150), nullable=True)
    part_category = Column(String(50), default="MAIN PART")
    qr_code_value = Column(String(255), unique=True, nullable=False, index=True)
    barcode_value = Column(String(255), unique=True, nullable=False, index=True)
    external_barcode = Column(String(255), nullable=True)
    is_default = Column(Boolean, nullable=False, default=False)
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
    html_input_type = Column(String(30), nullable=False)  # 'checkbox', 'number', 'text', 'select', 'radio', 'date', 'pf'
    sample_columns = Column(JSON, nullable=False)  # e.g., ["1","2",..."30"] or ["S1","S2"] or ["val"]
    min_val = Column(Float, nullable=True)
    max_val = Column(Float, nullable=True)
    unit = Column(String(30), nullable=True)
    assigned_role = Column(String(20), nullable=False, default="operator")  # 'operator' | 'supervisor' | 'admin'
    is_supervisor_checkpoint = Column(Boolean, default=False)  # Highlighted checkpoint for Supervisor
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
    lot_number = Column(String(100), nullable=False, index=True)  # e.g., B-24117, LOT-2026-495A
    product_name = Column(String(150), nullable=True)
    line_name = Column(String(100), default="Line 1")
    lot_quantity = Column(Integer, nullable=True)
    inspection_mode = Column(String(30), default="IFM")
    round = Column(Integer, default=1)  # FR-058 Reinspection rounds
    status = Column(String(40), default="CREATED_PENDING_OPERATOR")
    # 'CREATED_PENDING_OPERATOR' (pending), 'OPERATOR_IN_PROGRESS' (op_progress),
    # 'OPERATOR_APPROVED' (op_approved), 'OPERATOR_REJECTED' (op_rejected),
    # 'SUPERVISOR_IN_PROGRESS' (sup_progress), 'ON_HOLD' (hold), 'APPROVED', 'REJECTED'

    # Operator decisions & rejections
    operator_decision = Column(String(30), nullable=True)  # 'Approved' | 'Rejected'
    operator_rejected_fields = Column(JSON, nullable=True)  # list of field item_ids or keys
    operator_submitted_at = Column(DateTime, nullable=True)
    prepared_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    # Operator's lot clearance on submit: 'Lot cleared' | 'Cleared, NG items segregated' | 'Not cleared, hold the lot'
    operator_clearance = Column(String(60), nullable=True)
    operator_clearance_note = Column(Text, nullable=True)

    # Supervisor reviews & decisions
    supervisor_reviews = Column(JSON, nullable=True)  # dict: {item_id/field_key: 'confirm' | 'overrule'}
    supervisor_submitted_at = Column(DateTime, nullable=True)
    checked_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    approved_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)

    # Hold specifications (FR-055, FR-056, FR-057)
    hold_reason = Column(String(100), nullable=True)
    hold_note = Column(Text, nullable=True)
    hold_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    hold_at = Column(DateTime, nullable=True)
    hold_due_at = Column(DateTime, nullable=True)
    hold_alerted = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    template = relationship("SheetTemplate", back_populates="batches")
    cell_responses = relationship("BatchCellResponse", back_populates="batch", cascade="all, delete-orphan")
    decisions = relationship("InspectionDecision", back_populates="batch", cascade="all, delete-orphan", order_by="InspectionDecision.decision_id")
    attachments = relationship("InspectionAttachment", back_populates="batch", cascade="all, delete-orphan")
    prepared_user = relationship("User", foreign_keys=[prepared_by])
    checked_user = relationship("User", foreign_keys=[checked_by])
    approved_user = relationship("User", foreign_keys=[approved_by])
    hold_user = relationship("User", foreign_keys=[hold_by])

class BatchCellResponse(Base):
    __tablename__ = "batch_cell_responses"

    response_id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(Integer, ForeignKey("inspection_batches.batch_id", ondelete="CASCADE"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("template_control_items.item_id", ondelete="CASCADE"), nullable=False, index=True)
    column_key = Column(String(50), nullable=False)  # '1', '2', 'S1', 'val', etc.
    cell_value = Column(Text, nullable=True)
    is_within_spec = Column(Boolean, default=True)
    checker_initials = Column(String(20), nullable=True)
    entered_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    client_mutation_id = Column(String(64), unique=True, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    batch = relationship("InspectionBatch", back_populates="cell_responses")
    item = relationship("TemplateControlItem", back_populates="cell_responses")
    user = relationship("User")

class InspectionDecision(Base):
    """
    FR-054 Sign-off record in the sheet:
    Tracks every round, stage (Inspection, Review, Hold placed, Hold released, Registered),
    deciding user, decision, timestamp, rejected fields, and note.
    """
    __tablename__ = "inspection_decisions"

    decision_id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(Integer, ForeignKey("inspection_batches.batch_id", ondelete="CASCADE"), nullable=False, index=True)
    round = Column(Integer, default=1)
    stage = Column(String(50), nullable=False, default="Review")  # 'Registered', 'Inspection', 'Review', 'Hold placed', 'Hold released'
    decided_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    role = Column(String(20), nullable=False)  # 'operator', 'supervisor', 'admin'
    decision = Column(String(50), nullable=False)  # 'Approved', 'Rejected', 'On hold', 'Sent for reinspection', 'Registered'
    rejected_fields = Column(JSON, nullable=True)  # list of string field names / item names
    rejected_item_ids = Column(JSON, nullable=True)
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

class InAppNotification(Base):
    """
    FR-052 & FR-053 In-App Notification System:
    Notifies users when batches are approved, rejected, put on hold, released, or overdue.
    """
    __tablename__ = "in_app_notifications"

    notification_id = Column(Integer, primary_key=True, autoincrement=True)
    recipient_role = Column(String(20), nullable=True)  # 'admin', 'supervisor', 'operator'
    recipient_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=True)
    batch_id = Column(Integer, ForeignKey("inspection_batches.batch_id", ondelete="CASCADE"), nullable=True)
    batch_code = Column(String(100), nullable=True)
    text = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="notifications")
    batch = relationship("InspectionBatch")

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

class SupervisorLotReview(Base):
    """
    Supervisor review state for one lot and inspection round (supervisor UI).
    Holds what inspection_batches has no field for: per-item decisions, the review
    lock, the out-of-spec action and the admin's reopen note.
    Added by migration 0001 (the baseline).
    """
    __tablename__ = "supervisor_lot_reviews"
    __table_args__ = (UniqueConstraint("batch_id", "round", name="uq_supervisor_lot_review_round"),)

    review_id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(Integer, ForeignKey("inspection_batches.batch_id", ondelete="CASCADE"), nullable=False, index=True)
    round = Column(Integer, nullable=False, default=1)
    # {sample column key: 'Approved' | 'On hold' | 'Rejected'} for the lot's bad items
    dispositions = Column(JSON, nullable=False, default=dict)
    locked_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    locked_at = Column(DateTime, nullable=True)
    # 'Re-measured, confirmed' | 'Lot put on hold' | 'Process adjusted'
    oos_action = Column(String(50), nullable=True)
    # Supervisor spot checks (prototype L.spot): {item column key: {"r": "OK"|"NG", "ng": [check ids]}}
    spot_checks = Column(JSON, nullable=True)
    # Supervisor's Yes/No answers where they differ from the operator's (saved on every tap):
    # {item column key: {"ng": [check ids answered No]}}. A good item with any No is rejected
    # by the supervisor. Migration 0003.
    item_answers = Column(JSON, nullable=True)
    # Supervisor comments for the report (prototype L.supComment)
    comment = Column(Text, nullable=True)
    reopen_note = Column(Text, nullable=True)
    reopened_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    reopened_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    batch = relationship("InspectionBatch")
    locked_user = relationship("User", foreign_keys=[locked_by])
