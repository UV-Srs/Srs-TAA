import React, { useState, useEffect } from 'react';
import { X, PlusCircle, AlertCircle, ArrowRight } from 'lucide-react';
import { SheetTemplate } from '../types';
import { fetchSheets, quickRegisterBatch } from '../api';

interface OnTheFlyRegisterModalProps {
  isOpen: boolean;
  unregisteredCode: string;
  onClose: () => void;
  onRegistered: (batchId: number) => void;
}

export const OnTheFlyRegisterModal: React.FC<OnTheFlyRegisterModalProps> = ({
  isOpen,
  unregisteredCode,
  onClose,
  onRegistered,
}) => {
  const [templates, setTemplates] = useState<SheetTemplate[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [productName, setProductName] = useState<string>('Controller board CB-7');
  const [lineName, setLineName] = useState<string>('Line 1');
  const [lotQuantity, setLotQuantity] = useState<number>(100);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadTemplates();
    }
  }, [isOpen]);

  const loadTemplates = async () => {
    try {
      const sheets = await fetchSheets();
      setTemplates(sheets);
      if (sheets.length > 0) {
        setSelectedSheetId(sheets[0].sheet_id);
        setProductName(sheets[0].part_name || sheets[0].document_title);
      }
    } catch (err: any) {
      setErrorMsg('Failed to load templates.');
    }
  };

  const handleTemplateChange = (sheetId: string) => {
    setSelectedSheetId(sheetId);
    const tmpl = templates.find((t) => t.sheet_id === sheetId);
    if (tmpl && tmpl.part_name) {
      setProductName(tmpl.part_name);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSheetId) {
      setErrorMsg('Please select an inspection sheet template.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      const res = await quickRegisterBatch({
        code: unregisteredCode,
        sheet_id: selectedSheetId,
        product_name: productName,
        line_name: lineName,
        lot_quantity: Number(lotQuantity) || 100,
      });

      onRegistered(res.batch_id);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to register batch.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 no-print backdrop-blur-sm">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-xl overflow-hidden text-xs">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PlusCircle className="w-4 h-4 text-slate-800" />
            <h3 className="font-bold text-sm text-slate-900">
              Register Unknown Code ({unregisteredCode})
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleRegister} className="p-5 space-y-4">
          <p className="text-slate-500 text-xs">
            This code isn't registered yet. As Admin, you can link it to an inspection sheet on the spot so Operators can scan and inspect it.
          </p>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Inspection Sheet Template:
            </label>
            <select
              value={selectedSheetId}
              onChange={(e) => handleTemplateChange(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
            >
              {templates.map((t) => (
                <option key={t.sheet_id} value={t.sheet_id}>
                  {t.sheet_id}: {t.document_title} ({t.part_name || 'Main Part'})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Product Name:</label>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Factory Line:</label>
              <select
                value={lineName}
                onChange={(e) => setLineName(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
              >
                <option value="Line 1">Line 1</option>
                <option value="Line 2">Line 2</option>
                <option value="Line 3">Line 3</option>
                <option value="Line 4">Line 4</option>
              </select>
            </div>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Lot Quantity:</label>
            <input
              type="number"
              value={lotQuantity}
              onChange={(e) => setLotQuantity(Number(e.target.value))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
              min="1"
              required
            />
          </div>

          {errorMsg && (
            <div className="border border-red-200 bg-red-50 text-red-700 p-2.5 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Registering...' : 'Register Batch'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
