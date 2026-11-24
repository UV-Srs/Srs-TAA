import jsQR from 'jsqr';

/**
 * Barcode / QR decoding for a canvas or a photo file.
 * Order: native BarcodeDetector (fast, where available) -> ZXing multi-format
 * (1D + 2D, TRY_HARDER) -> jsQR (QR only). Ported from the LotSure prototype's
 * decodeCanvas() / decodeBarcodeFile(), using the npm packages instead of CDN globals.
 */

const NATIVE_FORMATS = [
  'code_128', 'code_39', 'code_93', 'codabar', 'ean_8', 'ean_13',
  'itf', 'upc_a', 'upc_e', 'qr_code', 'data_matrix',
];

// undefined = not tried yet, null = unavailable on this browser
let nativeDetector: { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> } | null | undefined;

async function getNativeDetector() {
  if (nativeDetector !== undefined) return nativeDetector;
  const Native = (window as any).BarcodeDetector;
  if (!Native) return (nativeDetector = null);
  try {
    const supported: string[] = await Native.getSupportedFormats();
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    nativeDetector = formats.length ? new Native({ formats }) : null;
  } catch {
    nativeDetector = null;
  }
  return nativeDetector;
}

type CanvasDecoder = (canvas: HTMLCanvasElement) => string | null;
let zxingDecoder: Promise<CanvasDecoder> | null = null;

function loadZxing(): Promise<CanvasDecoder> {
  if (!zxingDecoder) {
    zxingDecoder = Promise.all([import('@zxing/browser'), import('@zxing/library')]).then(([browser, lib]) => {
      const hints = new Map();
      hints.set(lib.DecodeHintType.TRY_HARDER, true);
      const reader = new lib.MultiFormatReader();
      reader.setHints(hints);
      return (canvas: HTMLCanvasElement) => {
        try {
          const source = new browser.HTMLCanvasElementLuminanceSource(canvas);
          // decodeWithState keeps the hints set above (decode() would reset them).
          return reader.decodeWithState(new lib.BinaryBitmap(new lib.HybridBinarizer(source))).getText();
        } catch {
          return null;
        } finally {
          reader.reset();
        }
      };
    });
  }
  return zxingDecoder;
}

function decodeQrWithJsQR(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return null;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data || null;
}

/** Decode the first barcode or QR code found on a canvas, or null. */
export async function decodeCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  const native = await getNativeDetector();
  if (native) {
    try {
      const results = await native.detect(canvas);
      if (results[0]?.rawValue) return results[0].rawValue;
    } catch {
      /* fall through to ZXing */
    }
  }
  try {
    const decode = await loadZxing();
    const text = decode(canvas);
    if (text) return text;
  } catch {
    /* ZXing failed to load; fall through to jsQR */
  }
  return decodeQrWithJsQR(canvas);
}

/** Decode a barcode from a photo, retrying at a few sizes (large photos often decode better scaled down). */
export async function decodeImageFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    for (const max of [1600, 1000, 2400]) {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      const code = await decodeCanvas(canvas);
      if (code) return code;
    }
    return null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
