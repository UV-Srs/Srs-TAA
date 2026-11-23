import React, { useEffect } from 'react';
import { CheckCircle2, X, Smartphone, Loader2 } from 'lucide-react';

interface ScanResolvedToastProps {
  batchId: number;
  lotNumber: string;
  sheetId: string;
  isOpening: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}

export const ScanResolvedToast: React.FC<ScanResolvedToastProps> = ({
  batchId, lotNumber, sheetId, isOpening, onOpen, onDismiss,
}) => {
  // Auto-dismiss after 10 s if user ignores it
  useEffect(() => {
    const t = setTimeout(onDismiss, 10000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200">
      {/* Green progress bar that drains over 10 s */}
      <div className="h-1 bg-emerald-500 animate-[shrink_10s_linear_forwards]" />

      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
            <Smartphone className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900">Scanned from phone</p>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{lotNumber || `Sheet: ${sheetId}`}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Batch #{batchId}</p>
          </div>
          <button
            onClick={onDismiss}
            className="shrink-0 p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={onOpen}
          disabled={isOpening}
          className="mt-3 w-full py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded transition-colors flex items-center justify-center gap-2"
        >
          {isOpening
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening…</>
            : <><CheckCircle2 className="w-4 h-4" /> Open Sheet</>}
        </button>
      </div>
    </div>
  );
};
