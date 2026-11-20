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
  Check, Lock, Camera, Printer, Download,
  AlertTriangle, ShieldCheck, CheckCircle2, ChevronRight
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
        await cacheBatchOffline(bData);
      } catch (networkErr) {
        const cached = await getCachedBatchOffline(batchId);
        if (cached) {
          bData = cached;
        } else {
          throw networkErr;
        }
      }

      setBatch(bData);

      const map: Record<string, CellResponse> = {};
      if (bData.cell_responses) {
        bData.cell_responses.forEach((c) => {
          map[`${c.item_id}_${c.column_key}`] = c;
        });
      }

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

  const isReadOnly = useMemo(() => {
    if (!batch) return true;
    if (batch.status === 'APPROVED' || batch.status === 'REJECTED') {
      return true;
    }
    if (currentUser.role === 'operator' && batch.operator_submitted_at) {
      return true;
    }
    return false;
  }, [batch, currentUser]);

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

  const handleCellChange = async (item: ControlItem, columnKey: string, newValue: string) => {
    if (!batch || isReadOnly) return;
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

    setCellsMap((prev) => ({
      ...prev,
      [key]: updatedCell,
    }));

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
        console.warn('Sync queued:', err);
      }
    }
  };

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

  const handleOperatorApprove = async () => {
    if (!batch) return;
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
        remarks: '100% inspection verified within spec.',
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

  const handleOperatorRejectClick = () => {
    if (!batch) return;
    const validation = validateFullSheetCompletion();
    if (!validation.isValid) {
      setMissingFieldsList(validation.missing);
      setIsCompletionModalOpen(true);
      return;
    }
    setIsRejectionModalOpen(true);
  };

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
      setErrorMsg(err.message || 'Supervisor review failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-20 text-center text-xs font-medium text-slate-500">
        Loading checksheet...
      </div>
    );
  }

  if (!batch || !batch.template) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center max-w-md mx-auto my-12 space-y-2">
        <p className="font-semibold text-slate-800 text-sm">Checksheet Not Found</p>
        <p className="text-xs text-slate-500">Scan a QR code or choose a batch from the dashboard.</p>
      </div>
    );
  }

  const { template } = batch;

  return (
    <div className="space-y-5 pb-16">
      {/* Read-Only Status Banner */}
      {isReadOnly && (
        <div className="bg-slate-900 text-white px-4 py-2.5 rounded-xl flex items-center justify-between text-xs shadow-sm no-print">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-slate-400" />
            <span className="font-semibold">Locked Record — Read-Only Mode</span>
          </div>
          <span className="text-slate-300 font-medium capitalize">
            Status: {batch.status.replace(/_/g, ' ').toLowerCase()}
          </span>
        </div>
      )}

      {/* Main Container Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-sm space-y-5">
        {/* Top Header & Export Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 font-medium mb-1">
              <span>{template.sheet_id}</span>
              <ChevronRight className="w-3 h-3 text-slate-400" />
              <span>Lot {batch.lot_number}</span>
            </div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              {template.document_title}
            </h2>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 no-print">
            <button
              onClick={() => setIsPrintModalOpen(true)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Printer className="w-3.5 h-3.5 text-slate-500" />
              <span>QR Label</span>
            </button>

            <button
              onClick={() => setIsCameraModalOpen(true)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Camera className="w-3.5 h-3.5 text-slate-500" />
              <span>Photo</span>
            </button>

            <a
              href={getExportUrl(batch.batch_id, 'pdf')}
              download
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>PDF</span>
            </a>

            <a
              href={getExportUrl(batch.batch_id, 'xlsx')}
              download
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Excel</span>
            </a>
          </div>
        </div>

        {/* Metadata Details Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50/70 p-4 rounded-xl border border-slate-200/80 text-xs">
          <div>
            <span className="text-[11px] font-medium text-slate-500 block">Part Number</span>
            <span className="font-semibold text-slate-800">{template.part_no || 'N/A'}</span>
          </div>
          <div>
            <span className="text-[11px] font-medium text-slate-500 block">Part Name</span>
            <span className="font-semibold text-slate-800">{template.part_name || 'N/A'}</span>
          </div>
          <div>
            <span className="text-[11px] font-medium text-slate-500 block">Model</span>
            <span className="font-semibold text-slate-800">{template.model_name || 'N/A'}</span>
          </div>
          <div>
            <span className="text-[11px] font-medium text-slate-500 block">Customer</span>
            <span className="font-semibold text-slate-800">{template.customer_name || 'N/A'}</span>
          </div>

          <div className="pt-2 border-t border-slate-200/60">
            <span className="text-[11px] font-medium text-slate-500 block">Lot Quantity</span>
            <span className="font-semibold text-slate-800">{batch.lot_quantity || 'N/A'}</span>
          </div>
          <div className="pt-2 border-t border-slate-200/60">
            <span className="text-[11px] font-medium text-slate-500 block">Inspection Mode</span>
            <span className="font-semibold text-slate-800">{batch.inspection_mode} Frequency</span>
          </div>
          <div className="pt-2 border-t border-slate-200/60">
            <span className="text-[11px] font-medium text-slate-500 block">Date</span>
            <span className="font-semibold text-slate-800">
              {batch.created_at ? new Date(batch.created_at).toLocaleDateString('en-GB') : '-'}
            </span>
          </div>
          <div className="pt-2 border-t border-slate-200/60">
            <span className="text-[11px] font-medium text-slate-500 block">Batch Status</span>
            <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-900 text-white">
              {batch.status.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

        {/* Clean Inspection Table */}
        <div className="border border-slate-200 rounded-xl overflow-hidden overflow-x-auto shadow-sm">
          <table className="clean-table min-w-full">
            <thead>
              <tr>
                <th className="w-12 text-center">#</th>
                <th className="w-28">Stage</th>
                <th className="w-48">Control Item</th>
                <th className="w-56">Specification</th>
                <th className="w-24">Method</th>
                <th className="w-20 text-center">Freq</th>
                {displayColumns.map((col) => (
                  <th key={col} className="w-12 text-center bg-slate-100/60">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {template.control_items.map((item) => {
                const isAssigned = item.assigned_role === currentUser.role;
                const freq = batch.inspection_mode === 'IFM' ? item.ifm_frequency : item.normal_frequency;

                return (
                  <tr key={item.item_id || item.serial_no}>
                    <td className="text-center font-semibold text-slate-500">{item.serial_no}</td>
                    <td className="font-medium text-slate-600">{item.stage_name}</td>
                    <td className="font-semibold text-slate-900">{item.control_item_name}</td>
                    <td className="text-slate-600 text-xs leading-relaxed">{item.specification_content}</td>
                    <td className="text-slate-600 text-xs">{item.application_method || '-'}</td>
                    <td className="text-center text-xs font-medium text-slate-500">{freq || '-'}</td>

                    {/* Columns */}
                    {displayColumns.map((col) => {
                      const itemCols = Array.isArray(item.sample_columns) ? item.sample_columns : [];
                      const isApplicable = itemCols.includes(col);
                      const key = `${item.item_id}_${col}`;
                      const cell = cellsMap[key];
                      const val = cell?.cell_value || '';
                      const isFailed = checkOutOfSpec(item, val);

                      if (!isApplicable) {
                        return (
                          <td key={col} className="text-center bg-slate-100/40 text-slate-300">
                            -
                          </td>
                        );
                      }

                      // Tickbox
                      if (item.row_mode === 'SERIAL_TICKBOX') {
                        const isChecked = val === 'true' || val === '1' || val === 'OK';
                        return (
                          <td key={col} className="text-center p-1.5">
                            <button
                              type="button"
                              disabled={!isAssigned || isReadOnly}
                              onClick={() => handleCellChange(item, col, isChecked ? 'false' : 'true')}
                              className={`w-7 h-7 mx-auto rounded-md flex items-center justify-center transition-all ${
                                isChecked
                                  ? 'bg-slate-900 text-white'
                                  : isAssigned && !isReadOnly
                                  ? 'border border-slate-300 hover:border-slate-500 bg-white'
                                  : 'border border-slate-200 bg-slate-50 opacity-40 cursor-not-allowed'
                              }`}
                            >
                              {isChecked && <Check className="w-4 h-4 stroke-[2.5]" />}
                            </button>
                          </td>
                        );
                      }

                      // Numeric
                      return (
                        <td key={col} className="p-1">
                          <input
                            type="number"
                            step="0.01"
                            disabled={!isAssigned || isReadOnly}
                            value={val}
                            onChange={(e) => handleCellChange(item, col, e.target.value)}
                            placeholder="0.00"
                            className={`w-full py-1 px-1 text-center text-xs font-semibold rounded-md transition-all focus:outline-none ${
                              isFailed
                                ? 'bg-red-50 text-red-700 border border-red-300 font-bold'
                                : isAssigned && !isReadOnly
                                ? 'bg-white border border-slate-300 text-slate-900 focus:ring-1 focus:ring-slate-800'
                                : 'bg-slate-50 text-slate-500 border border-slate-200 opacity-60 cursor-not-allowed'
                            }`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* Checker Initials */}
              <tr className="bg-slate-50 font-medium text-xs text-slate-600">
                <td className="text-center font-bold text-slate-700">CHK</td>
                <td colSpan={5} className="font-semibold text-slate-700">
                  Checker Initials
                </td>
                {displayColumns.map((col) => {
                  let init = '';
                  for (const key in cellsMap) {
                    if (key.endsWith(`_${col}`) && cellsMap[key].checker_initials) {
                      init = cellsMap[key].checker_initials!;
                      break;
                    }
                  }
                  return (
                    <td key={col} className="text-center font-bold text-slate-800 text-xs">
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
          <div className="space-y-2.5 pt-2">
            <h3 className="text-xs font-semibold text-slate-800 flex items-center gap-2">
              <Camera className="w-4 h-4 text-slate-500" />
              Inspection Photos ({batch.attachments.length})
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {batch.attachments.map((att) => (
                <div key={att.attachment_id} className="border border-slate-200 rounded-lg p-1.5 bg-slate-50 space-y-1">
                  <div className="aspect-video bg-slate-100 rounded overflow-hidden">
                    <img
                      src={att.file_path}
                      alt={att.file_name || 'Evidence'}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium truncate">
                    {att.file_name || 'Image'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Decisions & Notes */}
        {((batch.decisions && batch.decisions.length > 0) || batch.hold_reason) && (
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
            <h4 className="font-semibold text-slate-800 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-slate-600" />
              Inspection Decisions
            </h4>
            <div className="space-y-1.5 divide-y divide-slate-200/60">
              {batch.decisions?.map((d) => (
                <div key={d.decision_id} className="pt-1.5 flex justify-between items-center text-xs">
                  <div>
                    <span className="font-semibold text-slate-900 uppercase">[{d.role}]</span>{' '}
                    <span className="font-medium text-slate-700">{d.decision}</span>
                    {d.remarks && <span className="text-slate-500 ml-2">— {d.remarks}</span>}
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {d.decided_at ? new Date(d.decided_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
              ))}
              {batch.hold_reason && (
                <div className="pt-1.5 text-amber-800 font-medium">
                  Hold Reason: {batch.hold_reason}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sign-Off Footer Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-100 text-xs">
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <span className="text-[10px] font-semibold text-slate-500 uppercase block mb-1">Prepared By (Operator)</span>
            <div className="font-semibold text-slate-800">
              {batch.prepared_user_name || (batch.prepared_by ? `User #${batch.prepared_by}` : 'Pending')}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {batch.operator_submitted_at ? new Date(batch.operator_submitted_at).toLocaleString('en-GB') : 'Not Submitted'}
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <span className="text-[10px] font-semibold text-slate-500 uppercase block mb-1">Checked By (Supervisor)</span>
            <div className="font-semibold text-slate-800">
              {batch.checked_user_name || (batch.checked_by ? `User #${batch.checked_by}` : 'Pending')}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {batch.supervisor_submitted_at ? new Date(batch.supervisor_submitted_at).toLocaleString('en-GB') : 'Not Reviewed'}
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <span className="text-[10px] font-semibold text-slate-500 uppercase block mb-1">Approved By (QA)</span>
            <div className="font-semibold text-slate-800">
              {batch.approved_user_name || (batch.approved_by ? `User #${batch.approved_by}` : 'Pending')}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Status: {batch.status.replace(/_/g, ' ')}
            </div>
          </div>
        </div>

        {/* Bottom Actions Bar */}
        <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 no-print">
          <span className="text-xs text-slate-500">
            Logged in as <strong className="text-slate-800 capitalize">{currentUser.full_name} ({currentUser.role})</strong>
          </span>

          <div className="flex items-center gap-2">
            {currentUser.role === 'operator' && !isReadOnly && (
              <>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleOperatorRejectClick}
                  className="px-4 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <span>Reject Batch</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleOperatorApprove}
                  className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isSubmitting ? 'Saving...' : 'Submit & Approve'}</span>
                </button>
              </>
            )}

            {(currentUser.role === 'supervisor' || currentUser.role === 'admin') && batch.status !== 'APPROVED' && batch.status !== 'REJECTED' && (
              <button
                type="button"
                onClick={() => setIsSupervisorModalOpen(true)}
                className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5 transition-all shadow-sm"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Review & Sign-Off</span>
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
