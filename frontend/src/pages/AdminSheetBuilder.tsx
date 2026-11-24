import React, { useState, useEffect } from 'react';
import { SheetTemplate, ControlItem } from '../types';
import { fetchSheets, createSheet, updateSheet } from '../api';
import { Plus, Trash2, Save, Printer, QrCode, CheckCircle2, AlertCircle } from 'lucide-react';
import { PrintLabelModal } from '../components/PrintLabelModal';
import { TFTScannerModal } from '../components/TFTScannerModal';

export const AdminSheetBuilder: React.FC = () => {
  const [sheetsList, setSheetsList] = useState<SheetTemplate[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [isNewSheet, setIsNewSheet] = useState<boolean>(false);

  // Form State
  const [sheetId, setSheetId] = useState<string>('');
  const [documentTitle, setDocumentTitle] = useState<string>('DAILY INITIAL FLOW MANAGEMENT CONTROL ITEMS MONITORING CHECKSHEET (PRODUCT PARAMETER)');
  const [partNo, setPartNo] = useState<string>('18351M62Q50');
  const [partName, setPartName] = useState<string>('PIPE, PURGE LINE (RH)');
  const [modelName, setModelName] = useState<string>('YTA MC26 Fuel Line');
  const [vendorName, setVendorName] = useState<string>('Bundy India Ltd.');
  const [customerName, setCustomerName] = useState<string>('MSIL');
  const [partCategory, setPartCategory] = useState<string>('MAIN PART');
  const [controlItems, setControlItems] = useState<ControlItem[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modals
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);
  const [isTFTScanOpen, setIsTFTScanOpen] = useState<boolean>(false);

  useEffect(() => {
    loadSheets();
  }, []);

  const loadSheets = async () => {
    try {
      setIsLoading(true);
      const list = await fetchSheets();
      setSheetsList(list || []);
      if (list && list.length > 0) {
        populateForm(list[0]);
      } else {
        handleStartBlank();
      }
    } catch (err: any) {
      console.error('Failed to load sheets:', err);
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
    if (s.vendor_name) setVendorName(s.vendor_name);
    if (s.customer_name) setCustomerName(s.customer_name);
    setPartCategory(s.part_category || 'MAIN PART');
    setControlItems(s.control_items || []);
    setStatusMsg(null);
  };

  const handleStartBlank = () => {
    setIsNewSheet(true);
    setSelectedSheetId('');
    setSheetId(`IFM-CUSTOM-${Date.now().toString().slice(-4)}`);
    setDocumentTitle('INITIAL FLOW MANAGEMENT CONTROL ITEMS MONITORING CHECKSHEET');
    setPartNo('');
    setPartName('');
    setModelName('');
    setVendorName('');
    setCustomerName('');
    setPartCategory('MAIN PART');
    setControlItems([
      {
        serial_no: 1,
        stage_name: 'Appearance',
        control_item_name: 'Visual Flaw Check',
        specification_content: 'Be free from scratch, rust, damage',
        application_method: 'Visual',
        normal_frequency: '100%',
        ifm_frequency: '200%',
        row_mode: 'SERIAL_TICKBOX',
        html_input_type: 'checkbox',
        sample_columns: ['1', '2', '3', '4', '5'],
        assigned_role: 'operator',
        visible_to_operator: true,
        editable_by_operator: true,
        visible_to_supervisor: true,
        is_required: true,
        display_order: 1,
      },
      {
        serial_no: 2,
        stage_name: 'Measurement',
        control_item_name: 'Outer Diameter',
        specification_content: '8.00 ± 0.10 mm',
        application_method: 'Micrometer',
        normal_frequency: 'n=5/lot',
        ifm_frequency: 'n=10/lot',
        row_mode: 'NUMERIC_SAMPLE',
        html_input_type: 'number',
        sample_columns: ['S1', 'S2', 'S3', 'S4', 'S5'],
        min_val: 7.90,
        max_val: 8.10,
        assigned_role: 'operator',
        visible_to_operator: true,
        editable_by_operator: true,
        visible_to_supervisor: true,
        is_required: true,
        display_order: 2,
      }
    ]);
  };

  const handleAddRow = () => {
    const nextSerial = controlItems.length + 1;
    const newItem: ControlItem = {
      serial_no: nextSerial,
      stage_name: 'Inspection',
      control_item_name: `Control Item #${nextSerial}`,
      specification_content: 'Technical criteria',
      application_method: 'Visual',
      normal_frequency: '100%',
      ifm_frequency: '200%',
      row_mode: 'SERIAL_TICKBOX',
      html_input_type: 'checkbox',
      sample_columns: ['1', '2', '3', '4', '5'],
      min_val: null,
      max_val: null,
      assigned_role: 'operator',
      visible_to_operator: true,
      editable_by_operator: true,
      visible_to_supervisor: true,
      is_required: true,
      display_order: nextSerial,
    };
    setControlItems([...controlItems, newItem]);
  };

  const handleRemoveRow = (index: number) => {
    const updated = controlItems.filter((_, i) => i !== index);
    const reindexed = updated.map((it, idx) => ({ ...it, serial_no: idx + 1, display_order: idx + 1 }));
    setControlItems(reindexed);
  };

  const handleUpdateItem = (index: number, field: keyof ControlItem, val: any) => {
    const updated = [...controlItems];
    updated[index] = { ...updated[index], [field]: val };
    setControlItems(updated);
  };

  const handleSave = async () => {
    if (!sheetId.trim() || !documentTitle.trim()) {
      setStatusMsg({ type: 'error', text: 'Sheet ID and Document Title are required.' });
      return;
    }

    try {
      setIsSaving(true);
      setStatusMsg(null);
      const payload: SheetTemplate = {
        sheet_id: sheetId.trim(),
        document_title: documentTitle,
        part_no: partNo,
        part_name: partName,
        model_name: modelName,
        vendor_name: vendorName,
        customer_name: customerName,
        part_category: partCategory,
        control_items: controlItems,
      };

      if (isNewSheet) {
        await createSheet(payload);
        setStatusMsg({ type: 'success', text: `Template '${sheetId}' created successfully.` });
      } else {
        await updateSheet(sheetId, payload);
        setStatusMsg({ type: 'success', text: `Template '${sheetId}' updated successfully.` });
      }

      await loadSheets();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to save template.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleQRScannedForSheetID = (res: any) => {
    if (res.sheet_id) {
      const existing = sheetsList.find((sheet) => sheet.sheet_id === res.sheet_id);
      if (existing) {
        populateForm(existing);
        setStatusMsg({ type: 'success', text: `Loaded sheet for part number ${existing.part_no || res.sheet_id}.` });
        return;
      }
      setSheetId(res.sheet_id);
      setStatusMsg({ type: 'success', text: `Scanned Sheet ID populated: ${res.sheet_id}` });
    }
  };

  const handlePartNumberScanned = (scannedCode: string) => {
    const scannedPartNo = scannedCode.trim();
    handleStartBlank();
    setDocumentTitle('');
    setPartName('');
    setModelName('');
    setVendorName('');
    setCustomerName('');
    setControlItems([]);
    const normalizedId = scannedPartNo
      .toUpperCase()
      .replace(/[^A-Z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 55);
    setIsNewSheet(true);
    setSelectedSheetId('');
    setSheetId(`IFM-${normalizedId || Date.now().toString()}`);
    setPartNo(scannedPartNo);
    setStatusMsg({ type: 'success', text: `Part number ${scannedPartNo} added to the new sheet. Complete the form and save it.` });
  };

  if (isLoading) {
    return (
      <div className="py-24 text-center">
        <div className="w-7 h-7 border-2 border-[var(--line2)] border-t-[var(--primary)] rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-[var(--muted)]">Loading template builder...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Page Header: Title + Select + Actions ─────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--line)]">
        <div>
          <h2>Templates</h2>
          <p className="sub mt-0.5">
            Configure checksheet templates, control items, tolerances, and generate linked QR codes
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Template Select Dropdown */}
          <select
            value={selectedSheetId}
            onChange={(e) => {
              const found = sheetsList.find((s) => s.sheet_id === e.target.value);
              if (found) populateForm(found);
            }}
            aria-label="Select Template"
            className="min-h-[44px] px-3.5 border border-[var(--line2)] rounded-xl text-xs font-semibold bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] max-w-[280px] truncate"
          >
            {sheetsList.map((s) => (
              <option key={s.sheet_id} value={s.sheet_id}>
                {s.sheet_id} ({s.part_no || 'Template'})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleStartBlank}
            className="btn sm"
            title="Create blank sheet"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Blank Sheet</span>
          </button>

          <button
            type="button"
            onClick={() => setIsPrintModalOpen(true)}
            disabled={isNewSheet}
            className="btn sm disabled:opacity-40"
            title="View & Print QR Code"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>View QR</span>
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="btn primary sm disabled:opacity-50"
            title="Save Template"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save Template'}</span>
          </button>
        </div>
      </div>

      {/* ── Status Message Banner ─────────────────────────────────────────── */}
      {statusMsg && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center gap-2.5 border ${
            statusMsg.type === 'success'
              ? 'border-[var(--ok)] bg-[var(--ok-bg)] text-[var(--ok)]'
              : 'border-[var(--ng)] bg-[var(--ng-bg)] text-[var(--ng)]'
          }`}
        >
          {statusMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[var(--ok)]" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 text-[var(--ng)]" />
          )}
          <span className="font-medium">{statusMsg.text}</span>
        </div>
      )}

      {/* ── Card 1: Sheet Metadata & Identification ────────────────────────── */}
      <div className="sv-card space-y-4">
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--line)]">
          <span className="font-semibold text-sm text-[var(--ink)]">
            Sheet Metadata & Identification
          </span>
          <button
            type="button"
            onClick={() => setIsTFTScanOpen(true)}
            className="btn sm text-xs"
            title="Scan part number barcode or QR"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Scan Part Number</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="space-y-1">
            <label className="font-semibold text-xs text-[var(--ink)] block">Sheet ID</label>
            <input
              type="text"
              required
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              placeholder="e.g. 18351M62Q50-IFM"
              className="w-full border border-[var(--line2)] rounded-xl p-2.5 bg-[var(--surface)] text-[var(--ink)] mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)] text-xs font-medium"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-xs text-[var(--ink)] block">Part Number</label>
            <input
              type="text"
              value={partNo}
              onChange={(e) => setPartNo(e.target.value)}
              placeholder="e.g. 18351M62Q50"
              className="w-full border border-[var(--line2)] rounded-xl p-2.5 bg-[var(--surface)] text-[var(--ink)] mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)] text-xs font-medium"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-xs text-[var(--ink)] block">Part Name</label>
            <input
              type="text"
              value={partName}
              onChange={(e) => setPartName(e.target.value)}
              placeholder="e.g. PIPE, PURGE LINE (RH)"
              className="w-full border border-[var(--line2)] rounded-xl p-2.5 bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] text-xs font-medium"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-xs text-[var(--ink)] block">Category</label>
            <select
              value={partCategory}
              onChange={(e) => setPartCategory(e.target.value)}
              className="w-full border border-[var(--line2)] rounded-xl p-2.5 bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] text-xs font-medium cursor-pointer"
            >
              <option value="MAIN PART">MAIN PART</option>
              <option value="CHILD PART">CHILD PART</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="space-y-1">
            <label className="font-semibold text-xs text-[var(--ink)] block">Model</label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="e.g. YTA MC26 Fuel Line"
              className="w-full border border-[var(--line2)] rounded-xl p-2.5 bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="font-semibold text-xs text-[var(--ink)] block">Vendor</label>
            <input
              type="text"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder="e.g. Bundy India Ltd."
              className="w-full border border-[var(--line2)] rounded-xl p-2.5 bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="font-semibold text-xs text-[var(--ink)] block">Customer</label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. MSIL"
              className="w-full border border-[var(--line2)] rounded-xl p-2.5 bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] text-xs"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="font-semibold text-xs text-[var(--ink)] block">Document Title</label>
          <input
            type="text"
            value={documentTitle}
            onChange={(e) => setDocumentTitle(e.target.value)}
            className="w-full border border-[var(--line2)] rounded-xl p-2.5 bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] text-xs font-medium"
          />
        </div>
      </div>

      {/* ── Card 2: Control Items & Specification Matrix ─────────────────────── */}
      <div className="sv-card flush">
        <div className="p-4 sm:p-5 border-b border-[var(--line)] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              Control Items & Specification Matrix
            </h3>
            <p className="sub text-[11px] mt-0.5">
              Configure visual checklist rows and numeric sample measurement grids
            </p>
          </div>

          <button
            type="button"
            onClick={handleAddRow}
            className="btn primary sm"
            title="Add a new row"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Row</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="vt">
            <thead>
              <tr>
                <th className="w-10 text-center">#</th>
                <th className="w-32">Stage</th>
                <th className="w-44">Control Item</th>
                <th className="w-48">Spec Criteria</th>
                <th className="w-28">Method</th>
                <th className="w-32">Type</th>
                <th className="w-28">Columns</th>
                <th className="w-28 text-center">Tolerance (Min / Max)</th>
                <th className="w-24">Role</th>
                <th className="w-12 text-center"></th>
              </tr>
            </thead>
            <tbody>
              {controlItems.map((item, idx) => (
                <tr key={idx}>
                  <td className="text-center font-semibold text-[var(--muted)]">{item.serial_no}</td>

                  <td>
                    <input
                      type="text"
                      value={item.stage_name}
                      onChange={(e) => handleUpdateItem(idx, 'stage_name', e.target.value)}
                      className="w-full border border-[var(--line2)] rounded-lg px-2 py-1.5 text-xs bg-[var(--surface)] text-[var(--ink)]"
                      placeholder="Stage"
                    />
                  </td>

                  <td>
                    <input
                      type="text"
                      value={item.control_item_name}
                      onChange={(e) => handleUpdateItem(idx, 'control_item_name', e.target.value)}
                      className="w-full border border-[var(--line2)] rounded-lg px-2 py-1.5 text-xs font-semibold bg-[var(--surface)] text-[var(--ink)]"
                      placeholder="Item name"
                    />
                  </td>

                  <td>
                    <input
                      type="text"
                      value={item.specification_content}
                      onChange={(e) => handleUpdateItem(idx, 'specification_content', e.target.value)}
                      className="w-full border border-[var(--line2)] rounded-lg px-2 py-1.5 text-xs bg-[var(--surface)] text-[var(--muted)]"
                      placeholder="Spec"
                    />
                  </td>

                  <td>
                    <input
                      type="text"
                      value={item.application_method || ''}
                      onChange={(e) => handleUpdateItem(idx, 'application_method', e.target.value)}
                      className="w-full border border-[var(--line2)] rounded-lg px-2 py-1.5 text-xs bg-[var(--surface)] text-[var(--ink)]"
                      placeholder="Method"
                    />
                  </td>

                  <td>
                    <select
                      value={item.row_mode}
                      onChange={(e) => {
                        const m = e.target.value as any;
                        handleUpdateItem(idx, 'row_mode', m);
                        if (m === 'NUMERIC_SAMPLE') {
                          handleUpdateItem(idx, 'html_input_type', 'number');
                          handleUpdateItem(idx, 'sample_columns', ['S1', 'S2', 'S3', 'S4', 'S5']);
                        } else {
                          handleUpdateItem(idx, 'html_input_type', 'checkbox');
                          handleUpdateItem(idx, 'sample_columns', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
                        }
                      }}
                      className="w-full border border-[var(--line2)] rounded-lg px-1.5 py-1.5 text-xs bg-[var(--surface)] text-[var(--ink)] font-medium cursor-pointer"
                    >
                      <option value="SERIAL_TICKBOX">Tickbox (100%/200%)</option>
                      <option value="NUMERIC_SAMPLE">Numeric (n=5/10)</option>
                    </select>
                  </td>

                  <td>
                    <input
                      type="text"
                      value={item.sample_columns.join(',')}
                      onChange={(e) => handleUpdateItem(idx, 'sample_columns', e.target.value.split(',').map((s) => s.trim()))}
                      className="w-full border border-[var(--line2)] rounded-lg px-2 py-1.5 text-[11px] mono bg-[var(--surface)] text-[var(--ink)]"
                    />
                  </td>

                  <td className="text-center">
                    {item.row_mode === 'NUMERIC_SAMPLE' ? (
                      <div className="flex gap-1 justify-center">
                        <input
                          type="number"
                          step="0.01"
                          value={item.min_val ?? ''}
                          onChange={(e) => handleUpdateItem(idx, 'min_val', e.target.value ? parseFloat(e.target.value) : null)}
                          placeholder="Min"
                          className="w-12 border border-[var(--line2)] rounded-lg p-1 text-[11px] text-center bg-[var(--surface)] text-[var(--ink)] mono"
                        />
                        <input
                          type="number"
                          step="0.01"
                          value={item.max_val ?? ''}
                          onChange={(e) => handleUpdateItem(idx, 'max_val', e.target.value ? parseFloat(e.target.value) : null)}
                          placeholder="Max"
                          className="w-12 border border-[var(--line2)] rounded-lg p-1 text-[11px] text-center bg-[var(--surface)] text-[var(--ink)] mono"
                        />
                      </div>
                    ) : (
                      <span className="text-[11px] text-[var(--muted)]">Pass / Fail</span>
                    )}
                  </td>

                  <td>
                    <select
                      value={item.assigned_role}
                      onChange={(e) => handleUpdateItem(idx, 'assigned_role', e.target.value as any)}
                      className="w-full border border-[var(--line2)] rounded-lg px-1.5 py-1.5 text-xs bg-[var(--surface)] text-[var(--ink)] cursor-pointer"
                    >
                      <option value="operator">Operator</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>

                  <td className="text-center">
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(idx)}
                      className="p-1.5 text-[var(--muted)] hover:text-[var(--ng)] rounded-lg transition-colors cursor-pointer"
                      title="Delete Row"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {isPrintModalOpen && (
        <PrintLabelModal
          isOpen={true}
          onClose={() => setIsPrintModalOpen(false)}
          sheetId={sheetId}
        />
      )}

      {isTFTScanOpen && (
        <TFTScannerModal
          isOpen={true}
          onClose={() => setIsTFTScanOpen(false)}
          onResolved={handleQRScannedForSheetID}
          scanAsPartNumber
          onUnregisteredCode={handlePartNumberScanned}
        />
      )}
    </div>
  );
};
