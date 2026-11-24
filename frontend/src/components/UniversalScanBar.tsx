import React, { useState, useEffect, useRef } from 'react';
import { Camera, Search, ArrowRight, CheckCircle2, AlertCircle, Barcode } from 'lucide-react';
import { resolveQR } from '../api';
import { User, QRResolveResult } from '../types';
import { OnTheFlyRegisterModal } from './OnTheFlyRegisterModal';
import { TFTScannerModal } from './TFTScannerModal';

interface UniversalScanBarProps {
  currentUser: User;
  onBatchResolved: (batchId: number) => void;
  onTemplateResolved?: (sheetId: string) => void;
  onRequestCreateBatch?: (code: string) => void;
  /**
   * 'bar' = slim full-width strip (default). 'hero' = large scan card used on the operator home.
   * 'listener' = no visible bar; keeps the hardware-scanner (keyboard wedge) listener active and shows a toast.
   */
  variant?: 'bar' | 'hero' | 'listener';
}

export const UniversalScanBar: React.FC<UniversalScanBarProps> = ({
  currentUser,
  onBatchResolved,
  onTemplateResolved,
  onRequestCreateBatch,
  variant = 'bar',
}) => {
  const [scanInput, setScanInput] = useState<string>('');
  const [feedback, setFeedback] = useState<{ text: string; isError: boolean } | null>(null);
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [unregisteredCode, setUnregisteredCode] = useState<string | null>(null);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState<boolean>(false);
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState<boolean>(false);

  const wedgeBufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);

  // Keyboard-wedge listener: Automatically catches USB / Bluetooth barcode scanner inputs
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
          handleProcessCode(code);
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

  const handleProcessCode = async (rawCode: string) => {
    if (!rawCode || !rawCode.trim()) return;
    const cleanRaw = rawCode.trim();

    try {
      setIsResolving(true);
      setFeedback(null);

      const res = await resolveQR(cleanRaw);
      setFeedback({
        text: `Loaded ${cleanRaw}`,
        isError: false,
      });

      // Clear feedback after 4 seconds
      setTimeout(() => setFeedback(null), 4000);

      if (res.batch_id) {
        onBatchResolved(res.batch_id);
      } else if (res.sheet_id && onTemplateResolved) {
        onTemplateResolved(res.sheet_id);
      }
    } catch (err: any) {
      const errStr = err.message || '';
      if (errStr.includes('NOT_REGISTERED') || errStr.includes("isn't registered") || errStr.includes('404')) {
        let codeOnly = cleanRaw;
        try {
          const match = cleanRaw.match(/B-?(\d{4,6})/i) || cleanRaw.match(/TAA-([A-Za-z0-9-]+)/);
          if (match) codeOnly = match[0];
        } catch {}

        if (currentUser.role === 'admin') {
          if (onRequestCreateBatch) {
            onRequestCreateBatch(codeOnly);
          } else {
            setUnregisteredCode(codeOnly);
            setIsRegisterModalOpen(true);
          }
        } else {
          setFeedback({
            text: `Batch "${codeOnly}" is not registered. Please ask an Admin to register this lot.`,
            isError: true,
          });
        }
      } else {
        setFeedback({
          text: err.message || 'Could not find checksheet for this code.',
          isError: true,
        });
      }
    } finally {
      setIsResolving(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleProcessCode(scanInput);
    setScanInput('');
  };

  // Status pill for the hero card: resolving > feedback > idle
  const heroStatus = isResolving
    ? { label: 'Opening…', cls: 'bg-blue-50 text-brand', dot: 'bg-brand animate-pulse' }
    : feedback?.isError
    ? { label: 'Not found', cls: 'bg-red-50 text-red-700', dot: 'bg-red-500' }
    : feedback
    ? { label: 'Lot loaded', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' }
    : { label: 'Ready to scan', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' };

  const heroCard = (
    <section className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center gap-5 lg:gap-8">
      <div className="flex items-start sm:items-center gap-4 sm:gap-5 flex-1 min-w-0">
        {/* Barcode tile doubles as the camera-scan trigger */}
        <button
          type="button"
          onClick={() => setIsCameraScannerOpen(true)}
          title="Scan with camera"
          className="shrink-0 w-20 h-16 sm:w-36 sm:h-24 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors flex items-center justify-center"
        >
          <svg viewBox="0 0 112 64" className="w-14 sm:w-28 h-auto" aria-hidden="true">
            {[0, 5, 8, 14, 17, 22, 27, 30, 36, 39, 44, 47, 53, 58, 61, 66, 71, 74, 80, 83, 88, 92, 97, 100, 106].map((x, i) => (
              <rect key={x} x={x + 2} y={6} width={i % 3 === 0 ? 3 : 1.5} height={52} fill="#334155" />
            ))}
            <rect x="0" y="17" width="112" height="2.5" fill="#EF4444" />
          </svg>
        </button>

        <div className="min-w-0">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${heroStatus.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${heroStatus.dot}`} />
            {heroStatus.label}
          </span>
          <h2 className="mt-2 text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight">Scan the lot barcode</h2>
          <p className="mt-1 text-sm text-slate-500 leading-relaxed">
            Point the TAA device at the lot label. The inspection opens by itself.
          </p>
        </div>
      </div>

      <div className="w-full lg:w-[440px] shrink-0">
        <form onSubmit={handleFormSubmit} className="flex items-stretch gap-2">
          <input
            type="text"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            placeholder="Or enter the barcode number"
            className="flex-1 min-w-0 px-4 py-3 bg-white border border-slate-300 hover:border-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/20 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none transition-all"
          />
          <button
            type="submit"
            disabled={isResolving}
            className="px-6 py-3 bg-brand hover:bg-brand-dark text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {isResolving ? 'Opening…' : 'Open'}
          </button>
        </form>
        <p className={`mt-2 text-xs ${feedback?.isError ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
          {feedback ? feedback.text : 'No device? Tap the barcode picture to scan with the camera.'}
        </p>
      </div>
    </section>
  );

  return (
    <div className={variant === 'bar' ? 'bg-white border-b border-slate-200 px-4 py-2.5 sm:px-6 no-print' : 'no-print'}>
      {variant === 'listener' && (isResolving || feedback) && (
        <div
          role="status"
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium ${
            feedback?.isError ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'
          }`}
        >
          {isResolving ? 'Opening scanned lot…' : feedback?.text}
        </div>
      )}
      {variant === 'listener' ? null : variant === 'hero' ? heroCard : (
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Search & Scan Box */}
        <form onSubmit={handleFormSubmit} className="w-full sm:max-w-xl flex items-center gap-2">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Barcode className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              placeholder="Scan barcode or type Lot / Sheet ID (e.g. B-24117)..."
              className="w-full pl-9 pr-20 py-2 bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-slate-900 focus:bg-white rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 transition-all outline-none"
            />
            <div className="absolute inset-y-0 right-1 flex items-center">
              <button
                type="submit"
                disabled={isResolving || !scanInput.trim()}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[11px] font-semibold transition-all disabled:opacity-40 disabled:hover:bg-slate-900"
              >
                {isResolving ? 'Opening...' : 'Open'}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsCameraScannerOpen(true)}
            title="Scan QR or barcode with camera"
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium transition-colors shrink-0"
          >
            <Camera className="w-3.5 h-3.5 text-slate-600" />
            <span className="hidden md:inline">Camera</span>
          </button>
        </form>

        {/* Live Status indicator & Scanner state */}
        <div className="flex items-center gap-3 text-xs">
          {feedback ? (
            <div
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-medium transition-all ${
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
          ) : (
            <div className="hidden sm:flex items-center gap-2 text-slate-500 text-[11px]">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Scanner ready (Point & shoot)</span>
            </div>
          )}
        </div>
      </div>
      )}

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

      {/* Camera Scanner Modal */}
      <TFTScannerModal
        isOpen={isCameraScannerOpen}
        onClose={() => setIsCameraScannerOpen(false)}
        onResolved={(res) => {
          if (res.batch_id) onBatchResolved(res.batch_id);
          else if (res.sheet_id && onTemplateResolved) onTemplateResolved(res.sheet_id);
        }}
        onScanError={(code, err) => {
          const isNotFound = typeof err?.message === 'string' && (err.message.includes("isn't registered") || err.message.includes('NOT_REGISTERED'));
          if (isNotFound && currentUser.role === 'admin' && onRequestCreateBatch) {
            setIsCameraScannerOpen(false);
            onRequestCreateBatch(code);
          }
        }}
      />
    </div>
  );
};
