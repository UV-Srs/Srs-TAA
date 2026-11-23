import React, { useState, useEffect } from 'react';
import {
  fetchProgressDashboard, createBatch, fetchSheets, downloadBatchExport
} from '../api';
import { SheetTemplate } from '../types';
import {
  Plus, ExternalLink, Printer, RefreshCw, AlertCircle, Star
} from 'lucide-react';
import { PrintLabelModal } from '../components/PrintLabelModal';

interface AdminDashboardProps {
  onSelectBatch: (batchId: number) => void;
  pendingLotNumber?: string | null;
  onPendingConsumed?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onSelectBatch, pendingLotNumber, onPendingConsumed }) => {
  const [data, setData] = useState<any>(null);
  const [sheets, setSheets] = useState<SheetTemplate[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // New Batch Modal
  const [isNewBatchOpen, setIsNewBatchOpen] = useState<boolean>(false);
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [lotNumber, setLotNumber] = useState<string>('');
  const [lotQuantity, setLotQuantity] = useState<number>(495);
  const [isCreating, setIsCreating] = useState<boolean>(false);

  // Print Label Modal
  const [printSheetId, setPrintSheetId] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  // When an unregistered QR is scanned on the phone, auto-open the Create Batch
  // modal with the scanned code pre-filled as the lot number.
  useEffect(() => {
    if (!pendingLotNumber) return;
    setLotNumber(pendingLotNumber);
    setIsNewBatchOpen(true);
    onPendingConsumed?.();
  }, [pendingLotNumber]);

  const loadDashboard = async () => {
    try {
      setIsLoading(true);
      setErrorMsg(null);
      const [prog, sList] = await Promise.all([
        fetchProgressDashboard(),
        fetchSheets(),
      ]);
      setData(prog);
      setSheets(sList);
      // Auto-select the active (default) template; fall back to first
      if (sList.length > 0 && !selectedSheetId) {
        const defaultTpl = sList.find(s => s.is_default);
        setSelectedSheetId((defaultTpl || sList[0]).sheet_id);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load progress dashboard.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSheetId || !lotNumber) return;
    try {
      setIsCreating(true);
      const newBatch = await createBatch({
        sheet_id: selectedSheetId,
        lot_number: lotNumber,
        lot_quantity: Number(lotQuantity),
      });
      setIsNewBatchOpen(false);
      setLotNumber('');
      await loadDashboard();
      onSelectBatch(newBatch.batch_id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to instantiate new batch.');
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading) {
    return <div className="py-20 text-center text-xs font-medium" style={{ color: 'var(--muted)' }}>Loading dashboard...</div>;
  }

  const summary = data?.summary || {};
  const batches = data?.batches || [];

  return (
    <div className="space-y-6">
      {/* Title & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <div>
          <h2 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Inspection Dashboard
          </h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Real-time batch quality status, stage tracking, and reports
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Active Template indicator */}
          {sheets.find(s => s.is_default) && (() => {
            const def = sheets.find(s => s.is_default)!;
            return (
              <div className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400 shrink-0" />
                <span style={{ color: 'var(--muted)' }}>Active:</span>
                <span className="font-mono font-semibold">{def.sheet_id}</span>
              </div>
            );
          })()}
          <button
            onClick={loadDashboard}
            className="p-2 rounded-lg transition-colors"
            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--muted)' }}
            title="Refresh Dashboard"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              // Always open with the default template pre-selected
              const def = sheets.find(s => s.is_default);
              if (def) setSelectedSheetId(def.sheet_id);
              setIsNewBatchOpen(true);
            }}
            className="font-medium text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition-all"
            style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
          >
            <Plus className="w-4 h-4" />
            <span>New Batch</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg text-xs flex items-center gap-2" style={{ border: '1px solid #f1b8b5', background: 'var(--ng-bg)', color: 'var(--ng)' }}>
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Batches',    value: summary.total_batches || 0,       labelColor: 'var(--muted)', valueColor: 'var(--ink)' },
          { label: 'Pending Operator', value: summary.pending_operator || 0,    labelColor: 'var(--muted)', valueColor: 'var(--ink)' },
          { label: 'Awaiting Review',  value: summary.awaiting_supervisor || 0, labelColor: 'var(--muted)', valueColor: 'var(--ink)' },
          { label: 'On Hold',          value: summary.on_hold || 0,             labelColor: 'var(--warn)',  valueColor: 'var(--warn)' },
          { label: 'Approved',         value: summary.approved || 0,            labelColor: 'var(--ok)',    valueColor: 'var(--ok)' },
          { label: 'Rejected',         value: summary.rejected || 0,            labelColor: 'var(--ng)',    valueColor: 'var(--ng)' },
        ].map(({ label, value, labelColor, valueColor }) => (
          <div key={label} className="p-4 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <span className="text-[11px] font-semibold uppercase tracking-wider block" style={{ color: labelColor }}>{label}</span>
            <span className="text-2xl font-semibold mt-1 block tabular-nums" style={{ color: valueColor }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Batches Table Card */}
      <div className="overflow-hidden rounded-[16px]" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
          <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>All Inspection Batches</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>{batches.length} total</span>
        </div>

        <div className="overflow-x-auto">
          <table className="clean-table min-w-full text-xs">
            <thead>
              <tr>
                <th className="w-16">ID</th>
                <th>Checksheet / Part</th>
                <th>Lot Number</th>
                <th>Lot Qty</th>
                <th>Mode</th>
                <th className="w-32">Progress</th>
                <th>Stage</th>
                <th>Status</th>
                <th className="text-center w-36">Actions</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b: any) => (
                <tr key={b.batch_id}>
                  <td className="font-semibold tabular-nums" style={{ color: 'var(--muted)' }}>#{b.batch_id}</td>
                  <td>
                    <div className="font-semibold" style={{ color: 'var(--ink)' }}>{b.sheet_id}</div>
                    <div className="text-[11px] truncate max-w-xs" style={{ color: 'var(--muted)' }}>
                      {b.part_no || 'N/A'} • {b.part_name || 'N/A'}
                    </div>
                  </td>
                  <td className="font-semibold" style={{ color: 'var(--ink)' }}>{b.lot_number}</td>
                  <td style={{ color: 'var(--muted)' }}>{b.lot_quantity || '-'}</td>
                  <td className="font-medium" style={{ color: 'var(--ink)' }}>{b.inspection_mode}</td>
                  <td>
                    <div className="w-full h-2 rounded-full overflow-hidden mb-1" style={{ background: 'var(--surface2)', border: '1px solid var(--line)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${b.completion_pct}%`,
                          background: b.status === 'APPROVED' ? 'var(--ok)' : b.status === 'REJECTED' ? 'var(--ng)' : 'var(--accent)',
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-medium tabular-nums" style={{ color: 'var(--muted)' }}>{b.completion_pct}%</span>
                  </td>
                  <td className="font-medium text-xs" style={{ color: 'var(--ink)' }}>
                    {b.bottleneck_stage}
                  </td>
                  <td>
                    <span className="pill" style={
                      b.status === 'APPROVED' ? { background: 'var(--ok-bg)', color: 'var(--ok)' } :
                      b.status === 'REJECTED' ? { background: 'var(--ng-bg)', color: 'var(--ng)' } :
                      b.status === 'ON_HOLD'  ? { background: 'var(--warn-bg)', color: 'var(--warn)' } :
                      { background: 'var(--surface2)', color: 'var(--muted)' }
                    }>
                      {b.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => onSelectBatch(b.batch_id)}
                        className="p-1.5 rounded transition-colors"
                        style={{ color: 'var(--muted)' }}
                        title="Open Checksheet"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setPrintSheetId(b.sheet_id)}
                        className="p-1.5 rounded transition-colors"
                        style={{ color: 'var(--muted)' }}
                        title="Print QR"
                      >
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadBatchExport(b.batch_id, 'pdf', b.lot_number).catch(console.error)}
                        className="px-2 py-1 text-[11px] font-semibold rounded"
                        style={{ background: 'var(--surface2)', color: 'var(--ink)' }}
                        title="Export PDF"
                      >
                        PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadBatchExport(b.batch_id, 'xlsx', b.lot_number).catch(console.error)}
                        className="px-2 py-1 text-[11px] font-semibold rounded"
                        style={{ background: 'var(--surface2)', color: 'var(--ink)' }}
                        title="Export Excel"
                      >
                        XLSX
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Simple Create Batch Dialog */}
      {isNewBatchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm" style={{ background: 'rgba(27,37,51,0.4)' }}>
          <div className="w-full max-w-md p-6 space-y-4 text-xs" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, boxShadow: 'var(--shadow)' }}>
            <h3 className="text-sm font-semibold pb-2" style={{ color: 'var(--ink)', borderBottom: '1px solid var(--line)' }}>
              Create New Inspection Batch
            </h3>

            <form onSubmit={handleCreateBatch} className="space-y-3.5">
              <div className="space-y-1">
                <label className="font-medium" style={{ color: 'var(--ink)' }}>Checksheet Template</label>
                <select
                  value={selectedSheetId}
                  onChange={(e) => setSelectedSheetId(e.target.value)}
                  className="w-full p-2 outline-none"
                  style={{ border: '1px solid var(--line2)', borderRadius: 10, background: 'var(--surface)', color: 'var(--ink)' }}
                >
                  {sheets.map((s) => (
                    <option key={s.sheet_id} value={s.sheet_id}>
                      {s.is_default ? '⭐ ' : ''}{s.sheet_id} — {s.part_no || ''}{s.is_default ? ' [ACTIVE]' : ''}
                    </option>
                  ))}
                </select>
                {selectedSheetId && sheets.find(s => s.sheet_id === selectedSheetId)?.is_default && (
                  <p className="text-[11px] font-medium flex items-center gap-1" style={{ color: 'var(--ok)' }}>
                    <Star className="w-3 h-3" />
                    Active Template — this is the default for all new batches
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="font-medium" style={{ color: 'var(--ink)' }}>Lot / Batch Number</label>
                <input
                  type="text"
                  required
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  placeholder="e.g. LOT-2026-495B"
                  className="w-full p-2 outline-none"
                  style={{ border: '1px solid var(--line2)', borderRadius: 10, color: 'var(--ink)' }}
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium" style={{ color: 'var(--ink)' }}>Lot Quantity</label>
                <input
                  type="number"
                  value={lotQuantity}
                  onChange={(e) => setLotQuantity(Number(e.target.value))}
                  className="w-full p-2 outline-none"
                  style={{ border: '1px solid var(--line2)', borderRadius: 10, color: 'var(--ink)' }}
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2" style={{ borderTop: '1px solid var(--line)' }}>
                <button
                  type="button"
                  onClick={() => setIsNewBatchOpen(false)}
                  className="px-4 py-2 font-medium rounded-lg"
                  style={{ color: 'var(--muted)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-2 font-medium rounded-xl transition-all disabled:opacity-50"
                  style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
                >
                  {isCreating ? 'Creating...' : 'Create Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print Label Modal */}
      {printSheetId && (
        <PrintLabelModal
          isOpen={true}
          onClose={() => setPrintSheetId(null)}
          sheetId={printSheetId}
        />
      )}
    </div>
  );
};
