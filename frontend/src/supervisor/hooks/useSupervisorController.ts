import { useCallback, useEffect, useRef, useState } from 'react';
import { onBatchCreated, onBatchUpdated, onCellUpdated } from '../../liveSync';
import { SPOT_CHECKS, supervisorService, type CheckResult, type Disposition, type Lot, type SpotCheck, type Workspace } from '../data';
import { shortName } from '../logic/format';
import {
  REVIEWABLE_STATUSES, STATUS_TXT, SUPERVISOR_STATUSES, badIdx, dimValue, effAns, lotTs, nItems, nSamples, paramsOf,
  itemDecision, spotUsesSample, spotsOf, supChecksOf, supLots, supRejected, svStatusItem, svVisibleItems, templateOf, type ItemFilter,
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
const READING_SEND_MS = 600;
const COMMENT_SEND_MS = 700;

/** Prototype `sel`: the dimension tile (p = index into the template's params) of sample s. */
export interface DimSel { p: number; s: number }


const TOAST_MS = 3200;

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
  /** Prototype svSel: the item open in the item card. */
  const [svItem, setSvItemState] = useState<number | null>(null);
  /** Prototype sel / kpOpen / buf: selected dimension tile, keypad open, digits typed. */
  const [sel, setSelState] = useState<DimSel>({ p: 0, s: 0 });
  const [kpOpen, setKpState] = useState(false);
  const [buf, setBufState] = useState('');
  const [saving, setSaving] = useState(false);
  /** Errors from saving review changes (not in the prototype, which saved to localStorage). */
  const [errMsg, setErrMsg] = useState('');
  /** Prototype svFilt2: the item list filter. */
  const [svFilt, setSvFiltState] = useState<ItemFilter>('all');
  /** Prototype showToast */
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'bad' } | null>(null);
  const toastTimer = useRef<number | undefined>();
  const showToast = (text: string, kind: 'ok' | 'bad' = 'ok') => {
    setToast({ text, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  };

  // Refs mirror state for the keyboard handler and chained writes.
  const wsRef = useRef<Workspace | null>(null);
  const svItemRef = useRef<number | null>(svItem);
  const selRef = useRef<DimSel>(sel);
  const kpRef = useRef(false);
  const bufRef = useRef('');
  const loadSeq = useRef(0);
  const reloadTimer = useRef<number | undefined>();
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const setSvItem = (v: number | null) => { svItemRef.current = v; setSvItemState(v); };
  const setWsBoth = (v: Workspace) => { wsRef.current = v; setWs(v); };
  const setSelBoth = (v: DimSel) => { selRef.current = v; setSelState(v); };
  const setKp = (v: boolean) => { kpRef.current = v; setKpState(v); };
  const setBuf = (v: string) => { bufRef.current = v; setBufState(v); };

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
  const svnav = (v: 'dash' | 'scan' | 'lots') => { flushAll(); setKp(false); setSvView(v); setSupMsg(''); setErrMsg(''); };
  /** ACT.svlots (back link in the lot bar) */
  const svlots = () => { flushAll(); setKp(false); setSvView('lots'); };
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
    setSvFiltState('all');
    // Prototype: start on the first undecided bad item, else item 1; dimensions on sample 1.
    const b = badIdx(lot).find((k) => { const p = lot.parts[k]; return !!p && p.r === 'NG' && !p.disp; });
    setSvItem(b ?? 0);
    setKp(false);
    setBuf('');
    const w = wsRef.current;
    const own = w ? paramsOf(w, lot).findIndex((p) => p.editable && p.samples.length > 0) : -1;
    setSelBoth({ p: own < 0 ? 0 : own, s: 0 });
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

  // ---------------- items (prototype v2 svReview) ----------------

  /** Open item k. A sample item also selects its sample for the readings. */
  const openItem = (k: number) => {
    const L = lotOf(supId);
    const w = wsRef.current;
    if (!L || !w || k < 0 || k >= nItems(w, L)) return;
    flushReadings();
    setSvItem(k);
    setKp(false);
    setBuf('');
    if (k < nSamples(w, L)) setSelBoth({ p: selRef.current.p, s: k });
  };

  /** ACT.svitem (item list row) */
  const svitem = (k: number) => { if (k !== svItemRef.current) openItem(k); };

  /** ACT.svfilt2: filter the item list; opens the first shown item when the open one is hidden. */
  const svfilt = (f: ItemFilter) => {
    setSvFiltState(f);
    const L = lotOf(supId);
    const w = wsRef.current;
    if (!L || !w) return;
    const vis = svVisibleItems(w, L, f);
    if (vis.length && !vis.includes(svItemRef.current ?? -1)) openItem(vis[0]);
  };

  /** ACT.jumpgo: "Go to item #" (shows all items). Returns 'bad' when the number is out of range, else ''. */
  const jumpgo = (raw: string): string => {
    const L = lotOf(supId);
    const w = wsRef.current;
    if (!L || !w) return '';
    const n = parseInt(raw, 10);
    const N = nItems(w, L);
    if (!(n >= 1 && n <= N)) { showToast(`Enter an item number from 1 to ${N}.`, 'bad'); return 'bad'; }
    setSvFiltState('all');
    openItem(n - 1);
    return '';
  };

  /**
   * ACT.svans: answer one check Yes / No on the open item; saved at once (no Save button).
   * On a good item any No rejects it, and a rejected item can't stay a spot check.
   */
  const svans = (checkId: string, v: 'Y' | 'N') => {
    const L = supLotNow();
    const w = wsRef.current;
    const k = svItemRef.current;
    if (!L || !w || k == null) return;
    const p = L.parts[k];
    if (!p) return;
    const cur = effAns(L, k);
    if (v === 'N') cur.add(checkId); else cur.delete(checkId);
    const ng = (templateOf(w, L)?.items ?? []).map((x) => x.id).filter((id) => cur.has(id));
    const opNg = p.r === 'NG' ? p.ng.map((n) => n.id).sort().join() : '';
    const key = String(k);
    const svd = { ...(L.svd ?? {}) };
    // A good item found bad keeps its decision while it stays bad; back to all Yes drops it.
    if ([...ng].sort().join() === opNg) delete svd[key]; else svd[key] = { ng, d: p.r === 'OK' ? svd[key]?.d ?? null : null };
    const dropSpot = p.r === 'OK' && ng.length > 0 && !!L.spot?.[key];
    const spot = { ...(L.spot ?? {}) };
    if (dropSpot) delete spot[key];
    patchLot(L.id, (l) => ({ ...l, svd, spot }));
    void enqueue(() => supervisorService.saveItem(L.id, L.columns[k], ng));
    if (dropSpot) showToast(`Item ${k + 1} is now a bad item, so it is no longer a spot check. Decide it below.`, 'bad');
  };

  /** Prototype nextTodoAfter: the next bad item without a decision after `from`, wrapping; -1 when none. */
  const nextTodoAfter = (L: Lot, from: number) => {
    const n = L.parts.length;
    for (let d = 1; d < n; d++) {
      const k = (from + d) % n;
      if (svStatusItem(L, k) === 'todo') return k;
    }
    return -1;
  };

  /**
   * Decide the open bad item (marked bad by the operator, or found bad by the supervisor):
   * Approved / On hold / Rejected, saved at once; tapping the current decision again clears it.
   * A new decision opens the next item that still needs one.
   */
  const svdecide = (v: Disposition) => {
    const L = supLotNow();
    const k = svItemRef.current;
    if (!L || k == null) return;
    const p = L.parts[k];
    const cur = itemDecision(L, k);
    if (!p || cur === undefined) return;
    const d = cur === v ? null : v;
    const key = String(k);
    const next: Lot = p.r === 'NG'
      ? { ...L, parts: L.parts.map((q, i) => (i === k && q && q.r === 'NG' ? { ...q, disp: d } : q)) }
      : { ...L, svd: { ...(L.svd ?? {}), [key]: { ng: L.svd?.[key]?.ng ?? [], d } } };
    patchLot(L.id, () => next);
    void enqueue(() => supervisorService.setDisposition(L.id, L.columns[k], d));
    if (!d) return;
    const res = `Item ${k + 1} ${d === 'On hold' ? 'kept on hold' : d.toLowerCase()}.`;
    const n = nextTodoAfter(next, k);
    if (n >= 0) {
      openItem(n);
      showToast(`${res} Opened item ${n + 1}, which needs a decision.`);
    } else {
      showToast(res);
    }
  };

  // ---------------- spot checks ----------------

  const writeSpot = (L: Lot, k: number, spot: SpotCheck | null) => {
    patchLot(L.id, (l) => {
      const all = { ...(l.spot ?? {}) };
      if (spot) all[String(k)] = spot; else delete all[String(k)];
      return { ...l, spot: all };
    });
    void enqueue(() => supervisorService.setSpot(L.id, L.columns[k], spot));
  };

  /** ACT.svspot3: mark / unmark the open item as a spot check. Good items the supervisor hasn't rejected only. */
  const svspot3 = () => {
    const L = supLotNow();
    const k = svItemRef.current;
    if (!L || k == null) return;
    const p = L.parts[k];
    if (!p || p.r !== 'OK') return;
    if (L.spot?.[String(k)]) { writeSpot(L, k, null); return; }
    if (supRejected(L, k)) { showToast('An item you rejected can’t be a spot check.', 'bad'); return; }
    if (spotsOf(L).length >= SPOT_CHECKS) { showToast(`Only ${SPOT_CHECKS} spot checks per lot. Remove one first.`, 'bad'); return; }
    writeSpot(L, k, { r: 'OK', ng: [], dims: {} });
  };

  /** ACT.svrand (Pick a random item): a good item to spot check (not rejected, not spot checked), preferring non-sample items. */
  const svrand = () => {
    const L = supLotNow();
    const w = wsRef.current;
    if (!L || !w) return;
    const S = nSamples(w, L);
    const cur = svItemRef.current;
    const open = L.parts.map((p, k) => (p && p.r === 'OK' && svStatusItem(L, k) === 'none' && k !== cur ? k : -1)).filter((k) => k >= 0);
    const pool = open.filter((k) => k >= S).length ? open.filter((k) => k >= S) : open;
    if (pool.length) { setSvFiltState('all'); openItem(pool[Math.floor(Math.random() * pool.length)]); }
    else showToast('No good item is left to spot check.', 'bad');
  };

  /**
   * A reading typed into a spot-checked item's dimension box. Goes into the item's sample cell when
   * the item is a sample item and that cell is the supervisor's; otherwise into the spot check.
   */
  const typeSpotReading = (pi: number, v: number | null) => {
    const L = supLotNow();
    const w = wsRef.current;
    const k = svItemRef.current;
    if (!L || !w || k == null || !L.spot?.[String(k)]) return;
    const p = paramsOf(w, L)[pi];
    if (!p) return;
    if (spotUsesSample(p, k)) { setReadingLocal(L, pi, k, v); return; }
    patchLot(L.id, (l) => {
      const sp = l.spot?.[String(k)];
      if (!sp) return l;
      return { ...l, spot: { ...l.spot, [String(k)]: { ...sp, dims: { ...(sp.dims ?? {}), [p.id]: v } } } };
    });
    pendingReadings.current.set(`${L.id}|spot|${k}|${p.id}`, () => supervisorService.setSpotReading(L.id, L.columns[k], p.id, v));
    window.clearTimeout(readingTimer.current);
    readingTimer.current = window.setTimeout(flushReadings, READING_SEND_MS);
  };

  // ---------------- dimension check (sample chips, tiles, keypad) ----------------

  /** Readings typed on the keypad are shown at once and sent after a short pause (or on Done / next tile). */
  const pendingReadings = useRef(new Map<string, () => Promise<unknown>>());
  const readingTimer = useRef<number | undefined>();
  const flushReadings = () => {
    window.clearTimeout(readingTimer.current);
    const sends = [...pendingReadings.current.values()];
    pendingReadings.current.clear();
    sends.forEach((send) => void enqueue(send));
  };

  const pendingComment = useRef<(() => Promise<unknown>) | null>(null);
  const commentTimer = useRef<number | undefined>();
  const flushComment = () => {
    window.clearTimeout(commentTimer.current);
    const send = pendingComment.current;
    pendingComment.current = null;
    if (send) void enqueue(send);
  };

  const flushAll = () => { flushReadings(); flushComment(); };

  /** Supervisor-entered dimensions of sample s (operator readings can't be typed here). */
  const ownParams = (w: Workspace, L: Lot, s: number) => paramsOf(w, L).map((p, pi) => ({ p, pi })).filter(({ p }) => p.editable && s < p.samples.length);

  const setReadingLocal = (L: Lot, pi: number, s: number, v: number | null) => {
    const w = wsRef.current;
    const p = w ? paramsOf(w, L)[pi] : undefined;
    if (!p || !p.editable || s >= p.samples.length) return;
    patchLot(L.id, (l) => {
      const vals = [...(l.dims[p.id] || [])];
      vals[s] = v;
      return { ...l, dims: { ...l.dims, [p.id]: vals } };
    });
    pendingReadings.current.set(`${L.id}|${p.id}|${s}`, () => supervisorService.setReading(L.id, p.id, p.samples[s], v));
    window.clearTimeout(readingTimer.current);
    readingTimer.current = window.setTimeout(flushReadings, READING_SEND_MS);
  };

  /** Prototype v2 .dvin input: a reading typed into a dimension box of sample s (null clears it). */
  const typeReading = (pi: number, s: number, v: number | null) => {
    const L = supLotNow();
    if (L) setReadingLocal(L, pi, s, v);
  };

  /** Prototype advance(): next empty reading in this sample, else the next sample's first empty one. */
  const advance = () => {
    setBuf('');
    flushReadings();
    const L = lotOf(supId);
    const w = wsRef.current;
    if (!L || !w) return;
    const { p, s } = selRef.current;
    const S = nSamples(w, L);
    const empty = (it: number, after: number) => ownParams(w, L, it).find(({ p: q, pi }) => pi > after && dimValue(L, q, it) == null);
    const here = empty(s, p);
    if (here) { setSelBoth({ p: here.pi, s }); return; }
    for (let it = s + 1; it < S; it++) {
      const e = empty(it, -1) ?? ownParams(w, L, it)[0];
      if (e) { setSelBoth({ p: e.pi, s: it }); return; }
    }
    const later = ownParams(w, L, s).find(({ pi }) => pi > p);
    if (later) setSelBoth({ p: later.pi, s });
  };

  /** Prototype keyDigit: type a digit or the decimal point into the open tile. Two decimals moves on. */
  const key = (d: string) => {
    const L = supLotNow();
    if (!L || !kpRef.current) return;
    let b = bufRef.current;
    if (d === '.') {
      if (b.includes('.')) return;
      b = b ? `${b}.` : '0.';
    } else {
      if (b.length >= 6) return;
      b += d;
    }
    setBuf(b);
    const v = parseFloat(b);
    setReadingLocal(L, selRef.current.p, selRef.current.s, Number.isNaN(v) ? null : v);
    if (/^\d+\.\d{2}$/.test(b)) advance();
  };

  /** Prototype bksp */
  const bksp = () => {
    const L = supLotNow();
    if (!L || !kpRef.current) return;
    const { p, s } = selRef.current;
    const b = bufRef.current;
    if (!b) { setReadingLocal(L, p, s, null); return; }
    const nb = b.slice(0, -1);
    setBuf(nb);
    const v = parseFloat(nb);
    setReadingLocal(L, p, s, nb && !Number.isNaN(v) ? v : null);
  };

  /** ACT.svsample: choose a sample; selects its first empty reading. */
  const svsample = (s: number) => {
    const L = lotOf(supId);
    const w = wsRef.current;
    if (!L || !w) return;
    flushReadings();
    const own = ownParams(w, L, s);
    const e = own.find(({ p }) => dimValue(L, p, s) == null) ?? own[0];
    setSelBoth({ p: e ? e.pi : 0, s });
    setBuf('');
  };

  /** ACT.svdim: open the keypad on one tile (only readings assigned to the supervisor). */
  const svdim = (pi: number) => {
    const L = supLotNow();
    const w = wsRef.current;
    if (!L || !w) return;
    const p = paramsOf(w, L)[pi];
    if (!p || !p.editable) return;
    flushReadings();
    setSelBoth({ p: pi, s: selRef.current.s });
    setBuf('');
    setKp(true);
  };

  /** ACT.kpclose */
  const kpclose = () => { flushReadings(); setKp(false); setBuf(''); };

  /** A supervisor check for sample s: Good / Bad; tapping the current result again clears it. */
  const svcheck = (s: number, checkId: string, v: CheckResult) => {
    const L = supLotNow();
    const w = wsRef.current;
    if (!L || !w) return;
    const chk = supChecksOf(w, L).find((x) => x.id === checkId);
    if (!chk || s >= chk.samples.length) return;
    const next = (L.supChecks?.[checkId] || [])[s] === v ? null : v;
    patchLot(L.id, (l) => {
      const vals = [...(l.supChecks?.[checkId] || Array(chk.samples.length).fill(null))];
      vals[s] = next;
      return { ...l, supChecks: { ...(l.supChecks ?? {}), [checkId]: vals } };
    });
    void enqueue(() => supervisorService.setCheck(L.id, checkId, chk.samples[s], next));
  };

  // ---------------- comments ----------------

  /** #svcomment input */
  const setComment = (text: string) => {
    const L = supLotNow();
    if (!L) return;
    patchLot(L.id, (l) => ({ ...l, supComment: text }));
    pendingComment.current = () => supervisorService.setComment(L.id, text);
    window.clearTimeout(commentTimer.current);
    commentTimer.current = window.setTimeout(flushComment, COMMENT_SEND_MS);
  };

  // ---------------- report ----------------

  /** ACT.svpreview */
  const svpreview = () => { flushAll(); setKp(false); setBuf(''); setSvView('preview'); };

  /** Report preview: back to the review. */
  const svback = () => setSvView('review');

  /** ACT.oos */
  const oos = (v: string) => {
    const L = supLotNow();
    if (!L) return;
    patchLot(L.id, (l) => ({ ...l, oos: v }));
    void enqueue(() => supervisorService.setOos(L.id, v));
  };

  /** Prototype svDownload: the report as a PDF, after every pending change has been saved. */
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    const L = lotOf(supId);
    if (!L || downloading) return;
    setDownloading(true);
    setErrMsg('');
    try {
      flushAll();
      await writeQueue.current;
      await supervisorService.downloadReportPdf(L.id, L.code);
    } catch (err) {
      setErrMsg(`Couldn’t download the report: ${err instanceof Error ? err.message : 'please try again.'}`);
    } finally {
      setDownloading(false);
    }
  };

  /** ACT.sign (Save) */
  const sign = async () => {
    const L = supLotNow();
    if (!L || saving) return;
    setSaving(true);
    try {
      flushAll();
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
    svItem, sel, kpOpen, buf,
    svnav, svlots, svgo, svclearpre, svopen, openFromList, openFromSearch, scan,
    svitem, svFilt, svfilt, jumpgo, svans, svdecide, svspot3, svrand, toast, typeSpotReading,
    svsample, svdim, kpclose, key, bksp, advance, svcheck, typeReading,
    setComment,
    svpreview, svback, oos, sign, download, downloading,
  };
}

export type SupervisorController = ReturnType<typeof useSupervisorController>;
