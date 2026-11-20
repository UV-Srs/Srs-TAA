import React from 'react';
import { AlertOctagon, X } from 'lucide-react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm no-print">
      <div className="bg-white border-4 border-black w-full max-w-lg shadow-2xl">
        {/* Banner */}
        <div className="bg-black text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertOctagon className="w-5 h-5 text-white" />
            <h2 className="font-black text-sm uppercase tracking-wider">
              FR-025A: FULL-SHEET COMPLETION MANDATE
            </h2>
          </div>
          <button onClick={onClose} className="text-white hover:text-zinc-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div className="border-2 border-black p-4 bg-zinc-50">
            <p className="font-bold text-sm text-black">
              Cannot Submit Decision Early
            </p>
            <p className="text-xs text-zinc-700 mt-1 leading-relaxed">
              Standard operating procedure requires 100% of required inspection fields across all stages to be measured and recorded—even if an early defect or tolerance failure has already been identified.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-mono font-bold mb-2">
              <span>UNFINISHED MANDATORY FIELDS:</span>
              <span className="bg-black text-white px-2 py-0.5">{missingFields.length} INCOMPLETE</span>
            </div>
            
            <div className="max-h-48 overflow-y-auto border-2 border-black divide-y divide-zinc-200 bg-white">
              {missingFields.map((field, idx) => (
                <div key={idx} className="px-3 py-2 text-xs font-mono text-zinc-800 flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full border border-black text-[10px] flex items-center justify-center font-bold">
                    !
                  </span>
                  <span>{field}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-zinc-100 p-3 border border-zinc-300 text-[11px] font-mono text-zinc-600">
            Complete the highlighted tickboxes and numeric sample cells on the checksheet before submitting Approve or Reject.
          </div>
        </div>

        {/* Footer */}
        <div className="bg-zinc-50 border-t-2 border-black px-6 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="bg-black text-white text-xs font-extrabold px-6 py-2.5 uppercase hover:bg-zinc-800 transition-colors"
          >
            Return to Checksheet
          </button>
        </div>
      </div>
    </div>
  );
};
