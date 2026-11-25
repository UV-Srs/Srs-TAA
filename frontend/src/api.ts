import {
  User, SheetTemplate, InspectionBatch, CellResponse,
  QRResolveResult, OfflineMutation, InAppNotification
} from './types';

const API_BASE = '';

export interface ApiError extends Error {
  status?: number;
  /** The response's `detail` as sent: a string, `{message, errors}` (409) or a list of field errors (422). */
  detail?: unknown;
}

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('taa_jwt_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // Token missing or expired — clear session and force re-login
    localStorage.removeItem('taa_jwt_token');
    localStorage.removeItem('taa_user');
    window.location.href = '/';
    throw new Error('Session expired. Please log in again.');
  }

  if (!response.ok) {
    let errorDetail = 'API request failed';
    let rawDetail: unknown;
    try {
      const errorJson = await response.json();
      rawDetail = errorJson.detail;
      errorDetail = errorJson.detail?.message || errorJson.detail || JSON.stringify(errorJson);
    } catch {
      errorDetail = await response.text();
    }
    // Same Error and message as before, plus the structured detail (for example the list of
    // per-field validation errors) for callers that want to show it beside the right field.
    const error = new Error(typeof errorDetail === 'string' ? errorDetail : JSON.stringify(errorDetail)) as ApiError;
    error.status = response.status;
    error.detail = rawDetail;
    throw error;
  }

  return response.json();
}

// --- Auth ---
export async function loginUser(username: string, password: string): Promise<{ access_token: string; user: User }> {
  const res = await apiRequest<{ access_token: string; user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  localStorage.setItem('taa_jwt_token', res.access_token);
  localStorage.setItem('taa_user', JSON.stringify(res.user));
  return res;
}

export function getCurrentStoredUser(): User | null {
  const u = localStorage.getItem('taa_user');
  return u ? JSON.parse(u) : null;
}

export function logoutUser(): void {
  localStorage.removeItem('taa_jwt_token');
  localStorage.removeItem('taa_user');
}

// --- Users (FR-002, FR-005) ---
export async function fetchUsers(): Promise<User[]> {
  return apiRequest<User[]>('/api/admin/users');
}

export async function createUser(data: { username: string; full_name: string; password: string; role: string }): Promise<User> {
  return apiRequest<User>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deactivateUser(userId: number): Promise<{ success: boolean; message: string; purged_audit_logs_count: number }> {
  return apiRequest(`/api/admin/users/${userId}/deactivate`, { method: 'PATCH' });
}

export async function activateUser(userId: number): Promise<{ success: boolean; message: string }> {
  return apiRequest(`/api/admin/users/${userId}/activate`, { method: 'PATCH' });
}

export async function deleteUser(userId: number): Promise<{ success: boolean; message: string; purged_audit_logs_count: number }> {
  return apiRequest(`/api/admin/users/${userId}`, { method: 'DELETE' });
}

// --- Sheet Templates ---
export async function fetchSheets(): Promise<SheetTemplate[]> {
  return apiRequest<SheetTemplate[]>('/api/admin/sheets');
}

export async function fetchSheet(sheetId: string): Promise<SheetTemplate> {
  return apiRequest<SheetTemplate>(`/api/admin/sheets/${sheetId}`);
}

export async function createSheet(data: SheetTemplate): Promise<SheetTemplate> {
  return apiRequest<SheetTemplate>('/api/admin/sheets', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSheet(sheetId: string, data: SheetTemplate): Promise<SheetTemplate> {
  return apiRequest<SheetTemplate>(`/api/admin/sheets/${sheetId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// --- Batches ---
export async function fetchBatches(): Promise<InspectionBatch[]> {
  return apiRequest<InspectionBatch[]>('/api/batches');
}

export async function createBatch(data: {
  sheet_id: string;
  lot_number: string;
  product_name?: string;
  line_name?: string;
  lot_quantity?: number;
  inspection_mode?: string;
}): Promise<InspectionBatch> {
  return apiRequest<InspectionBatch>('/api/admin/batches', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function quickRegisterBatch(data: {
  code: string;
  sheet_id: string;
  product_name: string;
  line_name: string;
  lot_quantity: number;
}): Promise<InspectionBatch> {
  return apiRequest<InspectionBatch>('/api/admin/batches/quick-register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchBatchDetail(batchId: number): Promise<InspectionBatch> {
  return apiRequest<InspectionBatch>(`/api/batches/${batchId}`);
}

export async function openBatchWorkflow(batchId: number): Promise<InspectionBatch> {
  return apiRequest<InspectionBatch>(`/api/batches/${batchId}/open`, {
    method: 'POST',
  });
}

export async function updateCellResponse(batchId: number, data: { item_id: number; column_key: string; cell_value?: string | null; checker_initials?: string; client_mutation_id?: string }): Promise<any> {
  return apiRequest(`/api/batches/${batchId}/cell`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// --- Operator & Supervisor Decisions ---
export async function submitOperatorBatch(
  batchId: number,
  data: { decision: 'APPROVE' | 'REJECT'; rejected_item_ids?: number[]; rejected_field_names?: string[]; remarks?: string; cells: any[] }
): Promise<any> {
  return apiRequest(`/api/operator/batches/${batchId}/submit`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function reviewSingleField(
  batchId: number,
  field_key: string,
  review: 'confirm' | 'overrule'
): Promise<any> {
  return apiRequest(`/api/supervisor/batches/${batchId}/review-field`, {
    method: 'POST',
    body: JSON.stringify({ field_key, review }),
  });
}

export async function reviewSupervisorBatch(
  batchId: number,
  data: { decision: string; rejected_item_ids?: number[]; hold_reason?: string; hold_note?: string; hold_due_hours?: number; remarks?: string }
): Promise<any> {
  return apiRequest(`/api/supervisor/batches/${batchId}/review`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function releaseBatchHold(
  batchId: number,
  data: { outcome: 'approve' | 'reject' | 'reinspect'; release_note: string; rejected_item_ids?: number[] }
): Promise<any> {
  return apiRequest(`/api/batches/${batchId}/release-hold`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// --- Notifications ---
export async function fetchNotifications(limit: number = 50): Promise<InAppNotification[]> {
  return apiRequest<InAppNotification[]>(`/api/notifications?limit=${limit}`);
}

export async function markNotificationsRead(notificationId?: number): Promise<any> {
  return apiRequest('/api/notifications/mark-read', {
    method: 'POST',
    body: JSON.stringify({ notification_id: notificationId }),
  });
}

// --- Attachments / Photo Evidence ---
export async function uploadBatchAttachment(batchId: number, file: Blob, captureSource: 'TFT_CAMERA' | 'FILE_UPLOAD', itemId?: number): Promise<any> {
  const formData = new FormData();
  formData.append('file', file, `evidence_${Date.now()}.jpg`);
  formData.append('capture_source', captureSource);
  if (itemId) formData.append('item_id', itemId.toString());

  const token = localStorage.getItem('taa_jwt_token');
  const response = await fetch(`/api/batches/${batchId}/attachments`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(err || 'Failed to upload photo evidence');
  }
  return response.json();
}

// --- QR / Barcode ---
export async function resolveQR(code: string): Promise<QRResolveResult> {
  return apiRequest<QRResolveResult>(`/api/qr/resolve/${encodeURIComponent(code)}`);
}

export async function startInspectionFromTemplate(sheetId: string): Promise<{ batch_id: number }> {
  return apiRequest<{ batch_id: number }>(`/api/qr/templates/${encodeURIComponent(sheetId)}/start`, {
    method: 'POST',
  });
}

export async function fetchSheetQRCodes(sheetId: string): Promise<{
  sheet_id: string;
  document_title: string;
  part_no?: string;
  qr_code_value: string;
  barcode_value: string;
  qr_image_url: string;
  barcode_image_url: string;
}> {
  return apiRequest(`/api/qr/codes/${sheetId}`);
}

// --- Dashboard & Sync ---
export async function fetchProgressDashboard(): Promise<any> {
  return apiRequest('/api/admin/progress');
}

export async function fetchAuditLogs(): Promise<any[]> {
  return apiRequest<any[]>('/api/admin/audit-logs');
}

export async function syncOfflineQueue(mutations: OfflineMutation[]): Promise<any> {
  return apiRequest('/api/sync/offline-queue', {
    method: 'POST',
    body: JSON.stringify({ mutations }),
  });
}

export type BatchReportFormat = 'pdf' | 'xlsx' | 'csv';

export function getExportUrl(batchId: number, format: BatchReportFormat): string {
  return `/api/admin/batches/${batchId}/export?format=${format}`;
}

export function getCsvExportUrl(): string {
  return `/api/admin/export-csv`;
}

// --- Authenticated File Downloads ---
// Plain <a href> links cannot send the Bearer token, so report exports are
// fetched with the stored JWT and saved from a Blob instead.

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through to plain filename */
    }
  }
  const plain = /filename\s*=\s*("?)([^";]+)\1/i.exec(header);
  return plain ? plain[2].trim() : null;
}

export async function downloadAuthenticatedFile(path: string, fallbackFilename: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, { headers: getAuthHeader() });

  if (!response.ok) {
    let errorDetail = `Download failed (HTTP ${response.status})`;
    try {
      const errorJson = await response.json();
      errorDetail = errorJson.detail?.message || errorJson.detail || errorDetail;
    } catch {
      /* non-JSON error body; keep the generic message */
    }
    throw new Error(errorDetail);
  }

  const filename =
    parseContentDispositionFilename(response.headers.get('Content-Disposition')) || fallbackFilename;
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Give the browser time to start the save before releasing the Blob.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function downloadBatchReport(batchId: number, format: BatchReportFormat): Promise<void> {
  return downloadAuthenticatedFile(getExportUrl(batchId, format), `IFM_Checksheet_batch_${batchId}.${format}`);
}

export function downloadCsvReport(): Promise<void> {
  return downloadAuthenticatedFile(getCsvExportUrl(), 'ai-smart-scan-records.csv');
}

/** Click handler for existing report <a> links: keeps the markup, swaps in an authenticated download. */
export function handleReportDownloadClick(
  event: { preventDefault: () => void },
  download: () => Promise<void>
): void {
  event.preventDefault();
  download().catch((err: unknown) => {
    window.alert(`Report download failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

// Polling fallback: returns and clears the latest pending scan event for this user
export async function fetchPendingScan(): Promise<any | null> {
  const result = await apiRequest<{ scan: any | null }>('/api/qr/pending-scan', { method: 'GET' });
  return result.scan ?? null;
}
