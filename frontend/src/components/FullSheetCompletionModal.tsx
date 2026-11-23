import React from 'react';
import { AlertCircle, X } from 'lucide-react';

interface FullSheetCompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  missingFields: string[];
}

export const FullSheetCompletionModal: React.FC<FullSheetCompletionModalProps> = ({
  isOpen,
  onClose,
  missingFields,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm no-print">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-xl text-xs">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-600">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <h3 className="font-bold text-sm text-slate-900">
              Inspection Fields Incomplete
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-3.5">
          <p className="text-slate-600 leading-relaxed">
            All required inspection fields across the checksheet must be completed before submitting an <strong>Approve</strong> or <strong>Reject</strong> decision (FR-025A).
          </p>

          <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
            <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold flex justify-between">
              <span>Missing Required Fields:</span>
              <span className="text-amber-800 font-bold">{missingFields.length} unfinished</span>
            </div>
            <div className="max-h-48 overflow-y-auto p-2 space-y-1 divide-y divide-slate-200/50">
              {missingFields.map((field, idx) => (
                <div key={idx} className="pt-1 text-[11px] text-slate-700 font-medium">
                  • {field}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg transition-all"
          >
            Return to Checksheet
          </button>
        </div>
      </div>
    </div>
  );
};
