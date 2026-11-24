import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, InspectionBatch } from '../types';
import { TFTScannerModal } from '../components/TFTScannerModal';
import { Camera } from 'lucide-react';

interface OperatorLandingViewProps {
  currentUser: User;
  batches: InspectionBatch[];
  onSelectBatch: (batchId: number) => void;
  onScanBarcode: (barcode: string) => void;
}


export const OperatorLandingView: React.FC<OperatorLandingViewProps> = ({
  currentUser,
  batches,
  onSelectBatch,
  onScanBarcode,
}) => {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);

  // Global Hardware Barcode / TFT Scanner Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if typing in standard text inputs
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      const currentTime = Date.now();
      const timeDiff = currentTime - lastKeyTimeRef.current;
      lastKeyTimeRef.current = currentTime;

      // Hardware scanners typically type characters rapidly within ~40ms and end with Enter
      if (e.key === 'Enter') {
        if (bufferRef.current.length >= 3 && timeDiff < 100) {
          e.preventDefault();
          const scannedCode = bufferRef.current.trim();
          bufferRef.current = '';
          onScanBarcode(scannedCode);
        }
        // If user pressed Enter inside the barcode input field, let the form handle it
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && !isInput) {
        // L-1: only accumulate hardware scanner input when focus is NOT on a text field
        if (timeDiff > 200) {
          bufferRef.current = e.key;
        } else {
          bufferRef.current += e.key;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onScanBarcode]);

  const handleOpenBarcode = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!barcodeInput.trim()) return;
    onScanBarcode(barcodeInput.trim());
  };

  // Resolve KPIs from real batches
  const { inspectedCount, checkedCount, badCount, totalLots } = useMemo(() => {
    if (batches.length > 0) {
      const inspected = batches.filter(
        (b) => b.status !== 'CREATED_PENDING_OPERATOR'
      ).length;
      const checked = batches.reduce((sum, b) => {
        if (b.status !== 'CREATED_PENDING_OPERATOR') return sum + (b.lot_quantity || 0);
        return sum;
      }, 0);
      const bad = batches.filter(b => b.operator_decision === 'Rejected').length;
      return {
        inspectedCount: inspected,
        checkedCount: checked,
        badCount: bad,
        totalLots: batches.length,
      };
    }
    return {
      inspectedCount: 0,
      checkedCount: 0,
      badCount: 0,
      totalLots: 0,
    };
  }, [batches]);

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* ── 1. Top Card: Scan the lot barcode ──────────────────────────────── */}
      <div
        className="sv-card p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6"
      >
        {/* Left: Barcode graphic + Title + Subtitle */}
        <div className="flex items-center gap-5">
          {/* Barcode Graphic Box with Laser line */}
          <div className="w-24 h-20 rounded-2xl bg-[var(--surface2)] border border-[var(--line)] flex items-center justify-center relative overflow-hidden shrink-0 shadow-xs">
            {/* Barcode vertical stripes */}
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
            {/* Horizontal red scanner laser line */}
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] bg-[#C8463E] shadow-[0_0_8px_#C8463E]" />
          </div>

          <div>
            {/* Ready to scan status pill */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold text-[#23855A] bg-[#E4F3EB]">
              <span className="w-2 h-2 rounded-full bg-[#23855A]" />
              <span>Ready to scan</span>
            </div>

            {/* Title */}
            <h2 className="text-2xl font-bold text-[var(--ink)] mt-1.5">Scan the lot barcode</h2>

            {/* Subtitle */}
            <p className="text-sm text-[var(--muted)] mt-1">
              Point the Smart Scan device at the lot label. The inspection opens by itself.
            </p>
          </div>
        </div>

        {/* Right: Barcode input + Open button + Prototype hint */}
        <div
          className="flex flex-col md:items-end gap-1.5"
          onClick={(e) => e.stopPropagation() /* Allow clicking input without triggering card scan */}
        >
          <form onSubmit={handleOpenBarcode} className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              placeholder="Or enter the barcode number"
              className="w-full sm:w-72 h-[46px] px-4 rounded-xl border border-[var(--line2)] bg-[var(--surface)] text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--primary)]"
            />
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="h-[46px] w-[46px] rounded-xl border border-[var(--line2)] bg-[var(--surface)] hover:bg-[var(--surface2)] text-[var(--muted)] hover:text-[var(--ink)] flex items-center justify-center transition-colors shrink-0 shadow-xs"
              title="Scan barcode with camera"
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

      {/* Camera scanner modal */}
      {cameraOpen && (
        <TFTScannerModal
          isOpen={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onResolved={(res) => {
            setCameraOpen(false);
            // H-8: route through onScanBarcode so openBatchWorkflow runs and
            // the batch status transitions correctly (don't bypass scan enforcement)
            const code = res.data?.lot_number || res.sheet_id;
            if (code) onScanBarcode(code);
          }}
        />
      )}

      {/* ── 2. "Today" KPIs Section ────────────────────────────────────────── */}
      <div>
        <h3 className="text-base font-bold text-[var(--ink)] mb-3">Today</h3>
        <div className="sv-card p-5 md:p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="text-3xl font-light text-[var(--ink)] tabular-nums">{inspectedCount}</div>
            <div className="text-xs text-[var(--muted)] mt-1 font-medium">Lots inspected</div>
          </div>
          <div>
            <div className="text-3xl font-light text-[var(--ink)] tabular-nums">{checkedCount}</div>
            <div className="text-xs text-[var(--muted)] mt-1 font-medium">Items checked</div>
          </div>
          <div>
            <div className="text-3xl font-light text-[var(--ink)] tabular-nums">{badCount}</div>
            <div className="text-xs text-[var(--muted)] mt-1 font-medium">Bad items</div>
          </div>
          <div>
            <div className="text-3xl font-light text-[var(--ink)] tabular-nums">{totalLots}</div>
            <div className="text-xs text-[var(--muted)] mt-1 font-medium">Lots in total</div>
          </div>
        </div>
      </div>

      {/* ── 3. "Your recent lots" Table Section ────────────────────────────── */}
      <div>
        <h3 className="text-base font-bold text-[var(--ink)] mb-3">Your recent lots</h3>
        <div className="sv-card flush">
          <div className="overflow-x-auto">
            <table className="vt w-full">
              <thead>
                <tr>
                  <th className="py-3 px-4 text-left">BARCODE</th>
                  <th className="py-3 px-4 text-left">LOT</th>
                  <th className="py-3 px-4 text-left">ITEMS</th>
                  <th className="py-3 px-4 text-left">BAD</th>
                  <th className="py-3 px-4 text-left">CLEARANCE</th>
                  <th className="py-3 px-4 text-left">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {batches.length > 0
                  ? batches.slice(0, 10).map((b) => {
                      const lotShort = `Lot ${b.lot_number.slice(-9, -3) || b.batch_id}`;
                      const isSupervisor = ['OPERATOR_APPROVED', 'SUPERVISOR_IN_PROGRESS'].includes(b.status);
                      const isCompleted = ['APPROVED', 'REJECTED'].includes(b.status);
                      const statusLabel = isCompleted
                        ? 'Completed'
                        : isSupervisor
                        ? 'With supervisor'
                        : 'Inspecting';
                      const statusPillClass = isCompleted ? 'pill ok sm' : isSupervisor ? 'pill warn sm' : 'pill info sm';

                      return (
                        <tr
                          key={b.batch_id}
                          className="transition-colors"
                        >
                          <td className="py-3 px-4 mono text-xs font-semibold text-[var(--ink)]">
                            {b.lot_number}
                          </td>
                          <td className="py-3 px-4 text-sm font-semibold text-[var(--ink)]">
                            {lotShort}
                          </td>
                          <td className="py-3 px-4 text-sm text-[var(--ink)] tabular-nums">
                            {b.lot_quantity ?? '—'}
                          </td>
                          <td className="py-3 px-4 text-sm text-[var(--ink)] tabular-nums">
                            —
                          </td>
                          <td className="py-3 px-4 text-xs text-[var(--muted)]">
                            {b.status === 'REJECTED' ? 'Cleared, NG items segregated' : 'Lot cleared'}
                          </td>
                          <td className="py-3 px-4">
                            <span className={statusPillClass}>{statusLabel}</span>
                          </td>
                        </tr>
                      );
                    })
                  : (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-sm text-[var(--muted)]">
                        No lots yet — scan a barcode to begin.
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
