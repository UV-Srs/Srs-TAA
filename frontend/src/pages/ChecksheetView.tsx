import React, { useState, useEffect, useMemo } from 'react';
import {
  InspectionBatch, User, ControlItem, CellResponse, OfflineMutation
} from '../types';
import {
  fetchBatchDetail, updateCellResponse, submitOperatorBatch,
  reviewSupervisorBatch, reviewSingleField, releaseBatchHold, downloadBatchExport
} from '../api';
import { saveCellOffline, getOfflineCellsForBatch, cacheBatchOffline, getCachedBatchOffline } from '../db';
import { FullSheetCompletionModal } from '../components/FullSheetCompletionModal';
import { RejectionModal } from '../components/RejectionModal';
import { CameraCaptureModal } from '../components/CameraCaptureModal';
import { PrintLabelModal } from '../components/PrintLabelModal';
import { onSheetUpdated, onBatchUpdated as onLiveBatchUpdated, onCellUpdated } from '../liveSync';
import {
  Check, Lock, Camera, Printer, Download,
  AlertTriangle, ShieldCheck, CheckCircle2, ChevronRight,
  Clock, RefreshCw, X, AlertCircle, Settings
} from 'lucide-react';

interface ChecksheetViewProps {
  batchId: number;
  currentUser: User;
  onBatchUpdated?: () => void;
  onEditTemplate?: (sheetId: string) => void;
}

const HOLD_REASONS = [
  'Awaiting lab or test result',
  'Material deviation, needs MRB review',
  'Equipment or gauge issue',
  'Documentation missing',
  'Customer concession pending',
  'Other',
];

const REVIEW_BY_OPTIONS = [
  { label: '1 hour', hours: 1 },
  { label: '4 hours', hours: 4 },
  { label: 'End of shift (8 hours)', hours: 8 },
  { label: '24 hours', hours: 24 },
];

export const ChecksheetView: React.FC<ChecksheetViewProps> = ({
  batchId,
  currentUser,
  onBatchUpdated,
  onEditTemplate,
}) => {
  const [batch, setBatch] = useState<InspectionBatch | null>(null);
  const batchRef = React.useRef<InspectionBatch | null>(null);
  const [cellsMap, setCellsMap] = useState<Record<string, CellResponse>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modals & Mode
  const [isCompletionModalOpen, setIsCompletionModalOpen] = useState<boolean>(false);
  const [missingFieldsList, setMissingFieldsList] = useState<string[]>([]);
  const [isRejectionModalOpen, setIsRejectionModalOpen] = useState<boolean>(false);
  const [isSupRejectionModalOpen, setIsSupRejectionModalOpen] = useState<boolean>(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState<boolean>(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isPassingAll, setIsPassingAll] = useState<boolean>(false);

  // Supervisor Hold Modal
  const [isHoldModalOpen, setIsHoldModalOpen] = useState<boolean>(false);
  const [holdReason, setHoldReason] = useState<string>(HOLD_REASONS[0]);
  const [holdNote, setHoldNote] = useState<string>('');
  const [holdHours, setHoldHours] = useState<number>(4);

  // Release Hold Modal (FR-057 & FR-058)
  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState<boolean>(false);
  const [releaseOutcome, setReleaseOutcome] = useState<'approve' | 'reject' | 'reinspect'>('approve');
  const [releaseNote, setReleaseNote] = useState<string>('');
  const [releaseRejectItemIds, setReleaseRejectItemIds] = useState<number[]>([]);

  useEffect(() => {
    loadBatch();

    // Live subscriptions for real-time multi-user synchronization
    const unsubBatch = onLiveBatchUpdated((data) => {
      if (data.batch_id === batchId) {
        loadBatch();
        if (onBatchUpdated) onBatchUpdated();
      }
    });

    const unsubSheet = onSheetUpdated((data) => {
      if (batchRef.current && data.sheet_id === batchRef.current.sheet_id) {
        loadBatch();
      }
    });

    const unsubCell = onCellUpdated((data) => {
      if (data.batch_id === batchId) {
        setCellsMap((prev) => ({
          ...prev,
          [`${data.item_id}_${data.column_key}`]: {
            response_id: prev[`${data.item_id}_${data.column_key}`]?.response_id || 0,
            batch_id: data.batch_id,
            item_id: data.item_id,
            column_key: data.column_key,
            cell_value: data.cell_value,
            is_within_spec: data.is_within_spec,
            checker_initials: data.checker_initials,
            updated_at: data.updated_at,
          },
        }));
      }
    });

    return () => {
      unsubBatch();
      unsubSheet();
      unsubCell();
    };
  }, [batchId]);

  const loadBatch = async () => {
    try {
      setIsLoading(true);
      setErrorMsg(null);
      setCellsMap({});  // clear stale cells before fetch so previous batch's data never flashes

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
      batchRef.current = bData;

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

  // Globally locked — no one can edit anything
  const isReadOnly = useMemo(() => {
    if (!batch) return true;
    return batch.status === 'APPROVED' || batch.status === 'REJECTED';
  }, [batch]);

  // Operator's turn: batch not yet submitted by operator
  const isOperatorTurn = useMemo(() => {
    if (!batch) return false;
    return !batch.operator_submitted_at &&
      ['CREATED_PENDING_OPERATOR', 'OPERATOR_IN_PROGRESS'].includes(batch.status);
  }, [batch]);

  // Supervisor's turn: operator has submitted, awaiting supervisor decision
  const isSupervisorTurn = useMemo(() => {
    if (!batch) return false;
    return ['OPERATOR_APPROVED', 'SUPERVISOR_IN_PROGRESS', 'ON_HOLD'].includes(batch.status);
  }, [batch]);

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
    if (item.row_mode === 'NUMERIC_SAMPLE' || item.html_input_type === 'number') {
      const num = parseFloat(val);
      if (isNaN(num)) return true;
      if (item.min_val !== null && item.min_val !== undefined && num < item.min_val) return true;
      if (item.max_val !== null && item.max_val !== undefined && num > item.max_val) return true;
    }
    if (item.row_mode === 'SERIAL_TICKBOX' || item.html_input_type === 'checkbox') {
      if (val === 'false' || val === 'FAIL' || val === '0') return true;
    }
    if (item.html_input_type === 'pf') {
      if (val === 'Fail') return true;
    }
    return false;
  };

  const handleCellChange = async (item: ControlItem, columnKey: string, newValue: string) => {
    if (!batch || isReadOnly) return;

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
      // Only validate fields owned by the current user's role
      const isOpItem = item.assigned_role === 'operator' || (!item.assigned_role && item.editable_by_operator !== false);
      const isSupItem = item.assigned_role === 'supervisor';
      if (currentUser.role === 'operator' && !isOpItem) return;
      if (currentUser.role === 'supervisor' && !isSupItem) return;

      const sampleCols = Array.isArray(item.sample_columns) ? item.sample_columns : ['val'];
      const col = sampleCols[0];
      const key = `${item.item_id}_${col}`;
      const cell = cellsMap[key];
      if (!cell || cell.cell_value === null || cell.cell_value === undefined || cell.cell_value === '') {
        missing.push(`S.No ${item.serial_no}: ${item.control_item_name}`);
      }
    });

    return {
      isValid: missing.length === 0,
      missing,
    };
  };

  const totalRequired = batch?.template?.control_items ? batch.template.control_items.filter((i) => {
    if (!i.is_required) return false;
    const isOpItem = i.assigned_role === 'operator' || (!i.assigned_role && i.editable_by_operator !== false);
    const isSupItem = i.assigned_role === 'supervisor';
    if (currentUser.role === 'operator') return isOpItem;
    if (currentUser.role === 'supervisor') return isSupItem;
    return true;
  }).length : 0;
  const completedRequired = batch?.template?.control_items ? batch.template.control_items.filter((item) => {
    if (!item.is_required) return false;
    const isOpItem = item.assigned_role === 'operator' || (!item.assigned_role && item.editable_by_operator !== false);
    const isSupItem = item.assigned_role === 'supervisor';
    if (currentUser.role === 'operator' && !isOpItem) return false;
    if (currentUser.role === 'supervisor' && !isSupItem) return false;
    const sampleCols = Array.isArray(item.sample_columns) ? item.sample_columns : ['val'];
    const firstColKey = sampleCols[0];
    const cellKey = `${item.item_id}_${firstColKey}`;
    const cellData = cellsMap[cellKey];
    return cellData && cellData.cell_value !== null && cellData.cell_value !== undefined && cellData.cell_value !== '';
  }).length : 0;
  const percentComplete = totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 100;

  const handlePassAll = async () => {
    if (!batch || isReadOnly) return;
    setIsPassingAll(true);
    setErrorMsg(null);
    try {
      const items = (batch.template?.control_items || []);
      const role = currentUser.role;
      const initials = currentUser.username.substring(0, 2).toUpperCase();
      const newCells: Record<string, CellResponse> = {};
      const apiCalls: Promise<any>[] = [];

      for (const item of items) {
        const isOpItem = item.assigned_role === 'operator' || (!item.assigned_role && item.editable_by_operator !== false);
        const isSupItem = item.assigned_role === 'supervisor';
        const isEditable =
          (role === 'operator' && isOpItem && isOperatorTurn) ||
          (role === 'supervisor' && isSupItem && isSupervisorTurn);
        if (!isEditable) continue;

        const sampleCols = Array.isArray(item.sample_columns) && item.sample_columns.length > 0
          ? item.sample_columns
          : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

        let colsToPass: string[] = [];
        if (item.row_mode === 'SERIAL_TICKBOX') {
          colsToPass = sampleCols;
        } else if (item.html_input_type === 'pf' || item.html_input_type === 'checkbox') {
          colsToPass = [sampleCols[0]];
        } else if (item.row_mode === 'NUMERIC_SAMPLE') {
          // Tick all verification checkboxes (the ${col}c keys) — doesn't touch number values
          colsToPass = sampleCols.map(c => `${c}c`);
        }

        for (const col of colsToPass) {
          const mutId = crypto.randomUUID();
          const key = `${item.item_id}_${col}`;
          newCells[key] = {
            batch_id: batch.batch_id,
            item_id: item.item_id!,
            column_key: col,
            cell_value: 'Pass',
            is_within_spec: true,
            checker_initials: initials,
            client_mutation_id: mutId,
            updated_at: new Date().toISOString(),
          };
          if (navigator.onLine) {
            apiCalls.push(
              updateCellResponse(batch.batch_id, {
                item_id: item.item_id!,
                column_key: col,
                cell_value: 'Pass',
                checker_initials: initials,
                client_mutation_id: mutId,
              }).catch(() => {})
            );
          }
        }
      }

      setCellsMap(prev => ({ ...prev, ...newCells }));
      await Promise.allSettled(apiCalls);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to mark all as pass.');
    } finally {
      setIsPassingAll(false);
    }
  };

  const handleOperatorApprove = async () => {
    if (!batch) return;

    const { isValid, missing } = validateFullSheetCompletion();
    if (!isValid) {
      setMissingFieldsList(missing);
      setIsCompletionModalOpen(true);
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const cellPayloads = Object.values(cellsMap).map((c) => ({
        item_id: c.item_id,
        column_key: c.column_key,
        cell_value: c.cell_value,
        checker_initials: c.checker_initials,
        client_mutation_id: c.client_mutation_id,
      }));

      await submitOperatorBatch(batch.batch_id, {
        decision: 'APPROVE',
        cells: cellPayloads,
      });

      await loadBatch();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit inspection approval.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOperatorRejectClick = () => {
    setIsRejectionModalOpen(true);
  };

  const handleConfirmRejection = async (selectedItemIds: number[], remarks: string) => {
    if (!batch) return;
    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const cellPayloads = Object.values(cellsMap).map((c) => ({
        item_id: c.item_id,
        column_key: c.column_key,
        cell_value: c.cell_value,
        checker_initials: c.checker_initials,
        client_mutation_id: c.client_mutation_id,
      }));

      await submitOperatorBatch(batch.batch_id, {
        decision: 'REJECT',
        rejected_item_ids: selectedItemIds,
        remarks,
        cells: cellPayloads,
      });

      setIsRejectionModalOpen(false);
      await loadBatch();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit rejection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Supervisor field review toggle (FR-038)
  const handleToggleFieldReview = async (fieldKey: string, review: 'confirm' | 'overrule') => {
    if (!batch) return;
    try {
      await reviewSingleField(batch.batch_id, fieldKey, review);
      await loadBatch();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update field review.');
    }
  };

  // Supervisor review actions (Approve, Reject, Hold)
  const handleSupervisorApprove = async () => {
    if (!batch) return;
    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      await reviewSupervisorBatch(batch.batch_id, {
        decision: 'APPROVE',
        remarks: 'Batch reviewed and signed off.',
      });
      await loadBatch();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to approve batch.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSupervisorReject = () => {
    setIsSupRejectionModalOpen(true);
  };

  const handleConfirmSupervisorRejection = async (selectedItemIds: number[], remarks: string) => {
    if (!batch) return;
    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      await reviewSupervisorBatch(batch.batch_id, {
        decision: 'REJECT',
        rejected_item_ids: selectedItemIds.length ? selectedItemIds : undefined,
        remarks: remarks || 'Batch rejected after supervisor review.',
      });
      setIsSupRejectionModalOpen(false);
      await loadBatch();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to reject batch.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSupervisorHoldSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batch) return;
    if (!holdNote.trim()) {
      setErrorMsg('Please enter a note explaining what the hold is waiting for.');
      return;
    }
    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      await reviewSupervisorBatch(batch.batch_id, {
        decision: 'HOLD',
        hold_reason: holdReason,
        hold_note: holdNote.trim(),
        hold_due_hours: Number(holdHours) || 4,
      });
      setIsHoldModalOpen(false);
      await loadBatch();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to put batch on hold.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReleaseHoldSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batch) return;
    if (!releaseNote.trim()) {
      setErrorMsg('Please enter a release note.');
      return;
    }
    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      await releaseBatchHold(batch.batch_id, {
        outcome: releaseOutcome,
        release_note: releaseNote.trim(),
        rejected_item_ids: releaseOutcome === 'reject' ? releaseRejectItemIds : undefined,
      });
      setIsReleaseModalOpen(false);
      setReleaseNote('');
      await loadBatch();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to release hold.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-slate-500 gap-3">
        <RefreshCw className="w-6 h-6 animate-spin text-slate-600" />
        <span className="text-xs font-medium">Loading checksheet...</span>
      </div>
    );
  }

  if (!batch || !batch.template) {
    return (
      <div className="p-8 text-center text-slate-500 border border-slate-200 rounded bg-white">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
        <h3 className="font-bold text-slate-800 text-sm">No batch selected</h3>
        <p className="text-xs text-slate-500 mt-1">Scan a batch label or select a batch from the sidebar.</p>
      </div>
    );
  }

  const template = batch.template;
  const supRevs = batch.supervisor_reviews || {};
  const hasConfirmedRejections = Object.values(supRevs).some((v) => v === 'confirm');
  const opRejectedList = batch.operator_rejected_fields || [];
  const pendingRejectionsCount = opRejectedList.filter((f) => !supRevs[String(f)]).length;

  return (
    <div className="space-y-4 text-xs font-sans pb-12">
      {/* Globally locked — APPROVED or REJECTED */}
      {isReadOnly && (
        <div className="bg-slate-900 text-white px-5 py-3 rounded-lg flex items-center justify-between text-xs font-bold tracking-widest uppercase mb-2">
          <div className="flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-white" />
            <span>LOCKED RECORD — READ-ONLY SUMMARY MODE</span>
          </div>
          <span className="text-[11px] text-zinc-300 font-mono font-semibold">
            Status: {batch.status} (Round {batch.round || 1})
          </span>
        </div>
      )}

      {/* Operator has submitted — waiting for supervisor */}
      {!isReadOnly && currentUser.role === 'operator' && batch.operator_submitted_at && (
        <div className="bg-blue-50 border border-blue-200 text-blue-900 px-4 py-3 rounded-lg flex items-center gap-2.5 text-xs font-semibold">
          <Check className="w-4 h-4 text-blue-600 shrink-0" />
          <span>Your entries are submitted and locked. Awaiting supervisor review.</span>
        </div>
      )}

      {/* Supervisor turn — operator's fields are locked */}
      {!isReadOnly && currentUser.role === 'supervisor' && isSupervisorTurn && (
        <div className="bg-violet-50 border border-violet-200 text-violet-900 px-4 py-3 rounded-lg flex items-center gap-2.5 text-xs font-semibold">
          <ShieldCheck className="w-4 h-4 text-violet-600 shrink-0" />
          <span>Operator data is locked. Fill in supervisor checkpoint fields below, then approve, reject, or hold.</span>
        </div>
      )}

      {/* Overdue Hold Banner (FR-056) */}
      {batch.status === 'ON_HOLD' && (
        <div
          className={`px-4 py-3 rounded-lg border flex flex-wrap items-center justify-between gap-3 ${
            batch.is_overdue
              ? 'bg-red-50 text-red-900 border-red-300'
              : 'bg-amber-50 text-amber-900 border-amber-300'
          }`}
        >
          <div>
            <div className="flex items-center gap-2 font-bold text-xs">
              <Clock className="w-4 h-4" />
              <span>
                {batch.is_overdue ? 'BATCH ON HOLD — OVERDUE ESCALATION' : 'BATCH ON HOLD'}
              </span>
            </div>
            <p className="text-[11px] mt-0.5">
              <b>Reason:</b> {batch.hold_reason || 'Validation in progress'}
              {batch.hold_note && <> — {batch.hold_note}</>}
            </p>
            {batch.hold_due_at && (
              <span className="text-[10px] opacity-80 block mt-0.5 font-mono">
                Review deadline: {new Date(batch.hold_due_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>

          {(currentUser.role === 'supervisor' || currentUser.role === 'admin') && (
            <button
              type="button"
              onClick={() => setIsReleaseModalOpen(true)}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg shadow-sm transition-all text-xs"
            >
              Release Hold
            </button>
          )}
        </div>
      )}

      {/* Main Checksheet Card */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {/* Zone A: Header Block */}
        <div className="px-5 py-4 border-b border-slate-200 bg-white">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 tracking-tight truncate">
                {batch.product_name || template.part_name || template.document_title}
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-500">
                <span className="font-mono font-semibold text-slate-700">Lot {batch.lot_number}</span>
                <span className="text-slate-300">|</span>
                <span>Part <span className="font-mono text-slate-600">#{template.part_no || 'N/A'}</span></span>
                <span className="text-slate-300">|</span>
                <span>{batch.line_name || 'Line 1'}</span>
                <span className="text-slate-300">|</span>
                <span>Qty {batch.lot_quantity || 100} pcs</span>
                {batch.round > 1 && (
                  <>
                    <span className="text-slate-300">|</span>
                    <span className="text-violet-600 font-semibold">Round {batch.round}</span>
                  </>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              {currentUser.role === 'admin' && onEditTemplate && batch?.sheet_id && (
                <button
                  type="button"
                  onClick={() => onEditTemplate(batch.sheet_id)}
                  className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-700 text-white font-medium rounded flex items-center gap-1.5 transition-colors text-xs"
                  title="Open this checksheet template in the builder"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Edit Template</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsCameraModalOpen(true)}
                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded flex items-center gap-1.5 transition-colors text-xs"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Photo</span>
              </button>

              <button
                type="button"
                onClick={() => setIsPrintModalOpen(true)}
                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded flex items-center gap-1.5 transition-colors text-xs"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Labels</span>
              </button>

              {currentUser.role === 'admin' && (
                <>
                  <button
                    type="button"
                    onClick={() => downloadBatchExport(batch.batch_id, 'pdf', batch.lot_number).catch((e) => setErrorMsg(e.message))}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded flex items-center gap-1.5 transition-colors text-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>PDF</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => downloadBatchExport(batch.batch_id, 'xlsx', batch.lot_number).catch((e) => setErrorMsg(e.message))}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded flex items-center gap-1.5 transition-colors text-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Excel</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Zone B: Inspection Matrix */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4 w-12 text-center">#</th>
                <th className="py-3 px-4 min-w-[100px]">Stage</th>
                <th className="py-3 px-4 min-w-[200px]">Inspection Item</th>
                <th className="py-3 px-4 min-w-[160px]">Specification & Limits</th>
                <th className="py-3 px-4 min-w-[120px]">Method / Instrument</th>
                <th className="py-3 px-4 min-w-[320px]">Recorded Result</th>
                {currentUser.role === 'supervisor' && opRejectedList.length > 0 && (
                  <th className="py-3 px-4 min-w-[160px] text-center">Supervisor Review</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {template.control_items.map((item, idx) => {
                const isOpRole = currentUser.role === 'operator';
                const isSupRole = currentUser.role === 'supervisor';
                // Which role owns this row — strict assignment, no crossover
                const isOpItem = item.assigned_role === 'operator' || (!item.assigned_role && item.editable_by_operator !== false);
                const isSupItem = item.assigned_role === 'supervisor';

                // Does this row belong to the current user's role?
                const isAssigned =
                  currentUser.role === 'admin' ||
                  (isOpRole && isOpItem) ||
                  (isSupRole && isSupItem);

                // Can the current user actively type into this cell right now?
                const canEditCell = !isReadOnly && (
                  (isOpRole && isOpItem && isOperatorTurn) ||
                  (isSupRole && isSupItem && isSupervisorTurn)
                );

                // Row styling — dim rows that belong to the other role
                const rowClass = isAssigned
                  ? 'bg-white text-slate-900 border-l-4 border-l-black hover:bg-slate-50/80 font-medium'
                  : 'bg-slate-50/40 text-slate-400 border-l-2 border-l-slate-200';

                // Get single representative column key or first column
                const sampleCols = Array.isArray(item.sample_columns) ? item.sample_columns : ['val'];
                const firstColKey = sampleCols[0];
                const cellKey = `${item.item_id}_${firstColKey}`;
                const cellData = cellsMap[cellKey];
                const currentVal = cellData?.cell_value || '';
                const isOutOfSpec = checkOutOfSpec(item, currentVal);

                // Supervisor review state for this item — keyed by item_id to avoid name-collision bugs
                const supRevChoice = supRevs[String(item.item_id)];
                const isItemRejectedByOp = opRejectedList.includes(item.control_item_name) || opRejectedList.includes(item.item_id);

                return (
                  <tr key={item.item_id || idx} className={`transition-colors border-b border-slate-100 ${rowClass}`}>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-700 font-bold">
                      {item.serial_no}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-800">
                      {item.stage_name}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-slate-950">
                      {item.control_item_name}
                      {item.is_required && <span className="text-red-600 ml-0.5">*</span>}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">
                      {item.specification_content}
                      {item.min_val !== null && item.max_val !== null && (
                        <span className="text-slate-500 block text-[10px] font-semibold">
                          [{item.min_val} ~ {item.max_val} {item.unit || ''}]
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {item.application_method || '-'}
                    </td>

                    {/* Cell Input / Value */}
                    <td className="py-2.5 px-3">
                      {canEditCell ? (
                        item.html_input_type === 'pf' ? (
                          <div className="inline-flex rounded-lg border-2 border-black p-0.5 bg-white shadow-2xs">
                            <button
                              type="button"
                              onClick={() => handleCellChange(item, firstColKey, 'Pass')}
                              className={`px-3 py-1 rounded font-bold text-xs transition-all ${
                                currentVal === 'Pass'
                                  ? 'bg-black text-white shadow-sm'
                                  : 'text-black hover:bg-slate-100'
                              }`}
                            >
                              Pass
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCellChange(item, firstColKey, 'Fail')}
                              className={`px-3 py-1 rounded font-bold text-xs transition-all ${
                                currentVal === 'Fail'
                                  ? 'bg-black text-white shadow-sm underline'
                                  : 'text-black hover:bg-slate-100'
                              }`}
                            >
                              Fail
                            </button>
                          </div>
                        ) : item.row_mode === 'NUMERIC_SAMPLE' ? (
                          <div className="grid grid-cols-5 gap-1" style={{ minWidth: '220px' }}>
                            {sampleCols.map((col) => {
                              const chkKey = `${col}c`;
                              const isVerified = cellsMap[`${item.item_id}_${chkKey}`]?.cell_value === 'Pass';
                              return (
                                <label key={col} className="flex flex-col items-center gap-0.5 cursor-pointer select-none">
                                  <span className="text-[9px] text-slate-400 font-mono leading-none">{col}</span>
                                  <input
                                    type="checkbox"
                                    checked={isVerified}
                                    onChange={(e) => handleCellChange(item, chkKey, e.target.checked ? 'Pass' : '')}
                                    className="w-5 h-5 accent-black cursor-pointer"
                                    title={`Mark sample ${col} as verified`}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        ) : item.html_input_type === 'number' ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              step="0.01"
                              value={currentVal}
                              onChange={(e) => handleCellChange(item, firstColKey, e.target.value)}
                              className={`w-28 rounded-lg px-2.5 py-1 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-black ${
                                isOutOfSpec
                                  ? 'border-2 border-dashed border-black bg-neutral-100 text-black'
                                  : 'border-2 border-black bg-white text-black'
                              }`}
                              placeholder="0.00"
                            />
                            {currentVal && (
                              <span
                                className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                  isOutOfSpec
                                    ? 'bg-black text-white'
                                    : 'bg-slate-200 text-slate-800'
                                }`}
                              >
                                {isOutOfSpec ? 'OUT OF SPEC' : 'OK'}
                              </span>
                            )}
                          </div>
                        ) : item.row_mode === 'SERIAL_TICKBOX' ? (
                          <div className="grid grid-cols-5 gap-1" style={{ minWidth: '220px' }}>
                            {sampleCols.map((col) => {
                              const colVal = cellsMap[`${item.item_id}_${col}`]?.cell_value || '';
                              const isChecked = colVal === 'Pass' || colVal === 'true';
                              return (
                                <label key={col} className="flex flex-col items-center gap-0.5 cursor-pointer select-none">
                                  <span className="text-[9px] text-slate-400 font-mono leading-none">{col}</span>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => handleCellChange(item, col, e.target.checked ? 'Pass' : '')}
                                    className="w-5 h-5 accent-black cursor-pointer"
                                  />
                                </label>
                              );
                            })}
                          </div>
                        ) : item.html_input_type === 'checkbox' ? (
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={currentVal === 'true' || currentVal === 'Pass'}
                              onChange={(e) =>
                                handleCellChange(item, firstColKey, e.target.checked ? 'Pass' : 'Fail')
                              }
                              className="w-5 h-5 accent-black border-2 border-black rounded cursor-pointer transition-transform active:scale-95"
                            />
                            <span className="font-bold text-xs text-black">
                              {currentVal === 'Pass' || currentVal === 'true' ? 'Passed' : 'Unticked'}
                            </span>
                          </label>
                        ) : (
                          <input
                            type="text"
                            value={currentVal}
                            onChange={(e) => handleCellChange(item, firstColKey, e.target.value)}
                            placeholder="Optional remark"
                            className="w-full border-2 border-black rounded-lg px-2.5 py-1 text-xs font-medium focus:ring-2 focus:ring-black focus:outline-none"
                          />
                        )
                      ) : item.row_mode === 'SERIAL_TICKBOX' ? (
                        <div className="grid grid-cols-5 gap-1" style={{ minWidth: '220px' }}>
                          {sampleCols.map((col) => {
                            const colVal = cellsMap[`${item.item_id}_${col}`]?.cell_value || '';
                            const isChecked = colVal === 'Pass' || colVal === 'true';
                            return (
                              <div key={col} className="flex flex-col items-center">
                                <span className="text-[9px] text-slate-400 font-mono">{col}</span>
                                <span className={`text-base leading-none font-bold ${isChecked ? 'text-emerald-600' : 'text-slate-200'}`}>
                                  {isChecked ? '✓' : '○'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : item.row_mode === 'NUMERIC_SAMPLE' ? (
                        <div className="grid grid-cols-5 gap-1" style={{ minWidth: '220px' }}>
                          {sampleCols.map((col) => {
                            const isVerified = cellsMap[`${item.item_id}_${col}c`]?.cell_value === 'Pass';
                            return (
                              <div key={col} className="flex flex-col items-center">
                                <span className="text-[9px] text-slate-400 font-mono">{col}</span>
                                <span className={`text-base leading-none font-bold ${isVerified ? 'text-emerald-600' : 'text-slate-200'}`}>
                                  {isVerified ? '✓' : '○'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 font-mono">
                          <span className="font-bold text-slate-900">
                            {currentVal || <span className="text-slate-400 font-normal italic">Empty</span>}
                          </span>
                          {currentVal && (
                            <span
                              className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                isOutOfSpec
                                  ? 'bg-black text-white'
                                  : 'bg-slate-200 text-slate-800'
                              }`}
                            >
                              {isOutOfSpec ? 'OUT OF SPEC' : 'OK'}
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Supervisor Review Column (Confirm / Overrule - FR-038) */}
                    {currentUser.role === 'supervisor' && opRejectedList.length > 0 && (
                      <td className="py-2.5 px-3 text-center">
                        {isItemRejectedByOp ? (
                          <div className="inline-flex rounded-lg border border-slate-300 p-0.5 bg-slate-50 gap-1">
                            <button
                              type="button"
                              onClick={() => handleToggleFieldReview(String(item.item_id), 'confirm')}
                              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all ${
                                supRevChoice === 'confirm'
                                  ? 'bg-red-600 text-white shadow-sm'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              Confirm Fail
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleFieldReview(String(item.item_id), 'overrule')}
                              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all ${
                                supRevChoice === 'overrule'
                                  ? 'bg-emerald-600 text-white shadow-sm'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              Overrule
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[11px]">-</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Photo Evidence Section */}
        {batch.attachments && batch.attachments.length > 0 && (
          <div className="p-5 border-t border-slate-200 bg-slate-50/30">
            <h4 className="font-bold text-slate-800 text-xs mb-2">Attached Photo Evidence ({batch.attachments.length})</h4>
            <div className="flex flex-wrap gap-3">
              {batch.attachments.map((att) => (
                <div key={att.attachment_id} className="relative group border border-slate-200 rounded overflow-hidden bg-white">
                  <img
                    src={att.file_path}
                    alt={att.file_name || 'Inspection Photo'}
                    className="w-24 h-24 object-cover"
                  />
                  <div className="absolute inset-0 bg-slate-900/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-1.5 text-[10px]">
                    <span className="truncate">{att.file_name}</span>
                    <span className="text-[9px] text-slate-300">{att.capture_source}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error message */}
        {errorMsg && (
          <div className="mx-5 mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Operator Completion Progress Bar */}
        {currentUser.role === 'operator' && !batch.operator_submitted_at && (
          <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex-1 max-w-sm">
              <div className="flex justify-between text-xs font-semibold mb-1">
                <span className="text-slate-700">Checksheet Progress</span>
                <span className="text-slate-900 font-bold">{completedRequired} of {totalRequired} ({percentComplete}%)</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${percentComplete === 100 ? 'bg-emerald-600' : 'bg-slate-900'}`}
                  style={{ width: `${percentComplete}%` }}
                ></div>
              </div>
            </div>
            <div className="text-xs">
              {percentComplete === 100 ? (
                <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>All required parameters recorded. Ready to submit.</span>
                </span>
              ) : (
                <span className="text-slate-500 font-medium">
                  Complete all {totalRequired} mandatory parameters to sign off.
                </span>
              )}
            </div>
          </div>
        )}

        {/* Actions Bar */}
        <div className="p-5 border-t border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-between gap-4">
          <div className="text-slate-500 text-xs">
            {currentUser.role === 'operator' && !batch.operator_submitted_at && (
              <span>Complete all fields. Submitting notifies Supervisor and Admin.</span>
            )}
            {currentUser.role === 'supervisor' && (
              <span>
                {hasConfirmedRejections ? (
                  <span className="text-red-600 font-semibold">
                    1 or more failing items confirmed. Approval is blocked.
                  </span>
                ) : (
                  <span>Review Operator entries and sign off on batch.</span>
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {/* Operator Actions */}
            {currentUser.role === 'operator' && !batch.operator_submitted_at && (
              <>
                <button
                  type="button"
                  disabled={isPassingAll || isSubmitting}
                  onClick={handlePassAll}
                  className="px-4 py-2 font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  title="Mark all checkboxes and Pass/Fail fields as Pass at once"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{isPassingAll ? 'Applying...' : 'Pass All'}</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleOperatorRejectClick}
                  className="px-4 py-2 font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                  <span>Reject Batch</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleOperatorApprove}
                  className="px-5 py-2 font-semibold text-white bg-slate-900 hover:bg-slate-700 rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isSubmitting ? 'Saving...' : 'Submit & Approve'}</span>
                </button>
              </>
            )}

            {/* Supervisor Actions (FR-035, FR-036, FR-038) */}
            {currentUser.role === 'supervisor' && batch.status !== 'APPROVED' && batch.status !== 'REJECTED' && batch.status !== 'ON_HOLD' && (
              <>
                <button
                  type="button"
                  disabled={isPassingAll || isSubmitting}
                  onClick={handlePassAll}
                  className="px-4 py-2 font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  title="Mark all supervisor-assigned Pass/Fail and checkbox fields as Pass at once"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{isPassingAll ? 'Applying...' : 'Pass All'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsHoldModalOpen(true)}
                  className="px-4 py-2 font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded flex items-center gap-1.5 transition-colors"
                >
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  <span>Put on Hold</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleSupervisorReject}
                  className="px-4 py-2 font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                  <span>Reject Batch</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting || hasConfirmedRejections}
                  onClick={handleSupervisorApprove}
                  title={hasConfirmedRejections ? 'Cannot approve: rejections confirmed failing' : 'Approve and sign off'}
                  className="px-5 py-2 font-semibold text-white bg-slate-900 hover:bg-slate-700 rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Approve & Sign-Off</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Approval Record Ledger (FR-054) */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <h3 className="font-bold text-sm text-slate-900">Approval Record (Sign-Off Ledger)</h3>
        {batch.decisions && batch.decisions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-600 font-semibold text-[11px] border-b border-slate-200">
                  <th className="py-2 px-3">Round</th>
                  <th className="py-2 px-3">Stage</th>
                  <th className="py-2 px-3">By</th>
                  <th className="py-2 px-3">Decision</th>
                  <th className="py-2 px-3">When</th>
                  <th className="py-2 px-3">Remarks / Failed Items</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batch.decisions.map((dec) => (
                  <tr key={dec.decision_id} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-mono font-bold text-slate-700">{dec.round}</td>
                    <td className="py-2 px-3 font-medium text-slate-800">{dec.stage}</td>
                    <td className="py-2 px-3 text-slate-700">
                      {dec.decided_by_name || `User #${dec.decided_by}`}
                      <span className="text-slate-400 text-[10px] ml-1">({dec.role})</span>
                    </td>
                    <td className="py-2 px-3 font-bold">
                      <span
                        className={
                          dec.decision.toLowerCase().includes('approv')
                            ? 'text-emerald-700'
                            : dec.decision.toLowerCase().includes('reject')
                            ? 'text-red-700'
                            : 'text-amber-700'
                        }
                      >
                        {dec.decision}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-500 font-mono text-[11px]">
                      {dec.decided_at ? new Date(dec.decided_at).toLocaleString() : '-'}
                    </td>
                    <td className="py-2 px-3 text-slate-600">
                      {dec.remarks || '-'}
                      {dec.rejected_fields && dec.rejected_fields.length > 0 && (
                        <span className="text-red-600 block text-[10px]">
                          Failed: {dec.rejected_fields.join(', ')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate-400 text-xs italic">
            No sign-offs recorded yet. All approvals, rejections, holds, and releases are permanently logged here.
          </p>
        )}
      </div>

      {/* Supervisor Hold Modal (FR-055) */}
      {isHoldModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 no-print backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md shadow-lg overflow-hidden text-xs">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Put Batch On Hold (Quarantine)</h3>
              <button onClick={() => setIsHoldModalOpen(false)} className="text-slate-400 hover:text-slate-700 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSupervisorHoldSubmit} className="p-5 space-y-3.5">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Reason Category:</label>
                <select
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
                >
                  {HOLD_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Note (What are you waiting for?):</label>
                <textarea
                  rows={2}
                  value={holdNote}
                  onChange={(e) => setHoldNote(e.target.value)}
                  placeholder="e.g. X-ray sample sent to lab for void check"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Review by:</label>
                <select
                  value={holdHours}
                  onChange={(e) => setHoldHours(Number(e.target.value))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
                >
                  {REVIEW_BY_OPTIONS.map((opt) => (
                    <option key={opt.hours} value={opt.hours}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsHoldModalOpen(false)}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded disabled:opacity-50"
                >
                  {isSubmitting ? 'Holding...' : 'Place On Hold'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Release Hold Modal (FR-057 & FR-058) */}
      {isReleaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 no-print backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md shadow-lg overflow-hidden text-xs">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Release Hold on {batch.lot_number}</h3>
              <button onClick={() => setIsReleaseModalOpen(false)} className="text-slate-400 hover:text-slate-700 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleReleaseHoldSubmit} className="p-5 space-y-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-2">Release Outcome:</label>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 p-2 border border-slate-200 rounded hover:bg-slate-50 cursor-pointer">
                    <input
                      type="radio"
                      name="relOutcome"
                      value="approve"
                      checked={releaseOutcome === 'approve'}
                      onChange={() => setReleaseOutcome('approve')}
                    />
                    <span className="font-semibold text-slate-800">Approve batch (Concession / Lab Cleared)</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 border border-slate-200 rounded hover:bg-slate-50 cursor-pointer">
                    <input
                      type="radio"
                      name="relOutcome"
                      value="reject"
                      checked={releaseOutcome === 'reject'}
                      onChange={() => setReleaseOutcome('reject')}
                    />
                    <span className="font-semibold text-slate-800">Reject batch</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 border border-slate-200 rounded hover:bg-slate-50 cursor-pointer">
                    <input
                      type="radio"
                      name="relOutcome"
                      value="reinspect"
                      checked={releaseOutcome === 'reinspect'}
                      onChange={() => setReleaseOutcome('reinspect')}
                    />
                    <div>
                      <span className="font-semibold text-slate-800 block">Send back for reinspection</span>
                      <span className="text-[10px] text-slate-500">
                        Increments round (Round {(batch.round || 1) + 1}) and allows Operator to re-inspect.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Release Note:</label>
                <textarea
                  rows={2}
                  value={releaseNote}
                  onChange={(e) => setReleaseNote(e.target.value)}
                  placeholder="e.g. Lab result received, voids within allowable limit"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
                  required
                />
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsReleaseModalOpen(false)}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 bg-slate-900 hover:bg-slate-700 text-white font-semibold rounded disabled:opacity-50"
                >
                  {isSubmitting ? 'Releasing...' : 'Release Hold'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

      <RejectionModal
        isOpen={isSupRejectionModalOpen}
        onClose={() => setIsSupRejectionModalOpen(false)}
        controlItems={template.control_items}
        onSubmit={handleConfirmSupervisorRejection}
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
        batchId={batch.batch_id}
      />
    </div>
  );
};
