import React, { useState } from 'react';
import { X, ShieldCheck, PauseCircle, XCircle, CheckCircle2, AlertOctagon } from 'lucide-react';
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
      setErrorMsg('FR-036 Mandate: You must enter a non-empty validation reason to place a batch on Hold.');
      return;
    }

    onSubmit(selectedDecision, remarks, holdReason, []);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm no-print">
      <div className="bg-white border-4 border-black w-full max-w-xl shadow-2xl">
        {/* Header */}
        <div className="bg-black text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-white" />
            <h2 className="font-black text-sm uppercase tracking-wider">
              SUPERVISOR QUALITY GOVERNANCE & SIGN-OFF
            </h2>
          </div>
          <button onClick={onClose} className="text-white hover:text-zinc-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Operator status summary */}
          <div className="border-2 border-black p-3.5 bg-zinc-50 font-mono text-xs">
            <div className="flex justify-between items-center mb-1">
              <span className="font-bold text-black uppercase">Batch Inspection Run:</span>
              <span className="font-extrabold">{batch.lot_number} ({batch.sheet_id})</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-bold text-black uppercase">Operator Evaluation:</span>
              <span className={`px-2 py-0.5 text-xs font-bold uppercase ${
                isOperatorRejected ? 'bg-black text-white' : 'border border-black font-extrabold'
              }`}>
                {batch.status.replace('_', ' ')}
              </span>
            </div>
          </div>

          {/* Decision Selection Grid */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-black">
              Select Supervisor Action:
            </label>

            {isOperatorRejected ? (
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedDecision('ACCEPT_REJECTION')}
                  className={`p-3 border-2 text-left font-mono transition-colors ${
                    selectedDecision === 'ACCEPT_REJECTION'
                      ? 'border-black bg-black text-white'
                      : 'border-black bg-white text-black hover:bg-zinc-100'
                  }`}
                >
                  <CheckCircle2 className="w-5 h-5 mb-1" />
                  <div className="font-extrabold text-xs uppercase leading-tight">Accept (Override)</div>
                  <div className="text-[10px] opacity-75 mt-0.5">Authorize engineering concession</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedDecision('CONTINUE_REJECTION')}
                  className={`p-3 border-2 text-left font-mono transition-colors ${
                    selectedDecision === 'CONTINUE_REJECTION'
                      ? 'border-black bg-black text-white'
                      : 'border-black bg-white text-black hover:bg-zinc-100'
                  }`}
                >
                  <XCircle className="w-5 h-5 mb-1" />
                  <div className="font-extrabold text-xs uppercase leading-tight">Continue Reject</div>
                  <div className="text-[10px] opacity-75 mt-0.5">Permanent batch rejection</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedDecision('HOLD')}
                  className={`p-3 border-2 text-left font-mono transition-colors ${
                    selectedDecision === 'HOLD'
                      ? 'border-black bg-black text-white'
                      : 'border-black bg-white text-black hover:bg-zinc-100'
                  }`}
                >
                  <PauseCircle className="w-5 h-5 mb-1" />
                  <div className="font-extrabold text-xs uppercase leading-tight">Hold Batch</div>
                  <div className="text-[10px] opacity-75 mt-0.5">Requires validation reason</div>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedDecision('APPROVE')}
                  className={`p-3 border-2 text-left font-mono transition-colors ${
                    selectedDecision === 'APPROVE'
                      ? 'border-black bg-black text-white'
                      : 'border-black bg-white text-black hover:bg-zinc-100'
                  }`}
                >
                  <CheckCircle2 className="w-5 h-5 mb-1" />
                  <div className="font-extrabold text-xs uppercase leading-tight">Final Approve</div>
                  <div className="text-[10px] opacity-75 mt-0.5">Confirm quality compliance</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedDecision('HOLD')}
                  className={`p-3 border-2 text-left font-mono transition-colors ${
                    selectedDecision === 'HOLD'
                      ? 'border-black bg-black text-white'
                      : 'border-black bg-white text-black hover:bg-zinc-100'
                  }`}
                >
                  <PauseCircle className="w-5 h-5 mb-1" />
                  <div className="font-extrabold text-xs uppercase leading-tight">Hold Batch</div>
                  <div className="text-[10px] opacity-75 mt-0.5">Quarantine pending audit</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedDecision('REJECT')}
                  className={`p-3 border-2 text-left font-mono transition-colors ${
                    selectedDecision === 'REJECT'
                      ? 'border-black bg-black text-white'
                      : 'border-black bg-white text-black hover:bg-zinc-100'
                  }`}
                >
                  <XCircle className="w-5 h-5 mb-1" />
                  <div className="font-extrabold text-xs uppercase leading-tight">Reject Batch</div>
                  <div className="text-[10px] opacity-75 mt-0.5">Mark lot as rejected</div>
                </button>
              </div>
            )}
          </div>

          {/* Hold reason input if HOLD selected */}
          {selectedDecision === 'HOLD' && (
            <div className="space-y-1.5 p-3.5 border-2 border-black bg-zinc-50">
              <label className="block text-xs font-bold uppercase tracking-wider text-black flex items-center gap-1.5">
                <AlertOctagon className="w-4 h-4 text-black" />
                Mandatory Hold Validation Reason (FR-036):
              </label>
              <textarea
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="Enter specific technical or calibration justification for quarantine hold..."
                rows={2}
                className="w-full border-2 border-black p-2 text-xs font-mono focus:outline-none"
                autoFocus
              />
            </div>
          )}

          {/* General Remarks */}
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wider text-black">
              Supervisor Notes & Audit Remarks:
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Visual and micrometer check verified. Lot released to dispatch..."
              rows={2}
              className="w-full border-2 border-black p-2 text-xs font-mono focus:outline-none"
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
            disabled={isSubmitting}
            onClick={handleExecute}
            className="bg-black text-white text-xs font-extrabold px-6 py-2.5 uppercase hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? 'Processing...' : 'Confirm Decision'}
          </button>
        </div>
      </div>
    </div>
  );
};
