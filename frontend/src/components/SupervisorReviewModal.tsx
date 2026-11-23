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
      setErrorMsg('A validation reason is required to place a batch on Hold.');
      return;
    }
    onSubmit(selectedDecision, remarks, holdReason, []);
  };

  const decisionBtnStyle = (key: string): React.CSSProperties => selectedDecision === key
    ? { background: 'var(--primary)', color: 'var(--on-primary)', border: '1px solid var(--primary)' }
    : { background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print"
      style={{ background: 'rgba(27,37,51,0.4)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-lg shadow-2xl overflow-hidden text-xs"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" style={{ color: 'var(--primary)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
              Supervisor Quality Review
            </h3>
          </div>
          <button onClick={onClose} style={{ color: 'var(--muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div className="p-3 rounded-lg flex justify-between items-center"
            style={{ background: 'var(--surface2)', border: '1px solid var(--line)' }}>
            <div>
              <span className="font-medium block" style={{ color: 'var(--muted)' }}>Batch Run</span>
              <span className="font-semibold" style={{ color: 'var(--ink)' }}>{batch.lot_number}</span>
            </div>
            <div className="text-right">
              <span className="font-medium block" style={{ color: 'var(--muted)' }}>Operator Evaluation</span>
              <span className="font-semibold uppercase" style={{ color: 'var(--ink)' }}>
                {batch.status.replace(/_/g, ' ')}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="sv-label">Select Supervisor Decision</label>

            {isOperatorRejected ? (
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'ACCEPT_REJECTION', Icon: CheckCircle2, label: 'Override', sub: 'Accept concession' },
                  { key: 'CONTINUE_REJECTION', Icon: XCircle,       label: 'Continue Reject', sub: 'Confirm failure' },
                  { key: 'HOLD',               Icon: PauseCircle,   label: 'Hold', sub: 'Quarantine lot' },
                ].map(({ key, Icon, label, sub }) => (
                  <button key={key} type="button" onClick={() => setSelectedDecision(key)}
                    className="p-3 rounded-xl text-left transition-all"
                    style={decisionBtnStyle(key)}>
                    <Icon className="w-4 h-4 mb-1" />
                    <div className="font-semibold">{label}</div>
                    <div className="text-[10px] opacity-75">{sub}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'APPROVE', Icon: CheckCircle2, label: 'Approve',    sub: 'Release batch' },
                  { key: 'HOLD',    Icon: PauseCircle,  label: 'Hold Batch', sub: 'Quarantine lot' },
                  { key: 'REJECT',  Icon: XCircle,      label: 'Reject',     sub: 'Mark failed' },
                ].map(({ key, Icon, label, sub }) => (
                  <button key={key} type="button" onClick={() => setSelectedDecision(key)}
                    className="p-3 rounded-xl text-left transition-all"
                    style={decisionBtnStyle(key)}>
                    <Icon className="w-4 h-4 mb-1" />
                    <div className="font-semibold">{label}</div>
                    <div className="text-[10px] opacity-75">{sub}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedDecision === 'HOLD' && (
            <div className="space-y-1">
              <label className="sv-label">Hold Validation Reason</label>
              <textarea
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="Enter technical or quarantine reason…"
                rows={2}
                className="w-full rounded-lg p-2 outline-none text-xs resize-none"
                style={{ border: '1px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)' }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--line2)'; e.currentTarget.style.boxShadow = 'none'; }}
                autoFocus
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="sv-label">Review Remarks (Optional)</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Enter audit notes or observations…"
              rows={2}
              className="w-full rounded-lg p-2 outline-none text-xs resize-none"
              style={{ border: '1px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)' }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--line2)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-lg text-xs" style={{ border: '1px solid #f1b8b5', background: 'var(--ng-bg)', color: 'var(--ng)' }}>
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
            onClick={handleExecute}
            className="btn primary sm"
          >
            {isSubmitting ? 'Recording…' : 'Confirm Review'}
          </button>
        </div>
      </div>
    </div>
  );
};
