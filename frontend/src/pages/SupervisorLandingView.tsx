import React, { useState, useEffect, useRef } from 'react';
import { User, InspectionBatch } from '../types';
import { TFTScannerModal } from '../components/TFTScannerModal';
import { Camera } from 'lucide-react';

interface Props {
  currentUser: User;
  batches: InspectionBatch[];
  onSelectBatch: (batchId: number) => void;
  onScanBarcode: (barcode: string) => void;
}

export const SupervisorLandingView: React.FC<Props> = ({
  currentUser,
  batches,
  onSelectBatch,
  onScanBarcode,
}) => {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);

  // Hardware barcode scanner listener — same as OperatorLandingView
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      const now = Date.now();
      const diff = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === 'Enter') {
        if (bufferRef.current.length >= 3 && diff < 100) {
          e.preventDefault();
          const code = bufferRef.current.trim();
          bufferRef.current = '';
          onScanBarcode(code);
        } else if (isInput && barcodeInput.trim()) {
          e.preventDefault();
          onScanBarcode(barcodeInput.trim());
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && !isInput) {
        bufferRef.current = diff > 200 ? e.key : bufferRef.current + e.key;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onScanBarcode, barcodeInput]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!barcodeInput.trim()) return;
    onScanBarcode(barcodeInput.trim());
  };

  // Batches pending supervisor review
  const pendingBatches = batches.filter(b =>
    ['OPERATOR_APPROVED', 'SUPERVISOR_IN_PROGRESS', 'ON_HOLD'].includes(b.status)
  );
  const completedBatches = batches.filter(b =>
    ['APPROVED', 'REJECTED'].includes(b.status)
  );

  const statusLabel = (status: string) => {
    if (status === 'OPERATOR_APPROVED') return 'Awaiting review';
    if (status === 'SUPERVISOR_IN_PROGRESS') return 'In progress';
    if (status === 'ON_HOLD') return 'On hold';
    if (status === 'APPROVED') return 'Approved';
    if (status === 'REJECTED') return 'Rejected';
    return status.replace(/_/g, ' ');
  };

  const statusPill = (status: string) => {
    if (status === 'OPERATOR_APPROVED') return 'pill warn sm';
    if (status === 'SUPERVISOR_IN_PROGRESS') return 'pill info sm';
    if (status === 'ON_HOLD') return 'pill warn sm';
    if (status === 'APPROVED') return 'pill ok sm';
    if (status === 'REJECTED') return 'pill ng sm';
    return 'pill sm';
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8 space-y-6">

      {/* ── 1. Scan card ──────────────────────────────────────────────────── */}
      <div
        className="sv-card p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6"
      >
        {/* Left: graphic + title */}
        <div className="flex items-center gap-5">
          <div className="w-24 h-20 rounded-2xl bg-[var(--surface2)] border border-[var(--line)] flex items-center justify-center relative overflow-hidden shrink-0 shadow-xs">
            <div className="flex items-center gap-[3px] h-10 opacity-70">
              <span className="w-1.5 h-full bg-[var(--ink)] rounded-xs" />
              <span className="w-0.5 h-full bg-[var(--ink)] rounded-xs" />
              <span className="w-1 h-full bg-[var(--ink)] rounded-xs" />
              <span className="w-2 h-full bg-[var(--ink)] rounded-xs" />
              <span className="w-0.5 h-full bg-[var(--ink)] rounded-xs" />
              <span className="w-1.5 h-full bg-[var(--ink)] rounded-xs" />
              <span className="w-0.5 h-full bg-[var(--ink)] rounded-xs" />
              <span className="w-1 h-full bg-[var(--ink)] rounded-xs" />
              <span className="w-1.5 h-full bg-[var(--ink)] rounded-xs" />
              <span className="w-0.5 h-full bg-[var(--ink)] rounded-xs" />
              <span className="w-1 h-full bg-[var(--ink)] rounded-xs" />
            </div>
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] bg-[#C8463E] shadow-[0_0_8px_#C8463E]" />
          </div>

          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold text-[#23855A] bg-[#E4F3EB]">
              <span className="w-2 h-2 rounded-full bg-[#23855A]" />
              <span>Ready to scan</span>
            </div>
            <h2 className="text-2xl font-bold text-[var(--ink)] mt-1.5">Scan the lot barcode</h2>
            <p className="text-sm text-[var(--muted)] mt-1">
              Point the Smart Scan device at the lot label to open the checksheet for review.
            </p>
          </div>
        </div>

        {/* Right: manual entry */}
        <div
          className="flex flex-col md:items-end gap-1.5"
          onClick={e => e.stopPropagation()}
        >
          <form onSubmit={handleSubmit} className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              placeholder="Or enter the barcode number"
              className="w-full sm:w-72 h-[46px] px-4 rounded-xl border border-[var(--line2)] bg-[var(--surface)] text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--primary)]"
            />
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="h-[46px] w-[46px] rounded-xl border border-[var(--line2)] bg-[var(--surface)] hover:bg-[var(--surface2)] text-[var(--muted)] hover:text-[var(--ink)] flex items-center justify-center transition-colors shrink-0 shadow-xs"
              title="Scan with camera"
            >
              <Camera className="w-5 h-5" />
            </button>
            <button
              type="submit"
              className="h-[46px] px-6 rounded-xl bg-[var(--primary)] text-white font-semibold text-sm hover:opacity-90 transition-opacity shrink-0 shadow-xs"
            >
              Open
            </button>
          </form>
          <span className="text-xs text-[var(--muted)]">
            Hardware scanner input is also active on this page.
          </span>
        </div>
      </div>

      {/* Camera modal */}
      {cameraOpen && (
        <TFTScannerModal
          isOpen={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onResolved={(res) => {
            setCameraOpen(false);
            // H-7: route through onScanBarcode so the scan-required enforcement
            // path (openBatchWorkflow + status transition) is not bypassed
            const code = res.data?.lot_number || res.sheet_id;
            if (code) onScanBarcode(code);
          }}
        />
      )}

      {/* ── 2. KPIs ───────────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-base font-bold text-[var(--ink)] mb-3">Queue</h3>
        <div className="sv-card p-5 md:p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="text-3xl font-light tabular-nums" style={{ color: pendingBatches.length > 0 ? 'var(--warn)' : 'var(--ink)' }}>
              {pendingBatches.length}
            </div>
            <div className="text-xs text-[var(--muted)] mt-1 font-medium">Lots pending review</div>
          </div>
          <div>
            <div className="text-3xl font-light text-[var(--ink)] tabular-nums">
              {batches.filter(b => b.status === 'ON_HOLD').length}
            </div>
            <div className="text-xs text-[var(--muted)] mt-1 font-medium">On hold</div>
          </div>
          <div>
            <div className="text-3xl font-light text-[var(--ink)] tabular-nums">
              {completedBatches.filter(b => b.status === 'APPROVED').length}
            </div>
            <div className="text-xs text-[var(--muted)] mt-1 font-medium">Approved today</div>
          </div>
          <div>
            <div className="text-3xl font-light text-[var(--ink)] tabular-nums">
              {completedBatches.filter(b => b.status === 'REJECTED').length}
            </div>
            <div className="text-xs text-[var(--muted)] mt-1 font-medium">Rejected</div>
          </div>
        </div>
      </div>

      {/* ── 3. Lots pending your review ───────────────────────────────────── */}
      {pendingBatches.length > 0 && (
        <div>
          <h3 className="text-base font-bold text-[var(--ink)] mb-3">Lots pending your review</h3>
          <div className="sv-card flush">
            <div className="overflow-x-auto">
              <table className="vt w-full">
                <thead>
                  <tr>
                    <th className="py-3 px-4 text-left">LOT BARCODE</th>
                    <th className="py-3 px-4 text-left">PART</th>
                    <th className="py-3 px-4 text-left">QTY</th>
                    <th className="py-3 px-4 text-left">OPERATOR</th>
                    <th className="py-3 px-4 text-left">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingBatches.map(b => (
                    <tr
                      key={b.batch_id}
                      className="transition-colors"
                    >
                      <td className="py-3 px-4 mono text-xs font-semibold text-[var(--ink)]">
                        {b.lot_number}
                      </td>
                      <td className="py-3 px-4 text-sm text-[var(--ink)]">
                        {b.template?.part_name || b.template?.part_no || '—'}
                      </td>
                      <td className="py-3 px-4 text-sm tabular-nums text-[var(--ink)]">
                        {b.lot_quantity ?? '—'}
                      </td>
                      <td className="py-3 px-4 text-sm text-[var(--muted)]">
                        {b.prepared_user_name || '—'}
                      </td>
                      <td className="py-3 px-4">
                        <span className={statusPill(b.status)}>{statusLabel(b.status)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. Recent completed lots ──────────────────────────────────────── */}
      {completedBatches.length > 0 && (
        <div>
          <h3 className="text-base font-bold text-[var(--ink)] mb-3">Recently completed</h3>
          <div className="sv-card flush">
            <div className="overflow-x-auto">
              <table className="vt w-full">
                <thead>
                  <tr>
                    <th className="py-3 px-4 text-left">LOT BARCODE</th>
                    <th className="py-3 px-4 text-left">PART</th>
                    <th className="py-3 px-4 text-left">QTY</th>
                    <th className="py-3 px-4 text-left">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {completedBatches.slice(0, 8).map(b => (
                    <tr
                      key={b.batch_id}
                      className="transition-colors"
                    >
                      <td className="py-3 px-4 mono text-xs font-semibold text-[var(--ink)]">
                        {b.lot_number}
                      </td>
                      <td className="py-3 px-4 text-sm text-[var(--ink)]">
                        {b.template?.part_name || b.template?.part_no || '—'}
                      </td>
                      <td className="py-3 px-4 text-sm tabular-nums text-[var(--ink)]">
                        {b.lot_quantity ?? '—'}
                      </td>
                      <td className="py-3 px-4">
                        <span className={statusPill(b.status)}>{statusLabel(b.status)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Empty state when no batches at all */}
      {batches.length === 0 && (
        <div className="sv-card p-10 flex flex-col items-center gap-3 text-center">
          <svg className="w-10 h-10" style={{ color: 'var(--line2)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>No lots are queued for review yet</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Scan a lot barcode to open its checksheet</p>
        </div>
      )}
    </div>
  );
};
