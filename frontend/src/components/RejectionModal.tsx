import React, { useState } from 'react';
import { X, AlertTriangle, CheckSquare, Square } from 'lucide-react';
import { ControlItem } from '../types';

interface RejectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  controlItems: ControlItem[];
  onSubmit: (rejectedItemIds: number[], remarks: string) => void;
  isSubmitting: boolean;
}

export const RejectionModal: React.FC<RejectionModalProps> = ({
  isOpen,
  onClose,
  controlItems,
  onSubmit,
  isSubmitting,
}) => {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [remarks, setRemarks]         = useState<string>('');
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);

  if (!isOpen) return null;

  const toggleSelect = (itemId?: number) => {
    if (!itemId) return;
    setErrorMsg(null);
    setSelectedIds(prev =>
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print"
      style={{ background: 'rgba(27,37,51,0.4)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-lg shadow-2xl overflow-hidden text-xs"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--ng)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
              Select Failed Items for Rejection
            </h3>
          </div>
          <button onClick={onClose} style={{ color: 'var(--muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p style={{ color: 'var(--muted)' }}>
            Optionally select the specific control items that failed. You can reject without selecting any fields.
          </p>

          <div className="space-y-1 max-h-56 overflow-y-auto rounded-lg p-2"
            style={{ border: '1px solid var(--line)', background: 'var(--surface2)' }}>
            {controlItems.map((item) => {
              const isSelected = item.item_id ? selectedIds.includes(item.item_id) : false;
              return (
                <div
                  key={item.item_id || item.serial_no}
                  onClick={() => toggleSelect(item.item_id)}
                  className="p-2 rounded-lg cursor-pointer flex items-start gap-2.5 transition-colors"
                  style={isSelected
                    ? { border: '1px solid var(--ng)', background: 'var(--ng-bg)', color: 'var(--ng)' }
                    : { border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }
                  }
                >
                  <div className="mt-0.5">
                    {isSelected
                      ? <CheckSquare className="w-4 h-4" style={{ color: 'var(--ng)' }} />
                      : <Square className="w-4 h-4" style={{ color: 'var(--muted)' }} />
                    }
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">#{item.serial_no} {item.control_item_name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
                        style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>
                        {item.stage_name}
                      </span>
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
                      Spec: {item.specification_content}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-1">
            <label className="sv-label">Defect remarks (optional)</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Enter details on the defect or observation…"
              rows={2}
              className="w-full rounded-lg p-2 outline-none text-xs resize-none"
              style={{ border: '1px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)' }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--line2)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-lg" style={{ border: '1px solid #f1b8b5', background: 'var(--ng-bg)', color: 'var(--ng)' }}>
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 flex items-center justify-between"
          style={{ borderTop: '1px solid var(--line)' }}>
          <button onClick={onClose} className="font-medium text-sm" style={{ color: 'var(--muted)' }}>
            Cancel
          </button>
          <button
            disabled={isSubmitting}
            onClick={() => onSubmit(selectedIds, remarks)}
            className="btn danger sm"
          >
            {isSubmitting
              ? 'Submitting…'
              : selectedIds.length > 0
              ? `Confirm Rejection (${selectedIds.length} fields)`
              : 'Confirm Rejection'}
          </button>
        </div>
      </div>
    </div>
  );
};
