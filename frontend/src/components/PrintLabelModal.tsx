import React, { useState, useEffect } from 'react';
import { X, Printer, Loader2 } from 'lucide-react';
import { fetchBatchQRCodes } from '../api';

interface PrintLabelModalProps {
  isOpen: boolean;
  onClose: () => void;
  sheetId: string;
  batchId?: number;
}

export const PrintLabelModal: React.FC<PrintLabelModalProps> = ({
  isOpen,
  onClose,
  batchId,
}) => {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchBatchQRCodes>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && batchId) {
      setLoading(true);
      setError(null);
      fetchBatchQRCodes(batchId)
        .then(setData)
        .catch(() => setError('Failed to load QR codes'))
        .finally(() => setLoading(false));
    }
  }, [isOpen, batchId]);

  const handlePrint = () => window.print();

  if (!isOpen) return null;

  const statusColor: Record<string, string> = {
    APPROVED:                 '#16a34a',
    REJECTED:                 '#dc2626',
    ON_HOLD:                  '#d97706',
    OPERATOR_APPROVED:        '#2563eb',
    OPERATOR_REJECTED:        '#dc2626',
    OPERATOR_IN_PROGRESS:     '#7c3aed',
    SUPERVISOR_IN_PROGRESS:   '#0891b2',
    CREATED_PENDING_OPERATOR: '#64748b',
  };

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          body > *:not(.taa-print-label) { display: none !important; }
          .taa-print-label { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
          .no-print { display: none !important; }
          .print-label-card { box-shadow: none !important; border: 1.5px solid #000 !important; }
        }
      `}</style>

      <div className="taa-print-label fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
        <div className="bg-white border border-slate-200 rounded-lg w-full max-w-sm shadow-xl overflow-hidden">

          {/* Header */}
          <div className="no-print px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900">QR Label — Batch</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            )}

            {error && (
              <div className="py-8 text-center text-red-500 text-sm">{error}</div>
            )}

            {!loading && !error && data && (
              <div className="print-label-card border-2 border-slate-200 rounded p-4 bg-white space-y-3">

                {/* Company bar */}
                <div className="text-center border-b border-slate-100 pb-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">TAA Inspection System</p>
                  <p className="text-xs font-bold text-slate-900 mt-0.5 leading-tight">Batch Traceability Label</p>
                </div>

                {/* Key info grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                  <div>
                    <span className="text-[9px] text-slate-400 uppercase font-bold block">Lot Number</span>
                    <span className="font-black text-slate-900 text-xs">{data.lot_number}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 uppercase font-bold block">Sheet</span>
                    <span className="font-bold text-slate-700">{data.sheet_id}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 uppercase font-bold block">Part No</span>
                    <span className="font-bold text-slate-800">{data.part_no || '—'}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 uppercase font-bold block">Qty</span>
                    <span className="font-bold text-slate-800">{data.lot_quantity} pcs</span>
                  </div>
                  {data.part_name && (
                    <div className="col-span-2">
                      <span className="text-[9px] text-slate-400 uppercase font-bold block">Part Name</span>
                      <span className="font-semibold text-slate-800">{data.part_name}</span>
                    </div>
                  )}
                  {data.vendor && (
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-bold block">Vendor</span>
                      <span className="font-semibold text-slate-700">{data.vendor}</span>
                    </div>
                  )}
                  {data.line_name && (
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-bold block">Line</span>
                      <span className="font-semibold text-slate-700">{data.line_name}</span>
                    </div>
                  )}
                  <div className="col-span-2">
                    <span className="text-[9px] text-slate-400 uppercase font-bold block">Status</span>
                    <span
                      className="font-black text-xs"
                      style={{ color: statusColor[data.status] || '#0f172a' }}
                    >
                      {data.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>

                {/* Primary: Lot number barcode (scan this) */}
                <div className="border-t border-slate-100 pt-3 space-y-1">
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-200">
                    <img
                      src={data.lot_barcode_url}
                      alt="Lot number barcode"
                      className="w-full max-h-20 object-contain"
                    />
                    <p className="text-[10px] font-black text-slate-900 mt-1 font-mono tracking-widest">{data.lot_number}</p>
                    <p className="text-[9px] text-slate-500 font-bold mt-0.5 uppercase tracking-wide">Scan to open — Operator / Supervisor</p>
                  </div>
                </div>

                {/* Secondary: Batch QR (alternative scan) */}
                <div className="flex items-center gap-3 pt-1">
                  <img
                    src={data.batch_qr_url}
                    alt="Batch QR"
                    className="w-14 h-14 shrink-0"
                  />
                  <div>
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">Batch QR (alternative)</p>
                    <p className="text-[9px] text-slate-400 font-mono mt-0.5">{data.batch_qr_value}</p>
                  </div>
                </div>

                {/* Batch ID footer */}
                <div className="border-t border-slate-100 pt-2 text-center">
                  <p className="text-[9px] text-slate-400 font-mono">Batch #{data.batch_id} · {new Date().toLocaleDateString()}</p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="no-print px-5 py-3 border-t border-slate-100 flex items-center justify-between">
            <button onClick={onClose} className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Close
            </button>
            <button
              onClick={handlePrint}
              disabled={!data}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-700 disabled:opacity-40 text-white font-semibold text-sm rounded flex items-center gap-2 transition-colors"
            >
              <Printer className="w-4 h-4" />
              Print Label
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
