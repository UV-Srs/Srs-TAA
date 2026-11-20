import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Camera, ScanLine, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
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
  const [isLoadingCamera, setIsLoadingCamera] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const barcodeBufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const scanIntervalRef = useRef<number | null>(null);

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

  // Callback ref to connect camera stream as soon as video DOM node attaches
  const setVideoRef = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    if (element && streamRef.current) {
      element.srcObject = streamRef.current;
      element.play().catch((err) => {
        console.warn('Video playback warning:', err);
      });
    }
  }, []);

  const stopCamera = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const startCamera = async () => {
    try {
      setIsLoadingCamera(true);
      setErrorMsg(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorMsg('Camera access requires HTTPS or localhost. Please type the Sheet ID below.');
        setIsLoadingCamera(false);
        return;
      }

      let newStream: MediaStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' },
            audio: false,
          });
        } catch {
          newStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
      }

      streamRef.current = newStream;
      setCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        videoRef.current.play().catch((err) => {
          console.warn('Playback error:', err);
        });
      }

      // If BarcodeDetector is supported, start auto-detection loop
      if ('BarcodeDetector' in window) {
        try {
          const detector = new (window as any).BarcodeDetector({
            formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'],
          });
          scanIntervalRef.current = window.setInterval(async () => {
            if (videoRef.current && videoRef.current.readyState >= 2) {
              try {
                const barcodes = await detector.detect(videoRef.current);
                if (barcodes.length > 0) {
                  const detected = barcodes[0].rawValue;
                  if (detected) {
                    stopCamera();
                    handleProcessCode(detected);
                  }
                }
              } catch {
                // ignore frame detection errors
              }
            }
          }, 350);
        } catch (detectorErr) {
          console.warn('BarcodeDetector not initialized:', detectorErr);
        }
      }
    } catch (err: any) {
      console.error('Camera access error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMsg('Camera access was denied. Please allow camera permissions in your browser URL settings.');
      } else {
        setErrorMsg('Camera access failed. Please ensure camera is connected or enter Sheet ID manually.');
      }
      setCameraActive(false);
    } finally {
      setIsLoadingCamera(false);
    }
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
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
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
          <div className="rounded-xl overflow-hidden bg-slate-900 relative aspect-video flex items-center justify-center">
            {cameraActive ? (
              <>
                <video
                  ref={setVideoRef}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={() => {
                    videoRef.current?.play().catch(() => {});
                  }}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={stopCamera}
                  className="absolute top-2.5 right-2.5 bg-slate-900/80 hover:bg-slate-900 text-white text-[11px] px-2.5 py-1 rounded-md backdrop-blur-sm transition-all"
                >
                  Close Camera
                </button>
              </>
            ) : (
              <div className="text-center p-4">
                <button
                  type="button"
                  disabled={isLoadingCamera}
                  onClick={startCamera}
                  className="px-4 py-2 bg-white text-slate-900 hover:bg-slate-100 font-semibold rounded-lg flex items-center justify-center gap-2 transition-all shadow-sm mx-auto"
                >
                  {isLoadingCamera ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <Camera className="w-4 h-4 text-slate-700" />
                      <span>Turn On Camera</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

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
