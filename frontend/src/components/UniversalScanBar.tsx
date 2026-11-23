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
}

export const UniversalScanBar: React.FC<UniversalScanBarProps> = ({
  currentUser,
  onBatchResolved,
  onTemplateResolved,
  onRequestCreateBatch,
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

  return (
    <div className="bg-[var(--surface)] border-b border-[var(--line)] px-4 py-2.5 sm:px-6 no-print">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Search & Scan Box */}
        <form onSubmit={handleFormSubmit} className="w-full sm:max-w-xl flex items-center gap-2">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--muted)]">
              <Barcode className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              placeholder="Search or scan barcode (e.g. 18351M62Q50-260818-01)..."
              className="w-full pl-9 pr-20 py-2.5 bg-[var(--surface2)] border border-[var(--line2)] hover:border-[var(--primary)] focus:border-[var(--primary)] focus:bg-[var(--surface)] rounded-xl text-xs font-medium text-[var(--ink)] placeholder-[var(--muted)] transition-all outline-none mono"
            />
            <div className="absolute inset-y-0 right-1 flex items-center">
              <button
                type="submit"
                disabled={isResolving || !scanInput.trim()}
                className="px-3 py-1.5 bg-[var(--primary)] hover:opacity-90 text-[var(--on-primary)] rounded-lg text-xs font-semibold transition-all disabled:opacity-40 cursor-pointer"
              >
                {isResolving ? 'Opening...' : 'Open'}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsCameraScannerOpen(true)}
            title="Scan QR or barcode with camera"
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-[var(--surface2)] hover:bg-[var(--line)] text-[var(--ink)] border border-[var(--line)] rounded-xl text-xs font-medium transition-colors shrink-0 cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5 text-[var(--muted)]" />
            <span className="hidden md:inline">Camera</span>
          </button>
        </form>

        {/* Live Status indicator & Scanner state */}
        <div className="flex items-center gap-3 text-xs">
          {feedback ? (
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                feedback.isError
                  ? 'bg-[var(--ng-bg)] text-[var(--ng)] border border-[var(--ng)]'
                  : 'bg-[var(--ok-bg)] text-[var(--ok)] border border-[var(--ok)]'
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
            <div className="hidden sm:flex items-center gap-2 text-[var(--muted)] text-[12px]">
              <span className="w-2 h-2 rounded-full bg-[var(--ok)] animate-pulse"></span>
              <span>Scanner ready (Point & shoot)</span>
            </div>
          )}
        </div>
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
