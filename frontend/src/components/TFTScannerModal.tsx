import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Camera, ScanLine, AlertCircle, ArrowRight, Loader2, Barcode } from 'lucide-react';
import { resolveQR, parseBarcodeDetails } from '../api';
import { QRResolveResult, PartBarcodeInfo } from '../types';

interface TFTScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 'resolve' (default): resolves code via backend and returns QRResolveResult
   *  'part-scan': parses a physical part barcode and returns PartBarcodeInfo */
  mode?: 'resolve' | 'part-scan';
  onResolved?: (result: QRResolveResult) => void;
  onPartScanned?: (info: PartBarcodeInfo) => void;
}

export const TFTScannerModal: React.FC<TFTScannerModalProps> = ({
  isOpen,
  onClose,
  mode = 'resolve',
  onResolved,
  onPartScanned,
}) => {
  const [manualCode, setManualCode] = useState<string>('');
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [isLoadingCamera, setIsLoadingCamera] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scanPreview, setScanPreview] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const barcodeBufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const scanIntervalRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Global Keydown Wedge Listener for USB/Bluetooth scanners
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
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const setVideoRef = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    if (element && streamRef.current) {
      element.muted = true;
      element.playsInline = true;
      element.srcObject = streamRef.current;
      element.play().catch(() => {});
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

      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMsg('Camera access requires HTTPS or localhost.');
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
          newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        } catch {
          newStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
      }

      streamRef.current = newStream;
      setCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        videoRef.current.play().catch(() => {});
      }

      // Camera barcode detection: BarcodeDetector (Chrome/Edge) with canvas fallback
      if ('BarcodeDetector' in window) {
        const detector = new (window as any).BarcodeDetector({
          formats: ['qr_code', 'code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix', 'pdf417', 'aztec'],
        });
        scanIntervalRef.current = window.setInterval(async () => {
          const vid = videoRef.current;
          if (!vid || vid.readyState < 2 || vid.videoWidth === 0) return;

          // Draw frame to canvas for more reliable detection on still frames
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.width = vid.videoWidth;
            canvas.height = vid.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(vid, 0, 0);
              try {
                const barcodes = await detector.detect(canvas);
                if (barcodes.length > 0 && barcodes[0].rawValue) {
                  stopCamera();
                  handleProcessCode(barcodes[0].rawValue);
                }
              } catch {
                // ignore frame errors
              }
            }
          } else {
            // fallback: detect directly on video element
            try {
              const barcodes = await detector.detect(vid);
              if (barcodes.length > 0 && barcodes[0].rawValue) {
                stopCamera();
                handleProcessCode(barcodes[0].rawValue);
              }
            } catch {
              // ignore
            }
          }
        }, 300);
      } else {
        // No BarcodeDetector — show guidance
        setErrorMsg('Auto-detection unavailable in this browser. Use a USB/Bluetooth scanner or type the code manually below.');
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMsg('Camera permission denied. Allow camera access in your browser URL bar settings.');
      } else {
        setErrorMsg('Camera failed to start. Use a USB/Bluetooth scanner or type the code manually.');
      }
      setCameraActive(false);
    } finally {
      setIsLoadingCamera(false);
    }
  };

  const handleProcessCode = async (codeToProcess: string) => {
    const code = codeToProcess.trim();
    if (!code) return;
    try {
      setIsLoading(true);
      setErrorMsg(null);
      setScanPreview(code);

      if (mode === 'part-scan') {
        const info = await parseBarcodeDetails(code);
        stopCamera();
        onPartScanned?.(info);
        onClose();
      } else {
        const result = await resolveQR(code);
        stopCamera();
        onResolved?.(result);
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Code not recognised. Try again or enter manually.');
      setScanPreview(null);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const isPartMode = mode === 'part-scan';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 no-print backdrop-blur-sm">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isPartMode ? (
              <Barcode className="w-4 h-4 text-slate-700" />
            ) : (
              <ScanLine className="w-4 h-4 text-slate-700" />
            )}
            <h3 className="font-semibold text-sm text-slate-900">
              {isPartMode ? 'Scan Part Barcode' : 'Scan Checksheet or Batch QR'}
            </h3>
          </div>
          <button
            onClick={() => { stopCamera(); onClose(); }}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {/* Scanner active tip */}
          <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl flex items-center gap-2.5 text-slate-700">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span>
              {isPartMode
                ? 'USB / Bluetooth scanner active — scan the physical barcode on the part now.'
                : 'Wired USB & Wireless Bluetooth scanner listener active. Point and trigger anytime.'}
            </span>
          </div>

          {isPartMode && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 p-3 rounded-xl text-[11px] leading-relaxed">
              <strong>How it works:</strong> Scan a 1D barcode (Code-128 / GS1-128) or QR code printed on the
              physical part. The system will auto-fill Part No, Lot Number and other details into the sheet form.
            </div>
          )}

          {/* Camera viewfinder */}
          <div className="rounded-xl overflow-hidden bg-slate-900 relative aspect-video flex items-center justify-center">
            {cameraActive ? (
              <>
                <video
                  ref={setVideoRef}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
                  className="w-full h-full object-cover"
                />
                {/* Scan crosshair overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-56 h-32 border-2 border-white/70 rounded-lg relative">
                    <span className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-white rounded-tl" />
                    <span className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-white rounded-tr" />
                    <span className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-white rounded-bl" />
                    <span className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-white rounded-br" />
                    <div className="absolute inset-x-0 top-1/2 h-px bg-red-400/70 animate-pulse" />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="absolute top-2.5 right-2.5 bg-slate-900/80 hover:bg-slate-900 text-white text-[11px] px-2.5 py-1 rounded-md backdrop-blur-sm"
                >
                  Close Camera
                </button>
                {/* Hidden canvas used for frame capture */}
                <canvas ref={canvasRef} className="hidden" />
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
                    <><Loader2 className="w-4 h-4 animate-spin text-slate-600" /><span>Connecting...</span></>
                  ) : (
                    <><Camera className="w-4 h-4 text-slate-700" /><span>Turn On Laptop Camera</span></>
                  )}
                </button>
                <p className="text-slate-400 text-[11px] mt-2">
                  {isPartMode
                    ? 'Point camera at the barcode or QR code on the part'
                    : 'Scan QR or barcode from camera'}
                </p>
              </div>
            )}
          </div>

          {scanPreview && (
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500 shrink-0" />
              <span className="font-mono text-slate-700 truncate">{scanPreview}</span>
            </div>
          )}

          {/* Manual Entry */}
          <div className="space-y-1.5 pt-2 border-t border-slate-100">
            <label className="font-medium text-slate-600 block">
              {isPartMode ? 'Or type / paste the barcode value:' : 'Or enter Sheet / Batch ID manually:'}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleProcessCode(manualCode); }}
                placeholder={isPartMode ? 'e.g. PCB-CB-700 or (01)12345...' : 'e.g. 18351M62Q50-IFM'}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 font-medium"
                autoFocus
              />
              <button
                type="button"
                disabled={isLoading || !manualCode.trim()}
                onClick={() => handleProcessCode(manualCode)}
                className="bg-slate-900 text-white font-medium px-4 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1"
              >
                {isLoading ? '...' : <><span>{isPartMode ? 'Parse' : 'Open'}</span><ArrowRight className="w-3.5 h-3.5" /></>}
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
