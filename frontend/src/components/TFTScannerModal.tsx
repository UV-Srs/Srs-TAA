import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Camera, ScanLine, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import jsQR from 'jsqr';
import { resolveQR } from '../api';
import { QRResolveResult } from '../types';

interface TFTScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResolved: (result: QRResolveResult) => void;
  onUnregisteredCode?: (code: string) => void;
  scanAsPartNumber?: boolean;
}

export const TFTScannerModal: React.FC<TFTScannerModalProps> = ({
  isOpen,
  onClose,
  onResolved,
  onUnregisteredCode,
  scanAsPartNumber = false,
}) => {
  const [manualCode, setManualCode] = useState<string>('');
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [isLoadingCamera, setIsLoadingCamera] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barcodeControlsRef = useRef<{ stop: () => void } | null>(null);
  const scanHandledRef = useRef(false);
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

  const setVideoRef = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    if (element && streamRef.current) {
      element.srcObject = streamRef.current;
      void element.play().catch(() => {});
    }
  }, []);

  const stopCamera = () => {
    barcodeControlsRef.current?.stop();
    barcodeControlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  const startCamera = async () => {
    try {
      setIsLoadingCamera(true);
      setErrorMsg(null);
      scanHandledRef.current = false;
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access requires HTTPS or localhost.');
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      streamRef.current = stream;
      setCameraActive(true);
    } catch (error: any) {
      console.error('Camera access error:', error);
      setErrorMsg(error.name === 'NotAllowedError'
        ? 'Camera access was denied. Allow camera access in your browser settings and try again.'
        : error.message || 'Camera access failed. Check that a camera is connected.');
    } finally {
      setIsLoadingCamera(false);
    }
  };

  const handleProcessCode = async (codeToResolve: string) => {
    if (!codeToResolve || !codeToResolve.trim()) return;
    if (scanAsPartNumber && onUnregisteredCode) {
      stopCamera();
      onUnregisteredCode(codeToResolve.trim());
      onClose();
      return;
    }
    try {
      setIsLoading(true);
      setErrorMsg(null);

      const result = await resolveQR(codeToResolve.trim());
      stopCamera();
      onResolved(result);
      onClose();
    } catch (err: any) {
      const errorText = String(err.message || '');
      setErrorMsg(errorText || 'Scanned code not found.');
    } finally {
      setIsLoading(false);
    }
  };

  const processCameraCode = (code: string) => {
    if (scanHandledRef.current) return;
    scanHandledRef.current = true;
    stopCamera();
    void handleProcessCode(code);
  };

  // Decode camera frames directly so scanning works even where BarcodeDetector is unavailable.
  useEffect(() => {
    if (!cameraActive) return;

    let active = true;
    let frameId = 0;
    let lastDecodeAt = 0;

    const scanFrame = (time: number) => {
      if (!active) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        setIsLoadingCamera(false);
        if (time - lastDecodeAt >= 250) {
          lastDecodeAt = time;
          const width = video.videoWidth;
          const height = video.videoHeight;
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (context) {
            context.drawImage(video, 0, 0, width, height);
            const frame = context.getImageData(0, 0, width, height);
            const decoded = jsQR(frame.data, width, height, { inversionAttempts: 'attemptBoth' });
            if (decoded?.data) {
              active = false;
              processCameraCode(decoded.data);
              return;
            }
          }
        }
      }
      frameId = window.requestAnimationFrame(scanFrame);
    };

    frameId = window.requestAnimationFrame(scanFrame);

    return () => {
      active = false;
      window.cancelAnimationFrame(frameId);
    };
  }, [cameraActive]);

  // A 1D ZXing reader runs beside jsQR so camera scans support common linear formats too.
  useEffect(() => {
    if (!cameraActive || !videoRef.current) return;

    let active = true;
    let detectorTimer: number | undefined;
    let detectorBusy = false;
    let controls: { stop: () => void } | undefined;
    const startBarcodeReader = async () => {
      try {
        const NativeDetector = (window as any).BarcodeDetector;
        if (NativeDetector) {
          try {
            const supported: string[] = await NativeDetector.getSupportedFormats();
            const formats = ['code_128', 'code_39', 'code_93', 'codabar', 'ean_8', 'ean_13', 'itf', 'upc_a', 'upc_e']
              .filter((format) => supported.includes(format));
            if (formats.length > 0) {
              const detector = new NativeDetector({ formats });
              detectorTimer = window.setInterval(async () => {
                const video = videoRef.current;
                if (!active || detectorBusy || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
                detectorBusy = true;
                try {
                  const results = await detector.detect(video);
                  if (active && results[0]?.rawValue) processCameraCode(results[0].rawValue);
                } catch {
                  // Keep checking later frames; the ZXing fallback below covers unsupported browsers.
                } finally {
                  detectorBusy = false;
                }
              }, 200);
            }
          } catch {
            // Fall through to ZXing when the native detector cannot initialize.
          }
        }

        const [{ BrowserMultiFormatOneDReader, BarcodeFormat }, { DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (!active || !videoRef.current) return;
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.CODE_93,
          BarcodeFormat.CODABAR,
          BarcodeFormat.EAN_8,
          BarcodeFormat.EAN_13,
          BarcodeFormat.ITF,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatOneDReader(hints);
        controls = await reader.decodeFromVideoElement(videoRef.current, (result) => {
          if (active && result) processCameraCode(result.getText());
        });
        barcodeControlsRef.current = controls;
        if (!active) controls.stop();
      } catch (error) {
        if (active) console.warn('Barcode decoder could not start; QR scanning remains active.', error);
      }
    };

    void startBarcodeReader();
    return () => {
      active = false;
      if (detectorTimer !== undefined) window.clearInterval(detectorTimer);
      controls?.stop();
      barcodeControlsRef.current = null;
    };
  }, [cameraActive]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 no-print backdrop-blur-sm">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-slate-700" />
            <h3 className="font-semibold text-sm text-slate-900">
              Scan QR, Barcode or Batch Code
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
            <span>Camera QR and barcode scanning is active. USB and Bluetooth scanner input is also supported.</span>
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
                <div className="absolute bottom-2 left-2 right-2 rounded-md bg-slate-900/80 px-3 py-2 text-center text-[11px] font-medium text-white">
                  {isLoadingCamera ? 'Starting camera…' : 'Scanning for QR code or barcode — hold it steady and fill the frame'}
                </div>
                <canvas ref={canvasRef} className="hidden" />
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
            <label className="font-medium text-slate-600 block">Or enter a part number, sheet ID, or batch code:</label>
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
                placeholder="e.g. TEST-PART-003 or LOT-2026-495A"
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
