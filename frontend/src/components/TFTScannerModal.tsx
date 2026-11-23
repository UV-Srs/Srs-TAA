import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Camera, ScanLine, AlertCircle, ArrowRight, Loader2, Barcode, Info } from 'lucide-react';
import { resolveQR, parseBarcodeDetails } from '../api';
import { QRResolveResult, PartBarcodeInfo } from '../types';

interface TFTScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'resolve' | 'part-scan';
  onResolved?: (result: QRResolveResult) => void;
  onPartScanned?: (info: PartBarcodeInfo) => void;
  onScanError?: (code: string, error: any) => void;
}

type DetectionEngine = 'native' | 'zxing' | 'none';

/** Dynamically load ZXing from CDN and return the global once loaded. */
function loadZXing(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).ZXing) { resolve((window as any).ZXing); return; }
    const existing = document.getElementById('zxing-script');
    if (existing) {
      existing.addEventListener('load', () => resolve((window as any).ZXing));
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.id = 'zxing-script';
    s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
    s.onload = () => resolve((window as any).ZXing);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export const TFTScannerModal: React.FC<TFTScannerModalProps> = ({
  isOpen,
  onClose,
  mode = 'resolve',
  onResolved,
  onPartScanned,
  onScanError,
}) => {
  const [manualCode, setManualCode] = useState<string>('');
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [isLoadingCamera, setIsLoadingCamera] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [detectionEngine, setDetectionEngine] = useState<DetectionEngine | null>(null);
  const [zxingLoading, setZxingLoading] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const barcodeBufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const scanIntervalRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const zxingReaderRef = useRef<any>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);

  // USB / Bluetooth wedge scanner global listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const timeDiff = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;
      if (e.key === 'Enter') {
        if (barcodeBufferRef.current.length > 2) {
          const scanned = barcodeBufferRef.current.trim();
          barcodeBufferRef.current = '';
          handleProcessCode(scanned);
        }
        return;
      }
      if (e.key.length === 1) {
        barcodeBufferRef.current = timeDiff > 250 ? e.key : barcodeBufferRef.current + e.key;
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
    if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
    if (zxingReaderRef.current) {
      try { zxingReaderRef.current.reset(); } catch {}
      zxingReaderRef.current = null;
    }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setCameraActive(false);
  };

  const startNativeDetection = (detector: any) => {
    scanIntervalRef.current = window.setInterval(async () => {
      const vid = videoRef.current;
      if (!vid || vid.readyState < 2 || vid.videoWidth === 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = vid.videoWidth;
      canvas.height = vid.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(vid, 0, 0);
      try {
        const barcodes = await detector.detect(canvas);
        if (barcodes.length > 0 && barcodes[0].rawValue) {
          stopCamera();
          handleProcessCode(barcodes[0].rawValue);
        }
      } catch {}
    }, 300);
  };

  const startZXingDetection = async () => {
    try {
      const ZXing = await loadZXing();
      const reader = new ZXing.BrowserMultiFormatReader();
      zxingReaderRef.current = reader;
      setDetectionEngine('zxing');

      reader.decodeFromStream(streamRef.current, videoRef.current, (result: any, err: any) => {
        if (result) {
          const raw = result.getText();
          if (raw) {
            stopCamera();
            handleProcessCode(raw);
          }
        }
        // err is normal (no barcode in frame) — ignore
      });
    } catch {
      // ZXing failed to load — fall back to manual
      setDetectionEngine('none');
      setErrorMsg(null); // clear so we show the info banner instead
      // Auto-focus manual input
      setTimeout(() => manualInputRef.current?.focus(), 100);
    }
  };

  const startCamera = async () => {
    try {
      setIsLoadingCamera(true);
      setErrorMsg(null);
      setDetectionEngine(null);

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

      if ('BarcodeDetector' in window) {
        const detector = new (window as any).BarcodeDetector({
          formats: ['qr_code', 'code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix', 'pdf417', 'aztec'],
        });
        setDetectionEngine('native');
        startNativeDetection(detector);
      } else {
        // Native API unavailable — load ZXing from CDN as fallback
        setZxingLoading(true);
        await startZXingDetection();
        setZxingLoading(false);
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMsg('Camera permission denied. Allow camera access in your browser URL bar settings, then try again.');
      } else {
        setErrorMsg('Camera failed to start. Use a USB/Bluetooth scanner or type the barcode below.');
      }
      setCameraActive(false);
      setDetectionEngine('none');
      setTimeout(() => manualInputRef.current?.focus(), 100);
    } finally {
      setIsLoadingCamera(false);
      setZxingLoading(false);
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
      const isNotFound = typeof err?.message === 'string' && (err.message.includes("isn't registered") || err.message.includes('NOT_REGISTERED'));
      setErrorMsg(
        isNotFound
          ? `"${code}" isn't registered yet. The laptop will prompt to create a new sheet.`
          : err.message || 'Code not recognised. Try again or enter manually.'
      );
      setScanPreview(null);
      onScanError?.(code, err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const isPartMode = mode === 'part-scan';
  const noAutoDetect = detectionEngine === 'none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 no-print backdrop-blur-sm">
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md shadow-lg overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isPartMode ? <Barcode className="w-4 h-4 text-slate-700" /> : <ScanLine className="w-4 h-4 text-slate-700" />}
            <h3 className="font-semibold text-sm text-slate-900">
              {isPartMode ? 'Scan Part Barcode' : 'Scan Checksheet or Batch QR'}
            </h3>
          </div>
          <button onClick={() => { stopCamera(); onClose(); }} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">

          {/* USB / BT scanner active indicator */}
          <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl flex items-center gap-2.5 text-slate-700">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span>
              {isPartMode
                ? 'USB / Bluetooth scanner active — scan the physical barcode on the part now.'
                : 'Wired & Bluetooth scanner listener active. Point and trigger anytime.'}
            </span>
          </div>

          {/* No auto-detect notice — not an error, just guidance */}
          {noAutoDetect && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl flex items-start gap-2.5">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <div className="space-y-0.5">
                <p className="font-semibold">Camera auto-detection unavailable in this browser</p>
                <p className="text-[11px] text-amber-700">
                  Auto-detection works in Chrome / Edge. In other browsers, the camera is for reference only.
                  <br />Use a USB / Bluetooth barcode scanner, or <strong>type the code below</strong> to test the full flow end-to-end.
                </p>
              </div>
            </div>
          )}

          {/* ZXing loading notice */}
          {zxingLoading && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 p-3 rounded-xl flex items-center gap-2.5 text-[11px]">
              <Loader2 className="w-4 h-4 animate-spin shrink-0 text-blue-600" />
              <span>Loading universal barcode engine — works in all browsers...</span>
            </div>
          )}

          {/* Detection engine badge */}
          {detectionEngine && detectionEngine !== 'none' && (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] text-slate-500 font-medium">
                {detectionEngine === 'native'
                  ? 'Native BarcodeDetector active (Chrome/Edge)'
                  : 'ZXing universal engine active — scanning all formats'}
              </span>
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
                {/* Scan crosshair overlay — only shown when detection is running */}
                {!noAutoDetect && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-56 h-32 border-2 border-white/70 rounded-lg relative">
                      <span className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-white rounded-tl" />
                      <span className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-white rounded-tr" />
                      <span className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-white rounded-bl" />
                      <span className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-white rounded-br" />
                      <div className="absolute inset-x-0 top-1/2 h-px bg-red-400/70 animate-pulse" />
                    </div>
                  </div>
                )}
                {noAutoDetect && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-black/50 text-white text-[11px] font-medium px-3 py-1.5 rounded-lg backdrop-blur-sm">
                      Camera preview only — type code below
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={stopCamera}
                  className="absolute top-2.5 right-2.5 bg-slate-900/80 hover:bg-slate-900 text-white text-[11px] px-2.5 py-1 rounded-md backdrop-blur-sm"
                >
                  Close Camera
                </button>
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
                    ? 'Point camera at the barcode or QR on the part'
                    : 'Scan QR or barcode from camera'}
                </p>
              </div>
            )}
          </div>

          {/* Processing preview */}
          {scanPreview && (
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500 shrink-0" />
              <span className="font-mono text-slate-700 truncate">{scanPreview}</span>
            </div>
          )}

          {/* Manual Entry — always visible, prominent when no auto-detect */}
          <div className={`space-y-1.5 pt-2 border-t border-slate-100 ${noAutoDetect ? 'ring-2 ring-slate-900/10 rounded-xl p-3 -mx-1 bg-slate-50' : ''}`}>
            <label className="font-medium text-slate-700 block">
              {noAutoDetect
                ? 'Enter barcode / code manually to test:'
                : isPartMode
                  ? 'Or type / paste barcode value:'
                  : 'Or enter Sheet / Batch ID manually:'}
            </label>
            {noAutoDetect && isPartMode && (
              <p className="text-[11px] text-slate-500">
                Examples: <code className="bg-white border border-slate-200 px-1 rounded">PCB-CB-700</code>
                {' '}<code className="bg-white border border-slate-200 px-1 rounded">(01)12345678901234(10)LOT01(240)ABC</code>
                {' '}<code className="bg-white border border-slate-200 px-1 rounded">{"{'part_no':'ABC','part_name':'PIPE'}"}</code>
              </p>
            )}
            <div className="flex gap-2">
              <input
                ref={manualInputRef}
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && manualCode.trim()) handleProcessCode(manualCode); }}
                placeholder={isPartMode ? 'e.g. PCB-CB-700 or (01)12345...' : 'e.g. 18351M62Q50-IFM'}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 font-medium"
                autoFocus={noAutoDetect}
              />
              <button
                type="button"
                disabled={isLoading || !manualCode.trim()}
                onClick={() => handleProcessCode(manualCode)}
                className="bg-slate-900 text-white font-medium px-4 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1 shrink-0"
              >
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (
                  <>{isPartMode ? 'Parse' : 'Open'}<ArrowRight className="w-3.5 h-3.5" /></>
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
