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
  const [remarks, setRemarks] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const toggleSelect = (itemId?: number) => {
    if (!itemId) return;
    setErrorMsg(null);
    if (selectedIds.includes(itemId)) {
      setSelectedIds(selectedIds.filter((id) => id !== itemId));
    } else {
      setSelectedIds([...selectedIds, itemId]);
    }
  };

  const handleConfirm = () => {
    if (selectedIds.length === 0) {
      setErrorMsg('Please select at least one failed control item to submit a rejection (FR-027).');
      return;
    }
    onSubmit(selectedIds, remarks);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm no-print">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-xl text-xs">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h3 className="font-bold text-sm text-slate-900">
              Select Failed Items for Rejection
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className="text-slate-600">
            Select the specific control items that failed tolerance or quality criteria:
          </p>

          <div className="space-y-1.5 max-h-56 overflow-y-auto border border-slate-200 rounded-xl p-2 bg-slate-50/50">
            {controlItems.map((item) => {
              const isSelected = item.item_id ? selectedIds.includes(item.item_id) : false;
              return (
                <div
                  key={item.item_id || item.serial_no}
                  onClick={() => toggleSelect(item.item_id)}
                  className={`p-2.5 rounded-lg border cursor-pointer flex items-start gap-2.5 transition-colors ${
                    isSelected
                      ? 'border-red-300 bg-red-50 text-red-900'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="mt-0.5">
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-red-600" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">
                        #{item.serial_no} {item.control_item_name}
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium bg-slate-100 px-1.5 py-0.5 rounded">
                        {item.stage_name}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Spec: {item.specification_content}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-1">
            <label className="font-medium text-slate-700">Defect Remarks (Optional)</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Enter details on the defect or observation..."
              rows={2}
              className="w-full border border-slate-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-slate-900 text-xs"
            />
          </div>

          {errorMsg && (
            <div className="border border-red-200 bg-red-50 text-red-700 p-2.5 rounded-lg text-xs">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={onClose}
            className="font-medium text-slate-600 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            disabled={isSubmitting || selectedIds.length === 0}
            onClick={handleConfirm}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-all disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : `Confirm Rejection (${selectedIds.length})`}
          </button>
        </div>
      </div>
    </div>
  );
};
