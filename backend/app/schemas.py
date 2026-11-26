import math
import re
from datetime import datetime
from typing import Optional, List, Any, Dict
from pydantic import BaseModel, Field, field_validator

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

# Values the rest of the application already understands (see supervisor_workspace.py, the
# operator / checksheet screens and the report exports). Anything else would be saved but
# then ignored or mis-rendered, so it is rejected up front.
ROW_MODES = {"SERIAL_TICKBOX", "NUMERIC_SAMPLE", "STANDARD_INPUT"}
INPUT_TYPES = {"checkbox", "number", "text", "select", "radio", "date", "pf"}
ASSIGNED_ROLES = {"operator", "supervisor", "admin"}
PART_CATEGORIES = {"MAIN PART", "CHILD PART"}
MAX_SAMPLE_COLUMNS = 50
SHEET_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


def _clean(value: Optional[str]) -> Optional[str]:
    return value.strip() if isinstance(value, str) else value


class ControlItemCreate(ControlItemBase):
    """Input model for a template row. Validation lives here, not on the shared base, so that
    rows already stored (possibly from older versions) can still be returned by the API."""

    # Optional: present when the client is editing an existing row, so it is updated in place.
    item_id: Optional[int] = None

    @field_validator("stage_name", "control_item_name")
    @classmethod
    def _required_text(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("must not be empty")
        return v

    @field_validator("stage_name")
    @classmethod
    def _stage_len(cls, v: str) -> str:
        if len(v) > 100:
            raise ValueError("must be 100 characters or fewer")
        return v

    @field_validator("control_item_name")
    @classmethod
    def _name_len(cls, v: str) -> str:
        if len(v) > 255:
            raise ValueError("must be 255 characters or fewer")
        return v

    @field_validator("application_method")
    @classmethod
    def _method_len(cls, v: Optional[str]) -> Optional[str]:
        v = _clean(v)
        if v and len(v) > 100:
            raise ValueError("must be 100 characters or fewer")
        return v

    @field_validator("normal_frequency", "ifm_frequency")
    @classmethod
    def _freq_len(cls, v: Optional[str]) -> Optional[str]:
        v = _clean(v)
        if v and len(v) > 50:
            raise ValueError("must be 50 characters or fewer")
        return v

    @field_validator("row_mode")
    @classmethod
    def _row_mode(cls, v: str) -> str:
        if v not in ROW_MODES:
            raise ValueError(f"unsupported row mode '{v}'. Use one of: {', '.join(sorted(ROW_MODES))}")
        return v

    @field_validator("html_input_type")
    @classmethod
    def _input_type(cls, v: str) -> str:
        if v not in INPUT_TYPES:
            raise ValueError(f"unsupported input type '{v}'. Use one of: {', '.join(sorted(INPUT_TYPES))}")
        return v

    @field_validator("assigned_role")
    @classmethod
    def _role(cls, v: str) -> str:
        if v not in ASSIGNED_ROLES:
            raise ValueError(f"unsupported role '{v}'. Use one of: {', '.join(sorted(ASSIGNED_ROLES))}")
        return v

    @field_validator("sample_columns")
    @classmethod
    def _columns(cls, v: List[str], info) -> List[str]:
        cols = [str(c).strip() for c in v]
        if any(not c for c in cols):
            raise ValueError("sample column names must not be empty")
        if any(len(c) > 50 for c in cols):
            raise ValueError("sample column names must be 50 characters or fewer")
        if len(set(cols)) != len(cols):
            raise ValueError("sample column names must be unique")
        if len(cols) > MAX_SAMPLE_COLUMNS:
            raise ValueError(f"at most {MAX_SAMPLE_COLUMNS} samples are allowed")
        # Tick and numeric rows are filled per sample, so they need at least one column.
        if info.data.get("row_mode") in ("SERIAL_TICKBOX", "NUMERIC_SAMPLE") and not cols:
            raise ValueError("at least 1 sample is required")
        return cols

    @field_validator("min_val", "max_val")
    @classmethod
    def _finite(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not math.isfinite(v):
            raise ValueError("must be a finite number")
        return v

    @field_validator("max_val")
    @classmethod
    def _max_above_min(cls, v: Optional[float], info) -> Optional[float]:
        lo = info.data.get("min_val")
        if v is not None and lo is not None and lo >= v:
            raise ValueError("must be greater than the minimum")
        return v

    @field_validator("unit")
    @classmethod
    def _unit(cls, v: Optional[str]) -> Optional[str]:
        v = _clean(v)
        if not v:
            return None
        if len(v) > 30:
            raise ValueError("must be 30 characters or fewer")
        return v

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
    control_items: List[ControlItemCreate] = []

    @field_validator("sheet_id")
    @classmethod
    def _sheet_id(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("must not be empty")
        if len(v) > 64:
            raise ValueError("must be 64 characters or fewer")
        return v

    @field_validator("document_title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("must not be empty")
        if len(v) > 255:
            raise ValueError("must be 255 characters or fewer")
        return v

    @field_validator("part_no", "part_name", "model_name", "vendor_name", "customer_name")
    @classmethod
    def _optional_text(cls, v: Optional[str], info) -> Optional[str]:
        v = _clean(v)
        limit = 100 if info.field_name == "part_no" else 150
        if v and len(v) > limit:
            raise ValueError(f"must be {limit} characters or fewer")
        return v

    @field_validator("part_category")
    @classmethod
    def _category(cls, v: Optional[str]) -> Optional[str]:
        if v in (None, ""):
            return "MAIN PART"
        if v not in PART_CATEGORIES:
            raise ValueError(f"unsupported category '{v}'. Use one of: {', '.join(sorted(PART_CATEGORIES))}")
        return v

    @field_validator("control_items")
    @classmethod
    def _unique_item_ids(cls, v: List[ControlItemCreate]) -> List[ControlItemCreate]:
        ids = [i.item_id for i in v if i.item_id is not None]
        if len(ids) != len(set(ids)):
            raise ValueError("the same item_id appears more than once")
        return v

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
    sheet_id: str
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
    operator_clearance: Optional[str] = None
    operator_clearance_note: Optional[str] = None
    bad_item_count: int = 0  # items the operator marked bad (any check answered No)
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
    clearance: Optional[str] = None  # 'Lot cleared' | 'Cleared, NG items segregated' | 'Not cleared, hold the lot'
    clearance_note: Optional[str] = None

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
    kind: str = "info"
    severity: str = "info"
    is_read: bool = False
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class NotificationPage(BaseModel):
    items: List[NotificationResponse]
    total: int
    unread_total: int
    offset: int
    limit: int

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
    actor_name: Optional[str] = None
    actor_username: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AuditLogPage(BaseModel):
    items: List[AuditLogResponse]
    total: int
    page: int
    page_size: int

# --- QR Resolve ---
class QRResolveResponse(BaseModel):
    type: str  # 'BATCH' | 'TEMPLATE'
    sheet_id: str
    batch_id: Optional[int] = None
    read_only: bool = False
    status: Optional[str] = None
    format_detected: Optional[str] = "Plain code"
    data: Optional[Dict[str, Any]] = None


# --- Supervisor UI (ported LotSure prototype) ---
class SupervisorDispositionRequest(BaseModel):
    disposition: Optional[str] = None  # 'Approved' | 'On hold' | 'Rejected' | None (clear)

class SupervisorReadingRequest(BaseModel):
    item_id: int
    sample: str                     # sample column key, e.g. 'S1'
    value: Optional[float] = None   # None clears the reading

class SupervisorOosRequest(BaseModel):
    action: Optional[str] = None    # 'Re-measured, confirmed' | 'Lot put on hold' | 'Process adjusted'

class SupervisorCheckRequest(BaseModel):
    item_id: int
    sample: str                     # sample column key, e.g. 'S1'
    value: Optional[str] = None     # 'OK' | 'NG' | None (clear)

class SupervisorSpotRequest(BaseModel):
    r: Optional[str] = None         # 'OK' | 'NG' | None (remove the spot check)
    ng: List[str] = []              # check ids found wrong (r == 'NG')

class SupervisorSpotReadingRequest(BaseModel):
    item_id: int                    # dimension (template control item) id
    value: Optional[float] = None   # None clears the reading

class SupervisorItemRequest(BaseModel):
    ng: List[str] = []              # check ids the supervisor answered No (empty = all Yes)

class SupervisorCommentRequest(BaseModel):
    comment: Optional[str] = None
