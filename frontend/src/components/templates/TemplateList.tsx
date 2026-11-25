import React, { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { SheetTemplate } from '../../types';

interface TemplateListProps {
  sheets: SheetTemplate[];
  selectedId: string;
  isNewSelected: boolean;
  newTitle: string;
  onSelect: (sheetId: string) => void;
  onNew: () => void;
}

export const TemplateList: React.FC<TemplateListProps> = ({ sheets, selectedId, isNewSelected, newTitle, onSelect, onNew }) => {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return sheets;
    return sheets.filter((s) =>
      [s.document_title, s.part_no, s.part_name, s.sheet_id].some((v) => (v || '').toLowerCase().includes(t)),
    );
  }, [sheets, q]);

  return (
    <aside className="space-y-3 lg:sticky lg:top-4 self-start" aria-label="Templates">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--ink)]">Templates</h3>
        <button type="button" className="btn primary sm" onClick={onNew}>
          <Plus className="w-3.5 h-3.5" />
          <span>New</span>
        </button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search part no. or name"
          aria-label="Search templates"
          className="w-full min-h-[42px] border border-[var(--line2)] rounded-xl pl-9 pr-3 bg-[var(--surface)] text-[var(--ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-0.5">
        {isNewSelected && (
          <div className="w-full text-left rounded-xl border border-[var(--primary)] bg-[var(--accent-soft)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[var(--ink)] truncate">{newTitle || 'New template'}</span>
              <span className="pill info sm">Unsaved</span>
            </div>
            <span className="sub text-xs">Not saved yet</span>
          </div>
        )}

        {filtered.map((s) => {
          const items = s.control_items || [];
          const sup = items.filter((i) => i.assigned_role === 'supervisor').length;
          const op = items.length - sup;
          const on = !isNewSelected && s.sheet_id === selectedId;
          return (
            <button
              key={s.sheet_id}
              type="button"
              onClick={() => onSelect(s.sheet_id)}
              aria-current={on ? 'true' : undefined}
              className={`w-full text-left rounded-xl border p-3 transition-colors cursor-pointer ${
                on
                  ? 'border-[var(--primary)] bg-[var(--accent-soft)]'
                  : 'border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface2)]'
              }`}
            >
              <span className="block text-sm font-semibold text-[var(--ink)] truncate">
                {s.document_title || s.part_name || s.sheet_id}
              </span>
              <span className="block mono text-xs text-[var(--muted)] truncate">
                {s.part_no || 'No part number'} · {s.sheet_id}
              </span>
              <span className="block text-xs text-[var(--muted)] mt-1">
                {op} operator check{op === 1 ? '' : 's'} · {sup} supervisor dimension{sup === 1 ? '' : 's'}
              </span>
            </button>
          );
        })}

        {sheets.length === 0 && !isNewSelected && (
          <div className="rounded-xl border border-dashed border-[var(--line2)] p-5 text-center">
            <p className="text-sm font-semibold text-[var(--ink)]">No templates yet</p>
            <p className="sub text-xs mt-1">Create the first one with the New button.</p>
          </div>
        )}
        {sheets.length > 0 && filtered.length === 0 && (
          <p className="sub text-center py-4">No templates match "{q}".</p>
        )}
      </div>
    </aside>
  );
};
