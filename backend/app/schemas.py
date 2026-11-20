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
    html_input_type: str = "checkbox"  # 'checkbox', 'number', 'text', 'select', 'radio', 'date'
    sample_columns: List[str] = []
    min_val: Optional[float] = None
    max_val: Optional[float] = None
    assigned_role: str = "operator"
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
    sheet_id: str  # Controlled by Admin (FR-009)
    document_title: str
    part_no: Optional[str] = None
    part_name: Optional[str] = None
    model_name: Optional[str] = None
    vendor_name: Optional[str] = None
    customer_name: Optional[str] = None
    part_category: Optional[str] = "MAIN PART"
    control_items: List[ControlItemCreate] = []

class SheetTemplateResponse(BaseModel):
    sheet_id: str
    document_title: str
    part_no: Optional[str]
    part_name: Optional[str]
    model_name: Optional[str]
    vendor_name: Optional[str]
    customer_name: Optional[str]
    part_category: Optional[str]
    qr_code_value: str
    barcode_value: str
    created_by: Optional[int]
    created_at: Optional[datetime]
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
    cell_value: Optional[str]
    is_within_spec: bool
    checker_initials: Optional[str]
    entered_by: Optional[int]
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True

# --- Batches ---
class BatchCreate(BaseModel):
    sheet_id: str
    lot_number: str
    lot_quantity: Optional[int] = 100
    inspection_mode: Optional[str] = "IFM"  # 'NORMAL' | 'IFM'

class DecisionResponse(BaseModel):
    decision_id: int
    decided_by: Optional[int]
    role: str
    decision: str
    rejected_item_ids: Optional[List[int]] = None
    remarks: Optional[str]
    decided_at: Optional[datetime]
    decided_by_name: Optional[str] = None

    class Config:
        from_attributes = True

class AttachmentResponse(BaseModel):
    attachment_id: int
    batch_id: int
    item_id: Optional[int]
    uploaded_by: Optional[int]
    capture_source: str
    file_path: str
    file_name: Optional[str]
    uploaded_at: Optional[datetime]

    class Config:
        from_attributes = True

class InspectionBatchResponse(BaseModel):
    batch_id: int
    sheet_id: str
    lot_number: str
    lot_quantity: Optional[int]
    inspection_mode: str
    status: str
    hold_reason: Optional[str]
    operator_submitted_at: Optional[datetime]
    supervisor_submitted_at: Optional[datetime]
    prepared_by: Optional[int]
    checked_by: Optional[int]
    approved_by: Optional[int]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
    template: Optional[SheetTemplateResponse] = None
    decisions: List[DecisionResponse] = []
    attachments: List[AttachmentResponse] = []
    prepared_user_name: Optional[str] = None
    checked_user_name: Optional[str] = None
    approved_user_name: Optional[str] = None

    class Config:
        from_attributes = True

class InspectionBatchDetail(InspectionBatchResponse):
    cell_responses: List[CellResponseView] = []

# --- Submissions & Reviews ---
class OperatorSubmitRequest(BaseModel):
    decision: str  # 'APPROVE' | 'REJECT'
    rejected_item_ids: Optional[List[int]] = []
    remarks: Optional[str] = None
    cells: List[CellResponseItem] = []

class SupervisorReviewRequest(BaseModel):
    decision: str  # 'APPROVE' | 'REJECT' | 'HOLD' | 'ACCEPT_REJECTION' | 'CONTINUE_REJECTION'
    rejected_item_ids: Optional[List[int]] = []
    hold_reason: Optional[str] = None
    remarks: Optional[str] = None

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
    user_id: Optional[int]
    role: Optional[str]
    action_type: str
    sheet_id: Optional[str]
    batch_id: Optional[int]
    details: Optional[Dict[str, Any]]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True

# --- QR Resolve ---
class QRResolveResponse(BaseModel):
    type: str  # 'BATCH' | 'TEMPLATE'
    sheet_id: str
    batch_id: Optional[int] = None
    read_only: bool = False
    status: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
