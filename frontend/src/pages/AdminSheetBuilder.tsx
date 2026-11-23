import React, { useState, useEffect } from 'react';
import { SheetTemplate, ControlItem, PartBarcodeInfo } from '../types';
import { fetchSheets, createSheet, updateSheet, setDefaultSheet, deleteSheet } from '../api';
import {
  Plus, Trash2, Save, Printer, QrCode, CheckCircle2, AlertCircle,
  Barcode, X, Star, StarOff, ScanLine, ChevronUp, ChevronDown, AlertTriangle
} from 'lucide-react';
import { PrintLabelModal } from '../components/PrintLabelModal';
import { TFTScannerModal } from '../components/TFTScannerModal';

interface AdminSheetBuilderProps {
  initialPrefill?: {
    sheetId?: string; partNo?: string; partName?: string;
    vendor?: string; customer?: string; model?: string; externalBarcode?: string;
  } | null;
  jumpToSheetId?: string | null;
}

export const AdminSheetBuilder: React.FC<AdminSheetBuilderProps> = ({ initialPrefill, jumpToSheetId }) => {
  const [sheetsList, setSheetsList] = useState<SheetTemplate[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [isNewSheet, setIsNewSheet] = useState<boolean>(false);

  // Form State
  const [sheetId, setSheetId] = useState<string>('');
  const [documentTitle, setDocumentTitle] = useState<string>(
    'DAILY INITIAL FLOW MANAGEMENT CONTROL ITEMS MONITORING CHECKSHEET (PRODUCT PARAMETER)'
  );
  const [partNo, setPartNo] = useState<string>('');
  const [partName, setPartName] = useState<string>('');
  const [modelName, setModelName] = useState<string>('');
  const [vendorName, setVendorName] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [partCategory, setPartCategory] = useState<string>('MAIN PART');
  const [externalBarcode, setExternalBarcode] = useState<string>('');
  const [controlItems, setControlItems] = useState<ControlItem[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isSettingDefault, setIsSettingDefault] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Modals
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);
  const [isScanOpen, setIsScanOpen] = useState<boolean>(false);
  const [scannerMode, setScannerMode] = useState<'resolve' | 'part-scan'>('part-scan');

  useEffect(() => { loadSheets(); }, []);

  // When a prefill arrives (e.g. from a "not found" scan on the phone), jump straight
  // to the new-sheet form with those fields pre-populated.
  useEffect(() => {
    if (initialPrefill) {
      startBlankSheet(initialPrefill);
    }
  }, [initialPrefill]);

  // When admin clicks "Edit Template" from ChecksheetView, jump to that sheet.
  useEffect(() => {
    if (jumpToSheetId && sheetsList.length > 0) {
      const found = sheetsList.find(s => s.sheet_id === jumpToSheetId);
      if (found) populateForm(found);
    }
  }, [jumpToSheetId, sheetsList]);

  const loadSheets = async () => {
    try {
      setIsLoading(true);
      const list = await fetchSheets();
      setSheetsList(list);
      if (list.length > 0 && !initialPrefill) {
        populateForm(list[0]);
      } else if (!initialPrefill) {
        startBlankSheet();
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const populateForm = (s: SheetTemplate) => {
    setIsNewSheet(false);
    setSelectedSheetId(s.sheet_id);
    setSheetId(s.sheet_id);
    setDocumentTitle(s.document_title);
    setPartNo(s.part_no || '');
    setPartName(s.part_name || '');
    setModelName(s.model_name || '');
    setVendorName(s.vendor_name || '');
    setCustomerName(s.customer_name || '');
    setPartCategory(s.part_category || 'MAIN PART');
    setExternalBarcode(s.external_barcode || externalBarcode); // keep scanned barcode if template has none
    setControlItems(s.control_items || []);
    setStatusMsg(null);
  };

  const startBlankSheet = (prefill?: {
    sheetId?: string; partNo?: string; partName?: string;
    vendor?: string; customer?: string; model?: string; externalBarcode?: string;
  }) => {
    setIsNewSheet(true);
    setSelectedSheetId('');
    setSheetId(prefill?.sheetId || `IFM-CUSTOM-${Date.now().toString().slice(-4)}`);
    setDocumentTitle('INITIAL FLOW MANAGEMENT CONTROL ITEMS MONITORING CHECKSHEET');
    setPartNo(prefill?.partNo || '');
    setPartName(prefill?.partName || '');
    setModelName(prefill?.model || '');
    setVendorName(prefill?.vendor || '');
    setCustomerName(prefill?.customer || '');
    setPartCategory('MAIN PART');
    setExternalBarcode(prefill?.externalBarcode || '');
    setControlItems([
      {
        serial_no: 1, stage_name: 'Appearance', control_item_name: 'Visual Flaw Check',
        specification_content: 'Be free from scratch, rust, damage', application_method: 'Visual',
        normal_frequency: '100%', ifm_frequency: '200%', row_mode: 'SERIAL_TICKBOX',
        html_input_type: 'checkbox', sample_columns: ['1','2','3','4','5','6','7','8','9','10'],
        assigned_role: 'operator', visible_to_operator: true, editable_by_operator: true,
        visible_to_supervisor: true, is_required: true, display_order: 1,
      },
      {
        serial_no: 2, stage_name: 'Measurement', control_item_name: 'Key Dimension',
        specification_content: 'Within tolerance', application_method: 'Vernier Caliper',
        normal_frequency: 'n=5/lot', ifm_frequency: 'n=10/lot', row_mode: 'NUMERIC_SAMPLE',
        html_input_type: 'number', sample_columns: ['1','2','3','4','5','6','7','8','9','10'],
        min_val: null, max_val: null,
        assigned_role: 'supervisor', visible_to_operator: false, editable_by_operator: false,
        visible_to_supervisor: true, is_required: true, is_supervisor_checkpoint: true, display_order: 2,
      }
    ]);
  };

  /* ── Barcode scan → auto-create sheet ──────────────────────────────── */
  const handlePartScanned = (info: PartBarcodeInfo) => {
    const filled: string[] = [];

    // Auto-fill all available fields and open the new-sheet form
    startBlankSheet({
      sheetId: info.suggested_sheet_id || undefined,
      partNo: info.part_no || undefined,
      partName: info.part_name || undefined,
      vendor: info.vendor || undefined,
      customer: info.customer || undefined,
      model: info.model || undefined,
      externalBarcode: info.raw_code,
    });

    if (info.part_no)   filled.push(`Part No: ${info.part_no}`);
    if (info.part_name) filled.push(`Part Name: ${info.part_name}`);
    if (info.vendor)    filled.push(`Vendor: ${info.vendor}`);
    if (info.gtin)      filled.push(`GTIN: ${info.gtin}`);

    if (info.already_assigned_to && info.already_assigned_to !== info.suggested_sheet_id) {
      setStatusMsg({ type: 'info', text: `This barcode is already linked to '${info.already_assigned_to}'. Saving will reassign it.` });
    } else {
      setStatusMsg({
        type: 'success',
        text: `Barcode scanned (${info.format_detected}). ${
          filled.length
            ? 'Auto-filled — ' + filled.join(', ') + '. Complete remaining fields and save.'
            : 'Sheet ID and barcode linked. Fill in the part details below.'
        }`,
      });
    }
  };

  const handleQRScannedForSheetID = (res: any) => {
    if (res.sheet_id) {
      setSheetId(res.sheet_id);
      setStatusMsg({ type: 'success', text: `Sheet ID populated: ${res.sheet_id}` });
    }
  };

  /* ── Set as Active Template ──────────────────────────────────────────── */
  const handleSetDefault = async () => {
    if (!sheetId || isNewSheet) return;
    try {
      setIsSettingDefault(true);
      await setDefaultSheet(sheetId);
      await loadSheets();
      setStatusMsg({ type: 'success', text: `'${sheetId}' is now the Active Template — all new batches will use this sheet.` });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to set active template.' });
    } finally {
      setIsSettingDefault(false);
    }
  };

  /* ── Delete Sheet ───────────────────────────────────────────────────── */
  const handleDelete = async () => {
    if (!sheetId || isNewSheet) return;
    try {
      setIsDeleting(true);
      const result = await deleteSheet(sheetId);
      setShowDeleteConfirm(false);
      setStatusMsg({
        type: 'success',
        text: `Template '${sheetId}' deleted (${result.batches_deleted} associated batch${result.batches_deleted !== 1 ? 'es' : ''} also removed).`,
      });
      await loadSheets();
    } catch (err: any) {
      setShowDeleteConfirm(false);
      setStatusMsg({ type: 'error', text: err.message || 'Failed to delete template.' });
    } finally {
      setIsDeleting(false);
    }
  };

  /* ── Control Items ───────────────────────────────────────────────────── */
  const handleAddRow = () => {
    const nextSerial = controlItems.length + 1;
    setControlItems([...controlItems, {
      serial_no: nextSerial, stage_name: 'Inspection',
      control_item_name: `Control Item #${nextSerial}`, specification_content: 'Technical criteria',
      application_method: 'Visual', normal_frequency: '100%', ifm_frequency: '200%',
      row_mode: 'SERIAL_TICKBOX', html_input_type: 'checkbox',
      sample_columns: ['1','2','3','4','5','6','7','8','9','10'], min_val: null, max_val: null,
      assigned_role: 'operator', visible_to_operator: true, editable_by_operator: true,
      visible_to_supervisor: true, is_required: true, display_order: nextSerial,
    }]);
  };

  const handleRemoveRow = (index: number) => {
    const updated = controlItems.filter((_, i) => i !== index)
      .map((it, idx) => ({ ...it, serial_no: idx + 1, display_order: idx + 1 }));
    setControlItems(updated);
  };

  const handleMoveRow = (index: number, dir: 'up' | 'down') => {
    if (dir === 'up' && index === 0) return;
    if (dir === 'down' && index === controlItems.length - 1) return;
    const updated = [...controlItems];
    const swap = dir === 'up' ? index - 1 : index + 1;
    [updated[index], updated[swap]] = [updated[swap], updated[index]];
    setControlItems(updated.map((it, i) => ({ ...it, serial_no: i + 1, display_order: i + 1 })));
  };

  const handleUpdateItem = (index: number, field: keyof ControlItem, val: any) => {
    const updated = [...controlItems];
    updated[index] = { ...updated[index], [field]: val };
    setControlItems(updated);
  };

  /* ── Save ────────────────────────────────────────────────────────────── */
  const handleSave = async () => {
    if (!sheetId.trim() || !documentTitle.trim()) {
      setStatusMsg({ type: 'error', text: 'Sheet ID and Document Title are required.' });
      return;
    }
    if (controlItems.length === 0) {
      setStatusMsg({ type: 'error', text: 'Template must have at least one control item row.' });
      return;
    }
    const names = controlItems.map(it => it.control_item_name?.trim()).filter(Boolean);
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
    if (duplicates.length > 0) {
      setStatusMsg({ type: 'error', text: `Duplicate control item names: ${[...new Set(duplicates)].join(', ')}` });
      return;
    }
    const rangeErrors = controlItems.filter(it =>
      it.min_val != null && it.max_val != null && Number(it.min_val) > Number(it.max_val)
    ).map(it => it.control_item_name);
    if (rangeErrors.length > 0) {
      setStatusMsg({ type: 'error', text: `Min > Max for: ${rangeErrors.join(', ')}` });
      return;
    }
    try {
      setIsSaving(true);
      setStatusMsg(null);
      const payload: any = {
        sheet_id: sheetId.trim(), document_title: documentTitle,
        part_no: partNo, part_name: partName, model_name: modelName,
        vendor_name: vendorName, customer_name: customerName,
        part_category: partCategory,
        external_barcode: externalBarcode.trim() || null,
        control_items: controlItems,
      };
      if (isNewSheet) {
        await createSheet(payload);
        setStatusMsg({ type: 'success', text: `Template '${sheetId}' created. You can now set it as the Active Template.` });
      } else {
        await updateSheet(sheetId, payload);
        setStatusMsg({ type: 'success', text: `Template '${sheetId}' updated.` });
      }
      await loadSheets();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to save template.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return (
    <div className="py-20 text-center text-xs font-medium text-slate-500">Loading builder...</div>
  );

  const currentSheet = sheetsList.find(s => s.sheet_id === selectedSheetId);
  const isCurrentDefault = currentSheet?.is_default === true;
  const defaultSheet = sheetsList.find(s => s.is_default);

  return (
    <div className="space-y-6">

      {/* ── Active Template Banner ───────────────────────────────────────── */}
      {defaultSheet && (
        <div className="flex items-center gap-3 bg-slate-900 text-white rounded px-4 py-3 text-xs">
          <Star className="w-4 h-4 text-yellow-400 shrink-0 fill-yellow-400" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold">Active Template: </span>
            <span className="font-mono">{defaultSheet.sheet_id}</span>
            {defaultSheet.part_name && (
              <span className="text-slate-300 ml-2">— {defaultSheet.part_name}</span>
            )}
          </div>
          <span className="text-slate-400 text-[11px]">All new batches use this template</span>
        </div>
      )}

      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div className="pb-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">Checksheet Template Builder</h2>
          <p className="text-xs text-slate-500">Scan a part barcode to create a sheet, or build one manually</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Scan to create */}
          <button
            onClick={() => { setScannerMode('part-scan'); setIsScanOpen(true); }}
            className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-sm"
          >
            <ScanLine className="w-3.5 h-3.5" />
            <span>Scan Part</span>
          </button>

          {/* Sheet picker + Delete grouped together */}
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <select
              value={selectedSheetId}
              onChange={(e) => {
                const found = sheetsList.find(s => s.sheet_id === e.target.value);
                if (found) populateForm(found);
              }}
              className="border-0 pl-3 pr-2 py-1.5 text-xs font-medium bg-transparent focus:outline-none max-w-[200px]"
            >
              {sheetsList.map(s => (
                <option key={s.sheet_id} value={s.sheet_id}>
                  {s.is_default ? '⭐ ' : ''}{s.sheet_id} ({s.part_no || 'Template'})
                </option>
              ))}
            </select>

            {!isNewSheet && (
              <>
                <div className="w-px h-5 bg-slate-200 shrink-0" />
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isDeleting || isCurrentDefault}
                  title={isCurrentDefault ? 'Cannot delete the active template — set another as active first' : `Delete template "${sheetId}" and all its batches`}
                  className="px-2.5 py-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>

          <button
            onClick={() => startBlankSheet()}
            className="px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Blank Sheet</span>
          </button>

          {!isNewSheet && (
            <button
              onClick={handleSetDefault}
              disabled={isSettingDefault || isCurrentDefault}
              title={isCurrentDefault ? 'Already the active template' : 'Set as active template for new batches'}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-all border ${
                isCurrentDefault
                  ? 'bg-yellow-50 border-yellow-300 text-yellow-800 cursor-default'
                  : 'border-slate-200 bg-white hover:bg-yellow-50 hover:border-yellow-300 text-slate-700 hover:text-yellow-800'
              } disabled:opacity-60`}
            >
              {isCurrentDefault
                ? <><Star className="w-3.5 h-3.5 fill-yellow-500 text-yellow-500" /><span>Active</span></>
                : <><StarOff className="w-3.5 h-3.5" /><span>{isSettingDefault ? 'Setting...' : 'Set Active'}</span></>
              }
            </button>
          )}

          <button
            onClick={() => setIsPrintModalOpen(true)}
            disabled={isNewSheet}
            className="px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg flex items-center gap-1.5 disabled:opacity-40"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>View QR</span>
          </button>

          <button
            disabled={isSaving}
            onClick={handleSave}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save Template'}</span>
          </button>
        </div>
      </div>

      {/* ── Status Message ───────────────────────────────────────────────── */}
      {statusMsg && (
        <div className={`p-3 rounded-lg text-xs flex items-start gap-2 border ${
          statusMsg.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : statusMsg.type === 'info'  ? 'border-blue-200 bg-blue-50 text-blue-800'
          : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          {statusMsg.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* ── Metadata Card ────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 text-xs">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">Sheet Metadata & Part Identification</span>
            {isCurrentDefault && (
              <span className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-800 border border-yellow-300 px-2 py-0.5 rounded-full text-[10px] font-semibold">
                <Star className="w-2.5 h-2.5 fill-yellow-600" /> ACTIVE
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => { setScannerMode('resolve'); setIsScanOpen(true); }}
            className="text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-md flex items-center gap-1 transition-colors"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Scan QR for Sheet ID</span>
          </button>
        </div>

        {/* Assigned physical barcode banner */}
        {externalBarcode && (
          <div className="flex items-center gap-2 bg-slate-900 text-white rounded-lg px-3 py-2.5">
            <Barcode className="w-4 h-4 shrink-0 text-slate-300" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Physical Barcode Linked</div>
              <div className="font-mono font-semibold truncate">{externalBarcode}</div>
            </div>
            <button type="button" onClick={() => setExternalBarcode('')}
              className="text-slate-400 hover:text-white p-0.5 rounded" title="Remove barcode link">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Core fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="space-y-1">
            <label className="font-medium text-slate-600 block">Sheet ID <span className="text-red-500">*</span></label>
            <input type="text" required value={sheetId} onChange={e => setSheetId(e.target.value)}
              placeholder="e.g. 18351M62Q50-IFM"
              className="w-full border border-slate-300 rounded-lg p-2 font-medium focus:outline-none focus:ring-2 focus:ring-slate-900" />
          </div>
          <div className="space-y-1">
            <label className="font-medium text-slate-600 block">Part Number</label>
            <input type="text" value={partNo} onChange={e => setPartNo(e.target.value)}
              placeholder="e.g. 18351M62Q50"
              className="w-full border border-slate-300 rounded-lg p-2 font-medium focus:outline-none focus:ring-2 focus:ring-slate-900" />
          </div>
          <div className="space-y-1">
            <label className="font-medium text-slate-600 block">Part Name</label>
            <input type="text" value={partName} onChange={e => setPartName(e.target.value)}
              placeholder="e.g. PIPE, PURGE LINE (RH)"
              className="w-full border border-slate-300 rounded-lg p-2 font-medium focus:outline-none focus:ring-2 focus:ring-slate-900" />
          </div>
          <div className="space-y-1">
            <label className="font-medium text-slate-600 block">Category</label>
            <select value={partCategory} onChange={e => setPartCategory(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2 font-medium focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white">
              <option value="MAIN PART">MAIN PART</option>
              <option value="CHILD PART">CHILD PART</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="space-y-1">
            <label className="font-medium text-slate-600 block">Model</label>
            <input type="text" value={modelName} onChange={e => setModelName(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-slate-900" />
          </div>
          <div className="space-y-1">
            <label className="font-medium text-slate-600 block">Vendor</label>
            <input type="text" value={vendorName} onChange={e => setVendorName(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-slate-900" />
          </div>
          <div className="space-y-1">
            <label className="font-medium text-slate-600 block">Customer</label>
            <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-slate-900" />
          </div>
        </div>

        <div className="space-y-1">
          <label className="font-medium text-slate-600 block">Document Title</label>
          <input type="text" value={documentTitle} onChange={e => setDocumentTitle(e.target.value)}
            className="w-full border border-slate-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-slate-900" />
        </div>
      </div>

      {/* ── Control Items Matrix ──────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-xs font-semibold text-slate-900">Control Items & Specification Matrix</h3>
            <p className="text-[11px] text-slate-500">Configure checklist rows and numeric measurement grids</p>
          </div>
          <button type="button" onClick={handleAddRow}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /><span>Add Row</span>
          </button>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="clean-table min-w-full text-xs">
            <thead>
              <tr>
                <th className="w-8 text-center">#</th>
                <th className="w-28">Stage</th>
                <th className="w-40">Control Item</th>
                <th className="w-44">Spec Criteria</th>
                <th className="w-24">Method</th>
                <th className="w-28 text-center">Freq (Norm / IFM)</th>
                <th className="w-30">Type</th>
                <th className="w-24 text-center">Min / Max / Unit</th>
                <th className="w-20">Role</th>
                <th className="w-8 text-center" title="Required">Req</th>
                <th className="w-8 text-center" title="Supervisor Checkpoint">Sup</th>
                <th className="w-14 text-center"></th>
              </tr>
            </thead>
            <tbody>
              {controlItems.map((item, idx) => (
                <tr key={idx}>
                  <td className="text-center font-semibold text-slate-400 text-[11px]">{item.serial_no}</td>
                  <td>
                    <input type="text" value={item.stage_name}
                      onChange={e => handleUpdateItem(idx, 'stage_name', e.target.value)}
                      className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs" placeholder="Stage" />
                  </td>
                  <td>
                    <input type="text" value={item.control_item_name}
                      onChange={e => handleUpdateItem(idx, 'control_item_name', e.target.value)}
                      className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs font-medium" placeholder="Item name" />
                  </td>
                  <td>
                    <input type="text" value={item.specification_content}
                      onChange={e => handleUpdateItem(idx, 'specification_content', e.target.value)}
                      className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs text-slate-700" placeholder="Spec" />
                  </td>
                  <td>
                    <input type="text" value={item.application_method || ''}
                      onChange={e => handleUpdateItem(idx, 'application_method', e.target.value)}
                      className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs" placeholder="Method" />
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5">
                      <input type="text" value={item.normal_frequency || ''}
                        onChange={e => handleUpdateItem(idx, 'normal_frequency', e.target.value)}
                        placeholder="Normal" className="w-full border border-slate-200 rounded px-1.5 py-0.5 text-[10px]" />
                      <input type="text" value={item.ifm_frequency || ''}
                        onChange={e => handleUpdateItem(idx, 'ifm_frequency', e.target.value)}
                        placeholder="IFM" className="w-full border border-slate-200 rounded px-1.5 py-0.5 text-[10px]" />
                    </div>
                  </td>
                  <td>
                    <select value={item.row_mode}
                      onChange={e => {
                        const m = e.target.value as any;
                        handleUpdateItem(idx, 'row_mode', m);
                        if (m === 'NUMERIC_SAMPLE') {
                          handleUpdateItem(idx, 'html_input_type', 'number');
                          handleUpdateItem(idx, 'sample_columns', ['1','2','3','4','5','6','7','8','9','10']);
                          handleUpdateItem(idx, 'assigned_role', 'supervisor');
                          handleUpdateItem(idx, 'is_supervisor_checkpoint', true);
                          handleUpdateItem(idx, 'editable_by_operator', false);
                          handleUpdateItem(idx, 'visible_to_operator', false);
                        } else {
                          handleUpdateItem(idx, 'html_input_type', 'checkbox');
                          handleUpdateItem(idx, 'sample_columns', ['1','2','3','4','5','6','7','8','9','10']);
                          handleUpdateItem(idx, 'assigned_role', 'operator');
                          handleUpdateItem(idx, 'is_supervisor_checkpoint', false);
                          handleUpdateItem(idx, 'editable_by_operator', true);
                          handleUpdateItem(idx, 'visible_to_operator', true);
                        }
                      }}
                      className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs bg-white font-medium">
                      <option value="SERIAL_TICKBOX">Tickbox</option>
                      <option value="NUMERIC_SAMPLE">Numeric</option>
                      <option value="STANDARD_INPUT">Text</option>
                    </select>
                  </td>
                  <td className="text-center">
                    {item.row_mode === 'NUMERIC_SAMPLE' ? (
                      <div className="space-y-0.5">
                        <div className="flex gap-1 justify-center">
                          <input type="number" step="0.01" value={item.min_val ?? ''}
                            onChange={e => handleUpdateItem(idx, 'min_val', e.target.value ? parseFloat(e.target.value) : null)}
                            placeholder="Min" className="w-11 border border-slate-200 rounded p-1 text-[10px] text-center" />
                          <input type="number" step="0.01" value={item.max_val ?? ''}
                            onChange={e => handleUpdateItem(idx, 'max_val', e.target.value ? parseFloat(e.target.value) : null)}
                            placeholder="Max" className="w-11 border border-slate-200 rounded p-1 text-[10px] text-center" />
                        </div>
                        <input type="text" value={item.unit || ''}
                          onChange={e => handleUpdateItem(idx, 'unit', e.target.value || null)}
                          placeholder="unit" className="w-full border border-slate-200 rounded px-1.5 py-0.5 text-[10px] text-center font-mono" />
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-400">Pass/Fail</span>
                    )}
                  </td>
                  <td>
                    <select value={item.assigned_role}
                      onChange={e => handleUpdateItem(idx, 'assigned_role', e.target.value as any)}
                      className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs bg-white">
                      <option value="operator">Operator</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="text-center">
                    <input type="checkbox" checked={item.is_required}
                      onChange={e => handleUpdateItem(idx, 'is_required', e.target.checked)}
                      className="w-3.5 h-3.5 cursor-pointer accent-black" title="Required field" />
                  </td>
                  <td className="text-center">
                    <input type="checkbox" checked={item.is_supervisor_checkpoint || false}
                      onChange={e => handleUpdateItem(idx, 'is_supervisor_checkpoint', e.target.checked)}
                      className="w-3.5 h-3.5 cursor-pointer accent-violet-600" title="Supervisor checkpoint" />
                  </td>
                  <td className="text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <button type="button" onClick={() => handleMoveRow(idx, 'up')} disabled={idx === 0}
                        className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-20 transition-colors" title="Move up">
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button type="button" onClick={() => handleMoveRow(idx, 'down')} disabled={idx === controlItems.length - 1}
                        className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-20 transition-colors" title="Move down">
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      <button type="button" onClick={() => handleRemoveRow(idx)}
                        className="p-0.5 text-slate-400 hover:text-red-600 rounded transition-colors" title="Delete row">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {isPrintModalOpen && (
        <PrintLabelModal isOpen onClose={() => setIsPrintModalOpen(false)} sheetId={sheetId} />
      )}

      {/* ── Delete Confirmation ──────────────────────────────────────────── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-sm p-6 shadow-xl text-xs space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">Delete Template</h3>
                <p className="text-slate-500 mt-1 leading-relaxed">
                  This will permanently delete <span className="font-mono font-semibold text-slate-800">{sheetId}</span> and
                  <strong> all inspection batches</strong> linked to it, including all recorded measurements, decisions, and attachments.
                </p>
                <p className="text-red-600 font-semibold mt-2">This cannot be undone.</p>
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Deleting...' : 'Yes, Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {isScanOpen && (
        <TFTScannerModal
          isOpen
          onClose={() => setIsScanOpen(false)}
          mode={scannerMode}
          onResolved={handleQRScannedForSheetID}
          onPartScanned={handlePartScanned}
        />
      )}
    </div>
  );
};
