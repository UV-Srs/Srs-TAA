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
      setErrorMsg('FR-027 Mandate: You must select at least one failed control item to proceed with batch rejection.');
      return;
    }
    onSubmit(selectedIds, remarks);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm no-print">
      <div className="bg-white border-4 border-black w-full max-w-xl shadow-2xl">
        {/* Header */}
        <div className="bg-black text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-white" />
            <h2 className="font-black text-sm uppercase tracking-wider">
              REJECTION SPECIFICATION — FAILED ITEMS SELECTION
            </h2>
          </div>
          <button onClick={onClose} className="text-white hover:text-zinc-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <div className="border-2 border-black p-3.5 bg-zinc-50">
            <p className="text-xs font-bold text-black uppercase">
              Mandatory Multi-Select Identification (FR-027)
            </p>
            <p className="text-[11px] text-zinc-600 mt-0.5">
              Select all items that failed appearance, pressure leakage, or variable micrometer/caliper tolerance checks.
            </p>
          </div>

          {/* List of items with checkboxes */}
          <div className="space-y-1.5 max-h-60 overflow-y-auto border-2 border-black p-2 bg-white">
            {controlItems.map((item) => {
              const isSelected = item.item_id ? selectedIds.includes(item.item_id) : false;
              return (
                <div
                  key={item.item_id || item.serial_no}
                  onClick={() => toggleSelect(item.item_id)}
                  className={`p-2.5 border cursor-pointer flex items-start gap-3 transition-colors ${
                    isSelected
                      ? 'border-black bg-zinc-100 font-bold'
                      : 'border-zinc-300 hover:border-black'
                  }`}
                >
                  <div className="mt-0.5">
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-black" />
                    ) : (
                      <Square className="w-4 h-4 text-zinc-400" />
                    )}
                  </div>
                  <div className="text-xs font-mono flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-black font-extrabold">
                        S.No {item.serial_no}: {item.control_item_name}
                      </span>
                      <span className="text-[10px] bg-black text-white px-1.5 py-0.2 uppercase">
                        {item.stage_name}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-600 mt-0.5">
                      Spec: {item.specification_content}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Remarks */}
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wider text-black">
              Defect Description / Failure Remarks:
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Provide defect details, e.g. Outer Dia exceeded tolerance limit on Sample #2 (8.25mm vs max 8.17mm)..."
              rows={3}
              className="w-full border-2 border-black p-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>

          {errorMsg && (
            <div className="border border-black bg-black text-white p-2.5 text-xs font-mono">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-zinc-100 border-t-2 border-black px-6 py-3 flex items-center justify-between">
          <button
            onClick={onClose}
            className="text-xs font-bold uppercase text-black hover:underline"
          >
            Cancel
          </button>
          <button
            disabled={isSubmitting || selectedIds.length === 0}
            onClick={handleConfirm}
            className="bg-black text-white text-xs font-extrabold px-6 py-2.5 uppercase hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? 'Recording...' : `Confirm Rejection (${selectedIds.length} Items)`}
          </button>
        </div>
      </div>
    </div>
  );
};
