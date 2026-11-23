import React from 'react';
import { X, FilePlus, AlertTriangle, Tag, Building2, User2, Layers, Plus } from 'lucide-react';

export interface ScanNotFoundData {
  raw_code: string;
  format_detected: string;
  suggested_sheet_id: string | null;
  part_no: string | null;
  part_name: string | null;
  vendor: string | null;
  customer: string | null;
  model: string | null;
  lot_number: string | null;
  gtin: string | null;
  user_id: number;
  role: string;
}

interface ScanNotFoundPopupProps {
  data: ScanNotFoundData;
  onCreateSheet: () => void;
  onCreateBatch?: () => void;
  onDismiss: () => void;
}

export const ScanNotFoundPopup: React.FC<ScanNotFoundPopupProps> = ({
  data,
  onCreateSheet,
  onCreateBatch,
  onDismiss,
}) => {
  const hasPartInfo = data.part_no || data.part_name || data.vendor || data.customer || data.model;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200">

        {/* Header */}
        <div className="flex items-start gap-3 p-5 bg-amber-50 border-b border-amber-100">
          <div className="shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-900">Barcode Not Registered</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              This barcode isn't linked to any sheet yet. Create one now?
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="shrink-0 p-1 text-slate-400 hover:text-slate-600 transition-colors rounded-lg hover:bg-amber-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Parsed info */}
        <div className="p-5 space-y-3">
          {/* Raw code chip */}
          <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
            <Tag className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Scanned Code</p>
              <p className="text-xs font-mono text-slate-700 truncate">{data.raw_code}</p>
            </div>
            <span className="ml-auto shrink-0 text-[10px] bg-slate-200 text-slate-500 font-semibold px-2 py-0.5 rounded-full">
              {data.format_detected}
            </span>
          </div>

          {/* Part details if parsed */}
          {hasPartInfo && (
            <div className="space-y-2">
              {(data.part_no || data.part_name) && (
                <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <Layers className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    {data.part_no && (
                      <p className="text-xs font-semibold text-slate-800">{data.part_no}</p>
                    )}
                    {data.part_name && (
                      <p className="text-xs text-slate-500">{data.part_name}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {data.vendor && (
                  <div className="flex items-center gap-1.5 p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                    <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-slate-400 font-semibold">Vendor</p>
                      <p className="text-xs text-slate-700 truncate">{data.vendor}</p>
                    </div>
                  </div>
                )}
                {data.customer && (
                  <div className="flex items-center gap-1.5 p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                    <User2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-slate-400 font-semibold">Customer</p>
                      <p className="text-xs text-slate-700 truncate">{data.customer}</p>
                    </div>
                  </div>
                )}
              </div>

              {data.model && (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Model</p>
                  <p className="text-xs text-slate-700">{data.model}</p>
                </div>
              )}
            </div>
          )}

          {/* Suggested sheet ID */}
          {data.suggested_sheet_id && (
            <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 rounded-xl border border-indigo-100">
              <p className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider shrink-0">Suggested ID</p>
              <p className="text-xs font-mono text-indigo-700 truncate">{data.suggested_sheet_id}</p>
            </div>
          )}

          <p className="text-xs text-slate-400 text-center pt-1">
            All detected fields will be pre-filled in the new sheet form.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2.5 p-5 pt-0">
          <button
            onClick={onDismiss}
            className="py-2.5 px-3 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            Dismiss
          </button>
          {onCreateBatch && (
            <button
              onClick={onCreateBatch}
              className="flex-1 py-2.5 text-xs font-bold text-white bg-black hover:bg-slate-800 rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Batch</span>
            </button>
          )}
          <button
            onClick={onCreateSheet}
            className="py-2.5 px-3 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <FilePlus className="w-3.5 h-3.5 text-slate-500" />
            <span>New Sheet</span>
          </button>
        </div>
      </div>
    </div>
  );
};
