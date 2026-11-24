import { apiRequest, downloadAuthenticatedFile } from '../../api';
import type { SupervisorDataService } from './SupervisorDataService';
import type { OpenLotResult, PersonRef, ProtoStatus, Workspace } from './types';

const getAuthHeader = (): Record<string, string> => {
  const token = localStorage.getItem('taa_jwt_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const put = (path: string, body: unknown) =>
  apiRequest(path, { method: 'PUT', body: JSON.stringify(body) }).then(() => undefined);

/** Live implementation backed by /api/supervisor/* (backend/app/routes/supervisor_routes.py). */
export const apiSupervisorService: SupervisorDataService = {
  getWorkspace() {
    return apiRequest<Workspace>('/api/supervisor/workspace');
  },

  async openLot(lotId: number): Promise<OpenLotResult> {
    // Uses fetch directly (not apiRequest) to read the 409/422 bodies.
    const res = await fetch(`/api/supervisor/lots/${lotId}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, view: body.view };
    const detail = body?.detail ?? {};
    if (res.status === 409 && detail.lockBy) return { ok: false, reason: 'locked', lockBy: detail.lockBy as PersonRef };
    if (res.status === 404) return { ok: false, reason: 'not_found', message: 'Lot not found.' };
    if (res.status === 422) return { ok: false, reason: 'not_ready', message: detail.message || 'This lot is not ready for review.' };
    throw new Error(typeof detail === 'string' ? detail : detail.message || `Request failed (HTTP ${res.status})`);
  },

  setDisposition(lotId, columnKey, disposition) {
    return put(`/api/supervisor/lots/${lotId}/dispositions/${encodeURIComponent(columnKey)}`, { disposition });
  },

  setReading(lotId, paramId, sampleKey, value) {
    return put(`/api/supervisor/lots/${lotId}/readings`, { item_id: Number(paramId), sample: sampleKey, value });
  },

  setCheck(lotId, checkId, sampleKey, value) {
    return put(`/api/supervisor/lots/${lotId}/checks`, { item_id: Number(checkId), sample: sampleKey, value });
  },

  setOos(lotId, action) {
    return put(`/api/supervisor/lots/${lotId}/oos`, { action });
  },

  setSpot(lotId, columnKey, spot) {
    return put(`/api/supervisor/lots/${lotId}/spot/${encodeURIComponent(columnKey)}`, spot ?? { r: null, ng: [] });
  },

  setComment(lotId, comment) {
    return put(`/api/supervisor/lots/${lotId}/comment`, { comment });
  },

  downloadReportPdf(lotId, code) {
    return downloadAuthenticatedFile(`/api/supervisor/lots/${lotId}/report.pdf`, `${code}-lot-report.pdf`);
  },

  sign(lotId) {
    return apiRequest<{ status: ProtoStatus }>(`/api/supervisor/lots/${lotId}/sign`, { method: 'POST' });
  },
};
