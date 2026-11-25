import type { ControlItem, SheetTemplate } from '../../types';

/**
 * Template builder model.
 *
 * Nothing here adds backend concepts. Every UI choice is turned into the fields the
 * backend already stores on a template row (row_mode, html_input_type, sample_columns,
 * min_val, max_val, unit, assigned_role, is_required), using the same rules the Operator
 * screen (OperatorInspection.tsx) and the Supervisor data builder (supervisor_workspace.py) read.
 */

export type Section = 'operator' | 'supervisor';
export type CheckKind = 'yesno' | 'passfail' | 'numeric' | 'text' | 'other';

export interface DraftItem extends ControlItem {
  /** UI-only key so new rows have a stable identity. Never sent to the server. */
  _uid: string;
}

export interface DraftTemplate {
  sheet_id: string;
  document_title: string;
  part_no: string;
  part_name: string;
  model_name: string;
  vendor_name: string;
  customer_name: string;
  part_category: string;
  items: DraftItem[];
}

export type FieldErrors = Record<string, string>;
export interface ValidationResult {
  basic: FieldErrors;
  items: Record<string, FieldErrors>; // keyed by _uid
  basicCount: number;
  operatorCount: number;
  supervisorCount: number;
  total: number;
}

let uidCounter = 0;
export const newUid = () => `row-${Date.now().toString(36)}-${++uidCounter}`;

export const SAMPLE_MIN = 1;
export const SAMPLE_MAX = 50;

export const KIND_INFO: Record<Exclude<CheckKind, 'other'>, { label: string; hint: string }> = {
  yesno: { label: 'Yes / No', hint: 'Tick box. Ticked counts as OK.' },
  passfail: { label: 'Pass / Fail', hint: 'Pass and Fail buttons. Fail counts as out of spec.' },
  numeric: { label: 'Numeric measurement', hint: 'A reading checked against a minimum and maximum.' },
  text: { label: 'Text', hint: 'A free-text entry with no pass / fail limit.' },
};

export const KINDS_BY_SECTION: Record<Section, Exclude<CheckKind, 'other'>[]> = {
  operator: ['yesno', 'passfail', 'numeric', 'text'],
  supervisor: ['yesno', 'passfail', 'numeric'],
};

export const sectionOf = (item: ControlItem): Section | 'other' =>
  item.assigned_role === 'supervisor' ? 'supervisor' : item.assigned_role === 'admin' ? 'other' : 'operator';

/** Reads the stored fields back into the UI's kind (same precedence the checksheet screen uses). */
export function detectKind(item: ControlItem): CheckKind {
  if (item.row_mode === 'NUMERIC_SAMPLE' || item.html_input_type === 'number') return 'numeric';
  if (item.html_input_type === 'pf') return 'passfail';
  if (item.row_mode === 'SERIAL_TICKBOX' || item.html_input_type === 'checkbox') return 'yesno';
  if (item.row_mode === 'STANDARD_INPUT' && item.html_input_type === 'text') return 'text';
  return 'other';
}

export const kindLabel = (k: CheckKind) => (k === 'other' ? 'Other (kept as saved)' : KIND_INFO[k].label);

export const defaultSamples = (kind: CheckKind): number => (kind === 'numeric' ? 5 : kind === 'text' ? 1 : 10);

/** Existing convention: tick rows use "1", "2", ... and numeric rows use "S1", "S2", ... */
const prefixFor = (kind: CheckKind) => (kind === 'numeric' ? 'S' : '');

export function makeColumns(kind: CheckKind, n: number): string[] {
  if (kind === 'text') return ['val'];
  return Array.from({ length: n }, (_, i) => `${prefixFor(kind)}${i + 1}`);
}

/** Resize while keeping the names already saved, so existing column keys never change. */
export function resizeColumns(cols: string[], kind: CheckKind, n: number): string[] {
  if (kind === 'text') return ['val'];
  const out = cols.slice(0, n);
  let next = out.length + 1;
  while (out.length < n) {
    const name = `${prefixFor(kind)}${next++}`;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Applies a kind to a row, writing exactly the fields the backend and other screens read. */
export function applyKind(item: DraftItem, kind: Exclude<CheckKind, 'other'>): DraftItem {
  const prev = detectKind(item);
  const base = { ...item };
  switch (kind) {
    case 'yesno':
      Object.assign(base, { row_mode: 'SERIAL_TICKBOX', html_input_type: 'checkbox', min_val: null, max_val: null, unit: null });
      break;
    case 'passfail':
      Object.assign(base, { row_mode: 'SERIAL_TICKBOX', html_input_type: 'pf', min_val: null, max_val: null, unit: null });
      break;
    case 'numeric':
      Object.assign(base, { row_mode: 'NUMERIC_SAMPLE', html_input_type: 'number' });
      break;
    case 'text':
      Object.assign(base, { row_mode: 'STANDARD_INPUT', html_input_type: 'text', min_val: null, max_val: null, unit: null });
      break;
  }
  // Keep the saved count when switching between tick styles or numeric <-> tick. Only the naming
  // changes (1, 2.. for tick rows; S1, S2.. for numeric rows). Text rows have a single "val" column.
  const hadSamples = prev !== 'text' && prev !== 'other' && item.sample_columns.length > 0;
  const count = hadSamples ? item.sample_columns.length : defaultSamples(kind);
  const sameStyle = hadSamples && (prev === 'numeric') === (kind === 'numeric');
  base.sample_columns = kind === 'text'
    ? ['val']
    : sameStyle ? resizeColumns(item.sample_columns, kind, count) : makeColumns(kind, count);
  return base;
}

export function createItem(section: Section, kind: Exclude<CheckKind, 'other'>, stage: string): DraftItem {
  const blank: DraftItem = {
    _uid: newUid(),
    serial_no: 0,
    display_order: 0,
    stage_name: stage,
    control_item_name: '',
    specification_content: '',
    application_method: '',
    normal_frequency: '100%',
    ifm_frequency: '200%',
    row_mode: 'SERIAL_TICKBOX',
    html_input_type: 'checkbox',
    sample_columns: [],
    min_val: null,
    max_val: null,
    unit: null,
    assigned_role: section,
    is_supervisor_checkpoint: false,
    visible_to_operator: true,
    editable_by_operator: true,
    visible_to_supervisor: true,
    is_required: true,
  };
  return applyKind(blank, kind);
}

export function duplicateItem(item: DraftItem): DraftItem {
  // No item_id: a copy is a new row. The server assigns its id when the template is saved.
  const { item_id: _id, sheet_id: _sid, ...rest } = item;
  return { ...rest, _uid: newUid(), control_item_name: item.control_item_name ? `${item.control_item_name} (copy)` : '' };
}

/** Moves a row to the previous / next row of the same section, so interleaved sheets keep their order. */
export function moveWithinSection(items: DraftItem[], uid: string, dir: -1 | 1): DraftItem[] {
  const idx = items.findIndex((i) => i._uid === uid);
  if (idx < 0) return items;
  const sec = sectionOf(items[idx]);
  let j = idx + dir;
  while (j >= 0 && j < items.length && sectionOf(items[j]) !== sec) j += dir;
  if (j < 0 || j >= items.length) return items;
  const copy = [...items];
  [copy[idx], copy[j]] = [copy[j], copy[idx]];
  return copy;
}

export function blankTemplate(): DraftTemplate {
  return {
    sheet_id: '', document_title: '', part_no: '', part_name: '', model_name: '',
    vendor_name: '', customer_name: '', part_category: 'MAIN PART', items: [],
  };
}

export function toDraft(s: SheetTemplate): DraftTemplate {
  const items = [...(s.control_items || [])]
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0) || (a.serial_no || 0) - (b.serial_no || 0))
    .map((i) => ({
      ...i,
      application_method: i.application_method ?? '',
      normal_frequency: i.normal_frequency ?? '100%',
      ifm_frequency: i.ifm_frequency ?? '200%',
      sample_columns: Array.isArray(i.sample_columns) ? i.sample_columns.map(String) : [],
      min_val: i.min_val ?? null,
      max_val: i.max_val ?? null,
      unit: i.unit ?? null,
      _uid: i.item_id != null ? `item-${i.item_id}` : newUid(),
    }));
  return {
    sheet_id: s.sheet_id,
    document_title: s.document_title || '',
    part_no: s.part_no || '',
    part_name: s.part_name || '',
    model_name: s.model_name || '',
    vendor_name: s.vendor_name || '',
    customer_name: s.customer_name || '',
    part_category: s.part_category || 'MAIN PART',
    items,
  };
}

/** Builds the existing POST / PUT payload. Order, serial_no and display_order follow the list order. */
export function toPayload(d: DraftTemplate): SheetTemplate {
  return {
    sheet_id: d.sheet_id.trim(),
    document_title: d.document_title.trim(),
    part_no: d.part_no.trim(),
    part_name: d.part_name.trim(),
    model_name: d.model_name.trim(),
    vendor_name: d.vendor_name.trim(),
    customer_name: d.customer_name.trim(),
    part_category: d.part_category,
    control_items: d.items.map((it, idx) => {
      const { _uid, ...rest } = it;
      return {
        ...rest,
        serial_no: idx + 1,
        display_order: idx + 1,
        stage_name: it.stage_name.trim(),
        control_item_name: it.control_item_name.trim(),
        specification_content: it.specification_content.trim(),
        application_method: (it.application_method || '').trim(),
        unit: detectKind(it) === 'numeric' ? (it.unit || '').trim() || null : null,
      };
    }),
  };
}

/** Stable text of the saved content, used to tell whether the editor has unsaved changes. */
export const snapshot = (d: DraftTemplate): string => JSON.stringify(toPayload(d));

export const normalizeSheetId = (partNo: string): string => {
  const id = partNo.trim().toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55);
  return id ? `IFM-${id}` : '';
};

export function validate(d: DraftTemplate, isNew: boolean): ValidationResult {
  const basic: FieldErrors = {};
  if (isNew) {
    if (!d.sheet_id.trim()) basic.sheet_id = 'Enter a Sheet ID. It is used for the QR code and cannot be changed later.';
    else if (!/^[A-Za-z0-9._-]+$/.test(d.sheet_id.trim())) basic.sheet_id = 'Use letters, numbers, dots, dashes or underscores only.';
  }
  if (!d.document_title.trim()) basic.document_title = 'Enter a template name.';

  const items: Record<string, FieldErrors> = {};
  let operatorCount = 0;
  let supervisorCount = 0;
  for (const it of d.items) {
    const e: FieldErrors = {};
    const kind = detectKind(it);
    if (!it.control_item_name.trim()) e.control_item_name = 'Enter a name.';
    if (!it.stage_name.trim()) e.stage_name = 'Enter a stage.';
    if (kind === 'numeric') {
      const lo = it.min_val, hi = it.max_val;
      if (lo != null && hi != null && lo >= hi) e.max_val = 'Max must be greater than min.';
    }
    if (kind !== 'text' && kind !== 'other') {
      const n = it.sample_columns.length;
      if (n < SAMPLE_MIN || n > SAMPLE_MAX) e.samples = `Use ${SAMPLE_MIN} to ${SAMPLE_MAX}.`;
    }
    if (Object.keys(e).length) {
      items[it._uid] = e;
      if (sectionOf(it) === 'supervisor') supervisorCount++;
      else operatorCount++;
    }
  }
  const basicCount = Object.keys(basic).length;
  return { basic, items, basicCount, operatorCount, supervisorCount, total: basicCount + operatorCount + supervisorCount };
}

// ── Server errors → fields ─────────────────────────────────────────────────────────────────────────

export interface ServerErrors {
  basic: FieldErrors;
  items: Record<string, FieldErrors>; // keyed by _uid
  /** Messages that don't belong to a field the screen shows. */
  general: string[];
}

const ITEM_FIELD_TO_UI: Record<string, string> = {
  control_item_name: 'control_item_name',
  stage_name: 'stage_name',
  min_val: 'min_val',
  max_val: 'max_val',
  unit: 'unit',
  sample_columns: 'samples',
  row_mode: 'kind',
  html_input_type: 'kind',
  assigned_role: 'kind',
};

const BASIC_FIELDS = ['sheet_id', 'document_title', 'part_no', 'part_name', 'model_name', 'vendor_name', 'customer_name', 'part_category'];

/** "Value error, must not be empty" → "Must not be empty". */
export const tidyMessage = (msg: string): string => {
  const m = msg.replace(/^Value error,\s*/i, '').trim();
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Invalid value';
};

/**
 * Reads the API's validation errors (422 list, or 409 {message, errors}) and files each message
 * under the row and field it is about. `draft` must be the draft that was sent: a 422 locates a row
 * by its position in the list, a 409 by its item_id.
 */
export function mapServerErrors(detail: unknown, draft: DraftTemplate): ServerErrors {
  const out: ServerErrors = { basic: {}, items: {}, general: [] };
  const addItem = (uid: string, field: string, message: string) => {
    (out.items[uid] ||= {})[field] ||= message;
  };

  if (Array.isArray(detail)) {
    for (const e of detail as { loc?: (string | number)[]; msg?: string }[]) {
      const loc = (e.loc || []).slice(e.loc?.[0] === 'body' ? 1 : 0);
      const message = tidyMessage(e.msg || '');
      if (loc[0] === 'control_items' && typeof loc[1] === 'number') {
        const row = draft.items[loc[1]];
        const field = typeof loc[2] === 'string' ? ITEM_FIELD_TO_UI[loc[2]] : undefined;
        if (row && field) addItem(row._uid, field, message);
        else out.general.push(`Row ${loc[1] + 1}${row?.control_item_name ? ` (${row.control_item_name})` : ''}: ${message}`);
      } else if (typeof loc[0] === 'string' && BASIC_FIELDS.includes(loc[0])) {
        out.basic[loc[0]] ||= message;
      } else {
        out.general.push(message);
      }
    }
    return out;
  }

  const d = detail as { message?: string; errors?: { item_id?: number; field?: string; message?: string }[] } | null;
  if (d && Array.isArray(d.errors)) {
    for (const e of d.errors) {
      const uid = e.item_id != null ? `item-${e.item_id}` : '';
      const field = e.field ? ITEM_FIELD_TO_UI[e.field] : undefined;
      if (uid && field && draft.items.some((i) => i._uid === uid)) addItem(uid, field, e.message || 'Not allowed');
    }
  }
  return out;
}

/** Client-side validation plus whatever the server said about the last save, counted per section. */
export function withServerErrors(v: ValidationResult, d: DraftTemplate, server: ServerErrors | null): ValidationResult {
  if (!server) return v;
  const items: Record<string, FieldErrors> = { ...v.items };
  for (const [uid, errs] of Object.entries(server.items)) items[uid] = { ...errs, ...(items[uid] || {}) };
  let operatorCount = 0;
  let supervisorCount = 0;
  for (const uid of Object.keys(items)) {
    const it = d.items.find((i) => i._uid === uid);
    if (!it) continue;
    if (sectionOf(it) === 'supervisor') supervisorCount++;
    else operatorCount++;
  }
  const basicCount = Object.keys({ ...v.basic, ...server.basic }).length;
  return { ...v, items, basicCount, operatorCount, supervisorCount, total: basicCount + operatorCount + supervisorCount };
}
