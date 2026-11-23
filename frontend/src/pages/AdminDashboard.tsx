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
    return <div className="py-20 text-center text-sm font-medium" style={{ color: 'var(--muted)' }}>Loading dashboard…</div>;
  }

  const summary = data?.summary || {};
  const batches = data?.batches || [];

  const withOperator   = summary.pending_operator || 0;
  const withSupervisor = summary.awaiting_supervisor || 0;
  const onHold         = summary.on_hold || 0;
  const totalBatches   = summary.total_batches || 0;
  const approved       = summary.approved || 0;
  const rejected       = summary.rejected || 0;

  return (
    <div className="space-y-8">

      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold" style={{ fontSize: 24, letterSpacing: '-0.015em', color: 'var(--ink)' }}>
            Team overview
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            Real-time inspection status and batch quality tracking
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {sheets.find(s => s.is_default) && (() => {
            const def = sheets.find(s => s.is_default)!;
            return (
              <div className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
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
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              const def = sheets.find(s => s.is_default);
              if (def) setSelectedSheetId(def.sheet_id);
              setIsNewBatchOpen(true);
            }}
            className="btn primary sm"
          >
            <Plus className="w-4 h-4" />
            New Batch
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg text-sm flex items-center gap-2" style={{ border: '1px solid #f1b8b5', background: 'var(--ng-bg)', color: 'var(--ng)' }}>
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ── INSPECTION · OPERATORS ──────────────────────────────── */}
      <section>
        <span className="sv-label">Inspection · Operators</span>
        <div className="kpis cols-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <div className="kpi-tile">
            <div className="kpi-num">{totalBatches}</div>
            <div className="kpi-label">Lots inspected</div>
          </div>
          <div className="kpi-tile">
            <div className="kpi-num">{(summary.items_checked || 0).toLocaleString('en-IN')}</div>
            <div className="kpi-label">Items checked</div>
          </div>
          <div className="kpi-tile">
            <div className={`kpi-num${(summary.bad_items || 0) > 0 ? ' ng' : ''}`}>
              {summary.bad_items || 0}
            </div>
            <div className="kpi-label">Bad items found</div>
          </div>
          <div className="kpi-tile">
            <div className="kpi-num">{summary.bad_rate != null ? `${Number(summary.bad_rate).toFixed(2)}%` : '—'}</div>
            <div className="kpi-label">Bad rate</div>
          </div>
        </div>
      </section>

      {/* ── RIGHT NOW ───────────────────────────────────────────── */}
      <section>
        <span className="sv-label">Right now</span>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button className="att" onClick={() => {}}>
            <span className="att-number">{withOperator}</span>
            <span className="att-title">Being inspected</span>
            <span className="att-caption">By operators now</span>
          </button>
          <button className={`att${withSupervisor > 0 ? ' warn' : ''}`} onClick={() => {}}>
            <span className={`att-number${withSupervisor > 0 ? ' warn' : ''}`}>{withSupervisor}</span>
            <span className="att-title">Waiting for supervisor</span>
            <span className="att-caption">{withSupervisor > 0 ? `${withSupervisor} waiting` : 'None waiting'}</span>
          </button>
          <button className={`att${onHold > 0 ? ' warn' : ''}`} onClick={() => {}}>
            <span className={`att-number${onHold > 0 ? ' warn' : ''}`}>{onHold}</span>
            <span className="att-title">Lots on hold</span>
            <span className="att-caption">{onHold > 0 ? `${onHold} items held` : 'None on hold'}</span>
          </button>
          <button className={`att${rejected > 0 ? ' ng' : ''}`} onClick={() => {}}>
            <span className={`att-number${rejected > 0 ? ' ng' : ''}`}>{rejected}</span>
            <span className="att-title">Rejected lots</span>
            <span className="att-caption">Completed with rejection</span>
          </button>
        </div>
      </section>

      {/* ── REVIEW SUMMARY ──────────────────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Approval outcomes */}
        <div className="p-5" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>
          <span className="sv-label">Decisions on batches</span>
          <div className="flex gap-4 mt-2">
            <div>
              <div className="text-2xl font-light tabular-nums" style={{ color: 'var(--ok)' }}>{approved}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Approved</div>
            </div>
            <div>
              <div className="text-2xl font-light tabular-nums" style={{ color: 'var(--warn)' }}>{onHold}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>On hold</div>
            </div>
            <div>
              <div className="text-2xl font-light tabular-nums" style={{ color: 'var(--ng)' }}>{rejected}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Rejected</div>
            </div>
          </div>
          {(approved + onHold + rejected) > 0 && (
            <div className="mt-4 h-3 rounded-full overflow-hidden flex" style={{ background: 'var(--surface2)' }}>
              {approved > 0 && (
                <div style={{ width: `${approved / (approved + onHold + rejected) * 100}%`, background: 'var(--ok)' }} />
              )}
              {onHold > 0 && (
                <div style={{ width: `${onHold / (approved + onHold + rejected) * 100}%`, background: 'var(--warn)' }} />
              )}
              {rejected > 0 && (
                <div style={{ width: `${rejected / (approved + onHold + rejected) * 100}%`, background: 'var(--ng)' }} />
              )}
            </div>
          )}
        </div>

        {/* Active template info */}
        {sheets.find(s => s.is_default) && (() => {
          const def = sheets.find(s => s.is_default)!;
          return (
            <div className="p-5" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>
              <span className="sv-label">Active template</span>
              <div className="mt-2 flex items-center gap-2">
                <Star className="w-4 h-4 shrink-0 fill-yellow-400 text-yellow-400" />
                <span className="font-semibold font-mono" style={{ color: 'var(--ink)' }}>{def.sheet_id}</span>
              </div>
              {def.part_name && (
                <p className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>{def.part_name}</p>
              )}
              {def.part_no && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Part No: {def.part_no}</p>
              )}
            </div>
          );
        })()}
      </section>

      {/* ── ALL BATCHES ─────────────────────────────────────────── */}
      <section>
        <div className="overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
            <span className="font-semibold" style={{ color: 'var(--ink)', fontSize: 16 }}>All Lots</span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{batches.length} total</span>
          </div>

          <div className="overflow-x-auto">
            <table className="clean-table min-w-full">
              <thead>
                <tr>
                  <th className="w-16">ID</th>
                  <th>Checksheet / Part</th>
                  <th>Lot Number</th>
                  <th>Qty</th>
                  <th className="w-32">Progress</th>
                  <th>Status</th>
                  <th className="text-center w-36">Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
                      No batches yet. Create one to get started.
                    </td>
                  </tr>
                ) : batches.map((b: any) => (
                  <tr key={b.batch_id}>
                    <td className="font-semibold tabular-nums" style={{ color: 'var(--muted)' }}>#{b.batch_id}</td>
                    <td>
                      <div className="font-semibold" style={{ color: 'var(--ink)' }}>{b.sheet_id}</div>
                      <div className="text-[11px] truncate max-w-xs" style={{ color: 'var(--muted)' }}>
                        {b.part_no || 'N/A'} · {b.part_name || 'N/A'}
                      </div>
                    </td>
                    <td className="font-semibold font-mono" style={{ color: 'var(--ink)' }}>{b.lot_number}</td>
                    <td style={{ color: 'var(--muted)' }}>{b.lot_quantity || '—'}</td>
                    <td>
                      <div className="w-full h-1.5 rounded-full overflow-hidden mb-1" style={{ background: 'var(--surface2)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${b.completion_pct}%`,
                            background: b.status === 'APPROVED' ? 'var(--ok)' : b.status === 'REJECTED' ? 'var(--ng)' : 'var(--accent)',
                          }}
                        />
                      </div>
                      <span className="text-[10px] tabular-nums" style={{ color: 'var(--muted)' }}>{b.completion_pct}%</span>
                    </td>
                    <td>
                      <span className="pill" style={
                        b.status === 'APPROVED'                   ? { background: 'var(--ok-bg)',   color: 'var(--ok)'   } :
                        b.status === 'REJECTED'                   ? { background: 'var(--ng-bg)',   color: 'var(--ng)'   } :
                        b.status === 'ON_HOLD'                    ? { background: 'var(--warn-bg)', color: 'var(--warn)' } :
                        b.status === 'SUPERVISOR_IN_PROGRESS'     ? { background: 'var(--warn-bg)', color: 'var(--warn)' } :
                        b.status === 'OPERATOR_IN_PROGRESS'       ? { background: 'var(--accent-soft)', color: 'var(--accent)' } :
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
                        >
                          PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadBatchExport(b.batch_id, 'xlsx', b.lot_number).catch(console.error)}
                          className="px-2 py-1 text-[11px] font-semibold rounded"
                          style={{ background: 'var(--surface2)', color: 'var(--ink)' }}
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
      </section>

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
                  className="btn secondary sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="btn primary sm"
                >
                  {isCreating ? 'Creating…' : 'Create Batch'}
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
