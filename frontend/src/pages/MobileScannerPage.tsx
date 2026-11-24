import React, { useState, useRef } from 'react';
import { User, QRResolveResult } from '../types';
import { openBatchWorkflow, logoutUser } from '../api';
import { TFTScannerModal } from '../components/TFTScannerModal';
import { liveSync } from '../liveSync';
import {
  ScanLine, CheckCircle2, AlertCircle, LogOut, Clock,
  ChevronRight, Layers, Loader2
} from 'lucide-react';

interface MobileScannerPageProps {
  currentUser: User;
  onLogout: () => void;
  /** When set, shows an "Inspect here" button that leaves scanner mode (used for operators). */
  onExitScannerMode?: () => void;
}

interface ScanEntry {
  id: number;
  lotNumber: string;
  batchId: number | null;
  status: 'ok' | 'error' | 'readonly' | 'not_found';
  message: string;
  time: string;
}

const roleBadge: Record<string, string> = {
  admin:      'bg-purple-100 text-purple-800',
  supervisor: 'bg-blue-100   text-blue-800',
  operator:   'bg-emerald-100 text-emerald-800',
};

export const MobileScannerPage: React.FC<MobileScannerPageProps> = ({ currentUser, onLogout, onExitScannerMode }) => {
  const [isScanOpen, setIsScanOpen]   = useState(false);
  const [isOpening, setIsOpening]     = useState(false);
  const [lastResult, setLastResult]   = useState<ScanEntry | null>(null);
  const [history, setHistory]         = useState<ScanEntry[]>([]);
  const nextId = useRef(0);

  // keep WebSocket alive while phone is the active scanner
  React.useEffect(() => { liveSync.connect(); }, []);

  const handleResolved = async (res: QRResolveResult) => {
    setIsOpening(true);

    let entry: ScanEntry;

    if (res.type === 'BATCH' && res.batch_id) {
      // Open workflow so prepared_by / checked_by is assigned on the laptop side too
      try { await openBatchWorkflow(res.batch_id); } catch { /* already open or finished */ }

      entry = {
        id: ++nextId.current,
        lotNumber: res.data?.lot_number ?? `Batch #${res.batch_id}`,
        batchId: res.batch_id,
        status: res.read_only ? 'readonly' : 'ok',
        message: res.read_only
          ? 'Already submitted — opened read-only on desktop'
          : 'Opened on desktop ✓',
        time: new Date().toLocaleTimeString(),
      };
    } else {
      entry = {
        id: ++nextId.current,
        lotNumber: res.sheet_id,
        batchId: null,
        status: 'ok',
        message: `Template ${res.sheet_id} — no active batch`,
        time: new Date().toLocaleTimeString(),
      };
    }

    setLastResult(entry);
    setHistory(prev => [entry, ...prev.slice(0, 9)]);
    setIsOpening(false);
  };

  const handleLogout = () => { logoutUser(); onLogout(); };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col select-none">

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 pt-safe-top pt-6 pb-4">
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">TFT Scanner</p>
          <p className="text-sm font-bold text-white leading-tight mt-0.5">{currentUser.full_name}</p>
        </div>
        <div className="flex items-center gap-3">
          {onExitScannerMode && (
            <button
              type="button"
              onClick={onExitScannerMode}
              className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              Inspect here
            </button>
          )}
          <span className={`text-[11px] font-bold uppercase px-2.5 py-1 rounded-full ${roleBadge[currentUser.role] ?? 'bg-slate-700 text-slate-300'}`}>
            {currentUser.role}
          </span>
          <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-white transition-colors" aria-label="Log out">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Main scan area ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6 gap-6">

        {/* Resolving spinner */}
        {isOpening && (
          <div className="w-full max-w-sm bg-slate-800 rounded-2xl p-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-slate-400 animate-spin shrink-0" />
            <p className="text-sm text-slate-300">Opening on desktop…</p>
          </div>
        )}

        {/* Last result card */}
        {!isOpening && lastResult && (
          <div className={`w-full max-w-sm rounded-2xl p-4 flex items-start gap-3 border ${
            lastResult.status === 'ok'        ? 'bg-emerald-900/50 border-emerald-700' :
            lastResult.status === 'readonly'  ? 'bg-amber-900/40  border-amber-700'   :
            lastResult.status === 'not_found' ? 'bg-violet-900/40  border-violet-700' :
                                               'bg-red-900/40     border-red-700'
          }`}>
            {lastResult.status === 'ok'        && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />}
            {lastResult.status === 'readonly'  && <AlertCircle  className="w-5 h-5 text-amber-400  shrink-0 mt-0.5" />}
            {lastResult.status === 'not_found' && <AlertCircle  className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />}
            {lastResult.status === 'error'     && <AlertCircle  className="w-5 h-5 text-red-400    shrink-0 mt-0.5" />}
            <div>
              <p className="text-sm font-bold text-white">{lastResult.lotNumber}</p>
              <p className="text-xs text-slate-300 mt-0.5">{lastResult.message}</p>
              {lastResult.batchId && (
                <p className="text-[11px] text-slate-500 mt-1">Batch #{lastResult.batchId}</p>
              )}
            </div>
          </div>
        )}

        {/* Big scan button */}
        <button
          onClick={() => setIsScanOpen(true)}
          disabled={isOpening}
          className="w-52 h-52 rounded-full bg-white text-slate-900 flex flex-col items-center justify-center gap-3 shadow-2xl active:scale-95 transition-transform disabled:opacity-40"
        >
          <ScanLine className="w-16 h-16" />
          <span className="text-sm font-bold tracking-wide">TAP TO SCAN</span>
        </button>

        <p className="text-xs text-slate-500 text-center max-w-xs leading-relaxed">
          Scan the <span className="text-slate-300 font-semibold">TAA QR code</span> or <span className="text-slate-300 font-semibold">lot barcode</span> from the printed inspection label — not the vendor barcode on the box
        </p>
      </div>

      {/* ── Session history ──────────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="border-t border-slate-800 px-5 pb-safe-bottom pb-8">
          <div className="flex items-center gap-2 py-3">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Session history</p>
          </div>
          <div className="space-y-2">
            {history.map(entry => (
              <div key={entry.id} className="flex items-center justify-between bg-slate-800 rounded-xl px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  {entry.status === 'ok'        && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                  {entry.status === 'readonly'  && <Layers       className="w-4 h-4 text-amber-400  shrink-0" />}
                  {entry.status === 'not_found' && <AlertCircle  className="w-4 h-4 text-violet-400 shrink-0" />}
                  {entry.status === 'error'     && <AlertCircle  className="w-4 h-4 text-red-400    shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{entry.lotNumber}</p>
                    <p className="text-[10px] text-slate-500 truncate">{entry.message}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-3">
                  <span className="text-[10px] text-slate-500">{entry.time}</span>
                  <ChevronRight className="w-3 h-3 text-slate-600" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Scanner modal ────────────────────────────────────────────── */}
      {isScanOpen && (
        <TFTScannerModal
          isOpen={isScanOpen}
          onClose={() => setIsScanOpen(false)}
          onResolved={(res) => { setIsScanOpen(false); handleResolved(res); }}
          onScanError={(code, _err) => {
            const isNotFound = typeof _err?.message === 'string' && (_err.message.includes("isn't registered") || _err.message.includes('NOT_REGISTERED'));
            if (isNotFound) {
              const entry: ScanEntry = {
                id: ++nextId.current,
                lotNumber: code,
                batchId: null,
                status: 'not_found',
                message: currentUser.role === 'admin'
                  ? 'Not registered — laptop will prompt to create a new sheet'
                  : 'Not registered. Scan the TAA QR code or lot barcode from the printed inspection label.',
                time: new Date().toLocaleTimeString(),
              };
              setLastResult(entry);
              setHistory(prev => [entry, ...prev.slice(0, 9)]);
              setIsScanOpen(false);
            }
          }}
        />
      )}
    </div>
  );
};
