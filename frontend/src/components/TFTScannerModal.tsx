import React, { useState, useEffect, useRef } from 'react';
import { X, QrCode, Camera, ScanLine, AlertCircle, ArrowRight } from 'lucide-react';
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
  const [lastScanned, setLastScanned] = useState<string | null>(null);

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

      // Enter key marks end of barcode transmission from HID scanner
      if (e.key === 'Enter') {
        if (barcodeBufferRef.current.length > 2) {
          const scannedStr = barcodeBufferRef.current.trim();
          barcodeBufferRef.current = '';
          handleProcessCode(scannedStr);
        }
        return;
      }

      // If typed within 70ms, it is almost certainly a hardware HID scanner wedge
      if (e.key.length === 1) {
        if (timeDiff > 250) {
          // Reset buffer if human delay
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

  // Clean up camera stream
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
      setErrorMsg('Camera access failed. Please ensure camera permissions are enabled on this TFT device.');
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
      setLastScanned(codeToResolve);

      const result = await resolveQR(codeToResolve.trim());
      stopCamera();
      onResolved(result);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Scanned code could not be resolved. Verify sheet exists.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 no-print backdrop-blur-sm">
      <div className="bg-white border-4 border-black w-full max-w-xl shadow-2xl">
        {/* Header */}
        <div className="bg-black text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ScanLine className="w-5 h-5" />
            <h2 className="font-extrabold text-sm uppercase tracking-wider">
              TFT QR & BARCODE SCANNER INTERFACE
            </h2>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="text-white hover:text-zinc-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Status Indicator */}
          <div className="border-2 border-black p-3.5 bg-zinc-50 flex items-start gap-3">
            <div className="w-3 h-3 bg-black rounded-full mt-1 animate-ping"></div>
            <div>
              <p className="font-bold text-xs uppercase tracking-wide text-black">
                Wired (USB) & Wireless (Bluetooth) TFT Wedge Active
              </p>
              <p className="text-[11px] text-zinc-600 mt-0.5">
                Point any shop-floor scanner at a sheet's QR code or barcode and pull the trigger. Resolution happens automatically in &lt; 500 ms.
              </p>
            </div>
          </div>

          {/* Camera Viewport Option */}
          {cameraActive ? (
            <div className="border-2 border-black relative overflow-hidden bg-black aspect-video flex items-center justify-center">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
              {/* Scan target reticle */}
              <div className="absolute inset-0 border-4 border-white/50 m-8 pointer-events-none flex items-center justify-center">
                <div className="w-16 h-1 border-t-2 border-white animate-pulse"></div>
              </div>

              <button
                onClick={stopCamera}
                className="absolute top-2 right-2 bg-black text-white text-xs px-2.5 py-1 border border-white font-bold"
              >
                Close Camera
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={startCamera}
                className="w-full py-3 bg-white border-2 border-black text-black font-extrabold text-xs uppercase flex items-center justify-center gap-2 hover:bg-zinc-100 transition-colors"
              >
                <Camera className="w-4 h-4" />
                Activate TFT Device Camera
              </button>
            </div>
          )}

          {/* Manual Input Fallback */}
          <div className="border-t-2 border-zinc-200 pt-4 space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-black">
              Manual Scan / Sheet ID Entry:
            </label>
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
                placeholder="e.g. 18351M62Q50-IFM or TAA:BATCH:1"
                className="flex-1 border-2 border-black px-3 py-2 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-black"
                autoFocus
              />
              <button
                type="button"
                disabled={isLoading || !manualCode.trim()}
                onClick={() => handleProcessCode(manualCode)}
                className="bg-black text-white font-extrabold text-xs px-5 py-2 uppercase hover:bg-zinc-800 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
              >
                {isLoading ? 'Resolving...' : (
                  <>
                    <span>Open</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Last Scanned Feedback */}
          {lastScanned && (
            <div className="text-[11px] font-mono text-zinc-600 bg-zinc-100 p-2 border border-zinc-300">
              <span className="font-bold text-black">Last Raw Scan:</span> {lastScanned}
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="border-2 border-black bg-black text-white p-3 flex items-start gap-2.5 text-xs font-mono">
              <AlertCircle className="w-4 h-4 text-white shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">SCAN ROUTING ERROR:</span>
                <p className="mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-zinc-100 border-t-2 border-black px-6 py-3 flex items-center justify-between text-xs font-mono text-zinc-600">
          <span>TFT Device: HID Keyboard Wedge & Camera Compatible</span>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="font-bold text-black uppercase hover:underline"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
