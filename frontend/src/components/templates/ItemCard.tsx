import React from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Copy, Minus, Plus, Trash2, AlertCircle } from 'lucide-react';
import { Field, NumberInput, inputCls } from './ui';
import {
  KIND_INFO, KINDS_BY_SECTION, SAMPLE_MAX, SAMPLE_MIN,
  detectKind, kindLabel, resizeColumns,
  type CheckKind, type DraftItem, type FieldErrors, type Section,
} from './templateModel';

interface ItemCardProps {
  item: DraftItem;
  section: Section;
  position: number;
  total: number;
  open: boolean;
  errors?: FieldErrors;
  stageListId: string;
  onToggle: () => void;
  onChange: (patch: Partial<DraftItem>) => void;
  onKindChange: (kind: Exclude<CheckKind, 'other'>) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const summary = (item: DraftItem, kind: CheckKind): string => {
  const unit = item.unit ? ` ${item.unit}` : '';
  const n = item.sample_columns.length;
  if (kind === 'numeric') {
    const lo = item.min_val, hi = item.max_val;
    const range = lo != null && hi != null ? `${lo} to ${hi}${unit}` : lo != null ? `min ${lo}${unit}` : hi != null ? `max ${hi}${unit}` : 'no limits set';
    return `${range} · ${n} sample${n === 1 ? '' : 's'}`;
  }
  if (kind === 'text') return 'Text entry';
  return `${n} piece${n === 1 ? '' : 's'}`;
};

const iconBtn =
  'p-2 rounded-lg text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface2)] disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer transition-colors';

export const ItemCard: React.FC<ItemCardProps> = ({
  item, section, position, total, open, errors = {}, stageListId,
  onToggle, onChange, onKindChange, onMove, onDuplicate, onDelete,
}) => {
  const kind = detectKind(item);
  const hasError = Object.keys(errors).length > 0;
  const id = (f: string) => `${item._uid}-${f}`;
  const samples = item.sample_columns.length;

  const setSamples = (n: number) => {
    const clamped = Math.min(SAMPLE_MAX, Math.max(SAMPLE_MIN, n));
    onChange({ sample_columns: resizeColumns(item.sample_columns, kind, clamped) });
  };

  const kinds = KINDS_BY_SECTION[section];
  const sampleLabel = kind === 'numeric' ? 'Samples (readings per lot)' : 'Pieces to check per lot';
  const specLabel = section === 'supervisor' ? 'Description' : 'Specification';

  return (
    <div className={`rounded-xl border bg-[var(--surface)] ${hasError ? 'border-[var(--ng)]' : 'border-[var(--line)]'}`}>
      {/* Header row: the title area is the only toggle; the row actions are separate buttons (no nesting). */}
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex items-center gap-3 p-3 flex-1 min-w-0 text-left cursor-pointer hover:bg-[var(--surface2)] rounded-xl"
        >
          {open ? <ChevronDown className="w-4 h-4 text-[var(--muted)] shrink-0" /> : <ChevronRight className="w-4 h-4 text-[var(--muted)] shrink-0" />}
          <span className="shrink-0 w-7 h-7 rounded-lg bg-[var(--accent-soft)] text-[var(--primary)] text-xs font-semibold flex items-center justify-center">
            {position}
          </span>
          <span className="min-w-0 flex-1 block">
            <span className="flex flex-wrap items-center gap-2">
              <span className={`text-sm font-semibold truncate ${item.control_item_name ? 'text-[var(--ink)]' : 'text-[var(--muted)] italic'}`}>
                {item.control_item_name || 'Untitled'}
              </span>
              <span className="pill neutral sm">{kindLabel(kind)}</span>
              {section === 'operator' && item.is_required && <span className="pill info sm">Required</span>}
              {section === 'operator' && item.editable_by_operator === false && <span className="pill warn sm">Operator can't edit</span>}
              {hasError && (
                <span className="pill ng sm"><AlertCircle className="w-3 h-3" />Needs attention</span>
              )}
            </span>
            <span className="block text-xs text-[var(--muted)] truncate mt-0.5">
              {item.stage_name ? `${item.stage_name} · ` : ''}{summary(item, kind)}
            </span>
          </span>
        </button>

        <div className="flex items-center shrink-0">
          <button type="button" className={iconBtn} onClick={onMove.bind(null, -1)} disabled={position === 1} aria-label={`Move ${item.control_item_name || 'row'} up`} title="Move up">
            <ChevronUp className="w-4 h-4" />
          </button>
          <button type="button" className={iconBtn} onClick={onMove.bind(null, 1)} disabled={position === total} aria-label={`Move ${item.control_item_name || 'row'} down`} title="Move down">
            <ChevronDown className="w-4 h-4" />
          </button>
          <button type="button" className={iconBtn} onClick={onDuplicate} aria-label={`Duplicate ${item.control_item_name || 'row'}`} title="Duplicate">
            <Copy className="w-4 h-4" />
          </button>
          <button type="button" className={`${iconBtn} hover:!text-[var(--ng)]`} onClick={onDelete} aria-label={`Delete ${item.control_item_name || 'row'}`} title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Editor */}
      {open && (
        <div className="border-t border-[var(--line)] p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Name" htmlFor={id('name')} required error={errors.control_item_name}>
              <input
                id={id('name')}
                value={item.control_item_name}
                onChange={(e) => onChange({ control_item_name: e.target.value })}
                placeholder={section === 'supervisor' ? 'e.g. Physical condition' : 'e.g. Label present'}
                className={inputCls(errors.control_item_name)}
              />
            </Field>

            <Field label="Stage" htmlFor={id('stage')} required error={errors.stage_name} hint="Checks with the same stage are grouped together.">
              <input
                id={id('stage')}
                list={stageListId}
                value={item.stage_name}
                onChange={(e) => onChange({ stage_name: e.target.value })}
                placeholder="e.g. Appearance"
                className={inputCls(errors.stage_name)}
              />
            </Field>

            <Field label="Input type" htmlFor={id('kind')} error={errors.kind} hint={kind === 'other' ? 'This row uses a type that is kept exactly as saved.' : KIND_INFO[kind].hint}>
              <select
                id={id('kind')}
                value={kind}
                onChange={(e) => onKindChange(e.target.value as Exclude<CheckKind, 'other'>)}
                className={`${inputCls(errors.kind)} cursor-pointer`}
              >
                {kind === 'other' && <option value="other" disabled>{kindLabel('other')}</option>}
                {kinds.map((k) => <option key={k} value={k}>{KIND_INFO[k].label}</option>)}
              </select>
            </Field>

            <Field label="Method" htmlFor={id('method')} hint="How it is checked, for example Visual or Micrometer.">
              <input
                id={id('method')}
                value={item.application_method || ''}
                onChange={(e) => onChange({ application_method: e.target.value })}
                placeholder="e.g. Visual"
                className={inputCls()}
              />
            </Field>

            <Field label={specLabel} htmlFor={id('spec')} className="md:col-span-2" hint={section === 'supervisor' ? 'What the supervisor should verify.' : 'The criteria shown to the operator, for example "Free from scratch, rust, damage".'}>
              <textarea
                id={id('spec')}
                rows={2}
                value={item.specification_content}
                onChange={(e) => onChange({ specification_content: e.target.value })}
                className={`${inputCls()} resize-y`}
              />
            </Field>
          </div>

          {kind === 'numeric' && (
            <div className="rounded-xl bg-[var(--surface2)] p-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Minimum" htmlFor={id('min')} error={errors.min_val} hint="Leave empty for no lower limit.">
                <NumberInput id={id('min')} value={item.min_val ?? null} onChange={(v) => onChange({ min_val: v })} placeholder="e.g. 7.90" error={errors.min_val} />
              </Field>
              <Field label="Maximum" htmlFor={id('max')} error={errors.max_val} hint="Leave empty for no upper limit.">
                <NumberInput id={id('max')} value={item.max_val ?? null} onChange={(v) => onChange({ max_val: v })} placeholder="e.g. 8.10" error={errors.max_val} />
              </Field>
              <Field label="Unit" htmlFor={id('unit')} error={errors.unit}>
                <input
                  id={id('unit')}
                  value={item.unit || ''}
                  maxLength={30}
                  onChange={(e) => onChange({ unit: e.target.value })}
                  placeholder="e.g. mm"
                  className={inputCls(errors.unit)}
                />
              </Field>
            </div>
          )}

          <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
            {kind !== 'text' && kind !== 'other' && (
              <Field label={sampleLabel} htmlFor={id('samples')} error={errors.samples} hint={`Between ${SAMPLE_MIN} and ${SAMPLE_MAX}.`}>
                <div className="inline-flex items-center gap-1">
                  <button type="button" className="btn sm !min-h-[42px] !px-3" onClick={() => setSamples(samples - 1)} disabled={samples <= SAMPLE_MIN} aria-label="Fewer samples">
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    id={id('samples')}
                    type="number"
                    min={SAMPLE_MIN}
                    max={SAMPLE_MAX}
                    value={samples}
                    onChange={(e) => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) setSamples(n); }}
                    className={`${inputCls(errors.samples)} mono !w-20 text-center`}
                  />
                  <button type="button" className="btn sm !min-h-[42px] !px-3" onClick={() => setSamples(samples + 1)} disabled={samples >= SAMPLE_MAX} aria-label="More samples">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </Field>
            )}

            {section === 'operator' && (
              <>
                <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
                  <input
                    type="checkbox"
                    checked={item.is_required}
                    onChange={(e) => onChange({ is_required: e.target.checked })}
                    className="mt-0.5 w-4 h-4 accent-[var(--primary)]"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-[var(--ink)]">Required</span>
                    <span className="block text-xs text-[var(--muted)]">The operator must fill this in before submitting the lot.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
                  <input
                    type="checkbox"
                    checked={!!item.is_supervisor_checkpoint}
                    onChange={(e) => onChange({ is_supervisor_checkpoint: e.target.checked })}
                    className="mt-0.5 w-4 h-4 accent-[var(--primary)]"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-[var(--ink)]">Supervisor checkpoint</span>
                    <span className="block text-xs text-[var(--muted)]">Highlights this row for the supervisor on the checksheet view.</span>
                  </span>
                </label>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
