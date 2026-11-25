import React, { useEffect, useRef, useState } from 'react';
import { Info, Printer, Save } from 'lucide-react';
import { BasicInfoTab } from './BasicInfoTab';
import { ItemsTab } from './ItemsTab';
import { RulesTab } from './RulesTab';
import { sectionOf, type CheckKind, type DraftItem, type DraftTemplate, type FieldErrors, type Section, type ValidationResult } from './templateModel';

type TabId = 'basic' | 'operator' | 'supervisor' | 'rules';

interface TemplateEditorProps {
  draft: DraftTemplate;
  isNew: boolean;
  dirty: boolean;
  saving: boolean;
  validation: ValidationResult;
  showErrors: boolean;
  serverErrors: FieldErrors;
  /** Batches that use this template: how many, and how many have inspection data. */
  usage: { total: number; inspected: number } | null;
  /** Increases each time the server rejects a save, so the editor can open the tab with the problem. */
  errorJump: number;
  onBasicChange: (field: Exclude<keyof DraftTemplate, 'items'>, value: string) => void;
  onScan: () => void;
  onViewQr: () => void;
  onSave: () => void;
  onAddItem: (section: Section) => string;
  onItemChange: (uid: string, patch: Partial<DraftItem>) => void;
  onItemKind: (uid: string, kind: Exclude<CheckKind, 'other'>) => void;
  onItemMove: (uid: string, dir: -1 | 1) => void;
  onItemDuplicate: (uid: string) => string;
  onItemDelete: (uid: string) => void;
}

export const TemplateEditor: React.FC<TemplateEditorProps> = ({
  draft, isNew, dirty, saving, validation, showErrors, serverErrors, usage, errorJump,
  onBasicChange, onScan, onViewQr, onSave,
  onAddItem, onItemChange, onItemKind, onItemMove, onItemDuplicate, onItemDelete,
}) => {
  const [tab, setTab] = useState<TabId>('basic');

  const firstTabWithErrors = (): TabId =>
    validation.basicCount ? 'basic' : validation.operatorCount ? 'operator' : 'supervisor';

  // After the server rejects a save, take the admin to the first tab that has something to fix.
  // Only a change after this editor mounted counts. A freshly opened template starts on its first tab.
  const seenJump = useRef(errorJump);
  useEffect(() => {
    if (errorJump !== seenJump.current) {
      seenJump.current = errorJump;
      setTab(firstTabWithErrors());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorJump]);

  const handleSave = () => {
    if (validation.total > 0) setTab(firstTabWithErrors());
    onSave();
  };

  const opCount = draft.items.filter((i) => sectionOf(i) !== 'supervisor' && sectionOf(i) !== 'other').length;
  const supCount = draft.items.filter((i) => sectionOf(i) === 'supervisor').length;

  const tabs: { id: TabId; label: string; count?: number; errors: number }[] = [
    { id: 'basic', label: 'Basic information', errors: showErrors ? validation.basicCount : 0 },
    { id: 'operator', label: 'Operator checks', count: opCount, errors: showErrors ? validation.operatorCount : 0 },
    { id: 'supervisor', label: 'Supervisor dimensions', count: supCount, errors: showErrors ? validation.supervisorCount : 0 },
    { id: 'rules', label: 'Rules', errors: 0 },
  ];

  const sectionItemErrors = validation.items;

  return (
    <div className="space-y-4 min-w-0">
      {/* Header */}
      <div className="sv-card !p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate">{draft.document_title.trim() || (isNew ? 'New template' : draft.sheet_id)}</h2>
            <p className="sub mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="mono text-xs">{draft.sheet_id || 'Sheet ID not set'}</span>
              {isNew ? <span className="pill info sm">New</span> : <span className="pill ok sm">Saved</span>}
              {dirty && <span className="pill warn sm">Unsaved changes</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn sm disabled:opacity-40" onClick={onViewQr} disabled={isNew} title={isNew ? 'Save the template first' : 'View and print the QR code'}>
              <Printer className="w-3.5 h-3.5" />
              <span>View QR</span>
            </button>
            <button type="button" className="btn primary sm disabled:opacity-50" onClick={handleSave} disabled={saving || (!isNew && !dirty)}>
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : isNew ? 'Create template' : 'Save changes'}</span>
            </button>
          </div>
        </div>

        {!isNew && usage && usage.total > 0 && (
          <div className="flex items-start gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface2)] p-3 text-xs text-[var(--muted)]">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Used by {usage.total} batch{usage.total === 1 ? '' : 'es'}
              {usage.inspected > 0 && <> ({usage.inspected} with inspection data)</>}.
              {' '}Values already recorded are kept when you save. A row that has recorded values can't be deleted, and its input type, role and recorded samples can't be changed.
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Template sections" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`stchip ${tab === t.id ? 'on' : ''}`}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 opacity-75">{t.count}</span>}
            {t.errors > 0 && <span className="ml-1.5 w-2 h-2 rounded-full bg-[var(--ng)]" aria-label={`${t.errors} to fix`} />}
          </button>
        ))}
      </div>

      {/* Panel */}
      <div className="sv-card !p-5" role="tabpanel">
        {tab === 'basic' && (
          <BasicInfoTab
            draft={draft}
            errors={showErrors ? validation.basic : {}}
            isNew={isNew}
            serverErrors={serverErrors}
            onChange={onBasicChange}
            onScan={onScan}
          />
        )}
        {(tab === 'operator' || tab === 'supervisor') && (
          <ItemsTab
            key={tab}
            section={tab}
            items={draft.items}
            errors={sectionItemErrors}
            showErrors={showErrors}
            onAdd={() => onAddItem(tab)}
            onChange={onItemChange}
            onKindChange={onItemKind}
            onMove={onItemMove}
            onDuplicate={onItemDuplicate}
            onRequestDelete={onItemDelete}
          />
        )}
        {tab === 'rules' && <RulesTab items={draft.items} />}
      </div>
    </div>
  );
};
