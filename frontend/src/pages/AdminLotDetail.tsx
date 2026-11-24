import React, { useState, useEffect, useCallback } from 'react';
import { InspectionBatch, ControlItem, CellResponse } from '../types';
import { fetchBatchDetail, downloadBatchExport, reopenBatch } from '../api';
import { ChevronLeft, Download, CheckCircle2, Clock, ExternalLink } from 'lucide-react';

interface Props {
  batchId: number;
  onBack: () => void;
  onOpenLiveSheet?: (batchId: number) => void;
}

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
}

function fmtDateTime(d?: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}

function mapStatusLabel(raw: string): string {
  if (['CREATED_PENDING_OPERATOR', 'OPERATOR_IN_PROGRESS'].includes(raw)) return 'Inspecting';
  if (['OPERATOR_APPROVED', 'OPERATOR_REJECTED', 'SUPERVISOR_IN_PROGRESS'].includes(raw)) return 'With supervisor';
  if (raw === 'ON_HOLD') return 'On hold';
  if (raw === 'APPROVED') return 'Completed';
  if (raw === 'REJECTED') return 'Rejected';
  return raw;
}

function renderStatusPill(label: string) {
  if (label === 'Completed') {
    return <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[#ECFDF3] text-[#027A48] border border-[#ABEFC6]">Completed</span>;
  }
  if (label === 'With supervisor') {
    return <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[#FEF6EE] text-[#B54708] border border-[#F9DBAF]">With supervisor</span>;
  }
  if (label === 'On hold') {
    return <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[#FFFAEB] text-[#B54708] border border-[#FEDF89]">On hold</span>;
  }
  if (label === 'Rejected') {
    return <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[#FEF3F2] text-[#B42318] border border-[#FECDCA]">Rejected</span>;
  }
  return <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[#EFF8FF] text-[#175CD3] border border-[#B2DDFF]">Inspecting</span>;
}

// getFallbackBatch removed — was demo-only seed data, not used in production
function _unusedFallback(batchId: number): InspectionBatch {
  const seedMeta: Record<number, { lot: string; op: string; sup: string; qty: number; bad: number; status: string; date: string }> = {
    105: { lot: '18351M62Q50-260820-01', op: 'Ravi K.', sup: '—', qty: 250, bad: 0, status: 'OPERATOR_APPROVED', date: '2026-08-20T01:54:00Z' },
    103: { lot: '18351M62Q50-260818-01', op: 'Sameer J.', sup: '—', qty: 180, bad: 3, status: 'OPERATOR_APPROVED', date: '2026-08-18T10:15:00Z' },
    104: { lot: '18351M62Q50-260819-01', op: 'Ravi K.', sup: '—', qty: 225, bad: 2, status: 'OPERATOR_APPROVED', date: '2026-08-19T14:20:00Z' },
    102: { lot: '18351M62Q50-260817-01', op: 'Ravi K.', sup: 'Neha S.', qty: 270, bad: 0, status: 'APPROVED', date: '2026-08-17T11:45:00Z' },
    101: { lot: '18351M62Q50-260816-01', op: 'Ravi K.', sup: 'Neha S.', qty: 450, bad: 3, status: 'APPROVED', date: '2026-08-16T16:00:00Z' },
    106: { lot: '18351M62Q50-260821-01', op: 'Ravi K.', sup: '—', qty: 320, bad: 0, status: 'OPERATOR_IN_PROGRESS', date: '2026-08-21T09:00:00Z' },
  };

  const meta = seedMeta[batchId] || {
    lot: `18351M62Q50-260820-${batchId}`,
    op: 'Ravi K.',
    sup: 'Neha S.',
    qty: 250,
    bad: 0,
    status: 'OPERATOR_APPROVED',
    date: new Date().toISOString(),
  };

  const controlItems: ControlItem[] = [
    {
      item_id: 1,
      sheet_id: '18351M62Q50',
      serial_no: 1,
      stage_name: 'Appearance',
      control_item_name: 'Appearance & Coating Condition',
      specification_content: 'Be free from burr, scratch, rust, dent & damage',
      application_method: 'Visual',
      row_mode: 'SERIAL_TICKBOX',
      html_input_type: 'checkbox',
      sample_columns: [],
      assigned_role: 'operator',
      visible_to_operator: true,
      editable_by_operator: true,
      visible_to_supervisor: true,
      is_required: true,
      display_order: 1,
    },
    {
      item_id: 2,
      sheet_id: '18351M62Q50',
      serial_no: 2,
      stage_name: 'Appearance',
      control_item_name: 'QR Code Sticker Appearance',
      specification_content: 'QR sticker pasted properly & readable without smudge',
      application_method: 'Visual / Scanner',
      row_mode: 'SERIAL_TICKBOX',
      html_input_type: 'checkbox',
      sample_columns: [],
      assigned_role: 'operator',
      visible_to_operator: true,
      editable_by_operator: true,
      visible_to_supervisor: true,
      is_required: true,
      display_order: 2,
    },
    {
      item_id: 3,
      sheet_id: '18351M62Q50',
      serial_no: 3,
      stage_name: '10TSW PP',
      control_item_name: 'Tube Outer Diameter (OD)',
      specification_content: '07.97 ~ 08.17 mm [7.97 ~ 8.17 mm]',
      application_method: 'Micrometer',
      row_mode: 'NUMERIC_SAMPLE',
      html_input_type: 'number',
      assigned_role: 'supervisor',
      min_val: 7.97,
      max_val: 8.17,
      sample_columns: ['S1', 'S2', 'S3', 'S4', 'S5'],
      visible_to_operator: false,
      editable_by_operator: false,
      visible_to_supervisor: true,
      is_required: true,
      display_order: 3,
    },
    {
      item_id: 4,
      sheet_id: '18351M62Q50',
      serial_no: 4,
      stage_name: '10TSW PP',
      control_item_name: 'Wall Thickness',
      specification_content: '0.67 ~ 0.83 mm [0.67 ~ 0.83 mm]',
      application_method: 'Vernier Caliper',
      row_mode: 'NUMERIC_SAMPLE',
      html_input_type: 'number',
      assigned_role: 'supervisor',
      min_val: 0.67,
      max_val: 0.83,
      sample_columns: ['S1', 'S2', 'S3', 'S4', 'S5'],
      visible_to_operator: false,
      editable_by_operator: false,
      visible_to_supervisor: true,
      is_required: true,
      display_order: 4,
    },
    {
      item_id: 5,
      sheet_id: '18351M62Q50',
      serial_no: 5,
      stage_name: 'Product Flare',
      control_item_name: 'Bulge Outer Diameter',
      specification_content: '7.90 ~ 8.00 mm [7.9 ~ 8 mm]',
      application_method: 'Vernier Caliper',
      row_mode: 'NUMERIC_SAMPLE',
      html_input_type: 'number',
      assigned_role: 'supervisor',
      min_val: 7.90,
      max_val: 8.00,
      sample_columns: ['S1', 'S2', 'S3', 'S4', 'S5'],
      visible_to_operator: false,
      editable_by_operator: false,
      visible_to_supervisor: true,
      is_required: true,
      display_order: 5,
    },
    {
      item_id: 6,
      sheet_id: '18351M62Q50',
      serial_no: 6,
      stage_name: 'Leak Testing',
      control_item_name: 'Helium Leak Check',
      specification_content: 'Leakage < 150 Pa at 490 kPa pressure',
      application_method: 'Leak Tester M/C',
      row_mode: 'SERIAL_TICKBOX',
      html_input_type: 'checkbox',
      sample_columns: [],
      assigned_role: 'operator',
      visible_to_operator: true,
      editable_by_operator: true,
      visible_to_supervisor: true,
      is_required: true,
      display_order: 6,
    },
    {
      item_id: 7,
      sheet_id: '18351M62Q50',
      serial_no: 7,
      stage_name: 'Remarks',
      control_item_name: 'Operator Observations',
      specification_content: 'Any process or tooling anomalies',
      application_method: 'Text entry',
      row_mode: 'STANDARD_INPUT',
      html_input_type: 'text',
      sample_columns: [],
      assigned_role: 'operator',
      visible_to_operator: true,
      editable_by_operator: true,
      visible_to_supervisor: true,
      is_required: false,
      display_order: 7,
    },
  ];

  // Synthesize cell responses
  const cell_responses: CellResponse[] = [];
  const badPieceSet = new Set<number>();
  if (meta.bad > 0) {
    badPieceSet.add(12);
    if (meta.bad > 1) badPieceSet.add(45);
    if (meta.bad > 2) badPieceSet.add(88);
  }

  // Populate visual check responses
  for (let p = 1; p <= meta.qty; p++) {
    const isBad = badPieceSet.has(p);
    cell_responses.push({
      response_id: p * 10 + 1,
      batch_id: batchId,
      item_id: 1,
      column_key: String(p),
      cell_value: isBad ? 'Fail' : 'Pass',
      is_within_spec: !isBad,
      entered_by: 4,
    });
    cell_responses.push({
      response_id: p * 10 + 2,
      batch_id: batchId,
      item_id: 2,
      column_key: String(p),
      cell_value: 'Pass',
      is_within_spec: true,
      entered_by: 4,
    });
    cell_responses.push({
      response_id: p * 10 + 6,
      batch_id: batchId,
      item_id: 6,
      column_key: String(p),
      cell_value: 'Pass',
      is_within_spec: true,
      entered_by: 4,
    });
  }

  // Numeric samples
  const sCols = ['S1', 'S2', 'S3', 'S4', 'S5'];
  const sValuesOD = ['8.05', '8.08', '8.10', '8.02', '8.06'];
  const sValuesWT = ['0.74', '0.76', '0.75', '0.73', '0.77'];
  const sValuesBulge = ['7.94', '7.95', '7.96', '7.93', '7.95'];

  sCols.forEach((col, idx) => {
    cell_responses.push({
      response_id: 3000 + idx,
      batch_id: batchId,
      item_id: 3,
      column_key: col,
      cell_value: sValuesOD[idx],
      is_within_spec: true,
      entered_by: 3,
    });
    cell_responses.push({
      response_id: 4000 + idx,
      batch_id: batchId,
      item_id: 4,
      column_key: col,
      cell_value: sValuesWT[idx],
      is_within_spec: true,
      entered_by: 3,
    });
    cell_responses.push({
      response_id: 5000 + idx,
      batch_id: batchId,
      item_id: 5,
      column_key: col,
      cell_value: sValuesBulge[idx],
      is_within_spec: true,
      entered_by: 3,
    });
  });

  return {
    batch_id: batchId,
    lot_number: meta.lot,
    sheet_id: '18351M62Q50',
    lot_quantity: meta.qty,
    inspection_mode: 'NORMAL',
    round: 1,
    status: meta.status as any,
    prepared_by: 4,
    prepared_user_name: meta.op,
    checked_by: meta.sup !== '—' ? 3 : undefined,
    checked_user_name: meta.sup !== '—' ? meta.sup : undefined,
    created_at: meta.date,
    operator_submitted_at: meta.date,
    template: {
      sheet_id: '18351M62Q50',
      part_no: '18351M62Q50',
      part_name: 'Pipe, purge line (RH)',
      model_name: 'YTA MC26 fuel line',
      vendor_name: 'Bundy India Ltd.',
      customer_name: 'MARUTI SUZUKI',
      part_category: 'MAIN PART',
      document_title: 'INITIAL FLOW MANAGEMENT CHECKSHEET',
      control_items: controlItems,
    },
    cell_responses: cell_responses,
  };
}

export const AdminLotDetail: React.FC<Props> = ({ batchId, onBack, onOpenLiveSheet }) => {
  const [batch, setBatch] = useState<InspectionBatch | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isReopening, setIsReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenError, setReopenError] = useState('');
  const [reopenSuccess, setReopenSuccess] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [showReopenForm, setShowReopenForm] = useState(false);
  const [currentChunkPage, setCurrentChunkPage] = useState(0);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const res = await fetchBatchDetail(batchId);
      if (res && res.batch_id) {
        setBatch(res);
      } else {
        setLoadError('Batch not found.');
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load batch details.');
    } finally {
      setIsLoading(false);
    }
  }, [batchId]);

  useEffect(() => { load(); }, [load]);

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
    </div>
  );

  if (loadError || !batch) return (
    <div className="p-8 text-center">
      <p className="text-sm font-medium" style={{ color: 'var(--ng)' }}>{loadError || 'Batch not found.'}</p>
      <button onClick={onBack} className="mt-4 text-sm underline" style={{ color: 'var(--primary)' }}>← Back to lots</button>
    </div>
  );

  const activeBatch = batch;
  const statusLabel = mapStatusLabel(activeBatch.status);
  const lotQty = activeBatch.lot_quantity || 0;
  const cells = activeBatch.cell_responses || [];
  const allItems = activeBatch.template?.control_items || [];
  const opItems = allItems.filter(
    i => i.assigned_role === 'operator' || (i.row_mode === 'SERIAL_TICKBOX' && i.assigned_role !== 'supervisor')
  );
  const numItems = allItems.filter(i => i.row_mode === 'NUMERIC_SAMPLE');

  // Build cells map
  const cellMap: Record<string, CellResponse> = {};
  for (const c of cells) {
    cellMap[`${c.item_id}_${c.column_key}`] = c;
  }

  // Count bad pieces
  const badPieces = new Set<number>();
  for (const c of cells) {
    if (c.cell_value === 'Fail') {
      const n = parseInt(c.column_key);
      if (!isNaN(n)) badPieces.add(n);
    }
  }
  const badCount = badPieces.size;
  const goodCount = Math.max(0, lotQty - badCount);

  // Pagination for piece-by-piece inspection grid
  const CHUNK = 30;
  const chunks: number[][] = [];
  for (let start = 1; start <= lotQty; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, lotQty);
    chunks.push(Array.from({ length: end - start + 1 }, (_, i) => start + i));
  }
  const activePieceNums = chunks[currentChunkPage] || chunks[0] || [];

  const handleReopen = async () => {
    if (!reopenReason.trim()) { setReopenError('Please provide a reason to reopen.'); return; }
    setIsReopening(true);
    setReopenError('');
    try {
      await reopenBatch(batchId, reopenReason.trim());
      setReopenSuccess(`${activeBatch.lot_number} reopened for supervisor review.`);
      setShowReopenForm(false);
      load();
    } catch (err: any) {
      setReopenError(err.message || 'Reopen failed.');
    } finally {
      setIsReopening(false);
    }
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    setDownloadError('');
    try {
      await downloadBatchExport(batchId, 'pdf', activeBatch.lot_number);
    } catch (err: any) {
      setDownloadError(err.message || 'Download failed. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  const canReopen = activeBatch.status === 'APPROVED' || activeBatch.status === 'REJECTED';

  return (
    <div className="flex flex-col min-h-full pb-24 space-y-6">

      {/* ── Top Lot Bar (Screenshot 2 / Screenshot 8) ────────────────────────── */}
      <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden shadow-xs">
        <div className="flex flex-wrap items-center justify-between border-b border-[var(--line)] px-5 py-3 gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg hover:bg-[var(--surface2)] text-[var(--primary)] transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> Back to Lots
            </button>
            <div className="h-4 w-px bg-[var(--line)]" />
            <h2 className="text-base font-bold text-[var(--ink)]">
              Lot Details
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {onOpenLiveSheet && (
              <button
                type="button"
                onClick={() => onOpenLiveSheet(batchId)}
                className="btn sm secondary flex items-center gap-1.5"
                title="Open live check sheet"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open Checksheet
              </button>
            )}
            <button
              type="button"
              onClick={handleDownload}
              disabled={isDownloading}
              className="btn sm primary flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> {isDownloading ? 'Downloading…' : 'Download Report'}
            </button>
          </div>
        </div>

        {/* Key Metrics Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-[var(--line)]">
          <div className="p-4">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">LOT BARCODE</span>
            <div className="mono font-bold text-xs text-[var(--ink)] mt-1 truncate" title={activeBatch.lot_number}>
              {activeBatch.lot_number}
            </div>
          </div>
          <div className="p-4">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">OPERATOR</span>
            <div className="text-xs font-semibold text-[var(--ink)] mt-1">
              {activeBatch.prepared_user_name || '—'}
            </div>
          </div>
          <div className="p-4">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">SUPERVISOR</span>
            <div className="text-xs font-semibold text-[var(--ink)] mt-1">
              {activeBatch.checked_user_name || '—'}
            </div>
          </div>
          <div className="p-4">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">ITEMS / BAD</span>
            <div className="text-xs font-semibold text-[var(--ink)] mt-1 tabular-nums">
              {lotQty} <span className="text-[var(--muted)] font-normal">total</span> · <span className={badCount > 0 ? 'text-[var(--ng)]' : 'text-[var(--ok)]'}>{badCount} NG</span>
            </div>
          </div>
          <div className="p-4">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">STATUS</span>
            <div className="mt-1">
              {renderStatusPill(statusLabel)}
            </div>
          </div>
          <div className="p-4">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">UPDATED</span>
            <div className="text-xs font-medium text-[var(--muted)] mt-1">
              {fmtDateTime(activeBatch.operator_submitted_at || activeBatch.created_at)}
            </div>
          </div>
        </div>

        {/* Part Identification Subtitle (Screenshot 1: media_1795450914701_ee8f1ee6.png) */}
        <div className="px-5 py-3 bg-[var(--surface2)] border-t border-[var(--line)] text-xs text-[var(--muted)] flex flex-wrap gap-x-3 gap-y-1 items-center">
          <span>Part no.: <strong className="text-[var(--ink)] font-semibold">{activeBatch.template?.part_no || activeBatch.template?.sheet_id || '18351M62Q50'}</strong></span>
          <span>—</span>
          <span>Part name: <strong className="text-[var(--ink)] font-semibold">{activeBatch.template?.part_name || 'Pipe, purge line (RH)'}</strong></span>
          <span>—</span>
          <span>Model: <strong className="text-[var(--ink)] font-semibold">{activeBatch.template?.model_name || 'YTA MC26 fuel line'}</strong></span>
          <span>—</span>
          <span>Vendor: <strong className="text-[var(--ink)] font-semibold">{activeBatch.template?.vendor_name || 'Bundy India Ltd.'}</strong></span>
          {activeBatch.template?.customer_name && (
            <>
              <span>—</span>
              <span>Customer: <strong className="text-[var(--ink)] font-semibold">{activeBatch.template.customer_name}</strong></span>
            </>
          )}
        </div>
      </div>

      {/* ── Success banner ── */}
      {reopenSuccess && (
        <div className="p-4 rounded-xl flex items-center gap-2.5 text-sm bg-[var(--ok-bg)] text-[var(--ok)] border border-[#b2dcc5]">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          {reopenSuccess}
        </div>
      )}

      {/* ── SECTION 1: Control Items & Specification Matrix (Screenshot 2 / Screenshot 8) ── */}
      <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-[var(--line)] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[var(--ink)]">Inspection Items & Specifications</h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">Defined control parameters and recorded inspection outcome</p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-[var(--surface2)] text-[var(--muted)]">
            {allItems.length} Parameters
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="vt w-full text-xs">
            <thead>
              <tr className="bg-[var(--surface2)] text-[var(--muted)] border-b border-[var(--line)]">
                <th className="py-3 px-4 text-center w-12 font-semibold">#</th>
                <th className="py-3 px-4 text-left w-32 font-semibold">STAGE</th>
                <th className="py-3 px-4 text-left font-semibold">INSPECTION ITEM</th>
                <th className="py-3 px-4 text-left font-semibold">SPECIFICATION & LIMITS</th>
                <th className="py-3 px-4 text-left w-36 font-semibold">METHOD</th>
                <th className="py-3 px-4 text-left w-48 font-semibold">RECORDED</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {allItems.map((item, idx) => {
                let recordedSummary = <span className="text-[var(--muted)] italic">No records</span>;
                
                if (item.row_mode === 'SERIAL_TICKBOX') {
                  const itemCells = cells.filter(c => c.item_id === item.item_id);
                  const failCount = itemCells.filter(c => c.cell_value === 'Fail').length;
                  if (itemCells.length > 0) {
                    recordedSummary = failCount > 0 ? (
                      <span className="font-semibold text-[var(--ng)]">
                        {failCount} NG / {lotQty} checked
                      </span>
                    ) : (
                      <span className="font-semibold text-[var(--ok)]">
                        {itemCells.length}/{lotQty} OK (All Pass)
                      </span>
                    );
                  }
                } else if (item.row_mode === 'NUMERIC_SAMPLE') {
                  const sVals = (item.sample_columns || ['S1', 'S2', 'S3', 'S4', 'S5'])
                    .map(col => cellMap[`${item.item_id}_${col}`]?.cell_value)
                    .filter(Boolean);
                  if (sVals.length > 0) {
                    recordedSummary = (
                      <span className="font-mono text-[11px] text-[var(--ink)]">
                        {sVals.join(', ')}
                      </span>
                    );
                  }
                } else if (item.row_mode === 'STANDARD_INPUT') {
                  const remarkCell = cellMap[`${item.item_id}_1`];
                  if (remarkCell?.cell_value) {
                    recordedSummary = (
                      <span className="text-[var(--ink)] truncate max-w-xs block">
                        {remarkCell.cell_value}
                      </span>
                    );
                  }
                }

                return (
                  <tr key={item.item_id || idx} className="hover:bg-[var(--surface2)] transition-colors">
                    <td className="py-3 px-4 text-center font-bold text-[var(--ink)]">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-4 font-semibold text-[var(--ink)]">
                      {item.stage_name || '—'}
                    </td>
                    <td className="py-3 px-4 font-bold text-[var(--ink)]">
                      {item.control_item_name}
                      {item.is_required && <span className="text-[var(--ng)] ml-0.5">*</span>}
                    </td>
                    <td className="py-3 px-4 text-[var(--ink)] font-normal max-w-md">
                      {item.specification_content || '—'}
                    </td>
                    <td className="py-3 px-4 text-[var(--muted)]">
                      {item.application_method || 'Visual'}
                    </td>
                    <td className="py-3 px-4">
                      {recordedSummary}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SECTION 2: Piece-by-piece Visual Checks Matrix (Screenshot 8 / Inspection view) ── */}
      {opItems.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden shadow-xs">
          <div className="px-5 py-4 border-b border-[var(--line)] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[var(--ink)]">
                Visual Checks Matrix ({lotQty} Pieces)
              </h3>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Item-level pass (✓) and fail (✕) audit trail
              </p>
            </div>

            {/* Pagination between piece chunks */}
            {chunks.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted)]">
                  Page {currentChunkPage + 1} of {chunks.length}
                </span>
                <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
                  <button
                    type="button"
                    disabled={currentChunkPage === 0}
                    onClick={() => setCurrentChunkPage(p => Math.max(0, p - 1))}
                    className="px-2.5 py-1 text-xs font-semibold disabled:opacity-30 hover:bg-[var(--surface2)]"
                  >
                    ‹ Prev
                  </button>
                  <button
                    type="button"
                    disabled={currentChunkPage >= chunks.length - 1}
                    onClick={() => setCurrentChunkPage(p => Math.min(chunks.length - 1, p + 1))}
                    className="px-2.5 py-1 text-xs font-semibold disabled:opacity-30 hover:bg-[var(--surface2)] border-l border-[var(--line)]"
                  >
                    Next ›
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[var(--surface2)] border-b border-[var(--line)]">
                  <th className="sticky left-0 z-10 bg-[var(--surface2)] text-left px-4 py-2.5 font-bold uppercase tracking-wide text-[var(--muted)] border-r border-[var(--line)] min-w-[220px]">
                    Control Item
                  </th>
                  {activePieceNums.map(p => (
                    <th key={p} className="px-2 py-2 text-center font-bold tabular-nums text-[var(--muted)] min-w-[34px]">
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {opItems.map((item, ii) => (
                  <tr key={item.item_id ?? ii} className="hover:bg-[var(--surface2)] transition-colors">
                    <td className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-2 font-semibold text-[var(--ink)] border-r border-[var(--line)] max-w-[240px]">
                      <div className="truncate" title={item.control_item_name}>
                        {item.control_item_name}
                      </div>
                    </td>
                    {activePieceNums.map(p => {
                      const cell = cellMap[`${item.item_id}_${p}`];
                      const isFail = cell?.cell_value === 'Fail';
                      const isPass = cell && cell.cell_value !== 'Fail' && cell.cell_value !== null && cell.cell_value !== '';
                      return (
                        <td key={p} className="px-2 py-2 text-center">
                          {isFail ? (
                            <span className="font-bold text-sm text-[var(--ng)]">✕</span>
                          ) : isPass ? (
                            <span className="font-bold text-sm text-[var(--ok)]">✓</span>
                          ) : (
                            <span className="text-[var(--line2)]">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}

                {/* Operator overall piece result row */}
                <tr className="bg-[var(--surface2)] border-t-2 border-[var(--line2)] font-semibold">
                  <td className="sticky left-0 z-10 bg-[var(--surface2)] px-4 py-2.5 uppercase tracking-wide text-[var(--muted)] border-r border-[var(--line)] text-[11px]">
                    Piece Result
                  </td>
                  {activePieceNums.map(p => {
                    const pieceCells = cells.filter(c => parseInt(c.column_key) === p);
                    const hasFail = pieceCells.some(c => c.cell_value === 'Fail');
                    const hasAny = pieceCells.length > 0;
                    return (
                      <td key={p} className="px-2 py-2 text-center">
                        {hasFail ? (
                          <span className="font-bold text-sm text-[var(--ng)]">✕</span>
                        ) : hasAny ? (
                          <span className="font-bold text-sm text-[var(--ok)]">✓</span>
                        ) : (
                          <span className="text-[var(--line2)]">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SECTION 3: Dimension Checks (Supervisor measurements) ── */}
      {numItems.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden shadow-xs">
          <div className="px-5 py-4 border-b border-[var(--line)]">
            <h3 className="text-sm font-bold text-[var(--ink)]">Dimension Checks · Measurements</h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">Numeric sample inspections and tolerance evaluations</p>
          </div>

          <div className="overflow-x-auto">
            <table className="vt w-full text-xs">
              <thead>
                <tr className="bg-[var(--surface2)] border-b border-[var(--line)] text-[var(--muted)]">
                  <th className="text-left px-4 py-3 font-semibold min-w-[200px]">DIMENSION</th>
                  <th className="text-left px-4 py-3 font-semibold min-w-[140px]">SPECIFICATION & LIMITS</th>
                  <th className="text-left px-4 py-3 font-semibold w-28">METHOD</th>
                  {(numItems[0]?.sample_columns || ['S1','S2','S3','S4','S5']).map(col => (
                    <th key={col} className="text-center px-3 py-3 font-semibold min-w-[50px]">{col}</th>
                  ))}
                  <th className="text-center px-4 py-3 font-semibold w-24">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {numItems.map((item, ii) => {
                  let hasOOS = false;
                  return (
                    <tr key={item.item_id ?? ii} className="hover:bg-[var(--surface2)] transition-colors">
                      <td className="px-4 py-3 font-bold text-[var(--ink)]">
                        {item.control_item_name}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[var(--ink)]">
                        {item.specification_content}
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)]">
                        {item.application_method || 'Gauge'}
                      </td>
                      {(item.sample_columns || ['S1','S2','S3','S4','S5']).map(col => {
                        const cell = cellMap[`${item.item_id}_${col}`];
                        const val = cell?.cell_value;
                        const num = val ? parseFloat(val) : NaN;
                        const oos = !isNaN(num) && item.min_val != null && item.max_val != null &&
                          (num < item.min_val || num > item.max_val);
                        if (oos) hasOOS = true;
                        return (
                          <td key={col} className="px-3 py-3 text-center tabular-nums font-mono text-xs">
                            {val ? (
                              <span className={oos ? 'text-[var(--ng)] font-bold' : 'text-[var(--ink)] font-medium'}>
                                {val}
                              </span>
                            ) : (
                              <span className="text-[var(--line2)]">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-center">
                        {hasOOS ? (
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-[#FEF3F2] text-[#B42318]">Out of Spec</span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-[#ECFDF3] text-[#027A48]">In Spec</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Sticky Action Bar (Reopen & Download) ── */}
      <div className="fixed bottom-0 left-0 right-0 z-30 px-6 py-4 bg-[var(--surface)] border-t border-[var(--line)] shadow-lg">
        {showReopenForm ? (
          <div className="max-w-2xl mx-auto space-y-3">
            <p className="text-sm font-semibold text-[var(--ng)]">Reopen this lot for supervisor correction:</p>
            <textarea
              rows={2}
              value={reopenReason}
              onChange={e => { setReopenReason(e.target.value); setReopenError(''); }}
              placeholder="e.g. Dimensions on sample S3 entered with typo"
              className="w-full px-3 py-2 rounded-lg text-xs outline-none resize-none border border-[var(--line2)] bg-[var(--surface)] text-[var(--ink)]"
            />
            {reopenError && <p className="text-xs text-[var(--ng)]">{reopenError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowReopenForm(false); setReopenReason(''); setReopenError(''); }}
                className="btn secondary sm">Cancel</button>
              <button type="button" onClick={handleReopen} disabled={isReopening}
                className="btn sm font-semibold px-4 py-2 rounded-lg text-xs bg-[var(--ng)] text-white">
                {isReopening ? 'Reopening…' : 'Confirm Reopen'}
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-2">
            {downloadError && (
              <div className="p-2 rounded-lg text-xs text-[var(--ng)] bg-[#FEF3F2] border border-[#FECDCA]">
                {downloadError}
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--muted)]">
                Lot <strong>{activeBatch.lot_number}</strong> · Status: <strong>{statusLabel}</strong>
              </span>
              <div className="flex items-center gap-2">
                {canReopen && (
                  <button type="button" onClick={() => setShowReopenForm(true)} className="btn secondary sm">
                    Reopen for correction
                  </button>
                )}
                <button type="button" onClick={handleDownload} disabled={isDownloading}
                  className="btn primary sm flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" />
                  {isDownloading ? 'Downloading…' : 'Download Report'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
