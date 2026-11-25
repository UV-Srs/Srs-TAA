import React, { useMemo, useState } from 'react';
import { ClipboardCheck, Plus, Ruler } from 'lucide-react';
import { ItemCard } from './ItemCard';
import { sectionOf, type CheckKind, type DraftItem, type FieldErrors, type Section } from './templateModel';

interface ItemsTabProps {
  section: Section;
  items: DraftItem[];
  errors: Record<string, FieldErrors>;
  /** After a failed Save, cards that have errors open so the admin can see them. */
  showErrors: boolean;
  onAdd: () => string; // returns the new row's _uid
  onChange: (uid: string, patch: Partial<DraftItem>) => void;
  onKindChange: (uid: string, kind: Exclude<CheckKind, 'other'>) => void;
  onMove: (uid: string, dir: -1 | 1) => void;
  onDuplicate: (uid: string) => string;
  onRequestDelete: (uid: string) => void;
}

const COPY: Record<Section, { title: string; description: string; add: string; emptyTitle: string; emptyBody: string; Icon: typeof Ruler }> = {
  operator: {
    title: 'Operator checks',
    description: 'What the operator inspects on each lot. These appear on the operator inspection screen.',
    add: 'Add operator check',
    emptyTitle: 'No operator checks yet',
    emptyBody: 'Add the checks an operator must complete, such as a visual check or a measurement.',
    Icon: ClipboardCheck,
  },
  supervisor: {
    title: 'Supervisor dimensions',
    description: 'What the supervisor measures or verifies during lot review. These appear on the supervisor review screen, separate from the operator checks.',
    add: 'Add supervisor dimension',
    emptyTitle: 'No supervisor dimensions yet',
    emptyBody: 'Add the readings or Good / Bad checks the supervisor records during review.',
    Icon: Ruler,
  },
};

export const ItemsTab: React.FC<ItemsTabProps> = ({
  section, items, errors, showErrors, onAdd, onChange, onKindChange, onMove, onDuplicate, onRequestDelete,
}) => {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const copy = COPY[section];

  const mine = useMemo(() => items.filter((i) => sectionOf(i) === section), [items, section]);
  const adminRows = useMemo(() => items.filter((i) => sectionOf(i) === 'other').length, [items]);
  const stageOptions = useMemo(
    () => Array.from(new Set(items.map((i) => i.stage_name.trim()).filter(Boolean))),
    [items],
  );
  const stageListId = `stages-${section}`;

  const setOpen = (uid: string, open: boolean) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (open) next.add(uid); else next.delete(uid);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="text-base font-semibold text-[var(--ink)]">
            {copy.title} <span className="text-[var(--muted)] font-medium">({mine.length})</span>
          </h3>
          <p className="sub mt-0.5">{copy.description}</p>
        </div>
        <button type="button" className="btn primary sm" onClick={() => setOpen(onAdd(), true)}>
          <Plus className="w-3.5 h-3.5" />
          <span>{copy.add}</span>
        </button>
      </div>

      <datalist id={stageListId}>
        {stageOptions.map((s) => <option key={s} value={s} />)}
      </datalist>

      {mine.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--line2)] bg-[var(--surface)] p-8 text-center">
          <span className="mx-auto mb-3 w-11 h-11 rounded-full bg-[var(--accent-soft)] text-[var(--primary)] flex items-center justify-center">
            <copy.Icon className="w-5 h-5" />
          </span>
          <p className="text-sm font-semibold text-[var(--ink)]">{copy.emptyTitle}</p>
          <p className="sub mt-1 mb-4">{copy.emptyBody}</p>
          <button type="button" className="btn primary sm" onClick={() => setOpen(onAdd(), true)}>
            <Plus className="w-3.5 h-3.5" />
            <span>{copy.add}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {mine.map((item, idx) => {
            const itemErrors = errors[item._uid];
            // Min / max and sample-count errors show straight away; "missing" errors wait for a Save attempt.
            const live: FieldErrors | undefined = itemErrors && (showErrors
              ? itemErrors
              : Object.fromEntries(Object.entries(itemErrors).filter(([k]) => k === 'max_val' || k === 'samples')));
            const visible = live && Object.keys(live).length ? live : undefined;
            return (
              <ItemCard
                key={item._uid}
                item={item}
                section={section}
                position={idx + 1}
                total={mine.length}
                open={openIds.has(item._uid) || (showErrors && !!visible)}
                errors={visible}
                stageListId={stageListId}
                onToggle={() => setOpen(item._uid, !openIds.has(item._uid))}
                onChange={(patch) => onChange(item._uid, patch)}
                onKindChange={(k) => onKindChange(item._uid, k)}
                onMove={(dir) => onMove(item._uid, dir)}
                onDuplicate={() => setOpen(onDuplicate(item._uid), true)}
                onDelete={() => onRequestDelete(item._uid)}
              />
            );
          })}
        </div>
      )}

      {section === 'operator' && adminRows > 0 && (
        <p className="text-xs text-[var(--muted)]">
          {adminRows} row{adminRows === 1 ? ' is' : 's are'} assigned to Admin. {adminRows === 1 ? 'It is' : 'They are'} kept as saved and not shown here.
        </p>
      )}
    </div>
  );
};
