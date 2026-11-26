import React, { useMemo } from 'react';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import {
  CHILD_STAGE_PREFIX, PRODUCT_STAGE, KIND_INFO, KINDS_BY_SECTION, detectKind, isChildStage, kindLabel, sectionOf,
  type CheckKind, type DraftItem, type FieldErrors, type Section,
} from './templateModel';

interface ItemsTabProps {
  section: Section;
  items: DraftItem[];
  errors: Record<string, FieldErrors>;
  showErrors: boolean;
  /** Adds a row to the given group (stage) and returns its uid. */
  onAdd: (stage: string) => string;
  onChange: (uid: string, patch: Partial<DraftItem>) => void;
  onKindChange: (uid: string, kind: Exclude<CheckKind, 'other'>) => void;
  onMove: (uid: string, dir: -1 | 1) => void;
  onDuplicate: (uid: string) => string;
  onRequestDelete: (uid: string) => void;
  onLoadStandard?: () => void;
}

const cell = 'w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--primary)]';
const bad = '!border-[var(--ng)]';
const OP_COLS = '28px minmax(120px,1fr) minmax(0,2.2fr) minmax(110px,0.9fr) 140px 36px';
const DIM_COLS = 'minmax(160px,1.4fr) 140px 100px 100px 36px';

const num = (v: string): number | null => (v.trim() === '' || isNaN(+v) ? null : +v);

export const ItemsTab: React.FC<ItemsTabProps> = ({
  section, items, errors, showErrors, onAdd, onChange, onKindChange, onRequestDelete, onLoadStandard,
}) => {
  const mine = useMemo(() => items.filter((i) => sectionOf(i) === section), [items, section]);

  // Operator: Visual checks, then Functional checks, then any other stage.
  // Supervisor: child part group(s) first, then the product group(s).
  const groups = useMemo(() => {
    const seen: string[] = [];
    mine.forEach((i) => { const s = i.stage_name.trim(); if (!seen.includes(s)) seen.push(s); });
    if (section === 'operator') {
      const first = ['Visual checks', 'Functional checks'];
      return [...first, ...seen.filter((s) => !first.includes(s))];
    }
    const child = seen.filter(isChildStage);
    const rest = seen.filter((s) => !isChildStage(s));
    if (!child.length) child.push(`${CHILD_STAGE_PREFIX}, `);
    if (!rest.length) rest.push(PRODUCT_STAGE);
    return [...child, ...rest];
  }, [mine, section]);

  const renameStage = (oldStage: string, newStage: string) =>
    mine.filter((i) => i.stage_name.trim() === oldStage.trim()).forEach((i) => onChange(i._uid, { stage_name: newStage }));

  const errOf = (uid: string, f: string) => (showErrors || f === 'max_val') && !!errors[uid]?.[f];

  const renderRow = (x: DraftItem, n: number) => {
    const kind = detectKind(x);
    const numeric = kind === 'numeric';
    const typeSel = (
      <select className={cell} value={kind === 'other' ? '' : kind} title={kind === 'other' ? 'Kept as saved' : KIND_INFO[kind].hint}
        onChange={(e) => e.target.value && onKindChange(x._uid, e.target.value as Exclude<CheckKind, 'other'>)}>
        {kind === 'other' && <option value="">{kindLabel(kind)}</option>}
        {KINDS_BY_SECTION[section].map((k) => <option key={k} value={k}>{KIND_INFO[k].label}</option>)}
      </select>
    );
    const limits = (
      <>
        <input className={cell} inputMode="decimal" placeholder="Min" defaultValue={x.min_val ?? ''}
          key={`${x._uid}-min`} onChange={(e) => onChange(x._uid, { min_val: num(e.target.value) })} />
        <input className={`${cell} ${errOf(x._uid, 'max_val') ? bad : ''}`} inputMode="decimal" placeholder="Max" defaultValue={x.max_val ?? ''}
          key={`${x._uid}-max`} onChange={(e) => onChange(x._uid, { max_val: num(e.target.value) })} />
      </>
    );
    const del = (
      <button type="button" className="p-2 rounded-lg text-[var(--muted)] hover:text-[var(--ng)] hover:bg-[var(--surface2)]"
        onClick={() => onRequestDelete(x._uid)} aria-label={`Remove ${x.control_item_name || 'row'}`}>
        <Trash2 className="w-4 h-4" />
      </button>
    );
    const name = (
      <input
        className={`${cell} ${errOf(x._uid, 'control_item_name') ? bad : ''}`}
        placeholder={section === 'operator' ? 'Check name' : 'Dimension name'}
        value={x.control_item_name}
        onChange={(e) => onChange(x._uid, { control_item_name: e.target.value })}
      />
    );
    if (section === 'operator') {
      return (
        <div key={x._uid} className="py-2 border-t border-[var(--line)] space-y-2">
          <div className="grid gap-2 items-start" style={{ gridTemplateColumns: OP_COLS }}>
            <span className="text-xs text-[var(--muted)] pt-2.5 text-center">{n}</span>
            {name}
            <input className={cell} placeholder="Description, as on the checksheet" value={x.specification_content}
              onChange={(e) => onChange(x._uid, { specification_content: e.target.value })} />
            <input className={cell} placeholder="Method" list="tpl-methods" value={x.application_method || ''}
              onChange={(e) => onChange(x._uid, { application_method: e.target.value })} />
            {typeSel}
            {del}
          </div>
          {numeric && (
            <div className="grid gap-2 items-center" style={{ gridTemplateColumns: '28px 100px 100px 90px 1fr' }}>
              <span />{limits}
              <input className={cell} placeholder="Unit" value={x.unit || ''} onChange={(e) => onChange(x._uid, { unit: e.target.value })} />
              <span className="text-xs text-[var(--muted)]">Reading must be between min and max.</span>
            </div>
          )}
        </div>
      );
    }
    return (
      <div key={x._uid} className="grid gap-2 items-start py-2 border-t border-[var(--line)]" style={{ gridTemplateColumns: DIM_COLS }}>
        {name}
        {typeSel}
        {numeric ? limits : <span className="col-span-2 text-xs text-[var(--muted)] pt-2.5">{kind === 'passfail' ? 'Pass is OK, Fail is out of spec' : 'Ticked is OK'}</span>}
        {del}
      </div>
    );
  };

  const title = section === 'operator' ? 'Operator checks' : 'Supervisor dimensions';
  const desc = section === 'operator' ? 'Answered Yes or No for every item.' : 'Measured on the sample items in each lot.';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--ink)]">
            {title} <span className="text-[var(--muted)] font-medium">({mine.length})</span>
          </h3>
          <p className="sub mt-0.5">{desc} Every box is editable.</p>
        </div>
        {items.length === 0 && onLoadStandard && (
          <button type="button" className="btn primary sm" onClick={onLoadStandard}>
            <Wand2 className="w-3.5 h-3.5" /><span>Load standard checks and dimensions</span>
          </button>
        )}
      </div>

      <datalist id="tpl-methods">
        {['Visual', 'Block testing or air blow', 'Profile gauge', 'Leak test machine'].map((m) => <option key={m} value={m} />)}
      </datalist>

      {groups.map((g, gi) => {
        const rows = mine.filter((i) => i.stage_name.trim() === g.trim());
        const child = section === 'supervisor' && isChildStage(g);
        const childName = g.replace(/^child part,?\s*/i, '');
        const heading = section === 'supervisor' && /^product/i.test(g) ? 'Product (flare)' : g;
        return (
          <section key={gi} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
            <div className="flex items-center gap-2 mb-2">
              {child ? (
                <>
                  <b className="text-sm text-[var(--ink)] whitespace-nowrap">Child part</b>
                  <input className={cell} placeholder="Child part name, e.g. Tube 8.0 TSW PP" value={childName}
                    onChange={(e) => renameStage(g, `${CHILD_STAGE_PREFIX}, ${e.target.value}`)} />
                </>
              ) : (
                <b className="text-sm text-[var(--ink)]">{heading}</b>
              )}
            </div>
            <div className="grid gap-2 text-xs font-semibold text-[var(--muted)] pb-1"
              style={{ gridTemplateColumns: section === 'operator' ? OP_COLS : DIM_COLS }}>
              {section === 'operator'
                ? (<><span>#</span><span>Check</span><span>Description</span><span>Method</span><span>Type</span><span /></>)
                : (<><span>Dimension</span><span>Type</span><span>Min</span><span>Max</span><span /></>)}
            </div>
            {rows.map((x, i) => renderRow(x, i + 1))}
            <button type="button" className="btn sm mt-2" onClick={() => onAdd(g)}>
              <Plus className="w-3.5 h-3.5" />
              <span>
                {section === 'operator'
                  ? `Add ${g.toLowerCase().replace(/s$/, '')}`
                  : child ? 'Add child part dimension' : 'Add flare dimension'}
              </span>
            </button>
          </section>
        );
      })}
    </div>
  );
};
