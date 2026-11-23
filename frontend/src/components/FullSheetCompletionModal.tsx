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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print"
      style={{ background: 'rgba(27,37,51,0.4)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-md shadow-2xl overflow-hidden text-xs"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0" style={{ color: 'var(--warn)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
              Inspection Fields Incomplete
            </h3>
          </div>
          <button onClick={onClose} style={{ color: 'var(--muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-3.5">
          <p className="leading-relaxed" style={{ color: 'var(--muted)' }}>
            All required inspection fields must be completed before submitting an <strong>Approve</strong> or <strong>Reject</strong> decision.
          </p>

          <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--line)' }}>
            <div className="px-3 py-2 flex justify-between font-semibold"
              style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--line)', color: 'var(--ink)' }}>
              <span>Missing required fields</span>
              <span style={{ color: 'var(--warn)' }}>{missingFields.length} unfinished</span>
            </div>
            <div className="max-h-48 overflow-y-auto p-2 space-y-1" style={{ background: 'var(--surface)' }}>
              {missingFields.map((field, idx) => (
                <div key={idx} className="pt-1 text-[11px] font-medium" style={{ color: 'var(--ink)' }}>
                  · {field}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 flex justify-end" style={{ borderTop: '1px solid var(--line)' }}>
          <button onClick={onClose} className="btn primary sm">
            Return to Checksheet
          </button>
        </div>
      </div>
    </div>
  );
};
