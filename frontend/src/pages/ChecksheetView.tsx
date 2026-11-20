import React, { useState, useEffect, useMemo } from 'react';
import {
  InspectionBatch, User, ControlItem, CellResponse, OfflineMutation
} from '../types';
import {
  fetchBatchDetail, updateCellResponse, submitOperatorBatch,
  reviewSupervisorBatch, getExportUrl
} from '../api';
import { saveCellOffline, getOfflineCellsForBatch, cacheBatchOffline, getCachedBatchOffline } from '../db';
import { FullSheetCompletionModal } from '../components/FullSheetCompletionModal';
import { RejectionModal } from '../components/RejectionModal';
import { SupervisorReviewModal } from '../components/SupervisorReviewModal';
import { CameraCaptureModal } from '../components/CameraCaptureModal';
import { PrintLabelModal } from '../components/PrintLabelModal';
import {
  CheckSquare, Square, Lock, Camera, Printer, Download,
  AlertTriangle, ShieldCheck, CheckCircle2, RefreshCw, FileText
} from 'lucide-react';

interface ChecksheetViewProps {
  batchId: number;
  currentUser: User;
  onBatchUpdated?: () => void;
}

export const ChecksheetView: React.FC<ChecksheetViewProps> = ({
  batchId,
  currentUser,
  onBatchUpdated,
}) => {
  const [batch, setBatch] = useState<InspectionBatch | null>(null);
  const [cellsMap, setCellsMap] = useState<Record<string, CellResponse>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modals
  const [isCompletionModalOpen, setIsCompletionModalOpen] = useState<boolean>(false);
  const [missingFieldsList, setMissingFieldsList] = useState<string[]>([]);
  const [isRejectionModalOpen, setIsRejectionModalOpen] = useState<boolean>(false);
  const [isSupervisorModalOpen, setIsSupervisorModalOpen] = useState<boolean>(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState<boolean>(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    loadBatch();
  }, [batchId]);

  const loadBatch = async () => {
    try {
      setIsLoading(true);
      setErrorMsg(null);

      let bData: InspectionBatch;
      try {
        bData = await fetchBatchDetail(batchId);
        // Cache to IndexedDB for offline use
        await cacheBatchOffline(bData);
      } catch (networkErr) {
        // Fallback to offline cached batch
        const cached = await getCachedBatchOffline(batchId);
        if (cached) {
          bData = cached;
        } else {
          throw networkErr;
        }
      }

      setBatch(bData);

      // Load server cells + overlay any unsynced offline cells
      const map: Record<string, CellResponse> = {};
      if (bData.cell_responses) {
        bData.cell_responses.forEach((c) => {
          map[`${c.item_id}_${c.column_key}`] = c;
        });
      }

      // Overlay offline cells
      const offlineCells = await getOfflineCellsForBatch(batchId);
      offlineCells.forEach((c) => {
        map[`${c.item_id}_${c.column_key}`] = c;
      });

      setCellsMap(map);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load checksheet details.');
    } finally {
      setIsLoading(false);
    }
  };

  // Determine if this sheet is strictly Read-Only
  const isReadOnly = useMemo(() => {
    if (!batch) return true;
    // FR-021A: Rescan Read-Only Rule
    if (batch.status === 'APPROVED' || batch.status === 'REJECTED') {
      return true;
    }
    if (currentUser.role === 'operator' && batch.operator_submitted_at) {
      return true;
    }
    return false;
  }, [batch, currentUser]);

  // Compute all unique sample columns across items
  const displayColumns = useMemo(() => {
    if (!batch?.template?.control_items) return [];
    const cols: string[] = [];
    batch.template.control_items.forEach((item) => {
      const itemCols = Array.isArray(item.sample_columns) ? item.sample_columns : [];
      itemCols.forEach((c) => {
        if (!cols.includes(c)) cols.push(c);
      });
    });
    return cols.length > 0 ? cols : ['1', '2', '3', '4', '5'];
  }, [batch]);

  // Check if a cell is out of spec
  const checkOutOfSpec = (item: ControlItem, val?: string | null): boolean => {
    if (!val || !val.trim()) return false;
    if (item.row_mode === 'NUMERIC_SAMPLE') {
      const num = parseFloat(val);
      if (isNaN(num)) return true;
      if (item.min_val !== null && item.min_val !== undefined && num < item.min_val) return true;
      if (item.max_val !== null && item.max_val !== undefined && num > item.max_val) return true;
    }
    if (item.row_mode === 'SERIAL_TICKBOX') {
      if (val === 'false' || val === 'FAIL' || val === '0') return true;
    }
    return false;
  };

  // Cell change handler (with immediate IndexedDB persistence & online sync)
  const handleCellChange = async (item: ControlItem, columnKey: string, newValue: string) => {
    if (!batch || isReadOnly) return;

    // Strict role boundary: Supervisor cannot edit Operator items after Operator submission
    if (currentUser.role === 'supervisor' && batch.operator_submitted_at) {
      return;
    }

    const key = `${item.item_id}_${columnKey}`;
    const isFailed = checkOutOfSpec(item, newValue);
    const mutationId = crypto.randomUUID();

    const updatedCell: CellResponse = {
      batch_id: batch.batch_id,
      item_id: item.item_id!,
      column_key: columnKey,
      cell_value: newValue,
      is_within_spec: !isFailed,
      checker_initials: currentUser.username.substring(0, 2).toUpperCase(),
      client_mutation_id: mutationId,
      updated_at: new Date().toISOString(),
    };

    // Update local state immediately
    setCellsMap((prev) => ({
      ...prev,
      [key]: updatedCell,
    }));

    // Persist immediately to IndexedDB (FR-041A)
    const mutation: OfflineMutation = {
      client_mutation_id: mutationId,
      batch_id: batch.batch_id,
      item_id: item.item_id!,
      column_key: columnKey,
      cell_value: newValue,
      checker_initials: currentUser.username.substring(0, 2).toUpperCase(),
      timestamp: new Date().toISOString(),
    };
    await saveCellOffline(mutation, !isFailed);

    // If online, send to server
    if (navigator.onLine) {
      try {
        await updateCellResponse(batch.batch_id, {
          item_id: item.item_id!,
          column_key: columnKey,
          cell_value: newValue,
          checker_initials: currentUser.username.substring(0, 2).toUpperCase(),
          client_mutation_id: mutationId,
        });
      } catch (err) {
        console.warn('Live cell server update failed, queued in IndexedDB:', err);
      }
    }
  };

  // Validate Full-Sheet Completion (FR-025A)
  const validateFullSheetCompletion = (): { isValid: boolean; missing: string[] } => {
    if (!batch?.template?.control_items) return { isValid: true, missing: [] };

    const missing: string[] = [];
    batch.template.control_items.forEach((item) => {
      if (!item.is_required) return;
      const cols = Array.isArray(item.sample_columns) ? item.sample_columns : [];
      cols.forEach((col) => {
        const key = `${item.item_id}_${col}`;
        const cell = cellsMap[key];
        if (!cell || cell.cell_value === null || cell.cell_value === undefined || cell.cell_value === '') {
          missing.push(`S.No ${item.serial_no}: ${item.control_item_name} [Col ${col}]`);
        }
      });
    });

    return {
      isValid: missing.length === 0,
      missing,
    };
  };

  // Operator Action: Approve
  const handleOperatorApprove = async () => {
    if (!batch) return;

    // FR-025A: Enforce full-sheet completion
    const validation = validateFullSheetCompletion();
    if (!validation.isValid) {
      setMissingFieldsList(validation.missing);
      setIsCompletionModalOpen(true);
      return;
    }

    try {
      setIsSubmitting(true);
      const cellsArray = Object.values(cellsMap).map((c) => ({
        item_id: c.item_id,
        column_key: c.column_key,
        cell_value: c.cell_value,
        checker_initials: c.checker_initials,
        client_mutation_id: c.client_mutation_id,
      }));

      await submitOperatorBatch(batch.batch_id, {
        decision: 'APPROVE',
        rejected_item_ids: [],
        remarks: '100% inspection completed. All control items verified within specification.',
        cells: cellsArray,
      });

      await loadBatch();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Submission failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Operator Action: Reject (pre-checked by full sheet completion)
  const handleOperatorRejectClick = () => {
    if (!batch) return;

    // FR-025A: Enforce full-sheet completion even upon rejection
    const validation = validateFullSheetCompletion();
    if (!validation.isValid) {
      setMissingFieldsList(validation.missing);
      setIsCompletionModalOpen(true);
      return;
    }

    setIsRejectionModalOpen(true);
  };

  // Operator Confirm Reject
  const handleConfirmRejection = async (rejectedIds: number[], remarks: string) => {
    if (!batch) return;
    try {
      setIsSubmitting(true);
      const cellsArray = Object.values(cellsMap).map((c) => ({
        item_id: c.item_id,
        column_key: c.column_key,
        cell_value: c.cell_value,
        checker_initials: c.checker_initials,
        client_mutation_id: c.client_mutation_id,
      }));

      await submitOperatorBatch(batch.batch_id, {
        decision: 'REJECT',
        rejected_item_ids: rejectedIds,
        remarks: remarks,
        cells: cellsArray,
      });

      setIsRejectionModalOpen(false);
      await loadBatch();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Submission failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Supervisor Confirm Review
  const handleSupervisorReviewConfirm = async (
    decision: string,
    remarks?: string,
    holdReason?: string,
    rejectedItemIds?: number[]
  ) => {
    if (!batch) return;
    try {
      setIsSubmitting(true);
      await reviewSupervisorBatch(batch.batch_id, {
        decision,
        remarks,
        hold_reason: holdReason,
        rejected_item_ids: rejectedItemIds,
      });

      setIsSupervisorModalOpen(false);
      await loadBatch();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Supervisor review submission failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-12 text-center font-mono text-xs uppercase tracking-wider">
        Loading Digital IFM Checksheet & Batch Quality Matrix...
      </div>
    );
  }

  if (!batch || !batch.template) {
    return (
      <div className="p-8 border-2 border-black m-6 bg-zinc-50 font-mono text-center space-y-2">
        <p className="font-extrabold text-sm uppercase">Checksheet Instance Not Found</p>
        <p className="text-xs text-zinc-600">Scan an active QR code or select a batch from the Progress Dashboard.</p>
      </div>
    );
  }

  const { template } = batch;

  return (
    <div className="space-y-4 pb-16">
      {/* 1. FR-021A: Rescanned / Saved Read-Only Summary Banner */}
      {isReadOnly && (
        <div className="bg-black text-white px-4 py-3 flex items-center justify-between border-b-2 border-black shadow-md no-print">
          <div className="flex items-center gap-3">
            <Lock className="w-5 h-5 text-white animate-pulse" />
            <span className="font-black text-sm uppercase tracking-wider">
              LOCKED RECORD — READ-ONLY SUMMARY MODE
            </span>
          </div>
          <span className="text-xs font-mono text-zinc-300">
            {batch.status === 'APPROVED' ? 'BATCH FINALIZED (APPROVED)' :
             batch.status === 'REJECTED' ? 'BATCH FINALIZED (REJECTED)' :
             batch.status === 'ON_HOLD' ? 'BATCH ON HOLD' : 'OPERATOR ENTRIES LOCKED'}
          </span>
        </div>
      )}

      {/* Main Checksheet Canvas (#FFFFFF Pure White) */}
      <div className="bg-white border-2 border-black p-4 sm:p-6 shadow-sm">
        {/* Checksheet Header Bar */}
        <div className="border-b-2 border-black pb-4 mb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base sm:text-lg font-black text-black uppercase tracking-tight">
              {template.document_title}
            </h2>
            <div className="text-xs font-mono font-bold text-zinc-700 mt-0.5">
              (PRODUCT PARAMETER) • INITIAL FLOW MANAGEMENT CONTROL ITEMS MONITORING
            </div>
          </div>

          <div className="flex items-center gap-2 no-print">
            <button
              onClick={() => setIsPrintModalOpen(true)}
              className="bg-white border-2 border-black hover:bg-zinc-100 text-black font-extrabold text-xs px-3 py-1.5 uppercase flex items-center gap-1.5 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>QR Label</span>
            </button>

            <button
              onClick={() => setIsCameraModalOpen(true)}
              className="bg-white border-2 border-black hover:bg-zinc-100 text-black font-extrabold text-xs px-3 py-1.5 uppercase flex items-center gap-1.5 transition-colors"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Camera Photo</span>
            </button>

            <a
              href={getExportUrl(batch.batch_id, 'pdf')}
              download
              className="bg-black hover:bg-zinc-800 text-white font-extrabold text-xs px-3 py-1.5 uppercase flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>PDF Report</span>
            </a>

            <a
              href={getExportUrl(batch.batch_id, 'xlsx')}
              download
              className="bg-black hover:bg-zinc-800 text-white font-extrabold text-xs px-3 py-1.5 uppercase flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Excel (.xlsx)</span>
            </a>
          </div>
        </div>

        {/* Zone A: Header Metadata Block (Section 4) */}
        <div className="border-2 border-black mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x-2 divide-y-2 md:divide-y-0 divide-black text-xs font-mono">
            <div className="p-2.5">
              <span className="font-bold text-black block">SHEET ID:</span>
              <span className="font-extrabold text-sm">{template.sheet_id}</span>
            </div>
            <div className="p-2.5">
              <span className="font-bold text-black block">PART NO.:</span>
              <span className="font-extrabold text-sm">{template.part_no || 'N/A'}</span>
            </div>
            <div className="p-2.5">
              <span className="font-bold text-black block">PART NAME:</span>
              <span className="font-extrabold text-sm">{template.part_name || 'N/A'}</span>
            </div>
            <div className="p-2.5">
              <span className="font-bold text-black block">CATEGORY:</span>
              <span className="font-extrabold text-sm">{template.part_category || 'MAIN PART'}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 divide-x-2 divide-y-2 md:divide-y-0 divide-black text-xs font-mono border-t-2 border-black">
            <div className="p-2.5">
              <span className="font-bold text-black block">MODEL:</span>
              <span className="font-extrabold text-sm">{template.model_name || 'N/A'}</span>
            </div>
            <div className="p-2.5">
              <span className="font-bold text-black block">VENDOR:</span>
              <span className="font-extrabold text-sm">{template.vendor_name || 'N/A'}</span>
            </div>
            <div className="p-2.5">
              <span className="font-bold text-black block">CUSTOMER:</span>
              <span className="font-extrabold text-sm">{template.customer_name || 'N/A'}</span>
            </div>
            <div className="p-2.5">
              <span className="font-bold text-black block">INSPECTION DATE:</span>
              <span className="font-extrabold text-sm">
                {batch.created_at ? new Date(batch.created_at).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB')}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 divide-x-2 divide-y-2 md:divide-y-0 divide-black text-xs font-mono border-t-2 border-black bg-zinc-50">
            <div className="p-2.5">
              <span className="font-bold text-black block">BATCH / LOT NO:</span>
              <span className="font-extrabold text-sm">{batch.lot_number}</span>
            </div>
            <div className="p-2.5">
              <span className="font-bold text-black block">LOT QUANTITY:</span>
              <span className="font-extrabold text-sm">{batch.lot_quantity || 'N/A'}</span>
            </div>
            <div className="p-2.5">
              <span className="font-bold text-black block">MODE:</span>
              <span className="font-extrabold text-sm">{batch.inspection_mode} FREQUENCY</span>
            </div>
            <div className="p-2.5 bg-black text-white">
              <span className="font-bold block text-zinc-300">STATUS:</span>
              <span className="font-black text-sm uppercase tracking-wider">{batch.status.replace('_', ' ')}</span>
            </div>
          </div>
        </div>

        {/* Zone B: Inspection Matrix Grid (PRD Section 4 & Design System Section 2) */}
        <div className="overflow-x-auto border-2 border-black mb-6">
          <table className="industrial-table min-w-full text-left">
            <thead>
              <tr className="industrial-header text-[11px] font-mono divide-x-2 divide-black border-b-2 border-black">
                <th className="p-2 w-10 text-center">S.No</th>
                <th className="p-2 w-28">Stage</th>
                <th className="p-2 w-48">Control Items</th>
                <th className="p-2 w-56">Content / Spec Range</th>
                <th className="p-2 w-24">Method</th>
                <th className="p-2 w-20 text-center">Freq.</th>
                {displayColumns.map((col) => (
                  <th key={col} className="p-2 w-12 text-center bg-zinc-100">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-black text-xs font-mono">
              {template.control_items.map((item) => {
                const isAssignedToUser = item.assigned_role === currentUser.role;
                const freq = batch.inspection_mode === 'IFM' ? item.ifm_frequency : item.normal_frequency;

                return (
                  <tr key={item.item_id || item.serial_no} className="divide-x-2 divide-black hover:bg-zinc-50/50">
                    <td className="p-2 text-center font-bold">{item.serial_no}</td>
                    <td className="p-2 font-bold text-zinc-800">{item.stage_name}</td>
                    <td className="p-2 font-black text-black">{item.control_item_name}</td>
                    <td className="p-2 text-zinc-700 leading-snug">{item.specification_content}</td>
                    <td className="p-2 text-zinc-800">{item.application_method || '-'}</td>
                    <td className="p-2 text-center font-bold">{freq || '-'}</td>

                    {/* Columns Grid */}
                    {displayColumns.map((col) => {
                      const itemCols = Array.isArray(item.sample_columns) ? item.sample_columns : [];
                      const isApplicableColumn = itemCols.includes(col);
                      const key = `${item.item_id}_${col}`;
                      const cell = cellsMap[key];
                      const val = cell?.cell_value || '';
                      const isFailed = checkOutOfSpec(item, val);

                      if (!isApplicableColumn) {
                        return (
                          <td key={col} className="p-1 text-center bg-zinc-200 text-zinc-400">
                            -
                          </td>
                        );
                      }

                      // Attribute Check Row (Tickbox)
                      if (item.row_mode === 'SERIAL_TICKBOX') {
                        const isChecked = val === 'true' || val === '1' || val === 'OK';
                        return (
                          <td
                            key={col}
                            className={`p-1 text-center ${
                              isAssignedToUser && !isReadOnly
                                ? 'cell-assigned-active'
                                : 'cell-unassigned-locked'
                            }`}
                          >
                            <button
                              type="button"
                              disabled={!isAssignedToUser || isReadOnly}
                              onClick={() => handleCellChange(item, col, isChecked ? 'false' : 'true')}
                              className="w-full h-8 flex items-center justify-center transition-transform active:scale-95 disabled:cursor-not-allowed"
                            >
                              {isChecked ? (
                                <span className="font-black text-base text-black">☑</span>
                              ) : (
                                <Square className="w-4 h-4 text-zinc-400 hover:text-black" />
                              )}
                            </button>
                          </td>
                        );
                      }

                      // Variable Measurement Row (Numeric)
                      return (
                        <td
                          key={col}
                          className={`p-1 ${
                            isFailed
                              ? 'cell-out-of-spec'
                              : isAssignedToUser && !isReadOnly
                              ? 'cell-assigned-active'
                              : 'cell-unassigned-locked'
                          }`}
                        >
                          <div className="relative">
                            <input
                              type="number"
                              step="0.01"
                              disabled={!isAssignedToUser || isReadOnly}
                              value={val}
                              onChange={(e) => handleCellChange(item, col, e.target.value)}
                              placeholder="0.00"
                              className={`w-full text-center py-1 px-0.5 text-xs font-mono font-bold focus:outline-none disabled:bg-transparent ${
                                isFailed ? 'text-black font-black' : 'text-black'
                              }`}
                            />
                            {isFailed && (
                              <div className="bg-black text-white text-[8px] font-mono font-extrabold px-1 py-0.2 text-center uppercase tracking-tighter">
                                OUT OF SPEC
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* Checker Initials Row */}
              <tr className="industrial-header divide-x-2 divide-black text-[11px] font-mono border-t-2 border-black">
                <td className="p-2 text-center font-bold">CHK</td>
                <td colSpan={5} className="p-2 font-bold uppercase tracking-wider">
                  Checker Initials (Per-Sample Verification)
                </td>
                {displayColumns.map((col) => {
                  // Find any checker initial entered for this column
                  let init = '';
                  for (const key in cellsMap) {
                    if (key.endsWith(`_${col}`) && cellsMap[key].checker_initials) {
                      init = cellsMap[key].checker_initials!;
                      break;
                    }
                  }
                  return (
                    <td key={col} className="p-2 text-center font-black text-black">
                      {init}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Photo Evidence Gallery */}
        {batch.attachments && batch.attachments.length > 0 && (
          <div className="border-2 border-black p-4 mb-6">
            <h3 className="font-extrabold text-xs uppercase tracking-wider text-black mb-3 flex items-center gap-2">
              <Camera className="w-4 h-4" />
              Shop-Floor Photo Evidence ({batch.attachments.length} Images Attached)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {batch.attachments.map((att) => (
                <div key={att.attachment_id} className="border-2 border-black p-2 bg-zinc-50 space-y-1">
                  <div className="aspect-video bg-black flex items-center justify-center overflow-hidden">
                    <img
                      src={att.file_path}
                      alt={att.file_name || 'Evidence'}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="text-[10px] font-mono text-zinc-600 truncate">
                    {att.file_name || 'Photo'}
                  </div>
                  <div className="text-[9px] font-mono text-zinc-500 font-bold">
                    SOURCE: {att.capture_source}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rejection & Supervisor Review History */}
        {(batch.decisions && batch.decisions.length > 0) || batch.hold_reason ? (
          <div className="border-2 border-black p-4 mb-6 bg-zinc-50 font-mono text-xs space-y-2">
            <h3 className="font-black uppercase tracking-wider text-black flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-black" />
              Inspection Decisions & Governance Audit Trail
            </h3>
            <div className="divide-y divide-zinc-300">
              {batch.decisions?.map((d) => (
                <div key={d.decision_id} className="py-2 flex flex-wrap justify-between gap-2">
                  <div>
                    <span className="font-extrabold text-black uppercase">[{d.role.toUpperCase()}]</span>{' '}
                    <span className={`px-1.5 py-0.5 text-[10px] font-bold ${
                      d.decision.includes('REJECT') ? 'bg-black text-white' : 'border border-black font-extrabold'
                    }`}>
                      {d.decision}
                    </span>
                    {d.remarks && <p className="text-zinc-700 mt-1">Remarks: {d.remarks}</p>}
                    {d.rejected_item_ids && d.rejected_item_ids.length > 0 && (
                      <p className="text-zinc-600 text-[11px] mt-0.5">
                        Failed Item IDs: {d.rejected_item_ids.join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="text-zinc-500 text-[10px]">
                    {d.decided_at ? new Date(d.decided_at).toLocaleString('en-GB') : '-'}
                  </div>
                </div>
              ))}
              {batch.hold_reason && (
                <div className="py-2 text-black font-bold">
                  HOLD REASON: {batch.hold_reason}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Zone C: Sign-off & Footer Block (Section 4) */}
        <div className="border-2 border-black mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y-2 md:divide-y-0 md:divide-x-2 divide-black text-xs font-mono">
            {/* Prepared by */}
            <div className="p-3">
              <div className="font-bold text-black uppercase border-b border-black pb-1 mb-2">
                PREPARED BY (Operator)
              </div>
              <div className="space-y-0.5 text-[11px]">
                <p>
                  <span className="font-bold">Operator:</span>{' '}
                  {batch.prepared_user_name || (batch.prepared_by ? `User #${batch.prepared_by}` : 'Pending Save')}
                </p>
                <p>
                  <span className="font-bold">Timestamp:</span>{' '}
                  {batch.operator_submitted_at ? new Date(batch.operator_submitted_at).toLocaleString('en-GB') : 'Not Submitted'}
                </p>
              </div>
            </div>

            {/* Checked by */}
            <div className="p-3">
              <div className="font-bold text-black uppercase border-b border-black pb-1 mb-2">
                CHECKED BY (Supervisor)
              </div>
              <div className="space-y-0.5 text-[11px]">
                <p>
                  <span className="font-bold">Supervisor:</span>{' '}
                  {batch.checked_user_name || (batch.checked_by ? `User #${batch.checked_by}` : 'Pending Review')}
                </p>
                <p>
                  <span className="font-bold">Timestamp:</span>{' '}
                  {batch.supervisor_submitted_at ? new Date(batch.supervisor_submitted_at).toLocaleString('en-GB') : 'Not Reviewed'}
                </p>
              </div>
            </div>

            {/* Approved by */}
            <div className="p-3">
              <div className="font-bold text-black uppercase border-b border-black pb-1 mb-2">
                APPROVED BY (Admin / QA)
              </div>
              <div className="space-y-0.5 text-[11px]">
                <p>
                  <span className="font-bold">QA Sign-Off:</span>{' '}
                  {batch.approved_user_name || (batch.approved_by ? `User #${batch.approved_by}` : 'Pending Final Sign-Off')}
                </p>
                <p>
                  <span className="font-bold">Status:</span>{' '}
                  <span className="font-extrabold">{batch.status.replace('_', ' ')}</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Action Controls Bar */}
        <div className="border-t-2 border-black pt-4 flex flex-wrap items-center justify-between gap-4 no-print">
          <div className="text-xs font-mono text-zinc-600">
            Current User: <span className="font-bold text-black uppercase">{currentUser.full_name} ({currentUser.role})</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Operator Actions */}
            {currentUser.role === 'operator' && !isReadOnly && (
              <>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleOperatorRejectClick}
                  className="bg-white hover:bg-zinc-100 text-black font-extrabold text-xs px-5 py-2.5 uppercase border-2 border-black flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <AlertTriangle className="w-4 h-4 text-black" />
                  <span>Reject Batch</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleOperatorApprove}
                  className="bg-black hover:bg-zinc-800 text-white font-extrabold text-xs px-6 py-2.5 uppercase flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4 text-white" />
                  <span>{isSubmitting ? 'Saving...' : 'Submit & Approve Batch'}</span>
                </button>
              </>
            )}

            {/* Supervisor Actions */}
            {(currentUser.role === 'supervisor' || currentUser.role === 'admin') && batch.status !== 'APPROVED' && batch.status !== 'REJECTED' && (
              <button
                type="button"
                onClick={() => setIsSupervisorModalOpen(true)}
                className="bg-black hover:bg-zinc-800 text-white font-extrabold text-xs px-6 py-2.5 uppercase flex items-center gap-2 transition-colors shadow-sm"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Supervisor Quality Governance</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <FullSheetCompletionModal
        isOpen={isCompletionModalOpen}
        onClose={() => setIsCompletionModalOpen(false)}
        missingFields={missingFieldsList}
      />

      <RejectionModal
        isOpen={isRejectionModalOpen}
        onClose={() => setIsRejectionModalOpen(false)}
        controlItems={template.control_items}
        onSubmit={handleConfirmRejection}
        isSubmitting={isSubmitting}
      />

      <SupervisorReviewModal
        isOpen={isSupervisorModalOpen}
        onClose={() => setIsSupervisorModalOpen(false)}
        batch={batch}
        onSubmit={handleSupervisorReviewConfirm}
        isSubmitting={isSubmitting}
      />

      <CameraCaptureModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        batchId={batch.batch_id}
        onPhotoUploaded={loadBatch}
      />

      <PrintLabelModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        sheetId={template.sheet_id}
      />
    </div>
  );
};
