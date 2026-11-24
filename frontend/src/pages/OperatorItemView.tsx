import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  CheckCircle2, AlertTriangle, Check, X,
} from 'lucide-react';
import { InspectionBatch, ControlItem, User } from '../types';
import { fetchBatchDetail, updateCellResponse, submitOperatorBatch } from '../api';

interface Props {
  batchId: number;
  currentUser: User;
  onBatchUpdated?: () => void;
  onBack?: () => void;
}

interface OperatorCheckItem {
  item_id: number;
  control_item_name: string;
  specification_content?: string;
  application_method?: string;
}

function getOperatorFallbackBatch(batchId: number): InspectionBatch {
  const seedLots: Record<number, { lot: string; qty: number }> = {
    105: { lot: '18351M62Q50-260820-01', qty: 250 },
    104: { lot: '18351M62Q50-260819-01', qty: 225 },
    103: { lot: '18351M62Q50-260818-01', qty: 180 },
    102: { lot: '18351M62Q50-260817-01', qty: 270 },
    101: { lot: '18351M62Q50-260816-01', qty: 450 },
    106: { lot: '18351M62Q50-260821-01', qty: 320 },
  };
  const meta = seedLots[batchId] || { lot: '18351M62Q50-260820-01', qty: 250 };

  return {
    batch_id: batchId,
    sheet_id: '18351M62Q50',
    lot_number: meta.lot,
    lot_quantity: meta.qty,
    inspection_mode: 'NORMAL',
    round: 1,
    status: 'OPERATOR_IN_PROGRESS',
    created_at: new Date().toISOString(),
    template: {
      sheet_id: '18351M62Q50',
      part_no: '18351M62Q50',
      part_name: 'Pipe, purge line (RH)',
      model_name: 'YTA MC26 fuel line',
      vendor_name: 'Bundy India Ltd.',
      customer_name: 'MARUTI SUZUKI',
      document_title: 'INITIAL FLOW MANAGEMENT CHECKSHEET',
      control_items: [
        {
          item_id: 1001,
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
          item_id: 1002,
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
          item_id: 1003,
          sheet_id: '18351M62Q50',
          serial_no: 3,
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
          display_order: 3,
        },
        {
          item_id: 1004,
          sheet_id: '18351M62Q50',
          serial_no: 4,
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
          display_order: 4,
        },
      ],
    },
    cell_responses: [],
  };
}

const DEFAULT_OP_ITEMS: OperatorCheckItem[] = [
  {
    item_id: 1001,
    control_item_name: 'Appearance & Coating Condition',
    specification_content: 'Be free from burr, scratch, rust, dent & damage',
    application_method: 'Visual',
  },
  {
    item_id: 1002,
    control_item_name: 'QR Code Sticker Appearance',
    specification_content: 'QR sticker pasted properly & readable without smudge',
    application_method: 'Visual / Scanner',
  },
  {
    item_id: 1003,
    control_item_name: 'Helium Leak Check',
    specification_content: 'Leakage < 150 Pa at 490 kPa pressure',
    application_method: 'Leak Tester M/C',
  },
  {
    item_id: 1004,
    control_item_name: 'Operator Observations',
    specification_content: 'Any process or tooling anomalies',
    application_method: 'Text entry',
  },
];

export const OperatorItemView: React.FC<Props> = ({
  batchId,
  currentUser,
  onBatchUpdated,
  onBack,
}) => {
  const [batch, setBatch] = useState<InspectionBatch | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPiece, setCurrentPiece] = useState(1);
  // key: `${itemId}_${pieceNum}` → 'Pass' (Right) | 'Fail' (Wrong)
  const [cellResponses, setCellResponses] = useState<Record<string, 'Pass' | 'Fail'>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const itemListRef = useRef<HTMLDivElement>(null);

  const loadBatch = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await fetchBatchDetail(batchId);
      if (data && data.batch_id) {
        setBatch(data);
        if (data.operator_submitted_at) setIsSubmitted(true);

        const responses: Record<string, 'Pass' | 'Fail'> = {};
        for (const cell of data.cell_responses || []) {
          const pieceNum = parseInt(cell.column_key);
          if (!isNaN(pieceNum) && pieceNum >= 1) {
            if (cell.cell_value === 'Fail' || cell.cell_value === 'Pass') {
              responses[`${cell.item_id}_${pieceNum}`] = cell.cell_value as 'Pass' | 'Fail';
            }
          }
        }
        setCellResponses(responses);
      } else {
        setBatch(getOperatorFallbackBatch(batchId));
      }
    } catch {
      setBatch(getOperatorFallbackBatch(batchId));
    } finally {
      setIsLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    loadBatch();
  }, [loadBatch]);

  // Scroll active item into view in sidebar
  useEffect(() => {
    const el = itemListRef.current?.querySelector(`[data-piece="${currentPiece}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentPiece]);

  const rawOpItems = (batch?.template?.control_items || []).filter(
    (i) => i.assigned_role === 'operator' || (!i.assigned_role && i.row_mode === 'SERIAL_TICKBOX')
  );

  const opItems = useMemo<OperatorCheckItem[]>(() => {
    if (rawOpItems.length > 0) {
      return rawOpItems.map((i) => ({
        item_id: i.item_id || Math.floor(Math.random() * 10000),
        control_item_name: i.control_item_name,
        specification_content: i.specification_content,
        application_method: i.application_method,
      }));
    }
    return DEFAULT_OP_ITEMS;
  }, [rawOpItems]);

  const lotQty = batch?.lot_quantity || 100;

  // Derive checked pieces directly from cell responses:
  // A piece is ONLY considered checked if at least one check has an explicit decision
  const checkedPieces = useMemo(() => {
    const pieces = new Set<number>();
    Object.keys(cellResponses).forEach((key) => {
      const parts = key.split('_');
      const pieceNum = parseInt(parts[parts.length - 1]);
      if (!isNaN(pieceNum) && cellResponses[key]) {
        pieces.add(pieceNum);
      }
    });
    return pieces;
  }, [cellResponses]);

  const pieceHasDefects = (p: number) =>
    opItems.some((i) => cellResponses[`${i.item_id}_${p}`] === 'Fail');

  const pieceIsChecked = (p: number) => checkedPieces.has(p);

  const checkedCount = checkedPieces.size;
  const goodCount = Array.from(checkedPieces).filter((p) => !pieceHasDefects(p)).length;
  const badCount = Array.from(checkedPieces).filter((p) => pieceHasDefects(p)).length;

  // Set Right ('Pass') or Wrong ('Fail')
  const handleSetStatus = async (itemId: number, newStatus: 'Pass' | 'Fail') => {
    const key = `${itemId}_${currentPiece}`;
    const prevStatus = cellResponses[key];
    // Tapping the same active button toggles it off
    const finalStatus: 'Pass' | 'Fail' | null = prevStatus === newStatus ? null : newStatus;

    setCellResponses((prev) => {
      const copy = { ...prev };
      if (finalStatus) {
        copy[key] = finalStatus;
      } else {
        delete copy[key];
      }
      return copy;
    });

    setSavingKey(key);

    try {
      await updateCellResponse(batchId, {
        item_id: itemId,
        column_key: currentPiece.toString(),
        cell_value: finalStatus,
      });
    } catch (err: any) {
      console.error('Failed to save cell response:', err);
    } finally {
      setSavingKey(null);
    }
  };

  const handlePrevious = () => {
    if (currentPiece > 1) setCurrentPiece((p) => p - 1);
  };

  const handleNext = () => {
    if (currentPiece < lotQty) {
      setCurrentPiece((p) => p + 1);
    } else {
      handleSubmit();
    }
  };

  // Quick Action: Mark all items on current piece as Right (Pass)
  const handleMarkAllRight = () => {
    opItems.forEach((i) => {
      const key = `${i.item_id}_${currentPiece}`;
      setCellResponses((prev) => ({ ...prev, [key]: 'Pass' }));
      updateCellResponse(batchId, {
        item_id: i.item_id,
        column_key: currentPiece.toString(),
        cell_value: 'Pass',
      }).catch(() => {});
    });
  };

  // Quick Action: Mark all items on current piece as Wrong (Fail)
  const handleMarkAllWrong = () => {
    opItems.forEach((i) => {
      const key = `${i.item_id}_${currentPiece}`;
      setCellResponses((prev) => ({ ...prev, [key]: 'Fail' }));
      updateCellResponse(batchId, {
        item_id: i.item_id,
        column_key: currentPiece.toString(),
        cell_value: 'Fail',
      }).catch(() => {});
    });
  };

  // Quick Action: Clear checks on current piece
  const handleClearCurrent = () => {
    opItems.forEach((i) => {
      const key = `${i.item_id}_${currentPiece}`;
      setCellResponses((prev) => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      updateCellResponse(batchId, {
        item_id: i.item_id,
        column_key: currentPiece.toString(),
        cell_value: null,
      }).catch(() => {});
    });
  };

  const handleSubmit = async () => {
    if (!batch) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const allPieces = Array.from(checkedPieces);

      const cells: Array<{ item_id: number; column_key: string; cell_value: string }> = [];
      for (const p of allPieces) {
        for (const item of opItems) {
          const status = cellResponses[`${item.item_id}_${p}`] || 'Pass';
          cells.push({
            item_id: item.item_id,
            column_key: p.toString(),
            cell_value: status,
          });
        }
      }

      const hasDefects = allPieces.some((p) => pieceHasDefects(p));
      const rejectedIds = hasDefects
        ? opItems
            .filter((i) =>
              Object.keys(cellResponses).some(
                (k) => k.startsWith(`${i.item_id}_`) && cellResponses[k] === 'Fail'
              )
            )
            .map((i) => i.item_id)
        : [];

      await submitOperatorBatch(batchId, {
        decision: hasDefects ? 'REJECT' : 'APPROVE',
        rejected_item_ids: rejectedIds,
        remarks: `Piece-by-piece inspection. ${allPieces.length}/${lotQty} pieces reviewed. ${badCount} defective.`,
        cells,
      });
      setIsSubmitted(true);
      onBatchUpdated?.();
    } catch (err: any) {
      console.error('Failed to submit batch:', err);
      alert(`Submit failed: ${err?.message || 'Please try again.'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto border-[var(--primary)]" />
          <p className="text-sm text-[var(--muted)]">Loading inspection…</p>
        </div>
      </div>
    );
  }

  const activeBatch = batch || getOperatorFallbackBatch(batchId);

  if (isSubmitted) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 px-8">
        <div className="w-20 h-20 rounded-full flex items-center justify-center bg-[var(--ok-bg)]">
          <CheckCircle2 className="w-10 h-10 text-[var(--ok)]" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-[var(--ink)]">Inspection submitted</p>
          <p className="text-sm mt-1 max-w-xs leading-relaxed text-[var(--muted)]">
            Waiting for supervisor review.{' '}
            {badCount > 0 ? (
              <span className="text-[var(--ng)] font-medium">
                {badCount} defective piece{badCount > 1 ? 's' : ''} flagged.
              </span>
            ) : (
              <span className="text-[var(--ok)] font-medium">All checked pieces passed.</span>
            )}
          </p>
          {onBack && (
            <button
              onClick={onBack}
              className="mt-4 px-6 py-2.5 rounded-xl bg-[var(--primary)] text-white font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              Back to Scan
            </button>
          )}
        </div>
      </div>
    );
  }

  // Derived metadata
  const lotBarcode = activeBatch.lot_number || '18351M62Q50-260820-01';
  const lotShort = activeBatch.lot_number?.slice(-9, -3) || '20-08';
  const partName = activeBatch.template?.part_name || activeBatch.product_name || 'Pipe, purge line (RH)';
  const partNo = activeBatch.template?.part_no || '18351M62Q50';
  const dateStr = activeBatch.created_at
    ? new Date(activeBatch.created_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '20 Aug 2026';

  const currentDefects = opItems.filter(
    (i) => cellResponses[`${i.item_id}_${currentPiece}`] === 'Fail'
  );
  const isCurrentReviewed = pieceIsChecked(currentPiece);
  const progressPct = lotQty > 0 ? Math.round((checkedCount / lotQty) * 100) : 0;

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      {/* ── 1. Top Bar: Lot Information ───────────────────────────────────── */}
      <div className="shrink-0 min-h-[56px] h-auto py-2 px-3 md:px-6 bg-[var(--surface)] border-b border-[var(--line)] flex items-center justify-between gap-2 md:gap-4 flex-wrap">
        {/* Left: Barcode Icon Button + LOT BARCODE + (LOT + PART hidden on mobile) */}
        <div className="flex items-center gap-2 md:gap-6 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-[var(--surface2)] hover:bg-[var(--line2)] text-[var(--ink)] flex items-center justify-center transition-colors shrink-0"
            title="Scan another lot"
          >
            <svg className="w-5 h-5 text-[var(--primary)]" viewBox="0 0 24 24" fill="currentColor">
              <rect x="2" y="4" width="2" height="16" rx="0.5" />
              <rect x="6" y="4" width="1" height="16" rx="0.5" />
              <rect x="9" y="4" width="3" height="16" rx="0.5" />
              <rect x="14" y="4" width="1.5" height="16" rx="0.5" />
              <rect x="17" y="4" width="2" height="16" rx="0.5" />
              <rect x="21" y="4" width="1" height="16" rx="0.5" />
            </svg>
          </button>

          <div>
            <span className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider block">
              LOT BARCODE
            </span>
            <span className="text-[13px] md:text-[15px] font-bold text-[var(--ink)] mono leading-tight block">
              {lotBarcode}
            </span>
          </div>

          <div className="hidden sm:block h-7 w-px bg-[var(--line)]" />

          <div className="hidden sm:block">
            <span className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider block">
              LOT
            </span>
            <span className="text-[14px] md:text-[15px] font-bold text-[var(--ink)] leading-tight block">
              {lotShort}
            </span>
          </div>

          <div className="hidden sm:block h-7 w-px bg-[var(--line)]" />

          <div className="hidden sm:block min-w-0">
            <span className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider block">
              PART
            </span>
            <span className="text-[14px] md:text-[15px] font-bold text-[var(--ink)] truncate leading-tight block">
              {partNo} · {partName}
            </span>
          </div>
        </div>

        {/* Right: ITEMS + DATE + CHECKED */}
        <div className="flex items-center gap-3 md:gap-6 shrink-0 text-right">
          <div className="hidden md:block">
            <span className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider block">
              ITEMS
            </span>
            <span className="text-[15px] font-bold text-[var(--ink)] tabular-nums leading-tight block">
              {lotQty}
            </span>
          </div>

          <div className="hidden md:block h-7 w-px bg-[var(--line)]" />

          <div className="hidden lg:block">
            <span className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider block">
              DATE
            </span>
            <span className="text-[15px] font-bold text-[var(--ink)] leading-tight block">
              {dateStr}
            </span>
          </div>

          <div className="hidden lg:block h-7 w-px bg-[var(--line)]" />

          <div>
            <span className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider block">
              CHECKED
            </span>
            <span className="text-[15px] font-bold text-[var(--primary)] tabular-nums leading-tight block">
              {checkedCount} / {lotQty}
            </span>
          </div>
        </div>
      </div>

      {/* Mobile compact progress bar */}
      <div className="md:hidden shrink-0 flex items-center gap-2 px-3 py-2 bg-[var(--surface)] border-b border-[var(--line)]">
        <span className="text-xs font-medium text-[var(--muted)] shrink-0">Item {currentPiece}/{lotQty}</span>
        <div className="flex-1 h-1.5 rounded-full bg-[var(--surface2)] overflow-hidden mx-1">
          <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="px-2 py-0.5 rounded-full text-xs font-semibold text-[#23855A] bg-[#E4F3EB] shrink-0">{goodCount} ✓</span>
        <span className="px-2 py-0.5 rounded-full text-xs font-semibold text-[var(--muted)] bg-[var(--surface2)] shrink-0">{badCount} ✗</span>
      </div>

      {/* ── 2. Body: Left Navigator + Right Inspection Area ───────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Column: Progress & Item List — hidden on mobile */}
        <div className="hidden md:flex md:w-60 bg-[var(--surface)] border-r border-[var(--line)] flex-col shrink-0">
          {/* Progress Header */}
          <div className="p-4 space-y-2.5 border-b border-[var(--line)] shrink-0">
            <span className="text-xs text-[var(--muted)] font-medium">Progress</span>
            <div className="text-3xl font-light text-[var(--ink)] tabular-nums leading-none">
              <strong className="font-semibold">{checkedCount}</strong>
              <span className="text-[var(--muted)] font-normal text-xl"> / {lotQty}</span>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-1.5 rounded-full bg-[var(--surface2)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            {/* Good / Bad counter pills */}
            <div className="flex items-center gap-2 pt-1">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold text-[#23855A] bg-[#E4F3EB] border border-[#23855A]/30">
                {goodCount} good
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold text-[var(--muted)] bg-[var(--surface2)] border border-[var(--line)]">
                {badCount} bad
              </span>
            </div>

            {/* Links row */}
            <div className="flex items-center justify-between text-xs pt-1.5 border-t border-[var(--line)]">
              <button
                type="button"
                onClick={handleMarkAllRight}
                className="font-bold text-[#23855A] hover:underline"
                title="Mark all items on this piece as Right (✓)"
              >
                All Right (✓)
              </button>
              <button
                type="button"
                onClick={handleMarkAllWrong}
                className="font-medium text-[#C8463E] hover:underline"
                title="Mark all items on this piece as Wrong (✕)"
              >
                Wrong (✕)
              </button>
              <button
                type="button"
                onClick={handleClearCurrent}
                className="text-[var(--muted)] hover:text-[var(--ink)]"
                title="Clear selection for this piece"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Item List */}
          <div ref={itemListRef} className="flex-1 overflow-y-auto p-2 space-y-1">
            {Array.from({ length: lotQty }, (_, i) => i + 1).map((piece) => {
              const isChecked = checkedPieces.has(piece);
              const defects = pieceHasDefects(piece);
              const isCurrent = piece === currentPiece;

              return (
                <button
                  key={piece}
                  data-piece={piece}
                  type="button"
                  onClick={() => setCurrentPiece(piece)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors ${
                    isCurrent
                      ? 'bg-[var(--accent-soft)] text-[var(--primary)] font-semibold'
                      : 'text-[var(--ink)] hover:bg-[var(--surface2)]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {/* Checkbox square indicator: ONLY show tick/cross if checked! */}
                    <div
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                        isChecked
                          ? defects
                            ? 'border-[#C8463E] bg-[#FCEAE8]'
                            : 'border-[#23855A] bg-[#E4F3EB]'
                          : 'border-[var(--line2)] bg-[var(--surface)]'
                      }`}
                    >
                      {isChecked &&
                        (defects ? (
                          <X className="w-3.5 h-3.5 text-[#C8463E] stroke-[3]" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-[#23855A] stroke-[3]" />
                        ))}
                    </div>
                    <span className="text-xs">Item {piece}</span>
                  </div>

                  {isCurrent ? (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold text-[var(--primary)] bg-[var(--accent-soft)]">
                      Now
                    </span>
                  ) : isChecked ? (
                    <span
                      className={`text-xs font-bold ${
                        defects ? 'text-[#C8463E]' : 'text-[#23855A]'
                      }`}
                    >
                      {defects ? 'NG' : 'OK'}
                    </span>
                  ) : (
                    <span className="text-[var(--muted)] text-sm">—</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Main Inspection Area */}
        <div className="flex-1 overflow-y-auto flex flex-col justify-between p-3 md:p-6 lg:p-8">
          <div>
            {/* Header: Item N of M + Subtitle + Prompt Pill */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-[var(--ink)]">
                  Item {currentPiece} of {lotQty}
                </h1>
                <p className="text-sm text-[var(--muted)] mt-1">
                  {!isCurrentReviewed
                    ? 'Not checked yet'
                    : currentDefects.length > 0
                    ? `${currentDefects.length} defect(s) flagged`
                    : 'All checks marked Right (✓)'}
                </p>
              </div>

              {/* Friendly prompt pill */}
              <div className="px-4 py-2 rounded-2xl bg-[var(--accent-soft)] text-[var(--primary)] text-sm font-semibold shadow-xs">
                Look at the part. Mark Right (✓) or Wrong (✕).
              </div>
            </div>

            {/* Visual checks section heading */}
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">
              VISUAL CHECKS
            </div>

            {/* 2-Column Grid of Inspection Cards with BOTH Tick and Cross */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {opItems.map((item, idx) => {
                const key = `${item.item_id}_${currentPiece}`;
                const status = cellResponses[key]; // 'Pass' | 'Fail' | undefined
                const isPass = status === 'Pass';
                const isFail = status === 'Fail';
                const isSaving = savingKey === key;

                return (
                  <div
                    key={item.item_id}
                    onClick={() => {
                      // Clicking card body: toggle between unselected -> Pass -> Fail -> Pass
                      if (!status) handleSetStatus(item.item_id, 'Pass');
                      else if (isPass) handleSetStatus(item.item_id, 'Fail');
                      else handleSetStatus(item.item_id, 'Pass');
                    }}
                    className={`p-5 rounded-2xl transition-all flex flex-col justify-between relative cursor-pointer select-none ${
                      isFail
                        ? 'bg-[#FCEAE8] border-2 border-[#C8463E] shadow-sm'
                        : isPass
                        ? 'bg-[var(--surface)] border-2 border-[#23855A] shadow-xs'
                        : 'bg-[var(--surface)] border border-[var(--line2)] shadow-xs hover:border-[var(--line)]'
                    }`}
                  >
                    <div>
                      {/* Top row: Number circle + Title + Tick/Cross Button Group */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <span
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                              isFail
                                ? 'bg-[#C8463E] text-white'
                                : isPass
                                ? 'bg-[#23855A] text-white'
                                : 'bg-[var(--surface2)] text-[var(--muted)]'
                            }`}
                          >
                            {idx + 1}
                          </span>
                          <h4 className="text-[15px] font-bold text-[var(--ink)] leading-snug">
                            {item.control_item_name}
                          </h4>
                        </div>

                        {/* BOTH TICK AND CROSS BUTTONS */}
                        <div
                          className="flex items-center gap-1.5 shrink-0"
                          onClick={(e) => e.stopPropagation() /* Prevent outer card click */}
                        >
                          {/* Tick Button (Right / Good / Pass) */}
                          <button
                            type="button"
                            onClick={() => handleSetStatus(item.item_id, 'Pass')}
                            disabled={isSaving}
                            className={`w-9 h-9 rounded-xl border-2 flex items-center justify-center transition-all cursor-pointer ${
                              isPass
                                ? 'border-[#23855A] bg-[#23855A] text-white shadow-xs scale-105'
                                : 'border-[var(--line2)] bg-[var(--surface)] text-[var(--muted)] hover:border-[#23855A] hover:text-[#23855A] hover:bg-[#E4F3EB]/50'
                            }`}
                            title="Mark as Right (Good / Pass)"
                          >
                            <Check className="w-5 h-5 stroke-[2.5]" />
                          </button>

                          {/* Cross Button (Wrong / Bad / Fail) */}
                          <button
                            type="button"
                            onClick={() => handleSetStatus(item.item_id, 'Fail')}
                            disabled={isSaving}
                            className={`w-9 h-9 rounded-xl border-2 flex items-center justify-center transition-all cursor-pointer ${
                              isFail
                                ? 'border-[#C8463E] bg-[#C8463E] text-white shadow-xs scale-105'
                                : 'border-[var(--line2)] bg-[var(--surface)] text-[var(--muted)] hover:border-[#C8463E] hover:text-[#C8463E] hover:bg-[#FCEAE8]/50'
                            }`}
                            title="Mark as Wrong (Defect / Fail)"
                          >
                            <X className="w-5 h-5 stroke-[2.5]" />
                          </button>
                        </div>
                      </div>

                      {/* Description */}
                      {item.specification_content && (
                        <p className="text-xs text-[var(--muted)] leading-relaxed mt-2.5">
                          {item.specification_content}
                        </p>
                      )}
                    </div>

                    {/* Footer: Application method + Status Label */}
                    <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-[var(--line)]">
                      <p className="text-xs text-[var(--muted)] font-normal">
                        {item.application_method || 'Visual'}
                      </p>

                      <div>
                        {isPass && (
                          <span className="text-[11px] font-bold text-[#23855A] flex items-center gap-1">
                            <Check className="w-3.5 h-3.5 stroke-[2.5]" /> Right
                          </span>
                        )}
                        {isFail && (
                          <span className="text-[11px] font-bold text-[#C8463E] flex items-center gap-1">
                            <X className="w-3.5 h-3.5 stroke-[2.5]" /> Wrong
                          </span>
                        )}
                        {!status && (
                          <span className="text-[11px] text-[var(--muted)]">
                            Tap ✓ or ✕
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom Sticky Action Bar — desktop only */}
          <div className="hidden md:flex mt-8 pt-4 border-t border-[var(--line)] items-center justify-end gap-3 sticky bottom-0 bg-[var(--bg)]/90 backdrop-blur-xs py-3">
            {submitError && (
              <span className="text-xs text-[var(--ng)] font-medium mr-auto">
                {submitError}
              </span>
            )}

            <button
              type="button"
              onClick={handlePrevious}
              disabled={currentPiece <= 1}
              className="h-12 px-6 rounded-xl border border-[var(--line2)] bg-[var(--surface)] text-sm font-semibold text-[var(--muted)] hover:bg-[var(--surface2)] disabled:opacity-40 transition-colors cursor-pointer"
            >
              ‹ Previous
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={isSubmitting}
              className="h-12 px-8 rounded-xl bg-[#23855A] hover:bg-[#1c6b48] text-white text-sm font-semibold transition-colors shadow-xs cursor-pointer"
            >
              {isSubmitting
                ? 'Submitting…'
                : currentPiece >= lotQty
                ? 'Submit inspection ›'
                : 'Next item ›'}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile bottom navigation bar */}
      <div className="md:hidden shrink-0 flex items-center gap-2 px-3 py-2 bg-[var(--surface)] border-t border-[var(--line)]">
        {submitError && (
          <span className="text-[11px] text-[var(--ng)] font-medium flex-1 truncate">{submitError}</span>
        )}
        <button
          type="button"
          onClick={handlePrevious}
          disabled={currentPiece <= 1}
          className="flex-1 py-3 rounded-xl bg-[var(--surface2)] text-sm font-semibold text-[var(--ink)] disabled:opacity-40 transition-colors"
        >
          ‹ Previous
        </button>
        <div className="text-center px-3 shrink-0">
          <span className="text-[10px] text-[var(--muted)] block">Item</span>
          <span className="text-base font-bold text-[var(--ink)] tabular-nums leading-tight">{currentPiece}/{lotQty}</span>
        </div>
        <button
          type="button"
          onClick={handleNext}
          disabled={isSubmitting}
          className="flex-1 py-3 rounded-xl bg-[#23855A] text-sm font-semibold text-white transition-colors"
        >
          {isSubmitting ? 'Saving…' : currentPiece < lotQty ? 'Next ›' : 'Submit'}
        </button>
      </div>
    </div>
  );
};
