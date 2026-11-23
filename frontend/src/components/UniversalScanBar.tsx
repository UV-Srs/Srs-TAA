import React, { useState, useEffect, useRef } from 'react';
import { Camera, Search, ArrowRight, CheckCircle2, AlertCircle, Barcode, Plus } from 'lucide-react';
import { resolveQR } from '../api';
import { User, QRResolveResult } from '../types';
import { TFTScannerModal } from './TFTScannerModal';

interface UniversalScanBarProps {
  currentUser: User;
  onBatchResolved: (batchId: number) => void;
  onTemplateResolved?: (sheetId: string) => void;
  onRequestCreateBatch?: (code?: string, sheetId?: string) => void;
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
      } else if (res.sheet_id) {
        if (currentUser.role === 'admin' && onRequestCreateBatch) {
          onRequestCreateBatch('', res.sheet_id);
        } else if (onTemplateResolved) {
          onTemplateResolved(res.sheet_id);
        }
      }
    } catch (err: any) {
      const errStr = err.message || '';
      if (errStr.includes('NOT_REGISTERED') || errStr.includes("isn't registered") || errStr.includes('404')) {
        let codeOnly = cleanRaw;
        try {
          const match = cleanRaw.match(/B-?(\d{4,6})/i) || cleanRaw.match(/TAA-([A-Za-z0-9-]+)/);
          if (match) codeOnly = match[0];
        } catch {}

        if (currentUser.role === 'admin' && onRequestCreateBatch) {
          onRequestCreateBatch(codeOnly);
        } else {
          setFeedback({
            text: `Batch "${codeOnly}" not found. Check the lot number or ask an Admin to register it.`,
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
    <div className="bg-white border-b border-slate-200 px-4 py-2.5 sm:px-6 no-print">
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
              className="w-full pl-9 pr-20 py-2 bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-slate-900 focus:bg-white rounded text-xs font-medium text-slate-800 placeholder-slate-400 transition-all outline-none"
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
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold transition-colors shrink-0 cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5 text-slate-600" />
            <span className="hidden md:inline">Camera</span>
          </button>

          {currentUser.role === 'admin' && onRequestCreateBatch && (
            <button
              type="button"
              onClick={() => onRequestCreateBatch()}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-700 text-white rounded text-xs font-semibold transition-colors shrink-0 cursor-pointer"
              title="Create New Inspection Batch"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Batch</span>
            </button>
          )}
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

      {/* Camera Scanner Modal */}
      <TFTScannerModal
        isOpen={isCameraScannerOpen}
        onClose={() => setIsCameraScannerOpen(false)}
        onResolved={(res) => {
          setIsCameraScannerOpen(false);
          if (res.batch_id) {
            onBatchResolved(res.batch_id);
          } else if (res.sheet_id) {
            if (currentUser.role === 'admin' && onRequestCreateBatch) {
              onRequestCreateBatch('', res.sheet_id);
            } else if (onTemplateResolved) {
              onTemplateResolved(res.sheet_id);
            }
          }
        }}
        onScanError={(code, _err) => {
          const isNotFound = typeof _err?.message === 'string' && (_err.message.includes("isn't registered") || _err.message.includes('NOT_REGISTERED'));
          if (isNotFound && currentUser.role === 'admin' && onRequestCreateBatch) {
            setIsCameraScannerOpen(false);
            onRequestCreateBatch(code);
          }
        }}
        onNotFound={(code) => {
          if (currentUser.role === 'admin') {
            setUnregisteredCode(code);
            setIsRegisterModalOpen(true);
          } else {
            setFeedback({
              text: `"${code}" not registered. Ask an Admin to register it.`,
              isError: true,
            });
          }
        }}
      />
    </div>
  );
};
