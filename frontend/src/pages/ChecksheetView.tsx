import React, { useState, useEffect, useMemo } from 'react';
import {
  InspectionBatch, User, ControlItem, CellResponse, OfflineMutation
} from '../types';
import {
  fetchBatchDetail, updateCellResponse, submitOperatorBatch,
  reviewSupervisorBatch, reviewSingleField, releaseBatchHold, downloadBatchExport,
  patchControlItemRole
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
  Clock, RefreshCw, X, AlertCircle, Settings, UserCheck
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

  // Role assignment panel
  const [isAssignMode, setIsAssignMode] = useState<boolean>(false);
  const [savingRoles, setSavingRoles] = useState<Set<number>>(new Set());
  const [localRoles, setLocalRoles] = useState<Record<number, 'operator' | 'supervisor'>>({});

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
      return false;
    }
    if (item.row_mode === 'SERIAL_TICKBOX' || item.html_input_type === 'checkbox') {
      if (val === 'false' || val === 'FAIL' || val === 'Fail' || val === '0') return true;
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

      if (item.row_mode === 'SERIAL_TICKBOX') {
        // All 100 items must have Pass or Fail before operator can submit
        const emptyCols = sampleCols.filter((col) => {
          const cell = cellsMap[`${item.item_id}_${col}`];
          return !cell || cell.cell_value === null || cell.cell_value === undefined || cell.cell_value === '';
        });
        if (emptyCols.length > 0) {
          missing.push(
            `${item.control_item_name}: ${emptyCols.length} item${emptyCols.length > 1 ? 's' : ''} not checked` +
            (emptyCols.length <= 5 ? ` (${emptyCols.join(', ')})` : ` (first unchecked: ${emptyCols.slice(0, 3).join(', ')}…)`)
          );
        }
      } else {
        const col = sampleCols[0];
        const key = `${item.item_id}_${col}`;
        const cell = cellsMap[key];
        if (!cell || cell.cell_value === null || cell.cell_value === undefined || cell.cell_value === '') {
          missing.push(`S.No ${item.serial_no}: ${item.control_item_name}`);
        }
      }
    });

    return {
      isValid: missing.length === 0,
      missing,
    };
  };

  // --- Progress calculation ---
  // For SERIAL_TICKBOX: count how many item columns have ALL required serial rows filled.
  // For other rows: count rows that have a value in sampleCols[0].
  const { totalRequired, completedRequired, serialTotalItems, serialCompletedItems, hasSerialRows } = (() => {
    if (!batch?.template?.control_items) return { totalRequired: 0, completedRequired: 0, serialTotalItems: 0, serialCompletedItems: 0, hasSerialRows: false };

    const isOwnedByRole = (i: ControlItem) => {
      const isOpItem = i.assigned_role === 'operator' || (!i.assigned_role && i.editable_by_operator !== false);
      const isSupItem = i.assigned_role === 'supervisor';
      if (currentUser.role === 'operator') return isOpItem;
      if (currentUser.role === 'supervisor') return isSupItem;
      return true;
    };

    const requiredItems = batch.template.control_items.filter((i) => i.is_required && isOwnedByRole(i));
    const serialRows = requiredItems.filter((i) => i.row_mode === 'SERIAL_TICKBOX');
    const nonSerialRows = requiredItems.filter((i) => i.row_mode !== 'SERIAL_TICKBOX');

    // For SERIAL_TICKBOX: total items = number of columns; complete = columns where ALL serial rows have a value
    const serialCols = serialRows.length > 0 ? (Array.isArray(serialRows[0].sample_columns) ? serialRows[0].sample_columns : []) : [];
    const serialTotalItems = serialCols.length;
    const serialCompletedItems = serialCols.filter((col) =>
      serialRows.every((row) => {
        const cell = cellsMap[`${row.item_id}_${col}`];
        return cell && cell.cell_value !== null && cell.cell_value !== undefined && cell.cell_value !== '';
      })
    ).length;

    // Non-serial: row-level counting
    const totalNonSerial = nonSerialRows.length;
    const completedNonSerial = nonSerialRows.filter((item) => {
      const sampleCols = Array.isArray(item.sample_columns) ? item.sample_columns : ['val'];
      const cell = cellsMap[`${item.item_id}_${sampleCols[0]}`];
      return cell && cell.cell_value !== null && cell.cell_value !== undefined && cell.cell_value !== '';
    }).length;

    // Combined totals for percent bar
    const totalRequired = serialTotalItems + totalNonSerial;
    const completedRequired = serialCompletedItems + completedNonSerial;

    return { totalRequired, completedRequired, serialTotalItems, serialCompletedItems, hasSerialRows: serialRows.length > 0 };
  })();
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

  const handleAssignRole = async (itemId: number, role: 'operator' | 'supervisor') => {
    if (!batch?.sheet_id) return;
    setSavingRoles(prev => { const s = new Set(prev); s.add(itemId); return s; });
    try {
      await patchControlItemRole(batch.sheet_id, itemId, role);
      setLocalRoles(prev => ({ ...prev, [itemId]: role }));
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update role assignment.');
    } finally {
      setSavingRoles(prev => { const s = new Set(prev); s.delete(itemId); return s; });
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 gap-3" style={{ color: 'var(--muted)' }}>
        <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--muted)' }} />
        <span className="text-xs font-medium">Loading checksheet...</span>
      </div>
    );
  }

  if (!batch || !batch.template) {
    return (
      <div className="p-8 text-center rounded" style={{ color: 'var(--muted)', border: '1px solid var(--line)', background: 'var(--surface)' }}>
        <AlertTriangle className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--warn)' }} />
        <h3 className="font-bold text-sm" style={{ color: 'var(--ink)' }}>No batch selected</h3>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Scan a batch label or select a batch from the sidebar.</p>
      </div>
    );
  }

  const template = batch.template;
  const supRevs = batch.supervisor_reviews || {};
  const hasConfirmedRejections = Object.values(supRevs).some((v) => v === 'confirm');
  const opRejectedList = batch.operator_rejected_fields || [];
  const pendingRejectionsCount = opRejectedList.filter((f) => !supRevs[String(f)]).length;

  return (
    <div className="space-y-4 text-xs pb-12">
      {/* Globally locked — APPROVED or REJECTED */}
      {isReadOnly && (
        <div className="px-5 py-3 rounded-lg flex items-center justify-between text-xs font-bold tracking-widest uppercase mb-2"
          style={{ background: 'var(--ink)', color: '#fff' }}>
          <div className="flex items-center gap-2.5">
            <Lock className="w-4 h-4" />
            <span>LOCKED RECORD — READ-ONLY SUMMARY MODE</span>
          </div>
          <span className="text-[11px] font-mono font-semibold" style={{ color: 'var(--line2)' }}>
            Status: {batch.status} (Round {batch.round || 1})
          </span>
        </div>
      )}

      {/* Operator has submitted — waiting for supervisor */}
      {!isReadOnly && currentUser.role === 'operator' && batch.operator_submitted_at && (
        <div className="px-4 py-3 rounded-lg flex items-center gap-2.5 text-xs font-semibold"
          style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)' }}>
          <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
          <span>Your entries are submitted and locked. Awaiting supervisor review.</span>
        </div>
      )}

      {/* Supervisor turn — operator's fields are locked */}
      {!isReadOnly && currentUser.role === 'supervisor' && isSupervisorTurn && (
        <div className="px-4 py-3 rounded-lg flex items-center gap-2.5 text-xs font-semibold"
          style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)' }}>
          <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
          <span>Operator data is locked. Fill in supervisor checkpoint fields below, then approve, reject, or hold.</span>
        </div>
      )}

      {/* Overdue Hold Banner (FR-056) */}
      {batch.status === 'ON_HOLD' && (
        <div
          className="px-4 py-3 rounded-lg flex flex-wrap items-center justify-between gap-3"
          style={batch.is_overdue
            ? { background: 'var(--ng-bg)', border: '1px solid #f1b8b5', color: 'var(--ng)' }
            : { background: 'var(--warn-bg)', border: '1px solid #e0b65a', color: 'var(--warn)' }
          }
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
              className="px-3.5 py-1.5 font-semibold rounded-lg shadow-sm transition-all text-xs"
              style={{ background: 'var(--ink)', color: '#fff' }}
            >
              Release Hold
            </button>
          )}
        </div>
      )}

      {/* Main Checksheet Card */}
      <div className="overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 }}>
        {/* Zone A: Header Block */}
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-base font-bold tracking-tight truncate" style={{ color: 'var(--ink)' }}>
                {batch.product_name || template.part_name || template.document_title}
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                <span className="font-mono font-semibold" style={{ color: 'var(--ink)' }}>Lot {batch.lot_number}</span>
                <span style={{ color: 'var(--line2)' }}>|</span>
                <span>Part <span className="font-mono" style={{ color: 'var(--muted)' }}>#{template.part_no || 'N/A'}</span></span>
                <span style={{ color: 'var(--line2)' }}>|</span>
                <span>{batch.line_name || 'Line 1'}</span>
                <span style={{ color: 'var(--line2)' }}>|</span>
                <span>Qty {batch.lot_quantity || 100} pcs</span>
                {batch.round > 1 && (
                  <>
                    <span style={{ color: 'var(--line2)' }}>|</span>
                    <span className="font-semibold" style={{ color: 'var(--accent)' }}>Round {batch.round}</span>
                  </>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              {currentUser.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => setIsAssignMode(o => !o)}
                  className="px-2.5 py-1.5 font-medium rounded flex items-center gap-1.5 transition-colors text-xs"
                  style={isAssignMode
                    ? { background: 'var(--primary)', color: 'var(--on-primary)' }
                    : { background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent)' }
                  }
                  title="Assign fields to Operator or Supervisor"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Assign Roles</span>
                </button>
              )}

              {currentUser.role === 'admin' && onEditTemplate && batch?.sheet_id && (
                <button
                  type="button"
                  onClick={() => onEditTemplate(batch.sheet_id)}
                  className="px-2.5 py-1.5 font-medium rounded flex items-center gap-1.5 transition-colors text-xs"
                  style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
                  title="Open this checksheet template in the builder"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Edit Template</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsCameraModalOpen(true)}
                className="px-2.5 py-1.5 font-medium rounded flex items-center gap-1.5 transition-colors text-xs"
                style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Photo</span>
              </button>

              <button
                type="button"
                onClick={() => setIsPrintModalOpen(true)}
                className="px-2.5 py-1.5 font-medium rounded flex items-center gap-1.5 transition-colors text-xs"
                style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Labels</span>
              </button>

              {currentUser.role === 'admin' && (
                <>
                  <button
                    type="button"
                    onClick={() => downloadBatchExport(batch.batch_id, 'pdf', batch.lot_number).catch((e) => setErrorMsg(e.message))}
                    className="px-2.5 py-1.5 font-medium rounded flex items-center gap-1.5 transition-colors text-xs"
                    style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>PDF</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => downloadBatchExport(batch.batch_id, 'xlsx', batch.lot_number).catch((e) => setErrorMsg(e.message))}
                    className="px-2.5 py-1.5 font-medium rounded flex items-center gap-1.5 transition-colors text-xs"
                    style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Excel</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Admin Role Assignment Panel */}
        {currentUser.role === 'admin' && isAssignMode && (
          <div style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
            <div className="px-5 pt-4 pb-1 flex items-center justify-between">
              <div>
                <span className="sv-label" style={{ marginBottom: 2 }}>Field Role Assignment</span>
                <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  Visual / tickbox checks → <strong>Operator</strong> &nbsp;·&nbsp; Dimension / measurement checks → <strong>Supervisor</strong>
                </p>
              </div>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                {template.control_items.filter(i => {
                  const r = i.item_id !== undefined ? (localRoles[i.item_id] ?? i.assigned_role) : i.assigned_role;
                  return r === 'supervisor';
                }).length} supervisor fields
              </span>
            </div>
            <div className="px-5 pb-4 space-y-1.5 max-h-72 overflow-y-auto">
              {template.control_items.map(item => {
                const currentRole = item.item_id !== undefined
                  ? (localRoles[item.item_id] ?? item.assigned_role ?? 'operator')
                  : (item.assigned_role ?? 'operator');
                const isSaving = item.item_id !== undefined && savingRoles.has(item.item_id);
                return (
                  <div key={item.item_id ?? item.serial_no}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: 'var(--surface2)', border: '1px solid var(--line)' }}
                  >
                    <span className="text-[11px] font-mono shrink-0" style={{ color: 'var(--muted)', minWidth: 24 }}>#{item.serial_no}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold truncate block" style={{ color: 'var(--ink)' }}>{item.control_item_name}</span>
                      <span className="text-[10px]" style={{ color: 'var(--muted)' }}>{item.application_method}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => item.item_id !== undefined && handleAssignRole(item.item_id, 'operator')}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
                        style={currentRole === 'operator'
                          ? { background: 'var(--accent-soft)', color: 'var(--accent)', border: '1.5px solid var(--accent)' }
                          : { background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--line)' }
                        }
                      >
                        Operator
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => item.item_id !== undefined && handleAssignRole(item.item_id, 'supervisor')}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
                        style={currentRole === 'supervisor'
                          ? { background: 'var(--ok-bg)', color: 'var(--ok)', border: '1.5px solid var(--ok)' }
                          : { background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--line)' }
                        }
                      >
                        Supervisor
                      </button>
                      {isSaving && (
                        <div className="w-3 h-3 border-2 rounded-full animate-spin shrink-0"
                          style={{ borderColor: 'var(--muted)', borderTopColor: 'transparent' }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Supervisor Item Overview Panel — only for SERIAL_TICKBOX batches */}
        {currentUser.role === 'supervisor' && isSupervisorTurn && (() => {
          const serialItems = template.control_items.filter((i) => i.row_mode === 'SERIAL_TICKBOX');
          if (serialItems.length === 0) return null;
          const serialCols = Array.isArray(serialItems[0].sample_columns) ? serialItems[0].sample_columns : [];

          // Per-column stats: for each col, check if any serial row has 'Fail'
          const colStats = serialCols.map((col) => {
            const hasPass = serialItems.some((row) => {
              const v = cellsMap[`${row.item_id}_${col}`]?.cell_value;
              return v === 'Pass' || v === 'true';
            });
            const hasFail = serialItems.some((row) => {
              const v = cellsMap[`${row.item_id}_${col}`]?.cell_value;
              return v === 'Fail';
            });
            const isEmpty = !hasPass && !hasFail;
            const overrideKey = `col_${col}`;
            const supChoice = supRevs[overrideKey] as string | undefined;
            return { col, hasPass, hasFail, isEmpty, overrideKey, supChoice };
          });

          const failedCols = colStats.filter((c) => c.hasFail);
          const overriddenCols = colStats.filter((c) => c.supChoice === 'overrule');
          const confirmedFailCols = colStats.filter((c) => c.supChoice === 'confirm');
          const passedCols = colStats.filter((c) => c.hasPass && !c.hasFail);

          return (
            <div className="px-5 py-4" style={{ borderTop: '1px solid var(--line)', background: '#fef9ed' }}>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-xs tracking-wide uppercase" style={{ color: 'var(--ink)' }}>
                  Item Inspection Summary — Supervisor View
                </h4>
                <div className="flex gap-3 text-[11px] font-semibold">
                  <span style={{ color: 'var(--ok)' }}>✓ {passedCols.length} Passed</span>
                  <span style={{ color: 'var(--ng)' }}>✗ {failedCols.length} Failed</span>
                  {overriddenCols.length > 0 && <span style={{ color: 'var(--accent)' }}>↩ {overriddenCols.length} Overridden</span>}
                  {confirmedFailCols.length > 0 && <span className="font-bold" style={{ color: 'var(--ng)' }}>⚑ {confirmedFailCols.length} Confirmed Fail</span>}
                </div>
              </div>
              <p className="text-[11px] mb-3" style={{ color: 'var(--muted)' }}>
                Review any items below. For failed items you disagree with, click <strong>Override</strong> to accept them.
                You may approve the batch as long as no failures are confirmed.
              </p>

              {/* Compact item grid */}
              <div className="flex flex-wrap gap-1.5">
                {colStats.map(({ col, hasPass, hasFail, isEmpty, overrideKey, supChoice }) => {
                  const isOverridden = supChoice === 'overrule';
                  const isConfirmedFail = supChoice === 'confirm';
                  const tileStyle = isOverridden
                    ? { border: '1px solid var(--accent)', background: 'var(--accent-soft)' }
                    : isConfirmedFail
                    ? { border: '1px solid var(--ng)', background: 'var(--ng-bg)' }
                    : hasFail
                    ? { border: '1px solid #f1b8b5', background: 'var(--ng-bg)' }
                    : hasPass
                    ? { border: '1px solid #b2dcc5', background: 'var(--ok-bg)' }
                    : { border: '1px solid var(--line)', background: 'var(--surface)' };
                  const iconColor = isOverridden ? 'var(--accent)'
                    : isConfirmedFail ? 'var(--ng)'
                    : hasFail ? 'var(--ng)'
                    : hasPass ? 'var(--ok)'
                    : 'var(--line2)';
                  return (
                    <div key={col} className="flex flex-col items-center rounded px-1 py-0.5 min-w-[32px]" style={tileStyle}>
                      <span className="text-[9px] font-mono leading-tight" style={{ color: 'var(--muted)' }}>{col}</span>
                      <span className="text-sm font-bold leading-none" style={{ color: iconColor }}>
                        {isOverridden ? '↩' : isConfirmedFail ? '⚑' : hasFail ? '✗' : hasPass ? '✓' : '○'}
                      </span>
                      {hasFail && !isOverridden && !isConfirmedFail && (
                        <button
                          type="button"
                          onClick={() => handleToggleFieldReview(overrideKey, 'overrule')}
                          className="text-[8px] font-bold px-0.5 mt-0.5 rounded transition-colors"
                          style={{ background: 'var(--surface)', border: '1px solid var(--accent)', color: 'var(--accent)' }}
                          title="Override — accept this failed item"
                        >OVR</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Zone B: Inspection Matrix */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="font-semibold text-[11px] uppercase tracking-wider" style={{ background: 'var(--surface2)', color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>
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
            <tbody>
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
                const rowStyle = isAssigned
                  ? { background: 'var(--surface)', color: 'var(--ink)', borderLeft: '3px solid var(--primary)' }
                  : { background: 'var(--surface2)', color: 'var(--muted)', borderLeft: '2px solid var(--line)', opacity: 0.65 };

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
                  <tr key={item.item_id || idx} className="transition-colors" style={{ ...rowStyle, borderBottom: '1px solid var(--line)' }}>
                    <td className="py-2.5 px-3 text-center font-mono font-bold" style={{ color: 'var(--muted)' }}>
                      {item.serial_no}
                    </td>
                    <td className="py-2.5 px-3 font-semibold" style={{ color: 'var(--ink)' }}>
                      {item.stage_name}
                    </td>
                    <td className="py-2.5 px-3 font-bold" style={{ color: 'var(--ink)' }}>
                      {item.control_item_name}
                      {item.is_required && <span className="ml-0.5" style={{ color: 'var(--ng)' }}>*</span>}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]" style={{ color: 'var(--ink)' }}>
                      {item.specification_content}
                      {item.min_val !== null && item.max_val !== null && (
                        <span className="block text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
                          [{item.min_val} ~ {item.max_val} {item.unit || ''}]
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3" style={{ color: 'var(--muted)' }}>
                      {item.application_method || '-'}
                    </td>

                    {/* Cell Input / Value */}
                    <td className="py-2.5 px-3">
                      {canEditCell ? (
                        item.html_input_type === 'pf' ? (
                          <div className="inline-flex rounded-lg p-0.5" style={{ border: '2px solid var(--line2)', background: 'var(--surface)' }}>
                            <button
                              type="button"
                              onClick={() => handleCellChange(item, firstColKey, 'Pass')}
                              className="px-3 py-1 rounded font-bold text-xs transition-all"
                              style={currentVal === 'Pass'
                                ? { background: 'var(--ok)', color: '#fff' }
                                : { color: 'var(--ink)' }}
                            >
                              Pass
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCellChange(item, firstColKey, 'Fail')}
                              className="px-3 py-1 rounded font-bold text-xs transition-all"
                              style={currentVal === 'Fail'
                                ? { background: 'var(--ng)', color: '#fff' }
                                : { color: 'var(--ink)' }}
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
                                  <span className="text-[9px] font-mono leading-none" style={{ color: 'var(--muted)' }}>{col}</span>
                                  <input
                                    type="checkbox"
                                    checked={isVerified}
                                    onChange={(e) => handleCellChange(item, chkKey, e.target.checked ? 'Pass' : '')}
                                    className="w-5 h-5 cursor-pointer"
                                    style={{ accentColor: 'var(--primary)' }}
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
                              className="w-28 rounded-lg px-2.5 py-1 text-xs font-mono font-bold focus:outline-none"
                              style={isOutOfSpec
                                ? { border: '2px dashed var(--ng)', background: 'var(--ng-bg)', color: 'var(--ng)' }
                                : { border: '2px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)' }}
                              placeholder="0.00"
                            />
                            {currentVal && (
                              <span
                                className="text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider"
                                style={isOutOfSpec
                                  ? { background: 'var(--ng)', color: '#fff' }
                                  : { background: 'var(--surface2)', color: 'var(--muted)' }}
                              >
                                {isOutOfSpec ? 'OUT OF SPEC' : 'OK'}
                              </span>
                            )}
                          </div>
                        ) : item.row_mode === 'SERIAL_TICKBOX' ? (
                          <div className="flex flex-wrap gap-1" style={{ minWidth: '320px' }}>
                            {sampleCols.map((col) => {
                              const colVal = cellsMap[`${item.item_id}_${col}`]?.cell_value || '';
                              const isPassed = colVal === 'Pass';
                              const isFailed = colVal === 'Fail';
                              return (
                                <div key={col} className="flex flex-col items-center gap-0.5">
                                  <span className="text-[9px] font-mono leading-none" style={{ color: 'var(--muted)' }}>{col}</span>
                                  <div className="inline-flex rounded overflow-hidden" style={{
                                    border: `1px solid ${isPassed ? 'var(--ok)' : isFailed ? 'var(--ng)' : 'var(--line2)'}`
                                  }}>
                                    <button
                                      type="button"
                                      onClick={() => handleCellChange(item, col, isPassed ? '' : 'Pass')}
                                      className="w-5 h-5 flex items-center justify-center text-[9px] font-bold transition-colors"
                                      style={isPassed ? { background: 'var(--ok)', color: '#fff' } : { color: 'var(--muted)' }}
                                      title={`Item ${col}: Pass`}
                                    >P</button>
                                    <button
                                      type="button"
                                      onClick={() => handleCellChange(item, col, isFailed ? '' : 'Fail')}
                                      className="w-5 h-5 flex items-center justify-center text-[9px] font-bold transition-colors"
                                      style={isFailed ? { background: 'var(--ng)', color: '#fff' } : { color: 'var(--muted)' }}
                                      title={`Item ${col}: Fail`}
                                    >F</button>
                                  </div>
                                </div>
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
                              className="w-5 h-5 cursor-pointer transition-transform active:scale-95"
                              style={{ accentColor: 'var(--primary)' }}
                            />
                            <span className="font-bold text-xs" style={{ color: 'var(--ink)' }}>
                              {currentVal === 'Pass' || currentVal === 'true' ? 'Passed' : 'Unticked'}
                            </span>
                          </label>
                        ) : (
                          <input
                            type="text"
                            value={currentVal}
                            onChange={(e) => handleCellChange(item, firstColKey, e.target.value)}
                            placeholder="Optional remark"
                            className="w-full rounded-lg px-2.5 py-1 text-xs font-medium focus:outline-none"
                            style={{ border: '2px solid var(--line2)', color: 'var(--ink)' }}
                          />
                        )
                      ) : item.row_mode === 'SERIAL_TICKBOX' ? (
                        <div className="flex flex-wrap gap-1" style={{ minWidth: '220px' }}>
                          {sampleCols.map((col) => {
                            const colVal = cellsMap[`${item.item_id}_${col}`]?.cell_value || '';
                            const isPassed = colVal === 'Pass' || colVal === 'true';
                            const isFailed = colVal === 'Fail';
                            return (
                              <div key={col} className="flex flex-col items-center gap-0.5">
                                <span className="text-[9px] font-mono leading-none" style={{ color: 'var(--muted)' }}>{col}</span>
                                <span className="text-sm font-bold leading-none" style={{
                                  color: isPassed ? 'var(--ok)' : isFailed ? 'var(--ng)' : 'var(--line2)'
                                }}>
                                  {isPassed ? '✓' : isFailed ? '✗' : '○'}
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
                                <span className="text-[9px] font-mono" style={{ color: 'var(--muted)' }}>{col}</span>
                                <span className="text-base leading-none font-bold" style={{ color: isVerified ? 'var(--ok)' : 'var(--line2)' }}>
                                  {isVerified ? '✓' : '○'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 font-mono">
                          <span className="font-bold" style={{ color: 'var(--ink)' }}>
                            {currentVal || <span className="font-normal italic" style={{ color: 'var(--muted)' }}>Empty</span>}
                          </span>
                          {currentVal && (
                            <span
                              className="text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider"
                              style={isOutOfSpec
                                ? { background: 'var(--ng)', color: '#fff' }
                                : { background: 'var(--surface2)', color: 'var(--muted)' }}
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
                          <div className="inline-flex rounded-lg p-0.5 gap-1" style={{ border: '1px solid var(--line2)', background: 'var(--surface2)' }}>
                            <button
                              type="button"
                              onClick={() => handleToggleFieldReview(String(item.item_id), 'confirm')}
                              className="px-2 py-0.5 rounded text-[11px] font-semibold transition-all"
                              style={supRevChoice === 'confirm'
                                ? { background: 'var(--ng)', color: '#fff' }
                                : { color: 'var(--muted)' }}
                            >
                              Confirm Fail
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleFieldReview(String(item.item_id), 'overrule')}
                              className="px-2 py-0.5 rounded text-[11px] font-semibold transition-all"
                              style={supRevChoice === 'overrule'
                                ? { background: 'var(--ok)', color: '#fff' }
                                : { color: 'var(--muted)' }}
                            >
                              Overrule
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>-</span>
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
          <div className="p-5" style={{ borderTop: '1px solid var(--line)', background: 'var(--surface2)' }}>
            <h4 className="font-bold text-xs mb-2" style={{ color: 'var(--ink)' }}>Attached Photo Evidence ({batch.attachments.length})</h4>
            <div className="flex flex-wrap gap-3">
              {batch.attachments.map((att) => (
                <div key={att.attachment_id} className="relative group rounded overflow-hidden" style={{ border: '1px solid var(--line)', background: 'var(--surface)' }}>
                  <img
                    src={att.file_path}
                    alt={att.file_name || 'Inspection Photo'}
                    className="w-24 h-24 object-cover"
                  />
                  <div className="absolute inset-0 text-white opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-1.5 text-[10px]"
                    style={{ background: 'rgba(27,37,51,0.6)' }}>
                    <span className="truncate">{att.file_name}</span>
                    <span className="text-[9px]" style={{ color: 'var(--line2)' }}>{att.capture_source}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error message */}
        {errorMsg && (
          <div className="mx-5 mb-4 p-3 rounded flex items-center gap-2" style={{ background: 'var(--ng-bg)', color: 'var(--ng)', border: '1px solid #f1b8b5' }}>
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Operator Completion Progress Bar */}
        {currentUser.role === 'operator' && !batch.operator_submitted_at && (
          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ background: 'var(--surface2)', borderTop: '1px solid var(--line)' }}>
            <div className="flex-1 max-w-sm">
              <div className="flex justify-between text-xs font-semibold mb-1">
                <span style={{ color: 'var(--muted)' }}>
                  {hasSerialRows ? 'Items Inspected' : 'Checksheet Progress'}
                </span>
                <span className="font-bold" style={{ color: 'var(--ink)' }}>
                  {hasSerialRows
                    ? `${serialCompletedItems} / ${serialTotalItems} items (${percentComplete}%)`
                    : `${completedRequired} of ${totalRequired} (${percentComplete}%)`}
                </span>
              </div>
              <div className="w-full rounded-full h-2 overflow-hidden" style={{ background: 'var(--line)' }}>
                <div
                  className="h-full transition-all duration-300"
                  style={{ width: `${percentComplete}%`, background: percentComplete === 100 ? 'var(--ok)' : 'var(--primary)' }}
                ></div>
              </div>
            </div>
            <div className="text-xs">
              {percentComplete === 100 ? (
                <span className="font-bold flex items-center gap-1.5" style={{ color: 'var(--ok)' }}>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>All required parameters recorded. Ready to submit.</span>
                </span>
              ) : (
                <span className="font-medium" style={{ color: 'var(--muted)' }}>
                  {hasSerialRows
                    ? `Check all ${serialTotalItems} items (P or F) to submit.`
                    : `Complete all ${totalRequired} mandatory parameters to sign off.`}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Actions Bar */}
        <div className="p-5 flex flex-wrap items-center justify-between gap-4" style={{ borderTop: '1px solid var(--line)', background: 'var(--surface2)' }}>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {currentUser.role === 'operator' && !batch.operator_submitted_at && (
              <span>Complete all fields. Submitting notifies Supervisor and Admin.</span>
            )}
            {currentUser.role === 'supervisor' && (
              <span>
                {hasConfirmedRejections ? (
                  <span className="font-semibold" style={{ color: 'var(--ng)' }}>
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
                  className="px-4 py-2 font-semibold rounded flex items-center gap-1.5 transition-colors disabled:opacity-50 text-xs"
                  style={{ background: 'var(--ok-bg)', color: 'var(--ok)', border: '1px solid #b2dcc5' }}
                  title="Mark all checkboxes and Pass/Fail fields as Pass at once"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{isPassingAll ? 'Applying...' : 'Pass All'}</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleOperatorRejectClick}
                  className="px-4 py-2 font-semibold rounded flex items-center gap-1.5 transition-colors disabled:opacity-50 text-xs"
                  style={{ background: 'var(--ng-bg)', color: 'var(--ng)', border: '1px solid #f1b8b5' }}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Reject Batch</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleOperatorApprove}
                  className="px-5 py-2 font-semibold rounded flex items-center gap-1.5 transition-colors disabled:opacity-50 text-xs"
                  style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
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
                  className="px-4 py-2 font-semibold rounded flex items-center gap-1.5 transition-colors disabled:opacity-50 text-xs"
                  style={{ background: 'var(--ok-bg)', color: 'var(--ok)', border: '1px solid #b2dcc5' }}
                  title="Mark all supervisor-assigned Pass/Fail and checkbox fields as Pass at once"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{isPassingAll ? 'Applying...' : 'Pass All'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsHoldModalOpen(true)}
                  className="px-4 py-2 font-semibold rounded flex items-center gap-1.5 transition-colors text-xs"
                  style={{ background: 'var(--warn-bg)', color: 'var(--warn)', border: '1px solid #e0b65a' }}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Put on Hold</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleSupervisorReject}
                  className="px-4 py-2 font-semibold rounded flex items-center gap-1.5 transition-colors disabled:opacity-50 text-xs"
                  style={{ background: 'var(--ng-bg)', color: 'var(--ng)', border: '1px solid #f1b8b5' }}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Reject Batch</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting || hasConfirmedRejections}
                  onClick={handleSupervisorApprove}
                  title={hasConfirmedRejections ? 'Cannot approve: rejections confirmed failing' : 'Approve and sign off'}
                  className="px-5 py-2 font-semibold rounded flex items-center gap-1.5 transition-colors disabled:opacity-50 text-xs"
                  style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
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
      <div className="p-5 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <h3 className="font-bold text-sm" style={{ color: 'var(--ink)' }}>Approval Record (Sign-Off Ledger)</h3>
        {batch.decisions && batch.decisions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="font-semibold text-[11px]" style={{ background: 'var(--surface2)', color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>
                  <th className="py-2 px-3">Round</th>
                  <th className="py-2 px-3">Stage</th>
                  <th className="py-2 px-3">By</th>
                  <th className="py-2 px-3">Decision</th>
                  <th className="py-2 px-3">When</th>
                  <th className="py-2 px-3">Remarks / Failed Items</th>
                </tr>
              </thead>
              <tbody>
                {batch.decisions.map((dec) => (
                  <tr key={dec.decision_id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="py-2 px-3 font-mono font-bold" style={{ color: 'var(--muted)' }}>{dec.round}</td>
                    <td className="py-2 px-3 font-medium" style={{ color: 'var(--ink)' }}>{dec.stage}</td>
                    <td className="py-2 px-3" style={{ color: 'var(--ink)' }}>
                      {dec.decided_by_name || `User #${dec.decided_by}`}
                      <span className="text-[10px] ml-1" style={{ color: 'var(--muted)' }}>({dec.role})</span>
                    </td>
                    <td className="py-2 px-3 font-bold">
                      <span style={{
                        color: dec.decision.toLowerCase().includes('approv')
                          ? 'var(--ok)'
                          : dec.decision.toLowerCase().includes('reject')
                          ? 'var(--ng)'
                          : 'var(--warn)'
                      }}>
                        {dec.decision}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px]" style={{ color: 'var(--muted)' }}>
                      {dec.decided_at ? new Date(dec.decided_at).toLocaleString() : '-'}
                    </td>
                    <td className="py-2 px-3" style={{ color: 'var(--muted)' }}>
                      {dec.remarks || '-'}
                      {dec.rejected_fields && dec.rejected_fields.length > 0 && (
                        <span className="block text-[10px]" style={{ color: 'var(--ng)' }}>
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
          <p className="text-xs italic" style={{ color: 'var(--muted)' }}>
            No sign-offs recorded yet. All approvals, rejections, holds, and releases are permanently logged here.
          </p>
        )}
      </div>

      {/* Supervisor Hold Modal (FR-055) */}
      {isHoldModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print backdrop-blur-sm" style={{ background: 'rgba(27,37,51,0.4)' }}>
          <div className="w-full max-w-md shadow-lg overflow-hidden text-xs" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--ink)' }}>Put Batch On Hold (Quarantine)</h3>
              <button onClick={() => setIsHoldModalOpen(false)} className="p-1" style={{ color: 'var(--muted)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSupervisorHoldSubmit} className="p-5 space-y-3.5">
              <div>
                <label className="font-semibold block mb-1" style={{ color: 'var(--ink)' }}>Reason Category:</label>
                <select
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-xs focus:outline-none"
                  style={{ border: '1px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)' }}
                >
                  {HOLD_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold block mb-1" style={{ color: 'var(--ink)' }}>Note (What are you waiting for?):</label>
                <textarea
                  rows={2}
                  value={holdNote}
                  onChange={(e) => setHoldNote(e.target.value)}
                  placeholder="e.g. X-ray sample sent to lab for void check"
                  className="w-full rounded-lg p-2.5 text-xs focus:outline-none"
                  style={{ border: '1px solid var(--line2)', color: 'var(--ink)' }}
                  required
                />
              </div>

              <div>
                <label className="font-semibold block mb-1" style={{ color: 'var(--ink)' }}>Review by:</label>
                <select
                  value={holdHours}
                  onChange={(e) => setHoldHours(Number(e.target.value))}
                  className="w-full rounded-lg px-3 py-2 text-xs focus:outline-none"
                  style={{ border: '1px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)' }}
                >
                  {REVIEW_BY_OPTIONS.map((opt) => (
                    <option key={opt.hours} value={opt.hours}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 pt-2" style={{ borderTop: '1px solid var(--line)' }}>
                <button
                  type="button"
                  onClick={() => setIsHoldModalOpen(false)}
                  className="flex-1 py-2 font-medium rounded"
                  style={{ background: 'var(--surface2)', color: 'var(--ink)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 font-semibold rounded disabled:opacity-50"
                  style={{ background: 'var(--warn)', color: '#fff' }}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print backdrop-blur-sm" style={{ background: 'rgba(27,37,51,0.4)' }}>
          <div className="w-full max-w-md shadow-lg overflow-hidden text-xs" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--ink)' }}>Release Hold on {batch.lot_number}</h3>
              <button onClick={() => setIsReleaseModalOpen(false)} className="p-1" style={{ color: 'var(--muted)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleReleaseHoldSubmit} className="p-5 space-y-4">
              <div>
                <label className="font-semibold block mb-2" style={{ color: 'var(--ink)' }}>Release Outcome:</label>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 p-2 rounded cursor-pointer" style={{ border: '1px solid var(--line)' }}>
                    <input
                      type="radio"
                      name="relOutcome"
                      value="approve"
                      checked={releaseOutcome === 'approve'}
                      onChange={() => setReleaseOutcome('approve')}
                    />
                    <span className="font-semibold" style={{ color: 'var(--ink)' }}>Approve batch (Concession / Lab Cleared)</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 rounded cursor-pointer" style={{ border: '1px solid var(--line)' }}>
                    <input
                      type="radio"
                      name="relOutcome"
                      value="reject"
                      checked={releaseOutcome === 'reject'}
                      onChange={() => setReleaseOutcome('reject')}
                    />
                    <span className="font-semibold" style={{ color: 'var(--ink)' }}>Reject batch</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 rounded cursor-pointer" style={{ border: '1px solid var(--line)' }}>
                    <input
                      type="radio"
                      name="relOutcome"
                      value="reinspect"
                      checked={releaseOutcome === 'reinspect'}
                      onChange={() => setReleaseOutcome('reinspect')}
                    />
                    <div>
                      <span className="font-semibold block" style={{ color: 'var(--ink)' }}>Send back for reinspection</span>
                      <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                        Increments round (Round {(batch.round || 1) + 1}) and allows Operator to re-inspect.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label className="font-semibold block mb-1" style={{ color: 'var(--ink)' }}>Release Note:</label>
                <textarea
                  rows={2}
                  value={releaseNote}
                  onChange={(e) => setReleaseNote(e.target.value)}
                  placeholder="e.g. Lab result received, voids within allowable limit"
                  className="w-full rounded-lg p-2.5 text-xs focus:outline-none"
                  style={{ border: '1px solid var(--line2)', color: 'var(--ink)' }}
                  required
                />
              </div>

              <div className="flex gap-2 pt-2" style={{ borderTop: '1px solid var(--line)' }}>
                <button
                  type="button"
                  onClick={() => setIsReleaseModalOpen(false)}
                  className="flex-1 py-2 font-medium rounded"
                  style={{ background: 'var(--surface2)', color: 'var(--ink)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 font-semibold rounded disabled:opacity-50"
                  style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
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
