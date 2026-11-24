import { useCallback, useEffect, useRef, useState } from 'react';
import { onBatchCreated, onBatchUpdated, onCellUpdated } from '../../liveSync';
import { supervisorService, type Disposition, type Lot, type Workspace } from '../data';
import { shortName } from '../logic/format';
import {
  REVIEWABLE_STATUSES, STATUS_TXT, SUPERVISOR_STATUSES, badIdx, lotTs, nItems, nSamples, paramsOf,
  sampleOwnDone, supLots, svNextTodo,
} from '../logic/rules';

/** Prototype svView, plus 'scan' (the supervisor Scan screen). */
export type SvView = 'dash' | 'scan' | 'lots' | 'review' | 'preview' | 'saved';
/** Prototype svPre (dashboard card prefilter for the Lots list). */
export type SvPre = '' | 'returned' | 'onhold' | 'oos';

/** Prototype lock message; short names end in "." already, so the sentence's own period is skipped then. */
export const reviewedByMsg = (code: string, name: string) => {
  const who = shortName(name);
  return `${code} is being reviewed by ${who}${who.endsWith('.') ? '' : '.'}`;
};

const RELOAD_DEBOUNCE_MS = 250;

/**
 * The prototype's supervisor UI state and ACT handlers (svnav, svgo, svclearpre, svopen, svlots,
 * svitem, svprev/next, svnext (Next to do), svdec, readings typed into the dimension fields, svpreview, oos, sign),
 * backed by the data service. Writes update the screen at once and are sent in order.
 */
export function useSupervisorController() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [loadError, setLoadError] = useState('');
  const [svView, setSvView] = useState<SvView>('scan');
  const [svPre, setSvPre] = useState<SvPre>('');
  const [svOp, setSvOp] = useState('');
  const [supQ, setSupQ] = useState('');
  const [supMsg, setSupMsg] = useState('');
  const [supId, setSupId] = useState<number | null>(null);
  /** The item open in the Lot review: its operator's checks and the supervisor's review are on one page. */
  const [svItem, setSvItemState] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  /** Errors from saving review changes (not in the prototype, which saved to localStorage). */
  const [errMsg, setErrMsg] = useState('');

  // Refs mirror state for the keyboard handler and chained writes.
  const wsRef = useRef<Workspace | null>(null);
  const svItemRef = useRef<number | null>(svItem);
  const loadSeq = useRef(0);
  const reloadTimer = useRef<number | undefined>();
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const setSvItem = (v: number | null) => { svItemRef.current = v; setSvItemState(v); };
  const setWsBoth = (v: Workspace) => { wsRef.current = v; setWs(v); };

  const reload = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const data = await supervisorService.getWorkspace();
      if (seq === loadSeq.current) {
        setWsBoth(data);
        setLoadError('');
      }
      return data;
    } catch (err) {
      if (seq === loadSeq.current) setLoadError(err instanceof Error ? err.message : 'Could not load lots.');
      return null;
    }
  }, []);

  const scheduleReload = useCallback(() => {
    window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => void reload(), RELOAD_DEBOUNCE_MS);
  }, [reload]);

  // Initial load + live updates (the prototype re-rendered from S on every change).
  useEffect(() => {
    void reload();
    const offs = [onBatchUpdated(scheduleReload), onBatchCreated(scheduleReload), onCellUpdated(scheduleReload)];
    return () => { offs.forEach((off) => off()); window.clearTimeout(reloadTimer.current); };
  }, [reload, scheduleReload]);

  const lotOf = (id: number | null, w = wsRef.current) => w?.lots.find((l) => l.id === id) ?? null;
  const supLot = lotOf(supId, ws);
  const reviewable = !!supLot && REVIEWABLE_STATUSES.includes(supLot.status);
  /** Prototype supLot(): the open lot if it is still reviewable. */
  const supLotNow = () => {
    const l = lotOf(supId);
    return l && REVIEWABLE_STATUSES.includes(l.status) ? l : null;
  };

  /** Apply a change to the open lot on screen at once; discard reloads that started before it. */
  const patchLot = (id: number, fn: (l: Lot) => Lot) => {
    const w = wsRef.current;
    if (!w) return;
    loadSeq.current++;
    setWsBoth({ ...w, lots: w.lots.map((l) => (l.id === id ? fn(l) : l)) });
  };

  /** Send writes one after another, in the order they were made. */
  const enqueue = (send: () => Promise<unknown>) => {
    writeQueue.current = writeQueue.current
      .then(send)
      .then(scheduleReload)
      .catch((err) => {
        setErrMsg(`Couldn’t save that change: ${err instanceof Error ? err.message : 'please try again.'}`);
        void reload();
      });
    return writeQueue.current;
  };

  // ---------------- navigation ----------------

  /** ACT.svnav (Dashboard / Scan / Lots) */
  const svnav = (v: 'dash' | 'scan' | 'lots') => { setSvView(v); setSupMsg(''); setErrMsg(''); };
  /** ACT.svlots (back link in the lot bar) */
  const svlots = () => setSvView('lots');
  /** ACT.svgo (dashboard attention cards) */
  const svgo = (v: 'pending' | 'onhold' | 'returned' | 'oos') => {
    setSvView('lots');
    setSvPre(v === 'pending' ? '' : v);
    setSupMsg('');
  };
  /** ACT.svclearpre */
  const svclearpre = () => setSvPre('');

  /** Review entry state the prototype sets when a lot opens (svopen / sign's next lot). */
  const enterReview = (lot: Lot) => {
    setErrMsg('');
    setSupId(lot.id);
    // Start on the first item still to do, else the first bad item, else item 1.
    const w = wsRef.current;
    const first = w ? svNextTodo(w, lot, -1) : -1;
    setSvItem(first >= 0 ? first : (badIdx(lot)[0] ?? 0));
    setSvView('review');
  };

  /**
   * ACT.svopen. Returns the "being reviewed by" message when locked (shown above the Lots list or on
   * the Scan screen), or '' when the lot opened.
   */
  const svopen = async (lot: Lot): Promise<string> => {
    const res = await supervisorService.openLot(lot.id);
    if (!res.ok) return res.reason === 'locked' ? reviewedByMsg(lot.code, res.lockBy.name) : res.message;
    setSupMsg('');
    const fresh = (await reload()) ?? wsRef.current;
    const l = lotOf(lot.id, fresh) ?? lot;
    if (res.view === 'saved') {
      setSupId(lot.id);
      setSvView('saved');
    } else {
      enterReview(l);
    }
    return '';
  };

  /** Lots list: open a row (message goes above the list). */
  const openFromList = async (lot: Lot) => setSupMsg(await svopen(lot));

  /** #supq Enter: exact barcode of a supervisor/onhold/completed lot opens it. */
  const openFromSearch = async () => {
    const q = supQ.trim().toUpperCase();
    const lot = wsRef.current?.lots.find((l) => l.code.toUpperCase() === q && SUPERVISOR_STATUSES.includes(l.status));
    if (lot) {
      setSupQ('');
      await openFromList(lot);
    }
  };

  /** Scan screen: behaves like Enter in the Lots search box; returns the error to show there. */
  const scan = async (raw: string): Promise<{ error: string }> => {
    const code = raw.trim().toUpperCase();
    if (!code) return { error: 'Scan a barcode or type its number.' };
    const fresh = (await reload()) ?? wsRef.current;
    const lot = fresh?.lots.find((l) => l.code.toUpperCase() === code);
    if (!lot) return { error: `No lot has barcode “${code}”. Check the label or ask the admin to register it.` };
    if (!SUPERVISOR_STATUSES.includes(lot.status)) {
      return { error: `${lot.name} (${lot.code}) is ${lot.status === 'operator' ? 'still being inspected by the operator' : STATUS_TXT[lot.status].toLowerCase()}.` };
    }
    return { error: await svopen(lot) };
  };

  // ---------------- items ----------------

  /** ACT.svitem (sidebar row) */
  const svitem = (k: number) => {
    const L = lotOf(supId);
    const w = wsRef.current;
    if (!L || !w || k < 0 || k >= nItems(w, L)) return;
    setSvItem(k);
  };

  /** ACT.svprev / Next item: step through every item of the lot. */
  const svstep = (dir: 1 | -1) => {
    const L = lotOf(supId);
    const w = wsRef.current;
    const i = svItemRef.current;
    if (!L || !w || i == null) return;
    const k = i + dir;
    if (k >= 0 && k < nItems(w, L)) setSvItem(k);
  };

  /** ACT.svnext: Next to do (undecided bad item or unmeasured sample). */
  const svnexttodo = () => {
    const L = lotOf(supId);
    const w = wsRef.current;
    if (!L || !w) return;
    const k = svNextTodo(w, L, svItemRef.current ?? -1);
    if (k >= 0) setSvItem(k);
  };

  /** ACT.svdec: decide the open bad item, then go to the next item to do (unless this one is a sample still to measure). */
  const svdec = (current: number, v: Disposition) => {
    const L = supLotNow();
    const w = wsRef.current;
    if (!L || !w) return;
    const col = L.columns[current];
    const updated: Lot = { ...L, parts: L.parts.map((p, i) => (i === current && p && p.r === 'NG' ? { ...p, disp: v } : p)) };
    patchLot(L.id, () => updated);
    void enqueue(() => supervisorService.setDisposition(L.id, col, v));
    if (current < nSamples(w, updated) && !sampleOwnDone(w, updated, current)) return;
    const n = svNextTodo(w, updated, current);
    if (n >= 0 && n !== current) setSvItem(n);
  };

  // ---------------- dimension check ----------------

  /**
   * A reading typed into a dimension field (replaces the prototype keypad). Only dimensions
   * assigned to the supervisor can be written (agreed rule; the server enforces it too).
   */
  const svreading = (item: number, pi: number, v: number | null) => {
    const L = supLotNow();
    const w = wsRef.current;
    if (!L || !w) return;
    const p = paramsOf(w, L)[pi];
    if (!p || !p.editable || item >= p.samples.length) return;
    if (((L.dims[p.id] || [])[item] ?? null) === v) return;
    patchLot(L.id, (l) => {
      const vals = [...(l.dims[p.id] || [])];
      vals[item] = v;
      return { ...l, dims: { ...l.dims, [p.id]: vals } };
    });
    void enqueue(() => supervisorService.setReading(L.id, p.id, p.samples[item], v));
  };

  // ---------------- report ----------------

  /** ACT.svpreview */
  const svpreview = () => setSvView('preview');

  /** ACT.oos */
  const oos = (v: string) => {
    const L = supLotNow();
    if (!L) return;
    patchLot(L.id, (l) => ({ ...l, oos: v }));
    void enqueue(() => supervisorService.setOos(L.id, v));
  };

  /** ACT.sign (Save) */
  const sign = async () => {
    const L = supLotNow();
    if (!L || saving) return;
    setSaving(true);
    try {
      await writeQueue.current; // make sure every reading and decision reached the server first
      const res = await supervisorService.sign(L.id);
      const fresh = (await reload()) ?? wsRef.current;
      const msg = `${L.code} ${res.status === 'onhold' ? 'saved and kept on hold' : 'completed'}.`;
      setSupMsg(msg);
      // Next lot: the oldest waiting lot, unless another supervisor is reviewing it.
      let nx: Lot | undefined = fresh ? supLots(fresh.lots).sort((a, b) => lotTs(a) - lotTs(b))[0] : undefined;
      if (nx && nx.lockBy && nx.lockBy.id !== fresh?.me.id) nx = undefined;
      if (nx) {
        const opened = await supervisorService.openLot(nx.id);
        if (opened.ok) {
          const again = (await reload()) ?? fresh;
          enterReview(lotOf(nx.id, again) ?? nx);
          setSupMsg(msg);
          return;
        }
      }
      setSvView('lots');
    } catch (err) {
      setErrMsg(`Couldn’t save the lot: ${err instanceof Error ? err.message : 'please try again.'}`);
      void reload();
    } finally {
      setSaving(false);
    }
  };

  return {
    ws, loadError, reload, saving, errMsg,
    svView, svPre, svOp, setSvOp, supQ, setSupQ, supMsg, setSupMsg, supId, supLot, reviewable,
    svItem,
    svnav, svlots, svgo, svclearpre, svopen, openFromList, openFromSearch, scan,
    svitem, svstep, svnexttodo, svdec, svreading,
    svpreview, oos, sign,
  };
}

export type SupervisorController = ReturnType<typeof useSupervisorController>;
