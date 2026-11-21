import React, { useState, useEffect, useRef } from 'react';
import { Camera, ScanLine, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import { resolveQR } from '../api';
import { User, QRResolveResult } from '../types';
import { OnTheFlyRegisterModal } from './OnTheFlyRegisterModal';
import { TFTScannerModal } from './TFTScannerModal';

interface UniversalScanBarProps {
  currentUser: User;
  onBatchResolved: (batchId: number) => void;
  onTemplateResolved?: (sheetId: string) => void;
}

const SAMPLES = [
  { label: 'Barcode: TAA-B-24117', raw: 'TAA-B-24117' },
  { label: 'QR with JSON: B-24118', raw: '{"sheet":"SH-PCB-01","batch":"B-24118"}' },
  { label: 'QR with URL: B-24119', raw: 'https://taa.example/inspect?batch=B-24119' },
  { label: 'GS1 lot: B-24120', raw: '(01)08901234567890(10)B-24120' },
  { label: 'Unregistered: B-24200', raw: 'TAA-B-24200' },
  { label: 'IFM Purge Line: LOT-2026-495A', raw: 'LOT-2026-495A' },
];

export const UniversalScanBar: React.FC<UniversalScanBarProps> = ({
  currentUser,
  onBatchResolved,
  onTemplateResolved,
}) => {
  const [scanInput, setScanInput] = useState<string>('');
  const [simDevice, setSimDevice] = useState<string>('TFT terminal');
  const [feedback, setFeedback] = useState<{ text: string; isError: boolean } | null>(null);
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [unregisteredCode, setUnregisteredCode] = useState<string | null>(null);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState<boolean>(false);
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState<boolean>(false);

  const wedgeBufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);

  // Global Keyboard-Wedge listener for TFT scanners / barcode guns anywhere on page
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.closest('input, textarea, select')) return;

      const now = performance.now();
      if (now - lastKeyTimeRef.current > 85) {
        wedgeBufferRef.current = '';
      }
      lastKeyTimeRef.current = now;

      if (e.key === 'Enter') {
        if (wedgeBufferRef.current.length >= 3) {
          e.preventDefault();
          const code = wedgeBufferRef.current.trim();
          wedgeBufferRef.current = '';
          handleProcessCode(code, 'hardware scanner (keyboard mode)');
        }
        wedgeBufferRef.current = '';
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        wedgeBufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentUser]);

  const handleProcessCode = async (rawCode: string, source: string) => {
    if (!rawCode || !rawCode.trim()) return;
    const cleanRaw = rawCode.trim();

    try {
      setIsResolving(true);
      setFeedback(null);

      const res = await resolveQR(cleanRaw);
      setFeedback({
        text: `Read ${cleanRaw} via ${source} (${res.format_detected || 'Plain code'}).`,
        isError: false,
      });

      if (res.batch_id) {
        onBatchResolved(res.batch_id);
      } else if (res.sheet_id && onTemplateResolved) {
        onTemplateResolved(res.sheet_id);
      }
    } catch (err: any) {
      const errStr = err.message || '';
      // Check if code was not registered
      if (errStr.includes('NOT_REGISTERED') || errStr.includes('isn\'t registered') || errStr.includes('404')) {
        let codeOnly = cleanRaw;
        try {
          const match = cleanRaw.match(/B-?(\d{4,6})/i) || cleanRaw.match(/TAA-([A-Za-z0-9-]+)/);
          if (match) codeOnly = match[0];
        } catch {}

        if (currentUser.role === 'admin') {
          setUnregisteredCode(codeOnly);
          setIsRegisterModalOpen(true);
          setFeedback({
            text: `${codeOnly} isn't registered yet. Opening registration modal...`,
            isError: false,
          });
        } else {
          setFeedback({
            text: `${codeOnly} isn't registered. Ask Admin to register the batch, then scan again.`,
            isError: true,
          });
        }
      } else {
        setFeedback({
          text: errStr || 'Failed to resolve scanned code.',
          isError: true,
        });
      }
    } finally {
      setIsResolving(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleProcessCode(scanInput, 'manual entry');
    setScanInput('');
  };

  return (
    <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 sm:px-6 no-print text-xs">
      <div className="max-w-7xl mx-auto space-y-2.5">
        {/* Main Scan Form */}
        <form onSubmit={handleFormSubmit} className="flex flex-wrap items-center gap-2">
          <label htmlFor="scan-bar-input" className="w-full text-slate-600 font-medium">
            Scan a batch label with any scanner, or type the code and press Enter
          </label>
          <div className="flex-1 flex gap-2 min-w-[260px]">
            <input
              id="scan-bar-input"
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              placeholder="e.g. TAA-B-24117, B-24118, LOT-2026-495A"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none bg-white font-medium"
            />
            <button
              type="submit"
              disabled={isResolving || !scanInput.trim()}
              className="bg-slate-900 hover:bg-slate-800 text-white font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition-all disabled:opacity-50"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>Open Batch</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsCameraScannerOpen(true)}
            className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-medium px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Camera className="w-3.5 h-3.5 text-slate-600" />
            <span>Scan with Camera</span>
          </button>
        </form>

        {/* Device Simulator & Quick Sample Chips */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 pt-0.5">
          <span className="font-medium text-slate-500">Simulate a device:</span>
          <select
            value={simDevice}
            onChange={(e) => setSimDevice(e.target.value)}
            className="border border-slate-200 bg-white rounded-md px-2 py-1 text-[11px] font-medium"
          >
            <option>TFT terminal</option>
            <option>Handheld barcode scanner</option>
            <option>QR scanner</option>
            <option>Phone camera</option>
          </select>

          <span className="text-slate-400">then tap a label:</span>
          <div className="flex flex-wrap gap-1.5">
            {SAMPLES.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleProcessCode(s.raw, `${simDevice} (simulated)`)}
                className="border border-dashed border-slate-300 hover:border-slate-600 bg-white hover:bg-slate-50 px-2 py-0.5 rounded text-[11px] text-slate-700 transition-all font-mono"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scan Result Feedback Banner */}
        {feedback && (
          <div
            className={`p-2 rounded-lg flex items-center gap-2 text-xs font-medium ${
              feedback.isError
                ? 'bg-red-50 text-red-700 border border-red-200'
                : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
            }`}
          >
            {feedback.isError ? (
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}
      </div>

      {/* Admin On-The-Fly Registration Modal */}
      {unregisteredCode && (
        <OnTheFlyRegisterModal
          isOpen={isRegisterModalOpen}
          unregisteredCode={unregisteredCode}
          onClose={() => {
            setIsRegisterModalOpen(false);
            setUnregisteredCode(null);
          }}
          onRegistered={(newBatchId) => {
            onBatchResolved(newBatchId);
          }}
        />
      )}

      {/* TFT Camera Scanner Modal */}
      <TFTScannerModal
        isOpen={isCameraScannerOpen}
        onClose={() => setIsCameraScannerOpen(false)}
        onResolved={(res) => {
          if (res.batch_id) onBatchResolved(res.batch_id);
          else if (res.sheet_id && onTemplateResolved) onTemplateResolved(res.sheet_id);
        }}
      />
    </div>
  );
};
