import { SPOT_CHECKS, type CheckItem, type Disposition, type CheckResult, type DimensionParam, type Lot, type Part, type ProtoStatus, type SupervisorCheck, type TemplateRef, type Workspace } from '../data/types';
import { lotTsMs } from './format';

/**
 * Lot rules ported from the LotSure prototype. Differences forced by our data:
 * - PARAMS / ITEMS are per template (lot.sheetId) instead of global constants.
 * - A lot's items are 1..lot.qty (lot.parts.length); item k is the visual checks' column "k".
 */

export const STATUS_TXT: Record<ProtoStatus, string> = {
  onhold: 'On hold', completed: 'Completed', registered: 'Waiting for inspection',
  operator: 'Inspecting', supervisor: 'With supervisor',
};

export const SUPERVISOR_STATUSES: ProtoStatus[] = ['supervisor', 'onhold', 'completed'];
export const REVIEWABLE_STATUSES: ProtoStatus[] = ['supervisor', 'onhold'];

export const templateOf = (ws: Workspace, l: Lot): TemplateRef | undefined => ws.templates[l.sheetId];

/** Items in the lot (prototype L.qty). */
export const lotSize = (l: Lot): number => l.qty || l.parts.length;

/**
 * Sample j is measured on item j+1, so a lot has at most lotSize samples even when the template
 * lists more (e.g. S1..S11 on a lot of 10). Trimmed copies are cached per template and size so
 * the same lot always gets the same objects (screens compare them by identity).
 */
const trimCache = new WeakMap<TemplateRef, Map<number, { params: DimensionParam[]; supChecks: SupervisorCheck[] }>>();
function trimmed(ws: Workspace, l: Lot) {
  const t = templateOf(ws, l);
  if (!t) return { params: [], supChecks: [] };
  const n = lotSize(l);
  let byN = trimCache.get(t);
  if (!byN) { byN = new Map(); trimCache.set(t, byN); }
  let v = byN.get(n);
  if (!v) {
    const cut = <T extends { samples: string[] }>(x: T): T => (n && x.samples.length > n ? { ...x, samples: x.samples.slice(0, n) } : x);
    v = { params: t.params.map(cut), supChecks: t.supChecks.map(cut) };
    byN.set(n, v);
  }
  return v;
}
export const paramsOf = (ws: Workspace, l: Lot): DimensionParam[] => trimmed(ws, l).params;
/** Supervisor-assigned pass/fail checks of the lot's template. */
export const supChecksOf = (ws: Workspace, l: Lot): SupervisorCheck[] => trimmed(ws, l).supChecks;

/** Prototype itemById, across all templates (item ids are unique). */
export function itemById(ws: Workspace, id: string): CheckItem | undefined {
  for (const t of Object.values(ws.templates)) {
    const it = t.items.find((x) => x.id === id);
    if (it) return it;
  }
  return undefined;
}

/** Prototype st(p, v): bad outside min/max, warn within 10% of the range from a limit. */
export function st(p: DimensionParam, v: number | null | undefined): '' | 'bad' | 'warn' | 'good' {
  if (v == null) return '';
  if (p.min == null || p.max == null) return 'good';
  const b = (p.max - p.min) * 0.1, e = 1e-9;
  if (v < p.min - e || v > p.max + e) return 'bad';
  if (v < p.min + b - e || v > p.max - b + e) return 'warn';
  return 'good';
}

export const isNG = (p: Part): boolean => !!p && p.r === 'NG' && p.disp !== 'Approved';
export const doneN = (l: Lot): number => l.parts.filter(Boolean).length;
export const lotTs = (l: Lot): number => lotTsMs(l.ts);

export interface Reading { p: DimensionParam; v: number | null; j: number; s: ReturnType<typeof st> }

/** Prototype stats(L) */
export function stats(ws: Workspace, l: Lot) {
  const all: Reading[] = [];
  paramsOf(ws, l).forEach((p) => (l.dims[p.id] || []).forEach((v, j) => all.push({ p, v, j, s: st(p, v) })));
  // The supervisor's own readings on spot-checked items (j = item index) count for out-of-spec too.
  Object.entries(l.spot ?? {}).forEach(([k, sp]) => paramsOf(ws, l).forEach((p) => {
    const v = sp.dims?.[p.id];
    if (v != null) all.push({ p, v, j: Number(k), s: st(p, v) });
  }));
  return {
    filled: all.filter((x) => x.v != null).length,
    warn: all.filter((x) => x.s === 'warn'),
    bad: all.filter((x) => x.s === 'bad'),
    ng: l.parts.filter(isNG).length,
    corr: l.parts.filter((x) => x && x.r === 'NG' && x.disp === 'Approved').length,
    undecided: l.parts.filter((x) => x && x.r === 'NG' && !x.disp).length,
    total: all.length,
  };
}

/** Prototype supLots(): lots waiting for the supervisor. */
export const supLots = (lots: Lot[]): Lot[] => lots.filter((l) => l.status === 'supervisor');

/** Prototype svStatusOf */
export const svStatusOf = (x: Lot): 'New' | 'Pending' | 'On hold' | 'Completed' =>
  x.status === 'supervisor' ? (x.supSeen ? 'Pending' : 'New') : x.status === 'onhold' ? 'On hold' : 'Completed';

/** Prototype svAllLots */
export const svAllLots = (lots: Lot[]): Lot[] => lots.filter((x) => SUPERVISOR_STATUSES.includes(x.status));

// ---------------------------------------------------------------------------
// Lot review (svReview / svProgress / dimStatusSV). The prototype has a fixed 10 samples x 6
// dimensions ("items 1-10 are the dimension samples"); here each template has its own
// dimensions and sample counts, so sample j is still shown on item j+1.
// ---------------------------------------------------------------------------

/** Prototype DEC: decision -> pill class */
export const DEC: Record<string, 'ok' | 'warn' | 'ng'> = { Approved: 'ok', 'On hold': 'warn', Rejected: 'ng' };

/** Prototype badIdx */
export const badIdx = (l: Lot): number[] =>
  l.parts.map((p, i) => (p && p.r === 'NG' ? i : -1)).filter((i) => i >= 0);

/**
 * Overall (final) number of bad items in a lot, after the supervisor's review: the operator's bad
 * items, plus good items the supervisor found bad, minus any the supervisor changed to good
 * (Approved). Problems recorded by older spot checks count too. Rejected, on-hold and undecided
 * items stay bad. Same rule as the server (final_bad_count): the PDF report and the dashboard.
 */
export const finalBadCount = (l: Lot): number =>
  l.parts.reduce((n, _p, k) => {
    const d = itemDecision(l, k);
    if (d !== undefined) return n + (d !== 'Approved' ? 1 : 0);
    return n + (l.spot?.[String(k)]?.r === 'NG' ? 1 : 0);
  }, 0);

/** Number of samples (prototype: 10): dimensions and supervisor checks share sample 1..n. */
export const nSamples = (ws: Workspace, l: Lot): number =>
  [...paramsOf(ws, l), ...supChecksOf(ws, l)].reduce((m, p) => Math.max(m, p.samples.length), 0);

/** Number of items in the lot (prototype: L.qty). Items past parts.length are not checked. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const nItems = (_ws: Workspace, l: Lot): number => lotSize(l);

/** Dimensions that have a sample j (prototype: all 6 PARAMS). */
export const sampleParams = (ws: Workspace, l: Lot, j: number): DimensionParam[] =>
  paramsOf(ws, l).filter((p) => j < p.samples.length);

export const dimValue = (l: Lot, p: DimensionParam, j: number): number | null => (l.dims[p.id] || [])[j] ?? null;

/** Supervisor checks that have a sample j. */
export const sampleChecks = (ws: Workspace, l: Lot, j: number): SupervisorCheck[] =>
  supChecksOf(ws, l).filter((c) => j < c.samples.length);

export const checkValue = (l: Lot, c: SupervisorCheck, j: number): CheckResult | null => (l.supChecks?.[c.id] || [])[j] ?? null;

/** Prototype sampleDone: every dimension and supervisor check of sample j done. */
export const sampleDone = (ws: Workspace, l: Lot, j: number): boolean =>
  sampleParams(ws, l, j).every((p) => dimValue(l, p, j) != null)
  && sampleChecks(ws, l, j).every((c) => checkValue(l, c, j) != null);

/** Sample j has everything the supervisor enters (the operator's own readings can't be typed here). */
export const sampleOwnDone = (ws: Workspace, l: Lot, j: number): boolean =>
  sampleParams(ws, l, j).every((p) => !p.editable || dimValue(l, p, j) != null)
  && sampleChecks(ws, l, j).every((c) => checkValue(l, c, j) != null);

/** Prototype sampleCount: readings and checks done in sample j. */
export const sampleCount = (ws: Workspace, l: Lot, j: number): number =>
  sampleParams(ws, l, j).filter((p) => dimValue(l, p, j) != null).length
  + sampleChecks(ws, l, j).filter((c) => checkValue(l, c, j) != null).length;

/** Readings + checks in sample j (the denominator next to sampleCount). */
export const sampleTotal = (ws: Workspace, l: Lot, j: number): number =>
  sampleParams(ws, l, j).length + sampleChecks(ws, l, j).length;

/** Item still to do: a bad item without a decision, or a sample with readings the supervisor still has to enter. */
export const isTodo = (ws: Workspace, l: Lot, k: number): boolean => {
  // A bad item (operator's, or found bad by the supervisor) with no decision yet
  if (itemDecision(l, k) === null) return true;
  // A sample item whose supervisor readings / checks are not all in
  if (k < nSamples(ws, l) && !sampleOwnDone(ws, l, k)) return true;
  // A marked spot check still missing a dimension reading the supervisor can type
  if (l.spot?.[String(k)] && !supRejected(l, k)) {
    return paramsOf(ws, l).some((p) => {
      if (spotDimValue(l, p, k) != null) return false;
      const sampleV = k < p.samples.length ? dimValue(l, p, k) : null;
      return spotUsesSample(p, k) || sampleV == null;
    });
  }
  return false;
};

/** Prototype svNextTodo: the next item to do after `from`, in item order, wrapping; -1 when none. */
export function svNextTodo(ws: Workspace, l: Lot, from: number): number {
  const n = nItems(ws, l);
  for (let d = 1; d <= n; d++) {
    const k = (((from + d) % n) + n) % n;
    if (isTodo(ws, l, k)) return k;
  }
  return -1;
}

/** Prototype spotsOf: item indexes with a supervisor spot check, in item order. */
export const spotsOf = (l: Lot): number[] =>
  Object.keys(l.spot ?? {}).map(Number).filter((k) => !Number.isNaN(k)).sort((a, b) => a - b);

/** Spot checks needed: 3, or fewer when the lot has fewer good items (same rule as the server). */
export const spotsNeeded = (l: Lot): number =>
  Math.min(SPOT_CHECKS, l.parts.filter((p) => p && p.r === 'OK').length);

// ---------------------------------------------------------------------------
// Prototype v2 review: every item of the lot in the list, with the supervisor's status.
// ---------------------------------------------------------------------------

export type ItemStatus = 'todo' | 'rejected' | 'hold' | 'spot' | 'approved' | 'none';

/** The supervisor answered No to a check on an item the operator marked good: found bad (needs a decision). */
export const supRejected = (l: Lot, k: number): boolean => {
  const p = l.parts[k];
  return !!p && p.r === 'OK' && (l.svd?.[String(k)]?.ng.length ?? 0) > 0;
};

/**
 * Decision on bad item k: an item the operator marked bad, or one the supervisor found bad.
 * undefined = not a bad item; null = still to decide.
 */
export function itemDecision(l: Lot, k: number): Disposition | null | undefined {
  const p = l.parts[k];
  if (p && p.r === 'NG') return p.disp ?? null;
  if (supRejected(l, k)) return l.svd?.[String(k)]?.d ?? null;
  return undefined;
}

/**
 * The supervisor's status of item k. Bad items (the operator's, or good items the supervisor found
 * bad) are decided: Approved / On hold / Rejected. Other good items can be spot checked.
 */
export function svStatusItem(l: Lot, k: number): ItemStatus {
  const d = itemDecision(l, k);
  if (d !== undefined) {
    if (!d) return 'todo';
    return d === 'Rejected' ? 'rejected' : d === 'On hold' ? 'hold' : 'approved';
  }
  if (l.spot?.[String(k)]) return 'spot';
  return 'none';
}

/** Prototype SV_TAG: [pill class, text] for the item list. */
export const SV_TAG: Partial<Record<ItemStatus, [string, string]>> = {
  // A good spot check reads as Approved; the ★ next to the item already marks it as a spot check.
  todo: ['ng', '✕ Decide'], rejected: ['ng', 'Rejected'], hold: ['warn', 'On hold'], spot: ['ok', 'Approved'], approved: ['ok', 'Approved'],
};

/** Prototype effAns: the checks answered No for item k (the supervisor's answers, else the operator's). */
export function effAns(l: Lot, k: number): Set<string> {
  const p = l.parts[k];
  const saved = l.svd?.[String(k)];
  if (saved) return new Set(saved.ng);
  if (p && p.r === 'NG') return new Set(p.ng.map((n) => n.id));
  return new Set();
}

/**
 * Reading of dimension p on spot-checked item k: its sample reading when item k is a sample
 * item and has one, else the supervisor's spot reading.
 */
export function spotDimValue(l: Lot, p: DimensionParam, k: number): number | null {
  const sv = k < p.samples.length ? dimValue(l, p, k) : null;
  return sv ?? l.spot?.[String(k)]?.dims?.[p.id] ?? null;
}

/** The supervisor types this spot reading into the sample (the sample cell is theirs), else into the spot check. */
export const spotUsesSample = (p: DimensionParam, k: number): boolean => k < p.samples.length && p.editable;

/** Dimension readings still missing on spot-checked item k (every dimension is required). */
export const spotMissing = (ws: Workspace, l: Lot, k: number): number =>
  paramsOf(ws, l).filter((p) => spotDimValue(l, p, k) == null).length;

/**
 * Report summary after the supervisor's review (same rules as the report PDF):
 * - bad: items the operator marked bad and the supervisor hasn't approved (rejected, on hold or
 *   undecided), plus items the operator marked good and the supervisor found bad;
 * - readings: the supervisor's own readings: sample cells of supervisor dimensions, supervisor
 *   checks, and spot-check readings not taken from a sample cell.
 */
export function supSummary(ws: Workspace, l: Lot) {
  const n = l.parts.length;
  const bad = finalBadCount(l);
  let filled = 0;
  let total = 0;
  const count = (v: unknown) => { total++; if (v != null) filled++; };
  paramsOf(ws, l).filter((p) => p.editable).forEach((p) => p.samples.forEach((_, j) => count(dimValue(l, p, j))));
  supChecksOf(ws, l).forEach((c) => c.samples.forEach((_, j) => count(checkValue(l, c, j))));
  spotsOf(l).filter((k) => !supRejected(l, k)).forEach((k) => paramsOf(ws, l).forEach((p) => {
    const fromSample = k < p.samples.length && (p.editable || dimValue(l, p, k) != null);
    if (!fromSample) count(l.spot[String(k)]?.dims?.[p.id] ?? null);
  }));
  return { items: n, good: n - bad, bad, filled, total };
}

/** Spot checks that count: good items not rejected by the supervisor, with every dimension measured. */
export const spotsDone = (ws: Workspace, l: Lot): number =>
  spotsOf(l).filter((k) => !supRejected(l, k) && spotMissing(ws, l, k) === 0).length;

export type ItemFilter = 'all' | 'approved' | 'todo' | 'rejected' | 'hold' | 'spot' | 'measured';

export const ITEM_FILTERS: [ItemFilter, string][] = [
  ['all', 'All items'], ['approved', 'Approved'], ['todo', 'To decide'], ['rejected', 'Rejected'],
  ['hold', 'On hold'], ['spot', 'Spot check'], ['measured', 'Measured'],
];

/** Prototype svFilt2 filter: the item indexes shown in the list. Measured = the sample items. */
export function svVisibleItems(ws: Workspace, l: Lot, f: ItemFilter): number[] {
  const n = nItems(ws, l);
  const S = nSamples(ws, l);
  const all = Array.from({ length: n }, (_, k) => k);
  if (f === 'all') return all;
  if (f === 'measured') return all.filter((k) => k < S);
  if (f === 'spot') return all.filter((k) => !!l.spot?.[String(k)]);
  // Good spot checks are tagged Approved, so they are listed under Approved too.
  if (f === 'approved') return all.filter((k) => ['approved', 'spot'].includes(svStatusItem(l, k)));
  return all.filter((k) => svStatusItem(l, k) === f);
}

/** Prototype svProgress */
export function svProgress(ws: Workspace, l: Lot) {
  // Bad items to decide: the operator's, plus good items the supervisor found bad.
  const b = l.parts.map((_p, k) => (itemDecision(l, k) !== undefined ? k : -1)).filter((k) => k >= 0);
  const n = nSamples(ws, l);
  let samp = 0;
  let opMissing = 0;
  let ownMissing = 0;
  for (let s = 0; s < n; s++) {
    // A sample counts as measured once every reading the supervisor enters is in.
    if (sampleOwnDone(ws, l, s)) samp++;
    sampleParams(ws, l, s).forEach((p) => {
      if (dimValue(l, p, s) == null) { if (p.editable) ownMissing++; else opMissing++; }
    });
    sampleChecks(ws, l, s).forEach((c) => { if (checkValue(l, c, s) == null) ownMissing++; });
  }
  const dec = b.filter((i) => !!itemDecision(l, i)).length;
  const spot = spotsDone(ws, l);
  const spotNeed = spotsNeeded(l);
  return {
    /** spot = spot checks complete (every dimension measured); spotMarked = items marked as spot checks. */
    bad: b.length, dec, samp, nSamples: n, spot, spotMarked: spotsOf(l).length, spotNeed,
    /** Readings the operator didn't enter (the supervisor can't enter them). */
    opMissing,
    /** Everything the supervisor can do is done (what Save requires). */
    ready: dec === b.length && ownMissing === 0 && spot >= spotNeed,
  };
}

/** Prototype dimStatusSV(p, vals): [pill class, text] */
export function dimStatusSV(p: DimensionParam, vals: (number | null)[]): [string, string] {
  const s = vals.map((v) => st(p, v));
  const f = vals.filter((v) => v != null).length;
  if (s.includes('bad')) return ['ng', 'Out of spec'];
  if (f < p.samples.length) return ['neutral', `${f}/${p.samples.length}`];
  if (s.includes('warn')) return ['warn', 'Near limit'];
  return ['ok', '✓'];
}

/** Prototype fmt */
export const fmt = (v: number | null | undefined): string => (v == null ? '' : v.toFixed(2));
