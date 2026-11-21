from datetime import datetime
from typing import Optional, List, Any, Dict
from pydantic import BaseModel, Field

# --- User & Auth ---
class UserLogin(BaseModel):
    username: str
    password: str

class UserCreate(BaseModel):
    username: str
    full_name: str
    password: str
    role: str  # 'admin', 'supervisor', 'operator'

class UserResponse(BaseModel):
    user_id: int
    username: str
    full_name: str
    role: str
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

# --- Template Control Item ---
class ControlItemBase(BaseModel):
    serial_no: int
    stage_name: str
    control_item_name: str
    specification_content: str
    application_method: Optional[str] = "Visual"
    normal_frequency: Optional[str] = "100%"
    ifm_frequency: Optional[str] = "200%"
    row_mode: str = "SERIAL_TICKBOX"  # 'SERIAL_TICKBOX' | 'NUMERIC_SAMPLE' | 'STANDARD_INPUT'
    html_input_type: str = "checkbox"  # 'checkbox', 'number', 'text', 'select', 'radio', 'date', 'pf'
    sample_columns: List[str] = []
    min_val: Optional[float] = None
    max_val: Optional[float] = None
    unit: Optional[str] = None
    assigned_role: str = "operator"
    is_supervisor_checkpoint: bool = False
    visible_to_operator: bool = True
    editable_by_operator: bool = True
    visible_to_supervisor: bool = True
    is_required: bool = True
    display_order: int = 0

class ControlItemCreate(ControlItemBase):
    pass

class ControlItemResponse(ControlItemBase):
    item_id: int
    sheet_id: str

    class Config:
        from_attributes = True

# --- Sheet Template ---
class SheetTemplateCreate(BaseModel):
    sheet_id: str
    document_title: str
    part_no: Optional[str] = None
    part_name: Optional[str] = None
    model_name: Optional[str] = None
    vendor_name: Optional[str] = None
    customer_name: Optional[str] = None
    part_category: Optional[str] = "MAIN PART"
    external_barcode: Optional[str] = None
    control_items: List[ControlItemCreate] = []

class SheetTemplateResponse(BaseModel):
    sheet_id: str
    document_title: str
    part_no: Optional[str] = None
    part_name: Optional[str] = None
    model_name: Optional[str] = None
    vendor_name: Optional[str] = None
    customer_name: Optional[str] = None
    part_category: Optional[str] = "MAIN PART"
    qr_code_value: str
    barcode_value: str
    external_barcode: Optional[str] = None
    is_default: bool = False
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None
    control_items: List[ControlItemResponse] = []

    class Config:
        from_attributes = True

# --- Cell Responses ---
class CellResponseItem(BaseModel):
    item_id: int
    column_key: str
    cell_value: Optional[str] = None
    checker_initials: Optional[str] = None
    client_mutation_id: Optional[str] = None

class CellResponseView(BaseModel):
    response_id: int
    batch_id: int
    item_id: int
    column_key: str
    cell_value: Optional[str] = None
    is_within_spec: bool = True
    checker_initials: Optional[str] = None
    entered_by: Optional[int] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# --- Batches ---
class BatchCreate(BaseModel):
    sheet_id: str
    lot_number: str
    product_name: Optional[str] = None
    line_name: Optional[str] = "Line 1"
    lot_quantity: Optional[int] = 100
    inspection_mode: Optional[str] = "IFM"

class QuickBatchRegisterRequest(BaseModel):
    code: str
    sheet_id: Optional[str] = None  # if omitted, the default/active template is used
    product_name: str
    line_name: str
    lot_quantity: int

class DecisionResponse(BaseModel):
    decision_id: int
    round: int = 1
    stage: str = "Review"
    decided_by: Optional[int] = None
    role: str
    decision: str
    rejected_fields: Optional[List[str]] = None
    rejected_item_ids: Optional[List[int]] = None
    remarks: Optional[str] = None
    decided_at: Optional[datetime] = None
    decided_by_name: Optional[str] = None

    class Config:
        from_attributes = True

class AttachmentResponse(BaseModel):
    attachment_id: int
    batch_id: int
    item_id: Optional[int] = None
    uploaded_by: Optional[int] = None
    capture_source: str
    file_path: str
    file_name: Optional[str] = None
    uploaded_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class InspectionBatchResponse(BaseModel):
    batch_id: int
    sheet_id: str
    lot_number: str
    product_name: Optional[str] = None
    line_name: Optional[str] = "Line 1"
    lot_quantity: Optional[int] = None
    inspection_mode: str = "IFM"
    round: int = 1
    status: str
    operator_decision: Optional[str] = None
    operator_rejected_fields: Optional[List[Any]] = None
    supervisor_reviews: Optional[Dict[str, str]] = None
    hold_reason: Optional[str] = None
    hold_note: Optional[str] = None
    hold_by: Optional[int] = None
    hold_at: Optional[datetime] = None
    hold_due_at: Optional[datetime] = None
    hold_alerted: bool = False
    is_overdue: bool = False
    operator_submitted_at: Optional[datetime] = None
    supervisor_submitted_at: Optional[datetime] = None
    prepared_by: Optional[int] = None
    checked_by: Optional[int] = None
    approved_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    template: Optional[SheetTemplateResponse] = None
    decisions: List[DecisionResponse] = []
    attachments: List[AttachmentResponse] = []
    prepared_user_name: Optional[str] = None
    checked_user_name: Optional[str] = None
    approved_user_name: Optional[str] = None
    hold_user_name: Optional[str] = None

    class Config:
        from_attributes = True

class InspectionBatchDetail(InspectionBatchResponse):
    cell_responses: List[CellResponseView] = []

# --- Submissions, Reviews & Holds ---
class OperatorSubmitRequest(BaseModel):
    decision: str  # 'APPROVE' | 'REJECT'
    rejected_item_ids: Optional[List[int]] = []
    rejected_field_names: Optional[List[str]] = []
    remarks: Optional[str] = None
    cells: List[CellResponseItem] = []

class SupervisorFieldReviewRequest(BaseModel):
    field_key: str
    review: str  # 'confirm' | 'overrule'

class SupervisorReviewRequest(BaseModel):
    decision: str  # 'APPROVE' | 'REJECT' | 'HOLD' | 'ACCEPT_REJECTION' | 'CONTINUE_REJECTION'
    rejected_item_ids: Optional[List[int]] = []
    hold_reason: Optional[str] = None
    hold_note: Optional[str] = None
    hold_due_hours: Optional[int] = 4
    remarks: Optional[str] = None

class HoldReleaseRequest(BaseModel):
    outcome: str  # 'approve' | 'reject' | 'reinspect'
    release_note: str
    rejected_item_ids: Optional[List[int]] = []

# --- Notifications ---
class NotificationResponse(BaseModel):
    notification_id: int
    recipient_role: Optional[str] = None
    recipient_user_id: Optional[int] = None
    batch_id: Optional[int] = None
    batch_code: Optional[str] = None
    text: str
    is_read: bool = False
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# --- Offline Sync ---
class OfflineSyncMutation(BaseModel):
    client_mutation_id: str
    batch_id: int
    item_id: int
    column_key: str
    cell_value: Optional[str] = None
    checker_initials: Optional[str] = None
    timestamp: Optional[str] = None

class OfflineSyncPayload(BaseModel):
    mutations: List[OfflineSyncMutation] = []
    decisions: Optional[List[Dict[str, Any]]] = []

# --- Audit Logs ---
class AuditLogResponse(BaseModel):
    log_id: int
    user_id: Optional[int] = None
    role: Optional[str] = None
    action_type: str
    sheet_id: Optional[str] = None
    batch_id: Optional[int] = None
    details: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# --- QR Resolve ---
class QRResolveResponse(BaseModel):
    type: str  # 'BATCH' | 'TEMPLATE'
    sheet_id: str
    batch_id: Optional[int] = None
    read_only: bool = False
    status: Optional[str] = None
    format_detected: Optional[str] = "Plain code"
    data: Optional[Dict[str, Any]] = None
