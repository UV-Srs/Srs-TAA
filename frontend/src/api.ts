import {
  User, SheetTemplate, InspectionBatch, CellResponse,
  QRResolveResult, OfflineMutation, InAppNotification, PartBarcodeInfo
} from './types';

const API_BASE = '';

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('taa_jwt_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Listeners notified when any request returns 401 (token expired / logged out elsewhere)
const _authErrorListeners: Array<() => void> = [];
export function onAuthError(cb: () => void): () => void {
  _authErrorListeners.push(cb);
  return () => { const i = _authErrorListeners.indexOf(cb); if (i !== -1) _authErrorListeners.splice(i, 1); };
}
function _fireAuthError() { _authErrorListeners.forEach(fn => fn()); }

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

  if (!response.ok) {
    // On 401 — token expired or user logged out elsewhere; clear local session.
    // Exclude the login endpoint itself — a wrong password returns 401 but must not
    // wipe an existing session that's open in another tab.
    if (response.status === 401 && !path.endsWith('/api/auth/login')) {
      localStorage.removeItem('taa_jwt_token');
      localStorage.removeItem('taa_user');
      _fireAuthError();
    }
    let errorDetail = 'API request failed';
    try {
      const errorJson = await response.json();
      errorDetail = errorJson.detail?.message || errorJson.detail || JSON.stringify(errorJson);
    } catch {
      errorDetail = await response.text();
    }
    throw new Error(errorDetail);
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
  const raw = localStorage.getItem('taa_user');
  if (!raw) return null;
  let stored: User;
  try {
    stored = JSON.parse(raw);
  } catch {
    localStorage.removeItem('taa_user');
    localStorage.removeItem('taa_jwt_token');
    return null;
  }

  // Derive role from the JWT payload so a tampered localStorage user object
  // cannot escalate UI privileges — the backend still enforces via JWT claims,
  // but this closes the gap where admin-only tabs would appear after a local edit.
  const token = localStorage.getItem('taa_jwt_token');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload?.role) stored.role = payload.role;
    } catch {
      // malformed token — force logout on next API call which will 401
    }
  }
  return stored;
}

export function logoutUser(): void {
  localStorage.removeItem('taa_jwt_token');
  localStorage.removeItem('taa_user');
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string; new_token?: string }> {
  return apiRequest('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
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

export async function patchControlItemRole(
  sheetId: string,
  itemId: number,
  role: 'operator' | 'supervisor'
): Promise<{ item_id: number; assigned_role: string }> {
  return apiRequest(`/api/admin/sheets/${sheetId}/items/${itemId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ assigned_role: role }),
  });
}

export async function setDefaultSheet(sheetId: string): Promise<SheetTemplate> {
  return apiRequest<SheetTemplate>(`/api/admin/sheets/${sheetId}/set-default`, { method: 'PATCH' });
}

export async function deleteSheet(sheetId: string): Promise<{ success: boolean; batches_deleted: number }> {
  return apiRequest(`/api/admin/sheets/${sheetId}`, { method: 'DELETE' });
}

export async function deleteBatch(batchId: number): Promise<{ success: boolean; batch_id: number; lot_number: string }> {
  return apiRequest(`/api/admin/batches/${batchId}`, { method: 'DELETE' });
}

export async function getDefaultSheet(): Promise<SheetTemplate | null> {
  try {
    return await apiRequest<SheetTemplate>('/api/admin/sheets/default');
  } catch {
    return null;
  }
}

// --- Batches ---
export async function fetchBatches(search?: string): Promise<InspectionBatch[]> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  return apiRequest<InspectionBatch[]>(`/api/batches${qs}`);
}

export async function createBatch(data: {
  sheet_id: string;
  lot_number: string;
  product_name?: string;
  line_name?: string;
  lot_quantity?: number;
  inspection_mode?: string;
  link_barcode?: string;
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

export async function fetchPendingScan(): Promise<any | null> {
  return apiRequest<any | null>('/api/qr/pending-scan');
}

export async function fetchBatchQRCodes(batchId: number): Promise<{
  batch_id: number;
  lot_number: string;
  sheet_id: string;
  product_name: string;
  part_no: string;
  part_name: string;
  vendor: string;
  customer: string;
  line_name: string;
  lot_quantity: number;
  status: string;
  batch_qr_value: string;
  batch_qr_url: string;
  lot_barcode_url: string;
}> {
  return apiRequest(`/api/qr/batch-codes/${batchId}`);
}

export async function parseBarcodeDetails(code: string): Promise<PartBarcodeInfo> {
  return apiRequest<PartBarcodeInfo>(`/api/qr/parse-part/${encodeURIComponent(code)}`);
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

export async function fetchAuditLogs(params?: {
  action_type?: string;
  user_id?: number;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}): Promise<any[]> {
  const qs = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v != null && v !== '')
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : '';
  return apiRequest<any[]>(`/api/admin/audit-logs${qs}`);
}

export async function syncOfflineQueue(mutations: OfflineMutation[]): Promise<any> {
  return apiRequest('/api/sync/offline-queue', {
    method: 'POST',
    body: JSON.stringify({ mutations }),
  });
}

export async function downloadWithAuth(url: string, filename: string): Promise<void> {
  const token = localStorage.getItem('taa_jwt_token');
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Download failed (${response.status}): ${text}`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

export async function downloadBatchExport(batchId: number, format: 'pdf' | 'xlsx', lotNumber: string): Promise<void> {
  const url = `/api/admin/batches/${batchId}/export?format=${format}`;
  const ext = format === 'pdf' ? 'pdf' : 'xlsx';
  await downloadWithAuth(url, `IFM_${lotNumber}.${ext}`);
}

export async function downloadCsvExport(): Promise<void> {
  await downloadWithAuth('/api/admin/export-csv', 'taa-inspection-records.csv');
}

export async function adminResetPassword(userId: number, newPassword: string): Promise<void> {
  await apiRequest(`/api/admin/users/${userId}/reset-password`, {
    method: 'PATCH',
    body: JSON.stringify({ new_password: newPassword }),
  });
}
