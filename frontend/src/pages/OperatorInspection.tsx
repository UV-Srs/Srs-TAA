import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, X, AlertCircle, Loader2, Lock } from 'lucide-react';
import { InspectionBatch, User, ControlItem, CellResponse, OfflineMutation } from '../types';
import { fetchBatchDetail, submitOperatorBatch, syncOfflineQueue } from '../api';
import {
  saveCellOffline, getOfflineCellsForBatch, cacheBatchOffline, getCachedBatchOffline,
  getQueuedMutations, removeQueuedMutations,
} from '../db';
import { onBatchUpdated as onLiveBatchUpdated, onCellUpdated } from '../liveSync';
import { ChecksheetView } from './ChecksheetView';

/**
 * Operator piece-by-piece inspection ("Item n of N").
 *
 * Storage model (no schema change):
 *  - Pass/fail checks (pf, checkbox, SERIAL_TICKBOX) get one cell per piece: column_key = piece number ("1".."N").
 *  - Lot-level fields (numeric samples, text) keep their template sample_columns (S1..S5, val, Notes).
 *  - On submit, any pass/fail sample_columns that aren't piece numbers (e.g. "val") get an aggregate
 *    value so the backend's full-sheet completion check passes, then the existing operator submit runs.
 */

interface OperatorInspectionProps {
  batchId: number;
  currentUser: User;
  onBack: () => void;
  onBatchUpdated?: () => void;
  onSubmitted?: () => void;
}

type PassFail = 'Pass' | 'Fail';
type PieceState = 'unchecked' | 'good' | 'bad';

const isFailValue = (v?: string | null) => !!v && ['fail', 'false', '0'].includes(String(v).trim().toLowerCase());
const hasValue = (c?: CellResponse) => !!c && c.cell_value !== null && c.cell_value !== undefined && String(c.cell_value).trim() !== '';

const isPassFailItem = (i: ControlItem) =>
  i.html_input_type === 'pf' || i.html_input_type === 'checkbox' || i.row_mode === 'SERIAL_TICKBOX';

const isOperatorItem = (i: ControlItem) =>
  i.assigned_role !== 'supervisor' && i.editable_by_operator !== false && i.visible_to_operator !== false;

const isOutOfSpec = (item: ControlItem, val?: string | null) => {
  if (!val || !String(val).trim()) return false;
  if (item.row_mode === 'NUMERIC_SAMPLE' || item.html_input_type === 'number') {
    const n = parseFloat(val);
    if (isNaN(n)) return true;
    if (item.min_val !== null && item.min_val !== undefined && n < item.min_val) return true;
    if (item.max_val !== null && item.max_val !== undefined && n > item.max_val) return true;
    return false;
  }
  return isFailValue(val);
};

const formatDate = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const OperatorInspection: React.FC<OperatorInspectionProps> = ({
  batchId, currentUser, onBack, onBatchUpdated, onSubmitted,
}) => {
  const [batch, setBatch] = useState<InspectionBatch | null>(null);
  const [cells, setCells] = useState<Record<string, CellResponse>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const [current, setCurrent] = useState(1);
  const [draft, setDraft] = useState<Record<number, PassFail>>({});
  const [view, setView] = useState<'piece' | 'finish'>('piece');
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [isListOpen, setIsListOpen] = useState(false);
  const initialisedFor = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const initials = currentUser.username.substring(0, 2).toUpperCase();

  // ---------- Loading & live updates ----------
  const loadBatch = useCallback(async () => {
    try {
      setErrorMsg(null);
      let data: InspectionBatch;
      try {
        data = await fetchBatchDetail(batchId);
        await cacheBatchOffline(data);
      } catch (networkErr) {
        const cached = await getCachedBatchOffline(batchId);
        if (!cached) throw networkErr;
        data = cached;
      }
      const map: Record<string, CellResponse> = {};
      (data.cell_responses || []).forEach((c) => { map[`${c.item_id}_${c.column_key}`] = c; });
      (await getOfflineCellsForBatch(batchId)).forEach((c) => { map[`${c.item_id}_${c.column_key}`] = c; });
      setBatch(data);
      setCells(map);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load this lot.');
    } finally {
      setIsLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    setIsLoading(true);
    initialisedFor.current = null;
    loadBatch();
    const unsubBatch = onLiveBatchUpdated((d) => { if (d.batch_id === batchId) loadBatch(); });
    const unsubCell = onCellUpdated((d) => {
      if (d.batch_id !== batchId) return;
      setCells((prev) => ({
        ...prev,
        [`${d.item_id}_${d.column_key}`]: {
          batch_id: d.batch_id, item_id: d.item_id, column_key: d.column_key,
          cell_value: d.cell_value, is_within_spec: d.is_within_spec,
          checker_initials: d.checker_initials, updated_at: d.updated_at,
        },
      }));
    });
    return () => { unsubBatch(); unsubCell(); };
  }, [batchId, loadBatch]);

  // Submitted / closed lots are shown in the same layout, read-only
  const isLocked = !!batch && (!!batch.operator_submitted_at || ['APPROVED', 'REJECTED'].includes(batch.status));

  // ---------- Derived template data ----------
  const items = useMemo(() => {
    const list = batch?.template?.control_items ? [...batch.template.control_items] : [];
    return list.sort((a, b) => (a.display_order ?? a.serial_no) - (b.display_order ?? b.serial_no));
  }, [batch]);
  const checks = useMemo(() => items.filter((i) => isOperatorItem(i) && isPassFailItem(i)), [items]);
  const lotFields = useMemo(() => items.filter((i) => isOperatorItem(i) && !isPassFailItem(i)), [items]);

  const pieceCount = useMemo(() => {
    if (batch?.lot_quantity && batch.lot_quantity > 0) return batch.lot_quantity;
    const serialCols = checks.map((c) => (Array.isArray(c.sample_columns) ? c.sample_columns.length : 0));
    return Math.max(1, ...serialCols);
  }, [batch, checks]);

  const pieceStates: PieceState[] = useMemo(() => {
    const out: PieceState[] = [];
    for (let n = 1; n <= pieceCount; n++) {
      let checked = checks.length > 0;
      let bad = false;
      for (const c of checks) {
        const cell = cells[`${c.item_id}_${n}`];
        if (!hasValue(cell)) { checked = false; break; }
        if (isFailValue(cell!.cell_value)) bad = true;
      }
      out.push(!checked ? 'unchecked' : bad ? 'bad' : 'good');
    }
    return out;
  }, [cells, checks, pieceCount]);

  const goodCount = pieceStates.filter((s) => s === 'good').length;
  const badCount = pieceStates.filter((s) => s === 'bad').length;
  const checkedCount = goodCount + badCount;
  const badPieces = pieceStates.map((s, i) => (s === 'bad' ? i + 1 : 0)).filter(Boolean);
  const firstUnchecked = pieceStates.findIndex((s) => s === 'unchecked') + 1; // 0 = none

  // Start on the first unchecked piece (or the finish screen when everything is done)
  useEffect(() => {
    if (!batch || initialisedFor.current === batch.batch_id || checks.length === 0) return;
    initialisedFor.current = batch.batch_id;
    if (isLocked) { setCurrent(1); setView('finish'); return; }
    if (firstUnchecked > 0) { setCurrent(firstUnchecked); setView('piece'); }
    else { setCurrent(pieceCount); setView('finish'); }
  }, [batch, checks.length, firstUnchecked, pieceCount, isLocked]);

  // Keep the current piece visible in the item list
  useEffect(() => {
    listRef.current?.querySelector(`[data-piece="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current, isListOpen]);

  const valueFor = (item: ControlItem, n: number, useDraft = true): PassFail => {
    if (useDraft && n === current && draft[item.item_id!]) return draft[item.item_id!];
    const cell = cells[`${item.item_id}_${n}`];
    return hasValue(cell) && isFailValue(cell!.cell_value) ? 'Fail' : 'Pass';
  };
  const currentProblems = checks.filter((c) => valueFor(c, current) === 'Fail').length;
  const cardState = (item: ControlItem): 'pass' | 'fail' => {
    if (isLocked && !hasValue(cells[`${item.item_id}_${current}`])) {
      const cols = Array.isArray(item.sample_columns) ? item.sample_columns : [];
      return cols.some((col) => isFailValue(cells[`${item.item_id}_${col}`]?.cell_value)) ? 'fail' : 'pass';
    }
    return valueFor(item, current) === 'Fail' ? 'fail' : 'pass';
  };

  // ---------- Saving ----------
  /** Save cells locally (IndexedDB queue) first, then push them to the server in one request. */
  const saveCells = async (entries: { item: ControlItem; column: string; value: string }[]) => {
    if (!batch || entries.length === 0) return;
    const now = new Date().toISOString();
    const mutations: OfflineMutation[] = [];
    const nextCells: Record<string, CellResponse> = {};
    for (const e of entries) {
      const id = crypto.randomUUID();
      const m: OfflineMutation = {
        client_mutation_id: id, batch_id: batch.batch_id, item_id: e.item.item_id!,
        column_key: e.column, cell_value: e.value, checker_initials: initials, timestamp: now,
      };
      const ok = !isOutOfSpec(e.item, e.value);
      await saveCellOffline(m, ok);
      mutations.push(m);
      nextCells[`${e.item.item_id}_${e.column}`] = {
        batch_id: batch.batch_id, item_id: e.item.item_id!, column_key: e.column, cell_value: e.value,
        is_within_spec: ok, checker_initials: initials, client_mutation_id: id, updated_at: now,
      };
    }
    setCells((prev) => ({ ...prev, ...nextCells }));

    if (!navigator.onLine) { setSyncNote('Offline: results are saved on this device and will sync automatically.'); return; }
    try {
      const res = await syncOfflineQueue(mutations);
      if (res?.success) await removeQueuedMutations(mutations.map((m) => m.client_mutation_id));
      setSyncNote(null);
    } catch {
      setSyncNote('Could not reach the server: results are saved on this device and will sync automatically.');
    }
  };

  /** Commit the current piece (defaults to Pass for anything not tapped). Only writes what changed. */
  const commitPiece = async (n: number, force: boolean) => {
    if (isLocked) return;
    const isChecked = pieceStates[n - 1] !== 'unchecked';
    if (!force && (!isChecked || Object.keys(draft).length === 0)) return;
    const entries = checks
      .map((c) => ({ item: c, column: String(n), value: valueFor(c, n) as string }))
      .filter((e) => {
        const saved = cells[`${e.item.item_id}_${n}`];
        return !hasValue(saved) || (isFailValue(saved!.cell_value) ? 'Fail' : 'Pass') !== e.value;
      });
    await saveCells(entries);
  };

  const navigate = async (target: number | 'finish', commitCurrent: boolean) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (view === 'piece') await commitPiece(current, commitCurrent);
      setDraft({});
      if (target === 'finish') setView('finish');
      else { setCurrent(Math.min(Math.max(1, target), pieceCount)); setView('piece'); }
      setIsListOpen(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleNext = () => navigate(current < pieceCount ? current + 1 : 'finish', true);
  const handlePrev = () => navigate(current - 1, false);
  const handleJump = (n: number) => navigate(n, false);

  const toggleCheck = (item: ControlItem) => {
    if (isLocked) return;
    const next: PassFail = valueFor(item, current) === 'Pass' ? 'Fail' : 'Pass';
    setDraft((d) => ({ ...d, [item.item_id!]: next }));
  };

  // ---------- Lot-level fields (measurements / notes) ----------
  const lotFieldCells = lotFields.flatMap((f) =>
    (Array.isArray(f.sample_columns) && f.sample_columns.length ? f.sample_columns : ['val']).map((col) => ({ item: f, col }))
  );
  const missingLotFields = lotFieldCells.filter(({ item, col }) => item.is_required && !hasValue(cells[`${item.item_id}_${col}`]));

  const [fieldDrafts, setFieldDrafts] = useState<Record<string, string>>({});
  const saveLotField = async (item: ControlItem, col: string) => {
    const key = `${item.item_id}_${col}`;
    if (!(key in fieldDrafts)) return;
    const value = fieldDrafts[key];
    if ((cells[key]?.cell_value ?? '') === value) return;
    await saveCells([{ item, column: col, value }]);
  };

  // ---------- Submit ----------
  const canSubmit = firstUnchecked === 0 && missingLotFields.length === 0 && !isSubmitting;

  const handleSubmit = async () => {
    if (!batch || !canSubmit) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      // 1. Aggregate values for pass/fail template columns that aren't piece numbers (e.g. "val")
      const failedCheck = (c: ControlItem) => {
        for (let n = 1; n <= pieceCount; n++) if (isFailValue(cells[`${c.item_id}_${n}`]?.cell_value)) return true;
        return false;
      };
      const summary: { item: ControlItem; column: string; value: string }[] = [];
      for (const c of checks) {
        const cols = Array.isArray(c.sample_columns) ? c.sample_columns : [];
        for (const col of cols) {
          const asNum = Number(col);
          if (Number.isInteger(asNum) && asNum >= 1 && asNum <= pieceCount) continue; // a real piece cell
          summary.push({ item: c, column: String(col), value: failedCheck(c) ? 'Fail' : 'Pass' });
        }
      }
      await saveCells(summary);

      // 2. Everything for this lot must be on the server before the decision is recorded
      const queued = (await getQueuedMutations()).filter((m) => m.batch_id === batch.batch_id);
      if (queued.length > 0) {
        const res = await syncOfflineQueue(queued);
        if (!res?.success) throw new Error('Some results have not synced yet. Check the connection and try again.');
        await removeQueuedMutations(queued.map((m) => m.client_mutation_id));
      }

      // 3. Decision: any bad piece or out-of-spec measurement => submitted with NG items for the supervisor
      const failedIds = [
        ...checks.filter(failedCheck),
        ...lotFields.filter((f) => lotFieldCells.some(({ item, col }) => item === f && isOutOfSpec(f, cells[`${f.item_id}_${col}`]?.cell_value))),
      ].map((i) => i.item_id!);

      const lotCells = [...summary.map((s) => ({ item_id: s.item.item_id!, column_key: s.column, cell_value: s.value })),
        ...lotFieldCells.filter(({ item, col }) => hasValue(cells[`${item.item_id}_${col}`]))
          .map(({ item, col }) => ({ item_id: item.item_id!, column_key: col, cell_value: cells[`${item.item_id}_${col}`].cell_value }))];

      const ngNote = badPieces.length
        ? `NG items: ${badPieces.slice(0, 50).map((n) => `#${n}`).join(', ')}${badPieces.length > 50 ? ` (+${badPieces.length - 50} more)` : ''} — ${badPieces.length} of ${pieceCount} segregated.`
        : '';
      const fullRemarks = [ngNote, remarks.trim()].filter(Boolean).join('\n');

      await submitOperatorBatch(batch.batch_id, {
        decision: failedIds.length === 0 ? 'APPROVE' : 'REJECT',
        rejected_item_ids: failedIds.length ? failedIds : undefined,
        remarks: fullRemarks || undefined,
        cells: lotCells.map((c) => ({ ...c, checker_initials: initials })),
      });

      onBatchUpdated?.();
      onSubmitted?.();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit the inspection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---------- Render guards ----------
  if (isLoading && !batch) {
    return (
      <div className="py-24 flex items-center justify-center text-slate-500 gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading lot…
      </div>
    );
  }
  if (!batch || !batch.template) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-4">
        <BackButton onBack={onBack} />
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl text-sm">{errorMsg || 'This lot could not be loaded.'}</div>
      </div>
    );
  }

  // Templates with no pass/fail checks keep the full checksheet
  if (checks.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-5 sm:px-6 sm:py-8 space-y-4">
        <BackButton onBack={onBack} />
        <ChecksheetView batchId={batch.batch_id} currentUser={currentUser} onBatchUpdated={onBatchUpdated} />
      </div>
    );
  }

  const template = batch.template;
  const partLabel = [template.part_no, batch.product_name || template.part_name].filter(Boolean).join(' · ') || template.document_title;
  const pct = pieceCount ? Math.round((checkedCount / pieceCount) * 100) : 0;

  // ---------- Pieces list (sidebar on desktop, collapsible on mobile) ----------
  const pieceList = (
    <div ref={listRef} className="overflow-y-auto overscroll-contain">
      {pieceStates.map((state, i) => {
        const n = i + 1;
        const isNow = view === 'piece' && n === current;
        return (
          <button
            key={n}
            type="button"
            data-piece={n}
            onClick={() => handleJump(n)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm transition-colors ${
              isNow ? 'bg-brand-soft text-brand font-semibold' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            <StatusBox state={state} />
            <span className="flex-1">Item {n}</span>
            <span className={`text-xs font-semibold ${isNow ? 'text-brand' : state === 'bad' ? 'text-red-600' : state === 'good' ? 'text-emerald-600' : 'text-slate-400'}`}>
              {isNow ? 'Now' : state === 'bad' ? 'Bad' : state === 'good' ? 'Good' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );

  const progressBlock = (
    <>
      <div className="text-sm text-slate-500">Progress</div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-4xl lg:text-5xl font-light text-slate-900 tabular-nums">{checkedCount}</span>
        <span className="text-xl lg:text-2xl font-light text-slate-500">/ {pieceCount}</span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-slate-200 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex gap-2 mt-3">
        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">{goodCount} good</span>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${badCount ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{badCount} bad</span>
      </div>
    </>
  );

  return (
    <div className="bg-canvas">
      {/* ---------- Lot strip ---------- */}
      <div className="bg-white border-b border-slate-200">
        <div className="grid grid-cols-3 lg:flex lg:items-stretch">
          <div className="col-span-3 lg:col-auto flex items-center gap-3 px-4 pt-3 pb-1 sm:py-3 sm:border-b lg:border-b-0 border-slate-100">
            <button
              type="button"
              onClick={onBack}
              title="Back to my lots"
              aria-label="Back to my lots"
              className="w-10 h-10 shrink-0 rounded-lg bg-brand-soft text-brand hover:bg-brand hover:text-white flex items-center justify-center transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-[11px] font-medium tracking-wider uppercase text-slate-500">Lot barcode</div>
              <div className="text-base sm:text-lg font-semibold text-slate-900 truncate">{batch.lot_number}</div>
            </div>
          </div>
          <StripCell label="Line" value={batch.line_name || '—'} className="hidden sm:block lg:border-l" />
          <StripCell label="Part" value={partLabel} className="col-span-3 sm:col-span-2 lg:col-auto lg:flex-1 lg:border-l" />
          <StripCell label="Items" value={String(pieceCount)} className="hidden lg:block lg:border-l" />
          <StripCell label="Date" value={formatDate(batch.created_at)} className="hidden sm:block lg:border-l" />
          <StripCell label="Checked" value={`${checkedCount} / ${pieceCount}`} className="hidden lg:block lg:border-l" valueClass="text-brand" />
        </div>
      </div>

      {isLocked && <LockedBanner batch={batch} />}

      <div className="lg:flex">
        {/* ---------- Sidebar (lg+) ---------- */}
        <aside className="hidden lg:flex flex-col w-72 xl:w-80 shrink-0 bg-white border-r border-slate-200 sticky top-20 self-start h-[calc(100dvh-5rem)]">
          <div className="p-5 border-b border-slate-100">{progressBlock}</div>
          <div className="flex-1 min-h-0 flex flex-col p-2">{pieceList}</div>
          <div className="p-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => navigate('finish', false)}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                view === 'finish' ? 'bg-brand text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {isLocked ? 'Summary' : <>Review &amp; submit</>}
            </button>
          </div>
        </aside>

        {/* ---------- Main ---------- */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Mobile / tablet progress + item list */}
          <div className="lg:hidden bg-white border-b border-slate-200 px-4 py-3">
            {/* Compact one-row progress: the full progress block lives in the lg+ sidebar */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-2xl font-semibold text-slate-900 tabular-nums">{checkedCount}</span>
                  <span className="text-sm text-slate-500">/ {pieceCount} checked</span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700">{goodCount} good</span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${badCount ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{badCount} bad</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-200 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsListOpen(!isListOpen)}
                aria-expanded={isListOpen}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium"
              >
                All items
                <ChevronDown className={`w-4 h-4 transition-transform ${isListOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {isListOpen && (
              <div className="mt-3 max-h-72 flex flex-col border border-slate-200 rounded-xl p-1.5">
                {pieceList}
                <button
                  type="button"
                  onClick={() => navigate('finish', false)}
                  className="mt-1.5 w-full py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-semibold"
                >
                  {isLocked ? 'Summary' : <>Review &amp; submit</>}
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 px-4 sm:px-8 py-4 sm:py-8">
            {(errorMsg || syncNote) && (
              <div className={`mb-5 p-3 rounded-xl text-sm flex items-start gap-2 border ${errorMsg ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{errorMsg || syncNote}</span>
              </div>
            )}

            {view === 'piece' ? (
              <>
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-3 mb-4 sm:mb-6">
                  <div>
                    <h2 className="text-2xl sm:text-4xl font-semibold text-slate-900 tracking-tight">
                      Item {current} <span className="font-normal text-slate-500">of {pieceCount}</span>
                    </h2>
                    <p className="mt-1 text-slate-500">
                      {pieceStates[current - 1] === 'unchecked'
                        ? isLocked ? 'Showing the lot result for each check' : 'Not checked yet'
                        : currentProblems > 0
                        ? `Checked · ${currentProblems} problem${currentProblems > 1 ? 's' : ''}`
                        : 'Checked · good'}
                    </p>
                  </div>
                  {isLocked ? (
                    <span className="self-start inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-200/70 text-slate-600 text-sm font-medium">
                      <Lock className="w-3.5 h-3.5" /> Read-only
                    </span>
                  ) : (
                    <span className="self-start px-4 py-2 rounded-full bg-brand-soft text-brand text-sm font-medium">
                      Look at the part. Tap only what's wrong.
                    </span>
                  )}
                </div>

                <h3 className="text-xs font-semibold tracking-widest uppercase text-slate-500 mb-3">Visual checks</h3>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {checks.map((item, idx) => (
                    <CheckCard key={item.item_id} index={idx + 1} item={item} state={cardState(item)} readOnly={isLocked} onToggle={() => toggleCheck(item)} />
                  ))}
                </div>
              </>
            ) : (
              <FinishPanel
                pieceCount={pieceCount}
                goodCount={goodCount}
                badPieces={badPieces}
                firstUnchecked={firstUnchecked}
                uncheckedCount={pieceCount - checkedCount}
                lotFieldCells={lotFieldCells}
                cells={cells}
                fieldDrafts={fieldDrafts}
                setFieldDraft={(key, v) => setFieldDrafts((d) => ({ ...d, [key]: v }))}
                saveLotField={saveLotField}
                missingCount={missingLotFields.length}
                remarks={remarks}
                setRemarks={setRemarks}
                onJump={handleJump}
                readOnly={isLocked}
                batch={batch}
                checks={checks}
                pieceStates={pieceStates}
              />
            )}
          </div>

          {/* ---------- Sticky action bar ---------- */}
          <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-slate-200 px-4 sm:px-8 py-3 flex items-center justify-end gap-3 no-print">
            {view === 'piece' ? (
              <>
                <button
                  type="button"
                  onClick={handlePrev}
                  disabled={current <= 1 || isSaving}
                  className="flex-1 sm:flex-none sm:w-40 py-3.5 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  ‹ Previous
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={isSaving}
                  className={`flex-[2] sm:flex-none sm:w-64 py-3.5 rounded-xl text-white font-semibold transition-colors disabled:opacity-70 ${
                    isLocked ? 'bg-brand hover:bg-brand-dark' : currentProblems > 0 ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {isSaving ? 'Saving…' : current < pieceCount ? 'Next item ›' : isLocked ? 'Summary ›' : 'Review & submit ›'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleJump(isLocked ? 1 : firstUnchecked || pieceCount)}
                  className="flex-1 sm:flex-none sm:w-40 py-3.5 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors"
                >
                  {isLocked ? 'View items ›' : '‹ Items'}
                </button>
                {!isLocked && <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className={`flex-[2] sm:flex-none sm:w-72 py-3.5 rounded-xl text-white font-semibold transition-colors disabled:opacity-40 ${
                    badPieces.length ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {isSubmitting
                    ? 'Submitting…'
                    : badPieces.length
                    ? `Submit · ${badPieces.length} bad item${badPieces.length > 1 ? 's' : ''}`
                    : 'Submit · lot cleared'}
                </button>}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

// ---------- Small presentational pieces ----------

const BackButton: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <button
    type="button"
    onClick={onBack}
    className="inline-flex items-center gap-2 px-3 py-2 -ml-1 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-white rounded-lg transition-colors no-print"
  >
    <ArrowLeft className="w-4 h-4" /> Back to my lots
  </button>
);

const StripCell: React.FC<{ label: string; value: string; className?: string; valueClass?: string }> = ({ label, value, className = '', valueClass = '' }) => (
  <div className={`px-4 py-3 border-slate-200 min-w-0 ${className}`}>
    <div className="text-[11px] font-medium tracking-wider uppercase text-slate-500">{label}</div>
    <div className={`text-sm sm:text-base font-semibold text-slate-900 truncate ${valueClass}`} title={value}>{value}</div>
  </div>
);

const StatusBox: React.FC<{ state: PieceState }> = ({ state }) => (
  <span
    className={`w-7 h-7 shrink-0 rounded-md border flex items-center justify-center ${
      state === 'good' ? 'bg-emerald-600 border-emerald-600 text-white'
      : state === 'bad' ? 'bg-red-600 border-red-600 text-white'
      : 'bg-white border-slate-300'
    }`}
  >
    {state === 'good' && <Check className="w-4 h-4" strokeWidth={3} />}
    {state === 'bad' && <X className="w-4 h-4" strokeWidth={3} />}
  </span>
);

const CheckCard: React.FC<{ index: number; item: ControlItem; state: 'pass' | 'fail'; readOnly?: boolean; onToggle: () => void }> = ({ index, item, state, readOnly, onToggle }) => {
  const failed = state === 'fail';
  const limits = item.min_val !== null && item.min_val !== undefined && item.max_val !== null && item.max_val !== undefined
    ? `${item.min_val} – ${item.max_val}${item.unit ? ` ${item.unit}` : ''}` : null;
  return (
    <div
      className={`w-full text-left rounded-2xl border p-4 sm:p-5 flex items-start gap-3 sm:gap-4 transition-colors ${
        failed ? 'bg-red-50 border-red-300' : 'bg-white border-emerald-200'
      }`}
    >
      <span className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${failed ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
        {index}
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-base sm:text-lg font-semibold ${failed ? 'text-red-700' : 'text-slate-900'}`}>{item.control_item_name}</span>
        {item.specification_content && (
          <span className={`block mt-1 text-sm leading-relaxed ${failed ? 'text-red-600' : 'text-slate-600'}`}>{item.specification_content}</span>
        )}
        {limits && <span className={`block mt-1 text-xs font-medium ${failed ? 'text-red-600' : 'text-slate-500'}`}>Limits: {limits}</span>}
        {item.application_method && (
          <span className={`block mt-1.5 text-xs ${failed ? 'text-red-500' : 'text-slate-400'}`}>{item.application_method}</span>
        )}
      </span>
      <span className="shrink-0 flex gap-2" role="group" aria-label={`${item.control_item_name}: yes or no`}>
        <label className={`flex items-center gap-2 h-9 px-3 rounded-lg border text-sm font-bold select-none ${readOnly ? '' : 'cursor-pointer'} ${
          !failed ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-600'
        }`}>
          <input
            type="checkbox"
            className="w-4 h-4 accent-emerald-600"
            checked={!failed}
            disabled={readOnly}
            onChange={() => { if (!readOnly && failed) onToggle(); }}
          />
          Yes
        </label>
        <label className={`flex items-center gap-2 h-9 px-3 rounded-lg border text-sm font-bold select-none ${readOnly ? '' : 'cursor-pointer'} ${
          failed ? 'border-red-600 bg-red-50 text-red-700' : 'border-slate-300 bg-white text-slate-600'
        }`}>
          <input
            type="checkbox"
            className="w-4 h-4 accent-red-600"
            checked={failed}
            disabled={readOnly}
            onChange={() => { if (!readOnly && !failed) onToggle(); }}
          />
          No
        </label>
      </span>
    </div>
  );
};

interface FinishPanelProps {
  pieceCount: number;
  goodCount: number;
  badPieces: number[];
  firstUnchecked: number;
  uncheckedCount: number;
  lotFieldCells: { item: ControlItem; col: string }[];
  cells: Record<string, CellResponse>;
  fieldDrafts: Record<string, string>;
  setFieldDraft: (key: string, v: string) => void;
  saveLotField: (item: ControlItem, col: string) => void;
  missingCount: number;
  remarks: string;
  setRemarks: (v: string) => void;
  onJump: (n: number) => void;
  readOnly: boolean;
  batch: InspectionBatch;
  checks: ControlItem[];
  pieceStates: PieceState[];
}

const FinishPanel: React.FC<FinishPanelProps> = ({
  pieceCount, goodCount, badPieces, firstUnchecked, uncheckedCount, lotFieldCells, cells,
  fieldDrafts, setFieldDraft, saveLotField, missingCount, remarks, setRemarks, onJump,
  readOnly, batch, checks, pieceStates,
}) => {
  // Per-check result: from per-piece cells, or (older lots) from the template's own columns
  const checkResults = checks.map((c) => {
    let failed = 0;
    pieceStates.forEach((_, i) => {
      if (isFailValue(cells[`${c.item_id}_${i + 1}`]?.cell_value)) failed++;
    });
    const sheetCells = (Array.isArray(c.sample_columns) ? c.sample_columns : []).map((col) => cells[`${c.item_id}_${col}`]).filter(hasValue);
    const sheetFail = sheetCells.some((x) => isFailValue(x!.cell_value));
    const result: 'pass' | 'fail' = failed > 0 || sheetFail ? 'fail' : 'pass';
    return { item: c, failed, result };
  });

  const fieldsByItem = lotFieldCells.reduce<Record<number, { item: ControlItem; cols: string[] }>>((acc, { item, col }) => {
    (acc[item.item_id!] ||= { item, cols: [] }).cols.push(col);
    return acc;
  }, {});

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="text-2xl sm:text-4xl font-semibold text-slate-900 tracking-tight">
          {readOnly ? 'Inspection summary' : <>Review &amp; submit</>}
        </h2>
        <p className="mt-1 text-slate-500">
          {readOnly ? 'This lot has been submitted. Results are read-only.' : 'Check the summary, then submit the lot to the supervisor.'}
        </p>
      </div>

      {!readOnly && uncheckedCount > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span>{uncheckedCount} item{uncheckedCount > 1 ? 's' : ''} still to check before you can submit.</span>
          <button type="button" onClick={() => onJump(firstUnchecked)} className="self-start px-3 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 font-semibold">
            Go to item {firstUnchecked}
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <SummaryTile value={pieceCount} label="Items" />
        <SummaryTile value={goodCount} label="Good" tone="good" />
        <SummaryTile value={badPieces.length} label="Bad" tone={badPieces.length ? 'bad' : undefined} />
      </div>

      {readOnly && (
        <section className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-900">Check results</h3>
          <ul className="mt-2 divide-y divide-slate-100">
            {checkResults.map(({ item, failed, result }) => (
              <li key={item.item_id} className="py-2.5 flex items-center gap-3">
                <span className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center ${result === 'fail' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
                  {result === 'fail' ? <X className="w-4 h-4" strokeWidth={3} /> : <Check className="w-4 h-4" strokeWidth={3} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{item.control_item_name}</span>
                  {item.specification_content && <span className="block text-xs text-slate-500 truncate">{item.specification_content}</span>}
                </span>
                <span className={`text-xs font-semibold whitespace-nowrap ${result === 'fail' ? 'text-red-600' : 'text-emerald-700'}`}>
                  {result === 'fail' ? (failed > 0 ? `${failed} bad` : 'Failed') : 'Good'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {badPieces.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-900">Bad items — segregate these</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {badPieces.map((n) => (
              <button key={n} type="button" onClick={() => onJump(n)} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm font-semibold hover:bg-red-100">
                Item {n}
              </button>
            ))}
          </div>
        </section>
      )}

      {Object.keys(fieldsByItem).length > 0 && (
        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Lot measurements &amp; notes</h3>
            {missingCount > 0 && <p className="text-xs text-amber-700 mt-0.5">{missingCount} required value{missingCount > 1 ? 's' : ''} still empty.</p>}
          </div>
          {Object.values(fieldsByItem).map(({ item, cols }) => {
            const isNumber = item.html_input_type === 'number' || item.row_mode === 'NUMERIC_SAMPLE';
            return (
              <div key={item.item_id}>
                <div className="text-sm font-medium text-slate-800">
                  {item.control_item_name}{item.is_required && <span className="text-red-600"> *</span>}
                </div>
                <div className="text-xs text-slate-500">
                  {item.specification_content}
                  {item.min_val != null && item.max_val != null && ` · ${item.min_val} – ${item.max_val}${item.unit ? ` ${item.unit}` : ''}`}
                </div>
                <div className={`mt-2 grid gap-2 ${isNumber && cols.length > 1 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-1'}`}>
                  {cols.map((col) => {
                    const key = `${item.item_id}_${col}`;
                    const value = key in fieldDrafts ? fieldDrafts[key] : cells[key]?.cell_value ?? '';
                    const bad = isOutOfSpec(item, value);
                    return (
                      <label key={col} className="block">
                        {cols.length > 1 && <span className="block text-[11px] text-slate-500 mb-0.5">{col}</span>}
                        <input
                          type={isNumber ? 'number' : 'text'}
                          inputMode={isNumber ? 'decimal' : undefined}
                          step={isNumber ? 'any' : undefined}
                          value={value}
                          readOnly={readOnly}
                          onChange={(e) => setFieldDraft(key, e.target.value)}
                          onBlur={() => saveLotField(item, col)}
                          className={`w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:ring-2 ${
                            bad ? 'border-red-400 bg-red-50 text-red-700 focus:ring-red-200' : 'border-slate-300 focus:border-brand focus:ring-brand/20'
                          }`}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {readOnly ? <ApprovalRecord batch={batch} /> : (
      <section className="bg-white border border-slate-200 rounded-2xl p-5">
        <label className="block text-sm font-semibold text-slate-900" htmlFor="op-remarks">Remarks (optional)</label>
        <textarea
          id="op-remarks"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
          placeholder="Anything the supervisor should know"
          className="mt-2 w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        {badPieces.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">The bad item numbers are added to the remarks automatically.</p>
        )}
      </section>
      )}
    </div>
  );
};

const LOCKED_STATUS: Record<string, { label: string; cls: string }> = {
  OPERATOR_APPROVED: { label: 'Submitted · with supervisor', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  OPERATOR_REJECTED: { label: 'Submitted with bad items · with supervisor', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  SUPERVISOR_IN_PROGRESS: { label: 'Supervisor is reviewing', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  ON_HOLD: { label: 'On hold', cls: 'bg-orange-50 text-orange-800 border-orange-200' },
  APPROVED: { label: 'Approved · completed', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  REJECTED: { label: 'Rejected', cls: 'bg-red-50 text-red-800 border-red-200' },
};

const LockedBanner: React.FC<{ batch: InspectionBatch }> = ({ batch }) => {
  const st = LOCKED_STATUS[batch.status] || { label: String(batch.status), cls: 'bg-slate-50 text-slate-700 border-slate-200' };
  return (
    <div className={`border-b px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${st.cls}`}>
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <Lock className="w-4 h-4" /> {st.label}
      </span>
      {batch.status === 'ON_HOLD' && batch.hold_reason && <span>· {batch.hold_reason}</span>}
      {(batch.round || 1) > 1 && <span>· Round {batch.round}</span>}
      <span className="sm:ml-auto opacity-80">Read-only</span>
    </div>
  );
};

const ApprovalRecord: React.FC<{ batch: InspectionBatch }> = ({ batch }) => {
  const decisions = batch.decisions || [];
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-slate-900">Approval record</h3>
      {decisions.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No sign-offs recorded yet.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {decisions.map((d) => {
            const dec = String(d.decision || '').toLowerCase();
            const tone = dec.includes('approv') ? 'text-emerald-700' : dec.includes('reject') ? 'text-red-700' : 'text-slate-800';
            const failed = (d.rejected_fields || []).filter(Boolean);
            return (
              <li key={d.decision_id} className="flex gap-3">
                <span className="mt-1.5 w-2 h-2 rounded-full bg-slate-300 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className={`font-semibold ${tone}`}>{d.decision}</span>
                    <span className="text-slate-700">{d.stage}</span>
                    <span className="text-slate-500">by {d.decided_by_name || 'Unknown'} ({d.role})</span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {d.decided_at ? new Date(d.decided_at).toLocaleString() : ''}{(d.round || 1) > 1 ? ` · Round ${d.round}` : ''}
                  </div>
                  {d.remarks && <p className="mt-1 text-sm text-slate-600 whitespace-pre-line break-words">{d.remarks}</p>}
                  {failed.length > 0 && <p className="mt-1 text-xs text-red-600">Failed: {failed.join(', ')}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};

const SummaryTile: React.FC<{ value: number; label: string; tone?: 'good' | 'bad' }> = ({ value, label, tone }) => (
  <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4">
    <div className={`text-3xl font-light tabular-nums ${tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : 'text-slate-900'}`}>{value}</div>
    <div className="text-sm text-slate-500">{label}</div>
  </div>
);

export default OperatorInspection;
