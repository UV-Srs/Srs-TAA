import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, X, Loader2, Lock } from 'lucide-react';
import './operatorInspection.css';
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

// Lot clearance options. The wording is stored as-is and shown to the supervisor as "Operator clearance".
const CLEARANCE_CLEARED = 'Lot cleared';
const CLEARANCE_SEGREGATED = 'Cleared, NG items segregated';
const CLEARANCE_HOLD = 'Not cleared, hold the lot';
type Clearance = typeof CLEARANCE_CLEARED | typeof CLEARANCE_SEGREGATED | typeof CLEARANCE_HOLD;
const CLEARANCE_OPTIONS: { value: Clearance; desc: string }[] = [
  { value: CLEARANCE_CLEARED, desc: 'All items passed the checks.' },
  { value: CLEARANCE_SEGREGATED, desc: 'Bad items are tagged and kept aside.' },
  { value: CLEARANCE_HOLD, desc: 'A repeating problem or too many bad items.' },
];

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
  // piece = "Item n of N"; finish = lot clearance (or summary when read-only); preview = full lot report
  const [view, setView] = useState<'piece' | 'finish' | 'preview'>('piece');
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clearance, setClearance] = useState<Clearance | null>(null);
  const [clearanceNote, setClearanceNote] = useState('');
  const [msg, setMsg] = useState('');
  const [jumpText, setJumpText] = useState('');
  const initialisedFor = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);

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

  // ---------- Lot clearance ----------
  // "Lot cleared" is only possible with no bad items, "NG items segregated" only with some;
  // "hold the lot" is always possible but needs a reason. Pre-selected from the results.
  const clearanceAllowed = (c: Clearance) =>
    c === CLEARANCE_HOLD || (c === CLEARANCE_CLEARED ? badCount === 0 : badCount > 0);
  const defaultClearance: Clearance = badCount > 0 ? CLEARANCE_SEGREGATED : CLEARANCE_CLEARED;
  const chosenClearance: string = isLocked
    ? batch?.operator_clearance || defaultClearance
    : clearance && clearanceAllowed(clearance) ? clearance : defaultClearance;
  const needsHoldReason = !isLocked && chosenClearance === CLEARANCE_HOLD && !clearanceNote.trim();

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
  }, [current]);

  // The screen fills the window below the app header; the side list and the checks scroll on their own
  useLayoutEffect(() => {
    const setTop = () => {
      const el = rootRef.current;
      if (el) el.style.setProperty('--opi-top', `${Math.max(0, el.getBoundingClientRect().top + window.scrollY)}px`);
    };
    setTop();
    window.addEventListener('resize', setTop);
    return () => window.removeEventListener('resize', setTop);
  }, [!!batch]);

  /** The saved answer for a check on piece n, or null if it hasn't been answered yet. */
  const savedAnswer = (item: ControlItem, n: number): PassFail | null => {
    const cell = cells[`${item.item_id}_${n}`];
    if (hasValue(cell)) return isFailValue(cell!.cell_value) ? 'Fail' : 'Pass';
    if (isLocked) {
      // Older submitted lots only have lot-level results for each check
      const cols = Array.isArray(item.sample_columns) ? item.sample_columns : [];
      return cols.some((col) => isFailValue(cells[`${item.item_id}_${col}`]?.cell_value)) ? 'Fail' : 'Pass';
    }
    return null;
  };
  /** Every check starts unanswered: the operator taps Yes or No (or Select all) for each one. */
  const answerFor = (item: ControlItem, n: number): PassFail | null =>
    (n === current ? draft[item.item_id!] : undefined) || savedAnswer(item, n);
  const currentProblems = checks.filter((c) => answerFor(c, current) === 'Fail').length;
  const unanswered = checks.filter((c) => answerFor(c, current) === null).length;

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

  /** Save piece n once every check has an answer. Only writes what changed. Returns false if incomplete. */
  const commitPiece = async (n: number): Promise<boolean> => {
    if (isLocked) return false;
    const answers = checks.map((c) => ({ item: c, value: answerFor(c, n) }));
    if (answers.some((a) => a.value === null)) return false;
    const entries = answers
      .map((a) => ({ item: a.item, column: String(n), value: a.value as string }))
      .filter((e) => savedAnswer(e.item, n) !== e.value);
    await saveCells(entries);
    return true;
  };

  const goTo = (target: number | 'finish') => {
    setDraft({});
    if (target === 'finish') setView('finish');
    else { setCurrent(Math.min(Math.max(1, target), pieceCount)); setView('piece'); }
    mainRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  };

  /** Previous / jump: changes to an already-checked item are kept; a half-answered new item is dropped. */
  const leaveTo = async (target: number | 'finish') => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (view === 'piece' && pieceStates[current - 1] !== 'unchecked' && Object.keys(draft).length > 0) {
        await commitPiece(current);
      }
      setMsg('');
      goTo(target);
    } finally {
      setIsSaving(false);
    }
  };

  const handleNext = async () => {
    if (isSaving) return;
    if (isLocked) { goTo(current < pieceCount ? current + 1 : 'finish'); return; }
    if (unanswered > 0) return;
    setIsSaving(true);
    try {
      if (!(await commitPiece(current))) return;
      setMsg(`Item ${current} saved as ${currentProblems ? 'bad' : 'good'}.`);
      const after = pieceStates.map((s, i) => (i === current - 1 ? 'done' : s));
      const nextOpen = after.findIndex((s) => s === 'unchecked') + 1;
      if (nextOpen === 0) goTo('finish');
      else goTo(current < pieceCount ? current + 1 : nextOpen);
    } finally {
      setIsSaving(false);
    }
  };
  const handlePrev = () => leaveTo(current - 1);
  const handleJump = (n: number) => leaveTo(n);
  const handleJumpInput = () => {
    const n = parseInt(jumpText, 10);
    if (!(n >= 1 && n <= pieceCount)) { setMsg(`!Enter an item number from 1 to ${pieceCount}.`); return; }
    setJumpText('');
    handleJump(n);
  };

  const setAnswer = (item: ControlItem, value: PassFail) => {
    if (isLocked) return;
    setDraft((d) => ({ ...d, [item.item_id!]: value }));
    setMsg('');
  };
  const answerAllYes = () => {
    if (isLocked) return;
    setDraft(Object.fromEntries(checks.map((c) => [c.item_id!, 'Pass' as PassFail])));
    setMsg('');
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
  const canSubmit = firstUnchecked === 0 && missingLotFields.length === 0 && !needsHoldReason && !isSubmitting;

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
      const note = clearanceNote.trim();
      const fullRemarks = [ngNote, note].filter(Boolean).join('\n');

      await submitOperatorBatch(batch.batch_id, {
        decision: failedIds.length === 0 ? 'APPROVE' : 'REJECT',
        rejected_item_ids: failedIds.length ? failedIds : undefined,
        remarks: fullRemarks || undefined,
        cells: lotCells.map((c) => ({ ...c, checker_initials: initials })),
        clearance: chosenClearance,
        clearance_note: note || undefined,
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
  const pct = pieceCount ? (checkedCount / pieceCount) * 100 : 0;
  const isLast = current >= pieceCount;

  const openPreview = () => {
    setView('preview');
    mainRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  };
  const backToClearance = () => {
    setView('finish');
    mainRef.current?.scrollTo({ top: 0 });
  };

  const hint = view === 'preview'
    ? (isLocked ? 'The lot report as recorded.' : <><b>Report correct?</b> Submit to send this lot to the supervisor.</>)
    : isLocked
    ? 'This lot has been submitted. Results are read-only.'
    : view === 'finish'
    ? (firstUnchecked
      ? `${pieceCount - checkedCount} item${pieceCount - checkedCount > 1 ? 's' : ''} still to check.`
      : needsHoldReason
      ? 'Add a short reason for holding the lot.'
      : <><b>Next:</b> check the full report before submitting.</>)
    : msg.startsWith('!')
    ? <b className="ng">{msg.slice(1)}</b>
    : unanswered
    ? 'Answer Yes or No for every check. Select all sets them all to Yes.'
    : msg;

  return (
    <div className="opi" ref={rootRef}>
      {/* ---------- Lot bar ---------- */}
      <div className="opi-lotbar">
        <div>
          <button type="button" className="opi-backlink" onClick={onBack}>‹ Lots</button>
        </div>
        <div className="opi-lb-code">
          <span className="opi-lb-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </span>
          <div><small>Lot barcode</small><b>{batch.lot_number}</b></div>
        </div>
        <div className="opi-wide"><small>Part</small><b title={partLabel}>{partLabel}</b></div>
        <div><small>Items</small><b>{pieceCount}</b></div>
        <div><small>Date</small><b>{formatDate(batch.created_at)}</b></div>
        <div className="opi-lb-prog"><small>Checked</small><b>{checkedCount} / {pieceCount}</b></div>
      </div>

      {isLocked && <LockedBanner batch={batch} />}

      <section className={`opi-layout ${view !== 'piece' ? 'opi-full' : ''}`}>
        {/* ---------- Side: progress + item list (not on the clearance screen) ---------- */}
        {view === 'piece' && <aside className="opi-side">
          <div className="opi-sub">Progress</div>
          <div className="opi-bignum">{checkedCount}<span> / {pieceCount}</span></div>
          <div className="opi-progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="opi-counts">
            <span className="opi-pill ok">{goodCount} good</span>
            <span className={`opi-pill ${badCount ? 'ng' : 'neutral'}`}>{badCount} bad</span>
          </div>
          <div className="opi-jump">
            <input
              inputMode="numeric"
              placeholder="Go to item #"
              aria-label="Go to item number"
              value={jumpText}
              onChange={(e) => setJumpText(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleJumpInput(); } }}
            />
            <button type="button" className="opi-btn" onClick={handleJumpInput}>Go</button>
          </div>
          <ul className="opi-ilist" ref={listRef}>
            {pieceStates.map((state, i) => {
              const n = i + 1;
              const isNow = view === 'piece' && n === current;
              const cls = state === 'good' ? 'good' : state === 'bad' ? 'bad' : isNow ? 'now' : '';
              return (
                <li key={n} className={`opi-irow ${cls} ${isNow ? 'cur' : ''}`} data-piece={n}>
                  <button type="button" className="opi-ilabel" onClick={() => handleJump(n)} aria-current={isNow ? 'step' : undefined}>
                    <span>Item {n}</span>
                    <span className="opi-ist">{state === 'good' ? '✓ Good' : state === 'bad' ? '✕ Bad' : isNow ? 'Now' : '—'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>}

        {/* ---------- Main ---------- */}
        <div className="opi-main" ref={mainRef}>
          {(errorMsg || syncNote) && <div className={`opi-note ${errorMsg ? 'err' : 'warn'}`}>{errorMsg || syncNote}</div>}

          {view === 'piece' ? (
            <>
              <div className="opi-ckhead">
                <div>
                  <h2>Item {current} <span className="opi-of">of {pieceCount}</span></h2>
                  <p>
                    {isLocked
                      ? (currentProblems ? <b>{currentProblems} problem{currentProblems > 1 ? 's' : ''}</b> : 'All checks Yes')
                      : unanswered
                      ? `${unanswered} of ${checks.length} checks not answered yet`
                      : currentProblems
                      ? <b>{currentProblems} problem{currentProblems > 1 ? 's' : ''} marked</b>
                      : 'All checks answered Yes'}
                  </p>
                </div>
                {!isLocked && (
                  <button type="button" className="opi-btn opi-selall" onClick={answerAllYes}>✓ Select all</button>
                )}
              </div>

              <div className="opi-fsec">Visual checks</div>
              <div className="opi-fgrid">
                {checks.map((item, idx) => (
                  <CheckCard
                    key={item.item_id}
                    index={idx + 1}
                    item={item}
                    answer={answerFor(item, current)}
                    readOnly={isLocked}
                    onAnswer={(v) => setAnswer(item, v)}
                  />
                ))}
              </div>
            </>
          ) : view === 'preview' ? (
            <ReportPreview
              batch={batch}
              checks={checks}
              cells={cells}
              pieceCount={pieceCount}
              pieceStates={pieceStates}
              goodCount={goodCount}
              badCount={badCount}
              inspectedBy={(isLocked && batch.prepared_user_name) || currentUser.full_name || currentUser.username}
              submittedAt={batch.operator_submitted_at}
            />
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
              clearance={chosenClearance}
              clearanceAllowed={clearanceAllowed}
              onClearance={setClearance}
              clearanceNote={isLocked ? batch.operator_clearance_note || '' : clearanceNote}
              setClearanceNote={setClearanceNote}
              onJump={handleJump}
              readOnly={isLocked}
              batch={batch}
              checks={checks}
              pieceStates={pieceStates}
            />
          )}

          <div className="opi-grow" />

          {/* ---------- Action bar ---------- */}
          <div className="opi-actionbar no-print">
            <span className="opi-hint">{hint}</span>
            {view === 'piece' ? (
              <>
                <button type="button" className="opi-btn big" onClick={handlePrev} disabled={current <= 1 || isSaving}>
                  ‹ Previous
                </button>
                <button
                  type="button"
                  className={`opi-btn big opi-nextbtn ${isLocked ? 'primary' : unanswered ? 'primary' : currentProblems ? 'isbad' : 'isgood'}`}
                  onClick={handleNext}
                  disabled={isSaving || (!isLocked && unanswered > 0)}
                >
                  {isSaving ? 'Saving…' : !isLast ? 'Next item ›' : isLocked ? 'Summary ›' : 'Review & submit ›'}
                </button>
              </>
            ) : view === 'preview' ? (
              <>
                <button type="button" className="opi-btn big" onClick={backToClearance}>
                  {isLocked ? '‹ Back to summary' : '‹ Back to clearance'}
                </button>
                {!isLocked && (
                  <button
                    type="button"
                    className="opi-btn big primary opi-nextbtn"
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                  >
                    {isSubmitting ? 'Submitting…' : 'Submit to supervisor'}
                  </button>
                )}
              </>
            ) : (
              <>
                <button type="button" className="opi-btn big" onClick={() => handleJump(isLocked ? 1 : firstUnchecked || pieceCount)}>
                  {isLocked ? 'View items ›' : '‹ Back to items'}
                </button>
                <button
                  type="button"
                  className="opi-btn big primary opi-nextbtn"
                  onClick={openPreview}
                  disabled={!isLocked && !canSubmit}
                >
                  {isLocked ? 'View report ›' : 'Preview report ›'}
                </button>
              </>
            )}
          </div>
        </div>
      </section>
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

const CheckCard: React.FC<{
  index: number;
  item: ControlItem;
  answer: PassFail | null;
  readOnly?: boolean;
  onAnswer: (v: PassFail) => void;
}> = ({ index, item, answer, readOnly, onAnswer }) => {
  const limits = item.min_val !== null && item.min_val !== undefined && item.max_val !== null && item.max_val !== undefined
    ? `${item.min_val} – ${item.max_val}${item.unit ? ` ${item.unit}` : ''}` : null;
  const yes = answer === 'Pass';
  const no = answer === 'Fail';
  return (
    <div className={`opi-fcard ${no ? 'bad' : yes ? 'good' : ''}`}>
      <span className="opi-fn">{index}</span>
      <span className="opi-fb">
        <b>{item.control_item_name}</b>
        {item.specification_content && <span>{item.specification_content}</span>}
        {limits && <span>Limits: {limits}</span>}
        {item.application_method && <small>{item.application_method}</small>}
      </span>
      <span className="opi-ynb" role="group" aria-label={`${item.control_item_name}: yes or no`}>
        <button
          type="button"
          className={`opi-yb ${yes ? 'on' : ''}`}
          aria-pressed={yes}
          aria-label={`Yes, ${item.control_item_name} is OK`}
          title="Yes"
          disabled={readOnly}
          onClick={() => onAnswer('Pass')}
        >
          ✓
        </button>
        <button
          type="button"
          className={`opi-nb ${no ? 'on' : ''}`}
          aria-pressed={no}
          aria-label={`No, ${item.control_item_name} is not OK`}
          title="No"
          disabled={readOnly}
          onClick={() => onAnswer('Fail')}
        >
          ✕
        </button>
      </span>
    </div>
  );
};

// ---------- Lot report preview ("Preview the lot report") ----------
const REPORT_PER_PAGE = 30;

const ReportPreview: React.FC<{
  batch: InspectionBatch;
  checks: ControlItem[];
  cells: Record<string, CellResponse>;
  pieceCount: number;
  pieceStates: PieceState[];
  goodCount: number;
  badCount: number;
  inspectedBy: string;
  submittedAt?: string | null;
}> = ({ batch, checks, cells, pieceCount, pieceStates, goodCount, badCount, inspectedBy, submittedAt }) => {
  const t = batch.template!;
  const pages = Math.max(1, Math.ceil(pieceCount / REPORT_PER_PAGE));
  const resultCell = (item: ControlItem, n: number) => {
    const cell = cells[`${item.item_id}_${n}`];
    if (!hasValue(cell)) return <td key={n} className="c" />;
    return isFailValue(cell!.cell_value)
      ? <td key={n} className="c ng" aria-label="Not OK">✕</td>
      : <td key={n} className="c ok" aria-label="OK">✓</td>;
  };
  const meta: [string, React.ReactNode][] = [
    ['Part no.', t.part_no || '—'],
    ['Part name', batch.product_name || t.part_name || '—'],
    ['Model', t.model_name || '—'],
    ['Vendor', t.vendor_name || '—'],
    ['Lot barcode', batch.lot_number],
    ['Date', formatDate(batch.created_at)],
    ['Items', pieceCount],
    ['Inspected by', inspectedBy],
  ];

  return (
    <div className="opi-pv space-y-4">
      <div className="opi-pvhead">
        <div>
          <h2 className="opi-pv-title">Preview the lot report</h2>
          <p className="opi-pv-sub">Every item and every check, as it will be recorded. Read it through, then submit.</p>
        </div>
        <div className="opi-pvsum">
          <span><b>{pieceCount}</b>Items</span>
          <span className="g"><b>{goodCount}</b>Good</span>
          <span className={badCount ? 'r' : ''}><b>{badCount}</b>Bad</span>
        </div>
      </div>

      <div className="opi-card">
        <dl className="opi-dl">
          {meta.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </div>

      {Array.from({ length: pages }, (_, k) => {
        const from = k * REPORT_PER_PAGE + 1;
        const to = Math.min(pieceCount, (k + 1) * REPORT_PER_PAGE);
        const nums = Array.from({ length: to - from + 1 }, (_, i) => from + i);
        const pad = Array.from({ length: REPORT_PER_PAGE - nums.length }, (_, i) => i);
        return (
          <section key={k} className="opi-rblock">
            <div className="opi-rb-head"><b>Items {from} – {to}</b><span>Page {k + 1} of {pages}</span></div>
            <div className="opi-rb-scroll">
              <table className="opi-rt">
                <colgroup>
                  <col style={{ width: 34 }} /><col style={{ width: 150 }} /><col style={{ width: 190 }} /><col style={{ width: 86 }} />
                  {Array.from({ length: REPORT_PER_PAGE }, (_, i) => <col key={i} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th>S.No</th><th>Control item</th><th>Content</th><th>Method</th>
                    {nums.map((n) => <th key={n} className="c">{n}</th>)}
                    {pad.map((i) => <th key={`p${i}`} className="c" />)}
                  </tr>
                </thead>
                <tbody>
                  <tr className="rg"><td colSpan={4 + REPORT_PER_PAGE}>Visual checks</td></tr>
                  {checks.map((item, idx) => (
                    <tr key={item.item_id}>
                      <td className="c">{idx + 1}</td>
                      <td><b>{item.control_item_name}</b></td>
                      <td className="ds">{item.specification_content}</td>
                      <td className="ds">{item.application_method || '—'}</td>
                      {nums.map((n) => resultCell(item, n))}
                      {pad.map((i) => <td key={`p${i}`} className="c" />)}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>Item result</td>
                    {nums.map((n) => {
                      const s = pieceStates[n - 1];
                      return s === 'bad'
                        ? <td key={n} className="c ng" aria-label="Item not OK">✕</td>
                        : s === 'good'
                        ? <td key={n} className="c ok" aria-label="Item OK">✓</td>
                        : <td key={n} className="c" />;
                    })}
                    {pad.map((i) => <td key={`p${i}`} className="c" />)}
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        );
      })}

      <div className="opi-card opi-signoff">
        <table>
          <tbody>
            <tr>
              <th>Checked by</th>
              <td>
                {inspectedBy}{' '}
                <span>Operator, {submittedAt ? new Date(submittedAt).toLocaleString() : 'on submitting'}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
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
  clearance: string;
  clearanceAllowed: (c: Clearance) => boolean;
  onClearance: (c: Clearance) => void;
  clearanceNote: string;
  setClearanceNote: (v: string) => void;
  onJump: (n: number) => void;
  readOnly: boolean;
  batch: InspectionBatch;
  checks: ControlItem[];
  pieceStates: PieceState[];
}

const FinishPanel: React.FC<FinishPanelProps> = ({
  pieceCount, goodCount, badPieces, firstUnchecked, uncheckedCount, lotFieldCells, cells,
  fieldDrafts, setFieldDraft, saveLotField, missingCount, clearance, clearanceAllowed, onClearance, clearanceNote, setClearanceNote, onJump,
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
    <div className="opi-pv space-y-4">
      <div>
        <h2 className="opi-pv-title">
          {readOnly ? 'Inspection summary' : uncheckedCount > 0 ? `${pieceCount - uncheckedCount} of ${pieceCount} items checked` : `All ${pieceCount} items checked`}
        </h2>
        <p className="opi-pv-sub">
          {readOnly ? 'This lot has been submitted. Results are read-only.' : 'Give the lot clearance, then submit the lot.'}
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

      <div className="opi-statrow">
        <div><b>{pieceCount - uncheckedCount}</b><span>Items checked</span></div>
        <div className="isok"><b>{goodCount}</b><span>Good</span></div>
        <div className={badPieces.length ? 'isng' : ''}><b>{badPieces.length}</b><span>Bad</span></div>
      </div>

      <section className="opi-card">
        <h3>Lot clearance</h3>
        <p className="opi-pv-sub">{readOnly ? 'Given by the operator on submit.' : 'Pre-selected from the results. Change it if needed.'}</p>
        <div className="opi-cbs">
          {CLEARANCE_OPTIONS.map(({ value, desc }) => {
            const on = clearance === value;
            const enabled = !readOnly && clearanceAllowed(value);
            return (
              <button
                key={value}
                type="button"
                className={`opi-cb ${on ? 'on' : ''}`}
                role="checkbox"
                aria-checked={on}
                disabled={!enabled && !on}
                onClick={() => { if (enabled) onClearance(value); }}
              >
                <span className="opi-cbox" aria-hidden="true">{on ? '✓' : ''}</span>
                <span><b>{value}</b><span>{desc}</span></span>
              </button>
            );
          })}
        </div>
        <textarea
          className="opi-textarea"
          value={clearanceNote}
          readOnly={readOnly}
          onChange={(e) => setClearanceNote(e.target.value)}
          placeholder={clearance === CLEARANCE_HOLD ? 'Why is the lot not cleared? (required)' : 'Note for the supervisor (optional)'}
          aria-label="Note for the supervisor"
        />
        {!readOnly && badPieces.length > 0 && (
          <p className="opi-pv-sub" style={{ fontSize: 13 }}>The bad item numbers are sent to the supervisor automatically.</p>
        )}
      </section>

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

      {readOnly && <ApprovalRecord batch={batch} />}
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

export default OperatorInspection;
