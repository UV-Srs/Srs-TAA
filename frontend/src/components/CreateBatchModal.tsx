import React, { useState, useEffect } from 'react';
import { X, Star, Barcode, Layers, AlertCircle, CheckCircle2, ScanLine } from 'lucide-react';
import { SheetTemplate, PartBarcodeInfo } from '../types';
import { fetchSheets, createBatch, parseBarcodeDetails } from '../api';

interface CreateBatchModalProps {
  isOpen: boolean;
  initialCode?: string;
  initialSheetId?: string;
  linkBarcode?: string;
  onClose: () => void;
  onBatchCreated: (batchId: number) => void;
}

export const CreateBatchModal: React.FC<CreateBatchModalProps> = ({
  isOpen,
  initialCode = '',
  initialSheetId = '',
  linkBarcode = '',
  onClose,
  onBatchCreated,
}) => {
  const [templates, setTemplates] = useState<SheetTemplate[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [lotNumber, setLotNumber] = useState<string>('');
  const [productName, setProductName] = useState<string>('');
  const [lotQuantity, setLotQuantity] = useState<number>(100);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState<boolean>(false);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [parsedPart, setParsedPart] = useState<PartBarcodeInfo | null>(null);

  useEffect(() => {
    if (isOpen) {
      setParsedPart(null);
      setErrorMsg(null);

      let cleanLot = initialCode ? initialCode.trim() : '';
      if (cleanLot.startsWith('TAA:SHEET:')) cleanLot = '';
      setLotNumber(cleanLot);

      loadTemplates(initialCode);
    }
  }, [isOpen, initialCode, initialSheetId]);

  const loadTemplates = async (code = '') => {
    try {
      setIsLoadingTemplates(true);
      const sheets = await fetchSheets();
      setTemplates(sheets);

      // Determine initial template selection
      let targetSheetId = '';
      if (initialSheetId && sheets.some(s => s.sheet_id === initialSheetId)) {
        targetSheetId = initialSheetId;
      } else {
        const defaultTpl = sheets.find(s => s.is_default);
        targetSheetId = defaultTpl ? defaultTpl.sheet_id : (sheets[0]?.sheet_id || '');
      }
      setSelectedSheetId(targetSheetId);
      const activeTpl = sheets.find(s => s.sheet_id === targetSheetId);
      setProductName(activeTpl?.part_name || activeTpl?.document_title || '');

      // If we have a scanned barcode (not a TAA QR), try to parse part info from it
      const isTaaCode = code.startsWith('TAA:');
      if (code && !isTaaCode) {
        setIsParsing(true);
        try {
          const info = await parseBarcodeDetails(code);
          setParsedPart(info);

          // Auto-fill product name from barcode
          if (info.part_name) setProductName(info.part_name);

          // Auto-fill lot number if encoded in barcode and we don't have one
          if (info.lot_number) setLotNumber(info.lot_number);

          // Auto-select linked or suggested template
          const matchSheetId = info.already_assigned_to || info.suggested_sheet_id;
          if (matchSheetId && sheets.some(s => s.sheet_id === matchSheetId)) {
            setSelectedSheetId(matchSheetId);
            const matchTpl = sheets.find(s => s.sheet_id === matchSheetId);
            if (matchTpl && !info.part_name) {
              setProductName(matchTpl.part_name || matchTpl.document_title || '');
            }
          }
        } catch {
          // barcode format not recognised — silent, user can still fill manually
        } finally {
          setIsParsing(false);
        }
      }
    } catch (err: any) {
      setErrorMsg('Failed to load inspection templates.');
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  const handleTemplateChange = (sheetId: string) => {
    setSelectedSheetId(sheetId);
    const tmpl = templates.find(t => t.sheet_id === sheetId);
    if (tmpl) setProductName(tmpl.part_name || tmpl.document_title || '');
  };

  const selectedTemplate = templates.find(t => t.sheet_id === selectedSheetId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSheetId) { setErrorMsg('Please select an inspection sheet template.'); return; }
    if (!lotNumber.trim()) { setErrorMsg('Please enter a lot or batch number.'); return; }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      const newBatch = await createBatch({
        sheet_id: selectedSheetId,
        lot_number: lotNumber.trim(),
        lot_quantity: Number(lotQuantity) || 100,
        product_name: productName,
        link_barcode: linkBarcode || undefined,
      });
      onBatchCreated(newBatch.batch_id);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create batch.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none"
      style={{ background: 'rgba(27,37,51,0.4)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-lg shadow-2xl overflow-hidden text-xs"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--line)' }}>
          <div>
            <h3 className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>New Inspection Batch</h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>Release lot to shop floor for operator inspection</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Parsed Part Info Banner */}
        {isParsing && (
          <div className="px-5 py-2.5 flex items-center gap-2"
            style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--line)', color: 'var(--muted)' }}>
            <ScanLine className="w-3.5 h-3.5 animate-pulse" />
            <span className="text-[11px]">Reading barcode…</span>
          </div>
        )}
        {!isParsing && parsedPart && (parsedPart.part_name || parsedPart.part_no) && (
          <div className="px-5 py-3 flex items-start gap-2.5"
            style={{ background: 'var(--ok-bg)', borderBottom: '1px solid #b2dcc5' }}>
            <ScanLine className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--ok)' }} />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold" style={{ color: 'var(--ok)' }}>Part identified from barcode</p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[10px]" style={{ color: 'var(--ok)' }}>
                {parsedPart.part_name && <span className="font-medium">{parsedPart.part_name}</span>}
                {parsedPart.part_no && <span className="font-mono">#{parsedPart.part_no}</span>}
                {parsedPart.vendor && <span>Vendor: {parsedPart.vendor}</span>}
                {parsedPart.customer && <span>Customer: {parsedPart.customer}</span>}
              </div>
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* Lot Number */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-medium flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
                <Barcode className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
                Lot / Batch Number
              </label>
              {initialCode && !isParsing && (
                <span className="text-[10px] font-semibold" style={{ color: 'var(--ok)' }}>Scanned</span>
              )}
            </div>
            <input
              type="text"
              required
              autoFocus
              value={lotNumber}
              onChange={e => setLotNumber(e.target.value)}
              placeholder="e.g. B-24125 or LOT-2026-500"
              className="w-full px-3 py-2 rounded-lg font-mono outline-none transition-all"
              style={{ border: '1px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 12 }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--line2)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
          </div>

          {/* Template Selection */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-medium flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
                <Layers className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
                Inspection Sheet Template
              </label>
              {selectedTemplate?.is_default && (
                <span className="text-[10px] font-semibold flex items-center gap-1" style={{ color: 'var(--warn)' }}>
                  <Star className="w-3 h-3 fill-current" />
                  Default
                </span>
              )}
            </div>

            <select
              value={selectedSheetId}
              onChange={e => handleTemplateChange(e.target.value)}
              disabled={isLoadingTemplates}
              className="w-full px-3 py-2 rounded-lg outline-none cursor-pointer"
              style={{ border: '1px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 12 }}
            >
              {templates.map(t => (
                <option key={t.sheet_id} value={t.sheet_id}>
                  {t.is_default ? '★ [Default] ' : ''}{t.sheet_id} — {t.part_name || t.document_title} ({t.part_no})
                </option>
              ))}
            </select>

            {selectedTemplate && (
              <div className="p-3 rounded-lg space-y-1.5"
                style={{ background: 'var(--surface2)', border: '1px solid var(--line)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--ink)' }}>
                    {selectedTemplate.part_name || 'Standard Part'}
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--muted)' }}>Part #{selectedTemplate.part_no}</span>
                </div>
                <p className="text-[11px] line-clamp-1" style={{ color: 'var(--muted)' }}>{selectedTemplate.document_title}</p>
                <div className="flex items-center gap-3 text-[10px] pt-1" style={{ borderTop: '1px solid var(--line)', color: 'var(--muted)' }}>
                  <span>Customer: {selectedTemplate.customer_name || 'N/A'}</span>
                  <span>·</span>
                  <span>Vendor: {selectedTemplate.vendor_name || 'N/A'}</span>
                  <span>·</span>
                  <span>{selectedTemplate.control_items?.length || 0} checkpoints</span>
                </div>
              </div>
            )}
          </div>

          {/* Lot Quantity */}
          <div className="space-y-1.5">
            <label className="font-medium block" style={{ color: 'var(--ink)' }}>Lot Quantity (pcs)</label>
            <input
              type="number"
              value={lotQuantity}
              onChange={e => setLotQuantity(Number(e.target.value))}
              min="1"
              required
              className="w-full px-3 py-2 rounded-lg outline-none"
              style={{ border: '1px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 12 }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--line2)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg flex items-center gap-2"
              style={{ border: '1px solid #f1b8b5', background: 'var(--ng-bg)', color: 'var(--ng)' }}>
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Footer */}
          <div className="flex gap-2 pt-2" style={{ borderTop: '1px solid var(--line)' }}>
            <button type="button" onClick={onClose} className="btn secondary sm flex-1">
              Cancel
            </button>
            <button type="submit"
              disabled={isSubmitting || isParsing || !lotNumber || !selectedSheetId}
              className="btn primary sm flex-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Creating...' : isParsing ? 'Reading barcode…' : 'Create Batch'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
