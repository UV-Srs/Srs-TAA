import React, { useState } from 'react';
import { X, ShieldCheck, PauseCircle, XCircle, CheckCircle2 } from 'lucide-react';
import { InspectionBatch } from '../types';

interface SupervisorReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  batch: InspectionBatch;
  onSubmit: (decision: string, remarks?: string, holdReason?: string, rejectedItemIds?: number[]) => void;
  isSubmitting: boolean;
}

export const SupervisorReviewModal: React.FC<SupervisorReviewModalProps> = ({
  isOpen,
  onClose,
  batch,
  onSubmit,
  isSubmitting,
}) => {
  const [selectedDecision, setSelectedDecision] = useState<string>('APPROVE');
  const [holdReason, setHoldReason] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const isOperatorRejected = batch.status === 'OPERATOR_REJECTED';

  const handleExecute = () => {
    setErrorMsg(null);
    if (selectedDecision === 'HOLD' && (!holdReason || !holdReason.trim())) {
      setErrorMsg('A validation reason is required to place a batch on Hold (FR-036).');
      return;
    }

    onSubmit(selectedDecision, remarks, holdReason, []);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm no-print">
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-lg shadow-lg overflow-hidden text-xs">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-slate-800" />
            <h3 className="font-bold text-sm text-slate-900">
              Supervisor Quality Review
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div className="bg-slate-50 p-3 rounded border border-slate-200 flex justify-between items-center">
            <div>
              <span className="text-slate-500 font-medium block">Batch Run</span>
              <span className="font-bold text-slate-900">{batch.lot_number}</span>
            </div>
            <div className="text-right">
              <span className="text-slate-500 font-medium block">Operator Evaluation</span>
              <span className="font-semibold text-slate-800 uppercase">
                {batch.status.replace(/_/g, ' ')}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="font-semibold text-slate-700 block">Select Supervisor Decision:</label>

            {isOperatorRejected ? (
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedDecision('ACCEPT_REJECTION')}
                  className={`p-3 rounded border text-left transition-all ${
                    selectedDecision === 'ACCEPT_REJECTION'
                      ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300 text-slate-800'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 mb-1" />
                  <div className="font-bold">Override</div>
                  <div className="text-[10px] opacity-75">Accept concession</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedDecision('CONTINUE_REJECTION')}
                  className={`p-3 rounded border text-left transition-all ${
                    selectedDecision === 'CONTINUE_REJECTION'
                      ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300 text-slate-800'
                  }`}
                >
                  <XCircle className="w-4 h-4 mb-1" />
                  <div className="font-bold">Continue Reject</div>
                  <div className="text-[10px] opacity-75">Confirm failure</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedDecision('HOLD')}
                  className={`p-3 rounded border text-left transition-all ${
                    selectedDecision === 'HOLD'
                      ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300 text-slate-800'
                  }`}
                >
                  <PauseCircle className="w-4 h-4 mb-1" />
                  <div className="font-bold">Hold</div>
                  <div className="text-[10px] opacity-75">Quarantine lot</div>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedDecision('APPROVE')}
                  className={`p-3 rounded border text-left transition-all ${
                    selectedDecision === 'APPROVE'
                      ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300 text-slate-800'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 mb-1" />
                  <div className="font-bold">Approve</div>
                  <div className="text-[10px] opacity-75">Release batch</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedDecision('HOLD')}
                  className={`p-3 rounded border text-left transition-all ${
                    selectedDecision === 'HOLD'
                      ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300 text-slate-800'
                  }`}
                >
                  <PauseCircle className="w-4 h-4 mb-1" />
                  <div className="font-bold">Hold Batch</div>
                  <div className="text-[10px] opacity-75">Quarantine lot</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedDecision('REJECT')}
                  className={`p-3 rounded border text-left transition-all ${
                    selectedDecision === 'REJECT'
                      ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300 text-slate-800'
                  }`}
                >
                  <XCircle className="w-4 h-4 mb-1" />
                  <div className="font-bold">Reject</div>
                  <div className="text-[10px] opacity-75">Mark failed</div>
                </button>
              </div>
            )}
          </div>

          {selectedDecision === 'HOLD' && (
            <div className="space-y-1">
              <label className="font-medium text-slate-700 block">Hold Validation Reason (FR-036)</label>
              <textarea
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="Enter technical or quarantine reason..."
                rows={2}
                className="w-full border border-slate-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-slate-900 text-xs"
                autoFocus
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="font-medium text-slate-700 block">Review Remarks (Optional)</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Enter audit notes or observations..."
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
            disabled={isSubmitting}
            onClick={handleExecute}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg transition-all disabled:opacity-50"
          >
            {isSubmitting ? 'Recording...' : 'Confirm Review'}
          </button>
        </div>
      </div>
    </div>
  );
};
