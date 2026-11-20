import React, { useState, useEffect } from 'react';
import { X, Printer, Download } from 'lucide-react';
import { fetchSheetQRCodes } from '../api';

interface PrintLabelModalProps {
  isOpen: boolean;
  onClose: () => void;
  sheetId: string;
}

export const PrintLabelModal: React.FC<PrintLabelModalProps> = ({
  isOpen,
  onClose,
  sheetId,
}) => {
  const [data, setData] = useState<{
    sheet_id: string;
    document_title: string;
    part_no?: string;
    qr_code_value: string;
    barcode_value: string;
    qr_image_url: string;
    barcode_image_url: string;
  } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (isOpen && sheetId) {
      loadCodes();
    }
  }, [isOpen, sheetId]);

  const loadCodes = async () => {
    try {
      setLoading(true);
      const res = await fetchSheetQRCodes(sheetId);
      setData(res);
    } catch (err) {
      console.error('Failed to load QR codes:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="bg-white border-4 border-black w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="bg-black text-white px-5 py-3 flex items-center justify-between no-print">
          <h2 className="font-extrabold text-sm uppercase tracking-wider">
            Built-In QR & Barcode Label (Printable)
          </h2>
          <button onClick={onClose} className="text-white hover:text-zinc-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Printable Label Area */}
        <div className="p-6">
          {loading ? (
            <div className="p-8 text-center font-mono text-xs">Generating High-Contrast Codes...</div>
          ) : data ? (
            <div className="border-4 border-black p-5 bg-white text-black space-y-4 print:border-black print:m-0">
              <div className="border-b-2 border-black pb-2 text-center">
                <div className="text-base font-black tracking-tight uppercase">TAA INSPECTION CHECKSHEET</div>
                <div className="text-[11px] font-mono text-zinc-700 font-bold">{data.document_title}</div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                <div>
                  <span className="font-bold text-black">SHEET ID:</span>
                  <div className="font-extrabold text-sm text-black">{data.sheet_id}</div>
                </div>
                <div>
                  <span className="font-bold text-black">PART NO.:</span>
                  <div className="font-extrabold text-sm text-black">{data.part_no || 'N/A'}</div>
                </div>
              </div>

              {/* Codes layout */}
              <div className="grid grid-cols-2 gap-4 items-center border-t-2 border-b-2 border-black py-4">
                <div className="text-center">
                  <img
                    src={data.qr_image_url}
                    alt="QR Code"
                    className="w-36 h-36 mx-auto border border-black p-1 bg-white"
                  />
                  <div className="text-[10px] font-mono mt-1 font-bold">{data.qr_code_value}</div>
                </div>

                <div className="text-center space-y-2">
                  <img
                    src={data.barcode_image_url}
                    alt="Barcode 1D"
                    className="w-full max-h-24 object-contain mx-auto"
                  />
                  <div className="text-[10px] font-mono font-bold">{data.barcode_value}</div>
                </div>
              </div>

              <div className="text-[10px] font-mono text-center text-zinc-600">
                Wired/Wireless TFT Scanner Compatible • ISO/IEC 18004 QR & Code128
              </div>
            </div>
          ) : null}
        </div>

        {/* Action Buttons */}
        <div className="bg-zinc-100 border-t-2 border-black px-6 py-3 flex items-center justify-between no-print">
          <button
            onClick={onClose}
            className="text-xs font-bold uppercase text-black hover:underline"
          >
            Close
          </button>
          <button
            onClick={handlePrint}
            className="bg-black text-white text-xs font-extrabold px-5 py-2 uppercase flex items-center gap-2 hover:bg-zinc-800"
          >
            <Printer className="w-4 h-4" />
            Print Label
          </button>
        </div>
      </div>
    </div>
  );
};
