import React, { useState, useEffect } from 'react';
import { X, Printer } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-xl overflow-hidden text-xs">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between no-print">
          <h3 className="font-bold text-sm text-slate-900">
            Print Sheet QR / Barcode Label
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Printable Label */}
        <div className="p-6">
          {loading ? (
            <div className="p-8 text-center text-slate-400">Loading codes...</div>
          ) : data ? (
            <div className="border border-slate-300 rounded-xl p-5 bg-white space-y-3.5 print:border-black print:m-0 shadow-sm">
              <div className="text-center pb-2 border-b border-slate-100">
                <div className="text-xs font-bold text-slate-900 uppercase">TAA Inspection Checksheet</div>
                <div className="text-[11px] text-slate-500 font-medium">{data.document_title}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 block font-medium">SHEET ID</span>
                  <span className="font-bold text-slate-800">{data.sheet_id}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-medium">PART NO</span>
                  <span className="font-bold text-slate-800">{data.part_no || 'N/A'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 items-center pt-2 border-t border-slate-100">
                <div className="text-center">
                  <img
                    src={data.qr_image_url}
                    alt="QR Code"
                    className="w-28 h-28 mx-auto border border-slate-200 rounded p-1"
                  />
                  <div className="text-[10px] text-slate-500 mt-1 font-mono">{data.qr_code_value}</div>
                </div>

                <div className="text-center space-y-1">
                  <img
                    src={data.barcode_image_url}
                    alt="Barcode"
                    className="w-full max-h-20 object-contain mx-auto"
                  />
                  <div className="text-[10px] text-slate-500 font-mono">{data.barcode_value}</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between no-print">
          <button
            onClick={onClose}
            className="font-medium text-slate-600 hover:text-slate-900"
          >
            Close
          </button>
          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg flex items-center gap-1.5 transition-all shadow-sm"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Label</span>
          </button>
        </div>
      </div>
    </div>
  );
};
