import React, { useState, useEffect, useRef } from 'react';
import { X, Camera, ScanLine, AlertCircle, ArrowRight } from 'lucide-react';
import { resolveQR } from '../api';
import { QRResolveResult } from '../types';

interface TFTScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResolved: (result: QRResolveResult) => void;
}

export const TFTScannerModal: React.FC<TFTScannerModalProps> = ({
  isOpen,
  onClose,
  onResolved,
}) => {
  const [manualCode, setManualCode] = useState<string>('');
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const barcodeBufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);

  // Global Keydown Wedge Listener for Wired & Wireless TFT Barcode/QR Scanners
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const timeDiff = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === 'Enter') {
        if (barcodeBufferRef.current.length > 2) {
          const scannedStr = barcodeBufferRef.current.trim();
          barcodeBufferRef.current = '';
          handleProcessCode(scannedStr);
        }
        return;
      }

      if (e.key.length === 1) {
        if (timeDiff > 250) {
          barcodeBufferRef.current = e.key;
        } else {
          barcodeBufferRef.current += e.key;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!cameraActive && streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, [cameraActive]);

  const startCamera = async () => {
    try {
      setErrorMsg(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err: any) {
      setErrorMsg('Camera access failed. Please ensure camera permissions are allowed.');
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const handleProcessCode = async (codeToResolve: string) => {
    if (!codeToResolve || !codeToResolve.trim()) return;
    try {
      setIsLoading(true);
      setErrorMsg(null);

      const result = await resolveQR(codeToResolve.trim());
      stopCamera();
      onResolved(result);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Scanned code not found.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 no-print backdrop-blur-sm">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-slate-700" />
            <h3 className="font-semibold text-sm text-slate-900">
              Scan Checksheet or Batch QR
            </h3>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="text-slate-400 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Scanner active tip */}
          <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl flex items-center gap-2.5 text-slate-700">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
            <span>Wired USB & Wireless Bluetooth barcode scanner listener active. Point and trigger anytime.</span>
          </div>

          {/* Camera Option */}
          {cameraActive ? (
            <div className="rounded-xl overflow-hidden bg-slate-900 relative aspect-video flex items-center justify-center">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
              <button
                onClick={stopCamera}
                className="absolute top-2 right-2 bg-slate-900/80 text-white text-[10px] px-2.5 py-1 rounded-md"
              >
                Close Camera
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startCamera}
              className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-medium rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Camera className="w-4 h-4 text-slate-500" />
              <span>Use Device Camera</span>
            </button>
          )}

          {/* Manual Entry */}
          <div className="space-y-1.5 pt-2 border-t border-slate-100">
            <label className="font-medium text-slate-600 block">Or enter Sheet / Batch ID manually:</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleProcessCode(manualCode);
                  }
                }}
                placeholder="e.g. 18351M62Q50-IFM or LOT-2026-495A"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 font-medium"
                autoFocus
              />
              <button
                type="button"
                disabled={isLoading || !manualCode.trim()}
                onClick={() => handleProcessCode(manualCode)}
                className="bg-slate-900 text-white font-medium px-4 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1 transition-all"
              >
                {isLoading ? '...' : (
                  <>
                    <span>Open</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="border border-red-200 bg-red-50 text-red-700 p-2.5 rounded-lg flex items-center gap-2 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
