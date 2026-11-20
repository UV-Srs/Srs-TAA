import React, { useState, useEffect } from 'react';
import {
  fetchProgressDashboard, createBatch, fetchSheets, getExportUrl
} from '../api';
import { SheetTemplate } from '../types';
import {
  Plus, Download, ExternalLink, Printer, RefreshCw, AlertCircle, CheckCircle, Clock
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
      if (sList.length > 0 && !selectedSheetId) {
        setSelectedSheetId(sList[0].sheet_id);
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
    return <div className="p-12 text-center font-mono text-xs">Loading Live Progress Dashboard...</div>;
  }

  const summary = data?.summary || {};
  const batches = data?.batches || [];

  return (
    <div className="space-y-6">
      {/* Title & Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-black pb-4">
        <div>
          <h2 className="text-xl font-black uppercase tracking-tight text-black">
            Shop-Floor Progress & Bottleneck Dashboard
          </h2>
          <p className="text-xs font-mono text-zinc-600">
            Real-time quality monitoring across all batches, stage bottlenecks, and exact IFM exports
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadDashboard}
            className="p-2 border-2 border-black bg-white hover:bg-zinc-100 transition-colors"
            title="Refresh Dashboard"
          >
            <RefreshCw className="w-4 h-4 text-black" />
          </button>
          <button
            onClick={() => setIsNewBatchOpen(true)}
            className="bg-black hover:bg-zinc-800 text-white font-extrabold text-xs px-4 py-2 uppercase flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>New Batch Run</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="border border-black bg-black text-white p-3 flex items-center gap-2 text-xs font-mono">
          <AlertCircle className="w-4 h-4" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* KPI Summary Cards (PRD Section 5.2 & Design System Section 2) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono text-xs">
        <div className="border-2 border-black p-3 bg-white">
          <div className="font-bold text-zinc-600 uppercase text-[10px]">Total Batches</div>
          <div className="text-2xl font-black text-black mt-1">{summary.total_batches || 0}</div>
        </div>

        <div className="border-2 border-black p-3 bg-zinc-50">
          <div className="font-bold text-zinc-600 uppercase text-[10px]">Pending Operator</div>
          <div className="text-2xl font-black text-black mt-1">{summary.pending_operator || 0}</div>
        </div>

        <div className="border-2 border-black p-3 bg-zinc-50">
          <div className="font-bold text-zinc-600 uppercase text-[10px]">Awaiting Supervisor</div>
          <div className="text-2xl font-black text-black mt-1">{summary.awaiting_supervisor || 0}</div>
        </div>

        <div className="border-2 border-black p-3 bg-zinc-50">
          <div className="font-bold text-zinc-600 uppercase text-[10px]">On Quarantine Hold</div>
          <div className="text-2xl font-black text-black mt-1">{summary.on_hold || 0}</div>
        </div>

        <div className="border-2 border-black p-3 bg-white">
          <div className="font-bold text-black uppercase text-[10px] flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Approved
          </div>
          <div className="text-2xl font-black text-black mt-1">{summary.approved || 0}</div>
        </div>

        <div className="border-2 border-black p-3 bg-black text-white">
          <div className="font-bold text-zinc-300 uppercase text-[10px] flex items-center gap-1">
            <AlertCircle className="w-3 h-3 text-white" /> Rejected
          </div>
          <div className="text-2xl font-black text-white mt-1">{summary.rejected || 0}</div>
        </div>
      </div>

      {/* Batches Table with Bottleneck Stage Identification */}
      <div className="border-2 border-black bg-white overflow-x-auto">
        <table className="industrial-table min-w-full text-left text-xs font-mono">
          <thead>
            <tr className="industrial-header divide-x-2 divide-black text-[11px]">
              <th className="p-3">Batch ID</th>
              <th className="p-3">Sheet ID / Part Details</th>
              <th className="p-3">Lot No.</th>
              <th className="p-3">Lot Qty</th>
              <th className="p-3">Mode</th>
              <th className="p-3">Progress</th>
              <th className="p-3">Bottleneck Stage</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-center">Actions & Exports</th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-black">
            {batches.map((b: any) => (
              <tr key={b.batch_id} className="divide-x-2 divide-black hover:bg-zinc-50">
                <td className="p-3 font-bold">#{b.batch_id}</td>
                <td className="p-3">
                  <div className="font-extrabold text-black">{b.sheet_id}</div>
                  <div className="text-[11px] text-zinc-600">
                    {b.part_no || 'N/A'} • {b.part_name || 'N/A'}
                  </div>
                </td>
                <td className="p-3 font-bold">{b.lot_number}</td>
                <td className="p-3">{b.lot_quantity || '-'}</td>
                <td className="p-3 font-bold">{b.inspection_mode}</td>
                <td className="p-3 w-36">
                  <div className="flex items-center justify-between text-[10px] mb-1 font-bold">
                    <span>{b.completion_pct}%</span>
                  </div>
                  <div className="w-full bg-zinc-200 h-2 border border-black">
                    <div
                      className="bg-black h-full transition-all duration-300"
                      style={{ width: `${b.completion_pct}%` }}
                    />
                  </div>
                </td>
                <td className="p-3 font-bold text-zinc-800">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-black" />
                    <span>{b.bottleneck_stage}</span>
                  </div>
                </td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                    b.status === 'APPROVED' ? 'bg-black text-white' :
                    b.status === 'REJECTED' ? 'border-2 border-black font-black' :
                    b.status === 'ON_HOLD' ? 'bg-zinc-200 text-black border border-black' :
                    'border border-zinc-400'
                  }`}>
                    {b.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="p-3 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => onSelectBatch(b.batch_id)}
                      className="p-1.5 border border-black hover:bg-zinc-100"
                      title="Open Checksheet"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setPrintSheetId(b.sheet_id)}
                      className="p-1.5 border border-black hover:bg-zinc-100"
                      title="Print Sheet QR / Barcode"
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                    <a
                      href={getExportUrl(b.batch_id, 'pdf')}
                      download
                      className="px-2 py-1 bg-black text-white text-[10px] font-bold hover:bg-zinc-800"
                      title="Download IFM PDF Report"
                    >
                      PDF
                    </a>
                    <a
                      href={getExportUrl(b.batch_id, 'xlsx')}
                      download
                      className="px-2 py-1 border border-black text-black text-[10px] font-bold hover:bg-zinc-100"
                      title="Download Excel (.xlsx) Report"
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

      {/* Instantiate New Batch Modal */}
      {isNewBatchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-white border-4 border-black w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="text-sm font-black uppercase tracking-wider text-black border-b-2 border-black pb-2">
              Instantiate New Batch Inspection Run
            </h3>

            <form onSubmit={handleCreateBatch} className="space-y-4 font-mono text-xs">
              <div>
                <label className="block font-bold uppercase mb-1">Select Checksheet Template:</label>
                <select
                  value={selectedSheetId}
                  onChange={(e) => setSelectedSheetId(e.target.value)}
                  className="w-full border-2 border-black p-2 font-bold focus:outline-none"
                >
                  {sheets.map((s) => (
                    <option key={s.sheet_id} value={s.sheet_id}>
                      {s.sheet_id} — {s.part_no || ''} ({s.document_title.substring(0, 30)}...)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold uppercase mb-1">Lot / Batch Number:</label>
                <input
                  type="text"
                  required
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  placeholder="e.g. LOT-2026-495B"
                  className="w-full border-2 border-black p-2 font-bold focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold uppercase mb-1">Lot Quantity:</label>
                  <input
                    type="number"
                    value={lotQuantity}
                    onChange={(e) => setLotQuantity(Number(e.target.value))}
                    className="w-full border-2 border-black p-2 font-bold focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold uppercase mb-1">Inspection Mode:</label>
                  <select
                    value={inspectionMode}
                    onChange={(e) => setInspectionMode(e.target.value)}
                    className="w-full border-2 border-black p-2 font-bold focus:outline-none"
                  >
                    <option value="IFM">IFM Frequency (200% / n=10)</option>
                    <option value="NORMAL">Normal Frequency (100% / n=5)</option>
                  </select>
                </div>
              </div>

              <div className="border-t-2 border-black pt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsNewBatchOpen(false)}
                  className="font-bold uppercase hover:underline"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="bg-black text-white font-extrabold px-5 py-2 uppercase hover:bg-zinc-800 disabled:opacity-50"
                >
                  {isCreating ? 'Creating...' : 'Instantiate Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Label Modal */}
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
