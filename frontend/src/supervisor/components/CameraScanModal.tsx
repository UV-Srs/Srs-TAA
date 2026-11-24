import React, { useCallback, useEffect, useRef, useState } from 'react';
import { decodeCanvas } from '../../lib/barcodeDecode';

interface CameraScanModalProps {
  onDetected: (code: string) => void;
  /** Called when the live camera can't start; the screen shows the message and offers photo / type-in. */
  onUnavailable: (message: string) => void;
  onClose: () => void;
}

const SCAN_INTERVAL_MS = 450;
const UNAVAILABLE =
  'The live camera isn’t available here (camera access is blocked or not allowed). Use Take photo and scan instead.';

/** Live camera barcode scanner (prototype openCamera / tryFrame / closeCamera). */
export const CameraScanModal: React.FC<CameraScanModalProps> = ({ onDetected, onUnavailable, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const doneRef = useRef(false);
  const [message, setMessage] = useState<{ text: string; bad?: boolean }>({
    text: 'Point the camera at the lot barcode. It scans by itself, or tap Take photo.',
  });

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Start the camera once; stop it on unmount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onUnavailable('The live camera isn’t available on this device. Use Take photo and scan instead.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
      } catch {
        if (!cancelled) onUnavailable(UNAVAILABLE);
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
    // onUnavailable is intentionally not a dependency: the camera must start only once per open.
  }, []);

  const tryFrame = useCallback(async (manual: boolean) => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || busyRef.current || doneRef.current) return;
    busyRef.current = true;
    if (manual) setMessage({ text: 'Reading barcode…' });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    let code: string | null = null;
    try {
      code = await decodeCanvas(canvas);
    } catch {
      code = null;
    }
    busyRef.current = false;
    if (code && !doneRef.current) {
      doneRef.current = true;
      stopStream();
      onDetected(code);
      return;
    }
    if (manual) {
      setMessage({ text: 'No barcode found in that photo. Hold steady, fill the frame with the label and try again.', bad: true });
    }
  }, [onDetected]);

  // Auto-scan frames.
  useEffect(() => {
    const id = window.setInterval(() => void tryFrame(false), SCAN_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [tryFrame]);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div id="cam" className="cam">
      <div className="cam-card" role="dialog" aria-modal="true" aria-label="Scan barcode with camera">
        <div className="cam-view">
          <video id="camv" ref={videoRef} playsInline muted autoPlay />
          <div className="cam-frame" aria-hidden="true"><span /></div>
        </div>
        <p id="cammsg" className={`cam-msg${message.bad ? ' bad' : ''}`}>{message.text}</p>
        <div className="cam-acts">
          <button type="button" className="btn big" onClick={onClose}>Cancel</button>
          <button type="button" className="btn big primary" onClick={() => void tryFrame(true)}>Take photo and scan</button>
        </div>
      </div>
    </div>
  );
};
