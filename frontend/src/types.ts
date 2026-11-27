export type UserRole = 'admin' | 'supervisor' | 'operator';

export type BatchStatus =
  | 'CREATED_PENDING_OPERATOR'
  | 'OPERATOR_IN_PROGRESS'
  | 'OPERATOR_APPROVED'
  | 'OPERATOR_REJECTED'
  | 'SUPERVISOR_IN_PROGRESS'
  | 'ON_HOLD'
  | 'APPROVED'
  | 'REJECTED';

export interface User {
  user_id: number;
  username: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at?: string;
}

export interface ControlItem {
  item_id?: number;
  sheet_id?: string;
  serial_no: number;
  stage_name: string;
  control_item_name: string;
  specification_content: string;
  application_method?: string;
  normal_frequency?: string;
  ifm_frequency?: string;
  row_mode: 'SERIAL_TICKBOX' | 'NUMERIC_SAMPLE' | 'STANDARD_INPUT';
  html_input_type: 'checkbox' | 'number' | 'text' | 'select' | 'radio' | 'date' | 'pf';
  sample_columns: string[];
  min_val?: number | null;
  max_val?: number | null;
  unit?: string | null;
  assigned_role: UserRole;
  is_supervisor_checkpoint?: boolean;
  visible_to_operator: boolean;
  editable_by_operator: boolean;
  visible_to_supervisor: boolean;
  is_required: boolean;
  display_order: number;
}

export interface SheetTemplate {
  sheet_id: string;
  document_title: string;
  part_no?: string;
  part_name?: string;
  model_name?: string;
  vendor_name?: string;
  customer_name?: string;
  part_category?: string;
  qr_code_value?: string;
  barcode_value?: string;
  created_by?: number;
  created_at?: string;
  control_items: ControlItem[];
}

export interface CellResponse {
  response_id?: number;
  batch_id: number;
  item_id: number;
  column_key: string;
  cell_value?: string | null;
  is_within_spec: boolean;
  checker_initials?: string | null;
  entered_by?: number;
  client_mutation_id?: string;
  updated_at?: string;
}

export interface InspectionDecision {
  decision_id: number;
  batch_id: number;
  round: number;
  stage: string;  // 'Registered', 'Inspection', 'Review', 'Hold placed', 'Hold released'
  decided_by?: number;
  role: string;
  decision: string;
  rejected_fields?: string[] | null;
  rejected_item_ids?: number[];
  remarks?: string;
  decided_at?: string;
  decided_by_name?: string;
}

export interface InspectionAttachment {
  attachment_id: number;
  batch_id: number;
  item_id?: number;
  uploaded_by?: number;
  capture_source: 'TFT_CAMERA' | 'FILE_UPLOAD';
  file_path: string;
  file_name?: string;
  uploaded_at?: string;
}

export interface InspectionBatch {
  batch_id: number;
  sheet_id: string;
  lot_number: string;
  product_name?: string | null;
  line_name?: string;
  lot_quantity?: number;
  inspection_mode: 'NORMAL' | 'IFM';
  round: number;
  status: BatchStatus;
  operator_decision?: string | null;
  operator_rejected_fields?: any[] | null;
  supervisor_reviews?: Record<string, string>;
  hold_reason?: string | null;
  hold_note?: string | null;
  hold_by?: number | null;
  hold_at?: string | null;
  hold_due_at?: string | null;
  hold_alerted?: boolean;
  is_overdue?: boolean;
  operator_submitted_at?: string | null;
  supervisor_submitted_at?: string | null;
  prepared_by?: number;
  checked_by?: number;
  approved_by?: number;
  /** Operator's lot clearance, chosen on submit */
  operator_clearance?: string | null;
  operator_clearance_note?: string | null;
  /** Items the operator marked bad (any check answered No) */
  bad_item_count?: number;
  created_at?: string;
  updated_at?: string;
  template?: SheetTemplate;
  cell_responses?: CellResponse[];
  decisions?: InspectionDecision[];
  attachments?: InspectionAttachment[];
  prepared_user_name?: string | null;
  checked_user_name?: string | null;
  approved_user_name?: string | null;
  hold_user_name?: string | null;
}

export interface InAppNotification {
  notification_id: number;
  recipient_role?: string;
  recipient_user_id?: number;
  batch_id?: number;
  batch_code?: string;
  text: string;
  kind?: string;
  severity?: string;
  is_read: boolean;
  created_at: string;
}

export interface NotificationPage {
  items: InAppNotification[];
  total: number;
  unread_total: number;
  offset: number;
  limit: number;
}

export interface AuditLogEntry {
  log_id: number;
  user_id?: number | null;
  role?: string | null;
  action_type: string;
  sheet_id?: string | null;
  batch_id?: number | null;
  details?: Record<string, unknown> | null;
  actor_name?: string | null;
  actor_username?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at?: string | null;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
  page: number;
  page_size: number;
}

export interface AuditLogFilters {
  q?: string;
  role?: string;
  action_type?: string;
  date_from?: string;
  date_to?: string;
}

export interface QRResolveResult {
  type: 'BATCH' | 'TEMPLATE';
  sheet_id: string;
  batch_id?: number | null;
  read_only: boolean;
  status?: string;
  format_detected?: string;
  data?: any;
}

export interface OfflineMutation {
  client_mutation_id: string;
  batch_id: number;
  item_id: number;
  column_key: string;
  cell_value?: string | null;
  checker_initials?: string | null;
  timestamp: string;
}
