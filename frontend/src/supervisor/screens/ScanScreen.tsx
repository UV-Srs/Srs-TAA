import React, { useEffect, useRef, useState } from 'react';
import { decodeImageFile } from '../../lib/barcodeDecode';
import { CameraScanModal } from '../components/CameraScanModal';
import { useHidWedge } from '../hooks/useHidWedge';

interface ScanScreenProps {
  /** Look up and open the lot; resolves with the error to show, or '' when it opened. */
  onScan: (code: string) => Promise<{ error: string }>;
}

/**
 * Supervisor Scan screen, built from the prototype's operator scan screen (opScanScreen) with the
 * operator-only stats, "Your recent lots" and the "Prototype only" hint removed.
 * Camera / photo upload are the prototype's openCamera / tryFrame / handleBarcodeUpload / nativeCamera.
 * The prototype has no visible buttons for those two, so they are added under the type-in box.
 */
export const ScanScreen: React.FC<ScanScreenProps> = ({ onScan }) => {
  const [typeText, setTypeText] = useState('');
  const [scanErr, setScanErr] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const typeInRef = useRef<HTMLInputElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);

  // Prototype render(): focus the input on devices with a fine pointer (desktop / TFT + scanner).
  useEffect(() => {
    if (window.matchMedia?.('(pointer:fine)').matches) typeInRef.current?.focus();
  }, []);

  const scan = async (v: string) => {
    setScanErr('');
    // Prototype typeopen: keep what was typed on error, clear it once the lot opens.
    const { error } = await onScan(v);
    setScanErr(error);
    if (!error) setTypeText('');
  };

  // TAA device / handheld scanner typing while no field has focus.
  useHidWedge((code) => void scan(code), !cameraOpen && !scanBusy);

  // Prototype handleBarcodeUpload
  const handleBarcodeUpload = async (file: File) => {
    setScanBusy(true);
    setScanErr('');
    const code = await decodeImageFile(file);
    setScanBusy(false);
    if (!code) {
      setScanErr('Couldn’t read a barcode in that photo. Try again closer and steadier, or type the number.');
      return;
    }
    await scan(code);
  };

  return (
    <div className="home">
      <div className="home-top">
        <button className="scancard" onClick={() => setCameraOpen(true)} aria-label="Scan the lot barcode">
          <span className="beam" aria-hidden="true"><span></span></span>
          <span>
            <span className="ready"><i></i>Ready to scan</span>
            <h2>Scan the lot barcode</h2>
            <span className="sub">Point the TAA device at the lot label. The inspection opens by itself.</span>
          </span>
        </button>
        <div className="home-type">
          <div className="typebox">
            <input
              id="typein"
              ref={typeInRef}
              placeholder="Or enter the barcode number"
              value={typeText}
              onChange={(e) => setTypeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void scan(typeText);
                }
              }}
              autoComplete="off"
              autoCapitalize="characters"
              aria-label="Barcode number"
            />
            <button className="btn primary" onClick={() => void scan(typeText)}>Open</button>
          </div>
          {scanErr && <p className="err scanerr">{scanErr}</p>}
          <div className="sv-scanacts">
            <button className="btn" onClick={() => setCameraOpen(true)} disabled={scanBusy}>Scan with camera</button>
            <button className="btn" onClick={() => nativeRef.current?.click()} disabled={scanBusy}>Take photo and scan</button>
          </div>
          <input
            id="bcnative"
            ref={nativeRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void handleBarcodeUpload(file);
            }}
          />
        </div>
      </div>

      {cameraOpen && (
        <CameraScanModal
          onClose={() => setCameraOpen(false)}
          onUnavailable={(msg) => {
            setCameraOpen(false);
            setScanErr(msg);
          }}
          onDetected={(code) => {
            setCameraOpen(false);
            void scan(code);
          }}
        />
      )}
    </div>
  );
};
