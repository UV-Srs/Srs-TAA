import React from 'react';
import { Info, Printer, Save } from 'lucide-react';
import { BasicInfoTab } from './BasicInfoTab';
import { ItemsTab } from './ItemsTab';
import { RulesTab } from './RulesTab';
import { type CheckKind, type DraftItem, type DraftTemplate, type FieldErrors, type Section, type ValidationResult } from './templateModel';


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
  onPartNoBlur?: () => void;
  onViewQr: () => void;
  onSave: () => void;
  onAddItem: (section: Section, stage?: string) => string;
  onLoadStandard?: () => void;
  onItemChange: (uid: string, patch: Partial<DraftItem>) => void;
  onItemKind: (uid: string, kind: Exclude<CheckKind, 'other'>) => void;
  onItemMove: (uid: string, dir: -1 | 1) => void;
  onItemDuplicate: (uid: string) => string;
  onItemDelete: (uid: string) => void;
}

export const TemplateEditor: React.FC<TemplateEditorProps> = ({
  draft, isNew, dirty, saving, validation, showErrors, serverErrors, usage, errorJump,
  onBasicChange, onScan, onPartNoBlur, onViewQr, onSave,
  onAddItem, onLoadStandard, onItemChange, onItemKind, onItemMove, onItemDuplicate, onItemDelete,
}) => {
  const handleSave = () => onSave();

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

      <div className="sv-card !p-5 space-y-8">
        <BasicInfoTab
          draft={draft}
          errors={showErrors ? validation.basic : {}}
          isNew={isNew}
          serverErrors={serverErrors}
          onChange={onBasicChange}
          onScan={onScan}
          onPartNoBlur={onPartNoBlur}
        />
        {(['operator', 'supervisor'] as const).map((sec) => (
          <ItemsTab
            key={sec}
            section={sec}
            items={draft.items}
            errors={sectionItemErrors}
            showErrors={showErrors}
            onAdd={(stage) => onAddItem(sec, stage)}
            onLoadStandard={onLoadStandard}
            onChange={onItemChange}
            onKindChange={onItemKind}
            onMove={onItemMove}
            onDuplicate={onItemDuplicate}
            onRequestDelete={onItemDelete}
          />
        ))}
        <RulesTab items={draft.items} onItemChange={onItemChange} />
      </div>

      {/* Bottom action bar: stays pinned to the bottom of the screen while the form is on screen,
          so after filling a long form the admin can save without scrolling back to the top. */}
      <div className="sticky bottom-0 z-30 no-print">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)] min-w-0">
            {isNew
              ? <span className="pill info sm">New template</span>
              : dirty
                ? <span className="pill warn sm">Unsaved changes</span>
                : <span className="pill ok sm">All changes saved</span>}
          </div>
          <button type="button" className="btn primary disabled:opacity-50" onClick={handleSave} disabled={saving || (!isNew && !dirty)}>
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : isNew ? 'Create template' : 'Save changes'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
