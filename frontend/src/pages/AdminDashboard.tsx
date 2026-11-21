import React, { useState, useEffect } from 'react';
import {
  fetchProgressDashboard, createBatch, fetchSheets, getExportUrl
} from '../api';
import { SheetTemplate } from '../types';
import {
  Plus, ExternalLink, Printer, RefreshCw, AlertCircle, Star
} from 'lucide-react';
import { PrintLabelModal } from '../components/PrintLabelModal';

interface AdminDashboardProps {
  onSelectBatch: (batchId: number) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onSelectBatch }) => {
  const [data, setData] = useState<any>(null);
  const [sheets, setSheets] = useState<SheetTemplate[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // New Batch Modal
  const [isNewBatchOpen, setIsNewBatchOpen] = useState<boolean>(false);
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [lotNumber, setLotNumber] = useState<string>('');
  const [lotQuantity, setLotQuantity] = useState<number>(495);
  const [inspectionMode, setInspectionMode] = useState<string>('IFM');
  const [isCreating, setIsCreating] = useState<boolean>(false);

  // Print Label Modal
  const [printSheetId, setPrintSheetId] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

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
        inspection_mode: inspectionMode,
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
    return <div className="py-20 text-center text-xs font-medium text-slate-500">Loading dashboard...</div>;
  }

  const summary = data?.summary || {};
  const batches = data?.batches || [];

  return (
    <div className="space-y-6">
      {/* Title & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Inspection Dashboard
          </h2>
          <p className="text-xs text-slate-500">
            Real-time batch quality status, stage tracking, and reports
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Active Template indicator */}
          {sheets.find(s => s.is_default) && (() => {
            const def = sheets.find(s => s.is_default)!;
            return (
              <div className="flex items-center gap-1.5 bg-slate-900 text-white text-[11px] font-medium px-3 py-1.5 rounded-lg">
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400 shrink-0" />
                <span className="text-slate-300">Active:</span>
                <span className="font-mono font-semibold">{def.sheet_id}</span>
              </div>
            );
          })()}
          <button
            onClick={loadDashboard}
            className="p-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-lg transition-colors"
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
            className="bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>New Batch</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="border border-red-200 bg-red-50 text-red-700 p-3 rounded-lg text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
          <span className="text-[11px] font-medium text-slate-500 block">Total Batches</span>
          <span className="text-2xl font-bold text-slate-900 mt-1 block">{summary.total_batches || 0}</span>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
          <span className="text-[11px] font-medium text-slate-500 block">Pending Operator</span>
          <span className="text-2xl font-bold text-slate-800 mt-1 block">{summary.pending_operator || 0}</span>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
          <span className="text-[11px] font-medium text-slate-500 block">Awaiting Review</span>
          <span className="text-2xl font-bold text-slate-800 mt-1 block">{summary.awaiting_supervisor || 0}</span>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
          <span className="text-[11px] font-medium text-amber-700 block">On Hold</span>
          <span className="text-2xl font-bold text-amber-900 mt-1 block">{summary.on_hold || 0}</span>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
          <span className="text-[11px] font-medium text-emerald-700 block">Approved</span>
          <span className="text-2xl font-bold text-emerald-900 mt-1 block">{summary.approved || 0}</span>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
          <span className="text-[11px] font-medium text-red-700 block">Rejected</span>
          <span className="text-2xl font-bold text-red-900 mt-1 block">{summary.rejected || 0}</span>
        </div>
      </div>

      {/* Batches Table Card */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-800">All Inspection Batches</span>
          <span className="text-xs text-slate-400">{batches.length} total</span>
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
                  <td className="font-semibold text-slate-500">#{b.batch_id}</td>
                  <td>
                    <div className="font-semibold text-slate-900">{b.sheet_id}</div>
                    <div className="text-[11px] text-slate-500 truncate max-w-xs">
                      {b.part_no || 'N/A'} • {b.part_name || 'N/A'}
                    </div>
                  </td>
                  <td className="font-semibold text-slate-800">{b.lot_number}</td>
                  <td className="text-slate-600">{b.lot_quantity || '-'}</td>
                  <td className="font-medium text-slate-700">{b.inspection_mode}</td>
                  <td>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200 mb-1">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          b.status === 'APPROVED' ? 'bg-emerald-500' :
                          b.status === 'REJECTED' ? 'bg-red-500' : 'bg-slate-800'
                        }`}
                        style={{ width: `${b.completion_pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium">{b.completion_pct}%</span>
                  </td>
                  <td className="text-slate-700 font-medium text-xs">
                    {b.bottleneck_stage}
                  </td>
                  <td>
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      b.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                      b.status === 'REJECTED' ? 'bg-red-50 text-red-700 border border-red-200' :
                      b.status === 'ON_HOLD' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                      'bg-slate-100 text-slate-700 border border-slate-200'
                    }`}>
                      {b.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => onSelectBatch(b.batch_id)}
                        className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                        title="Open Checksheet"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setPrintSheetId(b.sheet_id)}
                        className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                        title="Print QR"
                      >
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                      <a
                        href={getExportUrl(b.batch_id, 'pdf')}
                        download
                        className="px-2 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded"
                        title="Export PDF"
                      >
                        PDF
                      </a>
                      <a
                        href={getExportUrl(b.batch_id, 'xlsx')}
                        download
                        className="px-2 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded"
                        title="Export Excel"
                      >
                        XLSX
                      </a>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl text-xs">
            <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">
              Create New Inspection Batch
            </h3>

            <form onSubmit={handleCreateBatch} className="space-y-3.5">
              <div className="space-y-1">
                <label className="font-medium text-slate-700">Checksheet Template</label>
                <select
                  value={selectedSheetId}
                  onChange={(e) => setSelectedSheetId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                >
                  {sheets.map((s) => (
                    <option key={s.sheet_id} value={s.sheet_id}>
                      {s.is_default ? '⭐ ' : ''}{s.sheet_id} — {s.part_no || ''}{s.is_default ? ' [ACTIVE]' : ''}
                    </option>
                  ))}
                </select>
                {selectedSheetId && sheets.find(s => s.sheet_id === selectedSheetId)?.is_default && (
                  <p className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                    <Star className="w-3 h-3 fill-emerald-600 text-emerald-600" />
                    Active Template — this is the default for all new batches
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="font-medium text-slate-700">Lot / Batch Number</label>
                <input
                  type="text"
                  required
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  placeholder="e.g. LOT-2026-495B"
                  className="w-full border border-slate-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-slate-700">Lot Quantity</label>
                  <input
                    type="number"
                    value={lotQuantity}
                    onChange={(e) => setLotQuantity(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-slate-700">Mode</label>
                  <select
                    value={inspectionMode}
                    onChange={(e) => setInspectionMode(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                  >
                    <option value="IFM">IFM (200% / n=10)</option>
                    <option value="NORMAL">Normal (100% / n=5)</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewBatchOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg transition-all disabled:opacity-50"
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
