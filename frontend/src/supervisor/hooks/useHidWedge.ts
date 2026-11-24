import { useEffect, useRef } from 'react';

/**
 * Listens for a USB/Bluetooth HID barcode scanner ("keyboard wedge") while no text
 * field has focus. Scanners type characters a few ms apart and finish with Enter;
 * a gap longer than `gapMs` starts a new code, so normal typing isn't mistaken for a scan.
 * When a text field has focus, the scanner simply types into it and its own Enter handler runs.
 */
export function useHidWedge(onScan: (code: string) => void, enabled = true, gapMs = 80, minLength = 5) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let buffer = '';
    let lastAt = 0;

    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Enter') {
        if (buffer.length >= minLength) {
          e.preventDefault();
          const code = buffer;
          buffer = '';
          onScanRef.current(code);
        }
        buffer = '';
        return;
      }
      if (e.key.length === 1) {
        const now = Date.now();
        if (now - lastAt > gapMs) buffer = '';
        buffer += e.key;
        lastAt = now;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, gapMs, minLength]);
}
