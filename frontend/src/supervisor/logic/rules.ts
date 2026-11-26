import { SPOT_CHECKS, type CheckItem, type CheckResult, type DimensionParam, type Lot, type Part, type ProtoStatus, type SupervisorCheck, type TemplateRef, type Workspace } from '../data/types';
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
export const paramsOf = (ws: Workspace, l: Lot): DimensionParam[] => templateOf(ws, l)?.params ?? [];
/** Supervisor-assigned pass/fail checks of the lot's template. */
export const supChecksOf = (ws: Workspace, l: Lot): SupervisorCheck[] => templateOf(ws, l)?.supChecks ?? [];

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
 * Overall (final) number of bad items in a lot: the operator's bad items, minus those the supervisor
 * changed to good (Approved), plus problems the supervisor found when spot-checking items the operator
 * passed. Rejected, on-hold and undecided items stay bad. Same rule as the server's PDF report.
 */
export const finalBadCount = (l: Lot): number => {
  const keptBad = l.parts.filter((p) => p && p.r === 'NG' && p.disp !== 'Approved').length;
  const spotProblems = Object.values(l.spot ?? {}).filter((s) => s?.r === 'NG').length;
  return keptBad + spotProblems;
};

/** Number of samples (prototype: 10): dimensions and supervisor checks share sample 1..n. */
export const nSamples = (ws: Workspace, l: Lot): number =>
  [...paramsOf(ws, l), ...supChecksOf(ws, l)].reduce((m, p) => Math.max(m, p.samples.length), 0);

/** Number of items in the lot (prototype: L.qty). Items past parts.length are not checked. */
export const nItems = (ws: Workspace, l: Lot): number => Math.max(l.qty || 0, l.parts.length, nSamples(ws, l));

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
  const p = l.parts[k];
  return (!!p && p.r === 'NG' && !p.disp) || (k < nSamples(ws, l) && !sampleOwnDone(ws, l, k));
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

/** Prototype svProgress */
export function svProgress(ws: Workspace, l: Lot) {
  const b = badIdx(l);
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
  const dec = b.filter((i) => (l.parts[i] as { disp: unknown }).disp).length;
  const spot = spotsOf(l).length;
  const spotNeed = spotsNeeded(l);
  return {
    bad: b.length, dec, samp, nSamples: n, spot, spotNeed,
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
