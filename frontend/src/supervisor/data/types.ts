/**
 * Supervisor data, in the shape the LotSure prototype screens read (its `S` object).
 * Built on the server from live tables by backend/app/supervisor_workspace.py.
 */

export type ProtoStatus = 'registered' | 'operator' | 'supervisor' | 'onhold' | 'completed';
export type Disposition = 'Approved' | 'On hold' | 'Rejected';

export interface PersonRef {
  id: number;
  name: string; // as stored, e.g. "Meena Rao (Supervisor)"; format with logic/format.ts
}

export interface WorkspaceUser {
  id: number;
  name: string;
  role: 'admin' | 'supervisor' | 'operator';
  active: boolean;
}

/** Prototype ITEMS entry + METHOD: one visual check. */
export interface CheckItem {
  id: string;
  g: string;      // group (stage)
  t: string;      // title
  desc: string;
  method: string;
}

/** Prototype PARAMS entry: one dimension. */
export interface DimensionParam {
  id: string;
  grp: string;
  t: string;
  min: number | null;
  max: number | null;
  spec: string;
  unit: string | null;
  samples: string[]; // sample column keys, e.g. ["S1".."S5"]
  method: string;
  /** Agreed rule: the supervisor enters this reading only when the dimension is assigned to them. */
  editable: boolean;
}

/** A pass/fail check assigned to the supervisor: Good / Bad per sample column. */
export interface SupervisorCheck {
  id: string;
  g: string;
  t: string;
  desc: string;
  method: string;
  samples: string[]; // sample column keys, e.g. ["S1".."S5"]
}

export type CheckResult = 'OK' | 'NG';

export interface SheetInfo {
  part: string | null;
  partName: string | null;
  model: string | null;
  vendor: string | null;
  title: string | null;
}

export interface TemplateRef {
  sheet: SheetInfo;
  items: CheckItem[];
  groups: string[];
  params: DimensionParam[];
  /** Supervisor-assigned pass/fail checks (items holds only the operator's checks). */
  supChecks: SupervisorCheck[];
}

/** Who checked an item and when, and the operator's result for each check (CheckItem.id). */
export interface PartCheck {
  res: Record<string, 'OK' | 'NG'>;
  by: number | null; // user id; the name is in Workspace.users
  at: string | null; // ISO
}

/** One item of a lot (prototype parts[i]), for every item 1..qty; null = not checked yet. */
export type Part =
  | null
  | ({ r: 'OK' } & PartCheck)
  | ({ r: 'NG'; ng: { id: string }[]; disp: Disposition | null } & PartCheck);

/**
 * Prototype L.spot[k]: the supervisor's own check of a good item. Always OK (an item the supervisor
 * finds bad is rejected instead); dims = the supervisor's readings where the item has no sample reading.
 */
export interface SpotCheck {
  r: 'OK' | 'NG';
  ng: string[];
  dims?: Record<string, number | null>;
}

/**
 * The supervisor's Yes/No answers where they differ from the operator's: the checks answered No.
 * d = the decision on an item the operator marked good and the supervisor found bad.
 */
export interface ItemAnswer {
  ng: string[];
  d?: Disposition | null;
}

export interface Lot {
  id: number;
  code: string;
  name: string;
  date: string | null;          // ISO
  qty: number;
  sheetId: string;
  round: number;
  backendStatus: string;
  status: ProtoStatus;
  supSeen: boolean;
  ts: string | null;            // ISO
  op: { by: PersonRef | null; at: string | null } | null;
  opBy: PersonRef | null;
  clearance: { d: string; note: string } | null;
  columns: string[];
  parts: Part[];
  /** Supervisor check results by SupervisorCheck.id, one per sample column (null = not done). */
  supChecks: Record<string, (CheckResult | null)[]>;
  dims: Record<string, (number | null)[]>;
  /** Supervisor spot checks, keyed by item index (0-based, as a string). At most 3. */
  spot: Record<string, SpotCheck>;
  /** Supervisor's answers that differ from the operator's, keyed by item index (0-based, as a string). */
  svd: Record<string, ItemAnswer>;
  /** Supervisor comments printed on the report. */
  supComment: string;
  oos: string | null;
  sup: { by: PersonRef | null; at: string | null } | null;
  rev: number;
  lockBy: PersonRef | null;
  returnNote: string | null;
}

export interface Workspace {
  me: { id: number; name: string; role: string };
  users: WorkspaceUser[];
  templates: Record<string, TemplateRef>;
  lots: Lot[];
  serverTime: string;
}

/** Prototype: the supervisor spot checks 3 good items per lot. */
export const SPOT_CHECKS = 3;

export const OOS_ACTIONS = ['Re-measured, confirmed', 'Lot put on hold', 'Process adjusted'] as const;

export type OpenLotResult =
  | { ok: true; view: 'review' | 'saved' }
  | { ok: false; reason: 'locked'; lockBy: PersonRef }
  | { ok: false; reason: 'not_ready' | 'not_found'; message: string };
