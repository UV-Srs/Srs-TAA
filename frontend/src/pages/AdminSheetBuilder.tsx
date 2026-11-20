import React, { useState, useEffect } from 'react';
import { SheetTemplate, ControlItem } from '../types';
import { fetchSheets, createSheet, updateSheet } from '../api';
import { Plus, Trash2, Save, Printer, QrCode, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
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
      setSheetsList(list);
      if (list.length > 0) {
        populateForm(list[0]);
      } else {
        handleStartBlank();
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
    vendorName && setVendorName(s.vendor_name || '');
    customerName && setCustomerName(s.customer_name || '');
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
      stage_name: 'Inspection Stage',
      control_item_name: `Control Item #${nextSerial}`,
      specification_content: 'Technical criteria / tolerance range',
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
    // Re-index serials
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
        setStatusMsg({ type: 'success', text: `Template '${sheetId}' created successfully with linked QR & Barcodes.` });
      } else {
        await updateSheet(sheetId, payload);
        setStatusMsg({ type: 'success', text: `Template '${sheetId}' updated successfully.` });
      }

      await loadSheets();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to save checksheet template.' });
    } finally {
      setIsSaving(false);
    }
  };

  // External QR Scan populates Sheet ID (FR-019)
  const handleQRScannedForSheetID = (res: any) => {
    if (res.sheet_id) {
      setSheetId(res.sheet_id);
      setStatusMsg({ type: 'success', text: `Scanned Sheet ID populated: ${res.sheet_id}` });
    }
  };

  if (isLoading) {
    return <div className="p-12 text-center font-mono text-xs">Loading Checksheet Builder...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Top Controls */}
      <div className="border-b-2 border-black pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black uppercase tracking-tight text-black">
            IFM Checksheet Template Builder & QR Engine
          </h2>
          <p className="text-xs font-mono text-zinc-600">
            Define rows, sample columns, numeric tolerance min/max limits, and generate built-in QR/barcodes
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Select Existing Template */}
          <select
            value={selectedSheetId}
            onChange={(e) => {
              const found = sheetsList.find((s) => s.sheet_id === e.target.value);
              if (found) populateForm(found);
            }}
            className="border-2 border-black px-3 py-2 text-xs font-mono font-bold bg-white focus:outline-none"
          >
            {sheetsList.map((s) => (
              <option key={s.sheet_id} value={s.sheet_id}>
                {s.sheet_id} ({s.part_no || 'No Part'})
              </option>
            ))}
          </select>

          <button
            onClick={handleStartBlank}
            className="bg-white border-2 border-black hover:bg-zinc-100 text-black font-extrabold text-xs px-3 py-2 uppercase flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Blank Sheet</span>
          </button>

          <button
            onClick={() => setIsPrintModalOpen(true)}
            disabled={isNewSheet}
            className="bg-white border-2 border-black hover:bg-zinc-100 text-black font-extrabold text-xs px-3 py-2 uppercase flex items-center gap-1.5 transition-colors disabled:opacity-40"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>View QR / Barcode</span>
          </button>

          <button
            disabled={isSaving}
            onClick={handleSave}
            className="bg-black hover:bg-zinc-800 text-white font-extrabold text-xs px-5 py-2 uppercase flex items-center gap-1.5 transition-colors disabled:opacity-50 shadow-sm"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save Template'}</span>
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className={`p-3 text-xs font-mono flex items-center gap-2 border-2 ${
          statusMsg.type === 'success'
            ? 'border-black bg-zinc-100 text-black font-bold'
            : 'border-black bg-black text-white font-bold'
        }`}>
          {statusMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Header Metadata Configuration (Zone A) */}
      <div className="border-2 border-black p-5 bg-white space-y-4 font-mono text-xs">
        <div className="flex items-center justify-between border-b-2 border-black pb-2">
          <span className="font-black text-sm uppercase">Zone A: Header Metadata & Sheet ID</span>
          <button
            type="button"
            onClick={() => setIsTFTScanOpen(true)}
            className="bg-zinc-100 hover:bg-zinc-200 border border-black px-2.5 py-1 text-[11px] font-bold flex items-center gap-1"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Scan External QR to Populate Sheet ID (FR-019)</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block font-bold uppercase mb-1">Sheet ID (Admin Controlled):</label>
            <input
              type="text"
              required
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              placeholder="e.g. 18351M62Q50-IFM"
              className="w-full border-2 border-black p-2 font-bold focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-bold uppercase mb-1">Part Number:</label>
            <input
              type="text"
              value={partNo}
              onChange={(e) => setPartNo(e.target.value)}
              placeholder="e.g. 18351M62Q50"
              className="w-full border-2 border-black p-2 font-bold focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-bold uppercase mb-1">Part Name:</label>
            <input
              type="text"
              value={partName}
              onChange={(e) => setPartName(e.target.value)}
              placeholder="e.g. PIPE, PURGE LINE (RH)"
              className="w-full border-2 border-black p-2 font-bold focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-bold uppercase mb-1">Part Category:</label>
            <select
              value={partCategory}
              onChange={(e) => setPartCategory(e.target.value)}
              className="w-full border-2 border-black p-2 font-bold focus:outline-none"
            >
              <option value="MAIN PART">MAIN PART</option>
              <option value="CHILD PART">CHILD PART</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block font-bold uppercase mb-1">Model Name:</label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="e.g. YTA MC26 Fuel Line"
              className="w-full border-2 border-black p-2 font-bold focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-bold uppercase mb-1">Vendor Name:</label>
            <input
              type="text"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder="e.g. Bundy India Ltd."
              className="w-full border-2 border-black p-2 font-bold focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-bold uppercase mb-1">Customer Name:</label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. MSIL"
              className="w-full border-2 border-black p-2 font-bold focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block font-bold uppercase mb-1">Document Title:</label>
          <input
            type="text"
            value={documentTitle}
            onChange={(e) => setDocumentTitle(e.target.value)}
            className="w-full border-2 border-black p-2 font-bold focus:outline-none"
          />
        </div>
      </div>

      {/* Control Items Matrix Configuration (Zone B) */}
      <div className="border-2 border-black p-5 bg-white space-y-4">
        <div className="flex items-center justify-between border-b-2 border-black pb-2">
          <div>
            <span className="font-black text-sm uppercase font-mono">
              Zone B: Inspection Control Items & Specification Tolerance Matrix
            </span>
            <p className="text-[11px] font-mono text-zinc-600">
              Configure attribute check tickboxes, micrometer/caliper sample grids, and upper/lower bounds
            </p>
          </div>

          <button
            type="button"
            onClick={handleAddRow}
            className="bg-black text-white hover:bg-zinc-800 font-extrabold text-xs px-3 py-1.5 uppercase flex items-center gap-1 font-mono"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Row</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="industrial-table min-w-full text-left text-xs font-mono">
            <thead>
              <tr className="industrial-header text-[10px] divide-x-2 divide-black">
                <th className="p-2 w-10 text-center">S.No</th>
                <th className="p-2 w-32">Stage</th>
                <th className="p-2 w-44">Control Item</th>
                <th className="p-2 w-48">Spec Criteria</th>
                <th className="p-2 w-28">Method</th>
                <th className="p-2 w-28">Mode & Type</th>
                <th className="p-2 w-24">Columns</th>
                <th className="p-2 w-28 text-center">Tolerance Bounds</th>
                <th className="p-2 w-24">Role</th>
                <th className="p-2 w-10 text-center">Del</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-black">
              {controlItems.map((item, idx) => (
                <tr key={idx} className="divide-x-2 divide-black">
                  <td className="p-1 text-center font-bold">{item.serial_no}</td>
                  
                  <td className="p-1">
                    <input
                      type="text"
                      value={item.stage_name}
                      onChange={(e) => handleUpdateItem(idx, 'stage_name', e.target.value)}
                      className="w-full border border-black p-1 text-[11px] font-bold"
                      placeholder="Stage"
                    />
                  </td>

                  <td className="p-1">
                    <input
                      type="text"
                      value={item.control_item_name}
                      onChange={(e) => handleUpdateItem(idx, 'control_item_name', e.target.value)}
                      className="w-full border border-black p-1 text-[11px] font-bold"
                      placeholder="Item name"
                    />
                  </td>

                  <td className="p-1">
                    <input
                      type="text"
                      value={item.specification_content}
                      onChange={(e) => handleUpdateItem(idx, 'specification_content', e.target.value)}
                      className="w-full border border-black p-1 text-[11px]"
                      placeholder="Criteria / Spec"
                    />
                  </td>

                  <td className="p-1">
                    <input
                      type="text"
                      value={item.application_method || ''}
                      onChange={(e) => handleUpdateItem(idx, 'application_method', e.target.value)}
                      className="w-full border border-black p-1 text-[11px]"
                      placeholder="Visual / Micrometer"
                    />
                  </td>

                  <td className="p-1">
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
                      className="w-full border border-black p-1 text-[11px] font-bold"
                    >
                      <option value="SERIAL_TICKBOX">TICKBOX (100%/200%)</option>
                      <option value="NUMERIC_SAMPLE">NUMERIC SAMPLE (n=5/10)</option>
                    </select>
                  </td>

                  <td className="p-1">
                    <input
                      type="text"
                      value={item.sample_columns.join(',')}
                      onChange={(e) => handleUpdateItem(idx, 'sample_columns', e.target.value.split(',').map((s) => s.trim()))}
                      className="w-full border border-black p-1 text-[11px] font-mono"
                      title="Comma-separated column keys, e.g. 1,2,3 or S1,S2,S3"
                    />
                  </td>

                  <td className="p-1 text-center">
                    {item.row_mode === 'NUMERIC_SAMPLE' ? (
                      <div className="flex gap-1">
                        <input
                          type="number"
                          step="0.01"
                          value={item.min_val ?? ''}
                          onChange={(e) => handleUpdateItem(idx, 'min_val', e.target.value ? parseFloat(e.target.value) : null)}
                          placeholder="Min"
                          className="w-1/2 border border-black p-0.5 text-[10px] text-center"
                        />
                        <input
                          type="number"
                          step="0.01"
                          value={item.max_val ?? ''}
                          onChange={(e) => handleUpdateItem(idx, 'max_val', e.target.value ? parseFloat(e.target.value) : null)}
                          placeholder="Max"
                          className="w-1/2 border border-black p-0.5 text-[10px] text-center"
                        />
                      </div>
                    ) : (
                      <span className="text-[10px] text-zinc-400">N/A (Pass/Fail)</span>
                    )}
                  </td>

                  <td className="p-1">
                    <select
                      value={item.assigned_role}
                      onChange={(e) => handleUpdateItem(idx, 'assigned_role', e.target.value as any)}
                      className="w-full border border-black p-1 text-[11px]"
                    >
                      <option value="operator">Operator</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>

                  <td className="p-1 text-center">
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(idx)}
                      className="p-1 text-black hover:bg-zinc-200"
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
        />
      )}
    </div>
  );
};
