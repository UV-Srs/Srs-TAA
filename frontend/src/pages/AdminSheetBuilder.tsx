import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import type { InspectionBatch, SheetTemplate } from '../types';
import { createSheet, fetchBatches, fetchSheets, updateSheet, type ApiError } from '../api';
import { registerNavGuard } from '../lib/navGuard';
import { PrintLabelModal } from '../components/PrintLabelModal';
import { TFTScannerModal } from '../components/TFTScannerModal';
import { TemplateList } from '../components/templates/TemplateList';
import { TemplateEditor } from '../components/templates/TemplateEditor';
import { ConfirmDialog } from '../components/templates/ui';
import {
  applyKind, blankTemplate, createItem, duplicateItem, mapServerErrors, moveWithinSection, normalizeSheetId, standardItems,
  snapshot, toDraft, toPayload, validate, withServerErrors,
  type CheckKind, type DraftItem, type DraftTemplate, type FieldErrors, type Section, type ServerErrors,
} from '../components/templates/templateModel';

type Banner = { type: 'success' | 'error'; text: string; kind?: 'validation' } | null;

/**
 * Admin → Templates.
 *
 * Talks only to GET/POST/PUT /api/admin/sheets and GET /api/batches. After every save the list is
 * re-read from the server, so what is on screen is what was stored. Rows are sent with their
 * item_id, so the server updates them in place and recorded inspection values stay attached.
 */
export const AdminSheetBuilder: React.FC = () => {
  const [sheets, setSheets] = useState<SheetTemplate[]>([]);
  const [batches, setBatches] = useState<InspectionBatch[] | null>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [draft, setDraft] = useState<DraftTemplate>(blankTemplate());
  const [baseline, setBaseline] = useState<string>(snapshot(blankTemplate()));
  const sheetIdTouched = useRef(false);

  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<ServerErrors | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorJump, setErrorJump] = useState(0);
  const [banner, setBanner] = useState<Banner>(null);

  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);
  const [deleteUid, setDeleteUid] = useState<string | null>(null);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [isScanOpen, setIsScanOpen] = useState(false);

  const clientValidation = useMemo(() => validate(draft, isNew), [draft, isNew]);
  const validation = useMemo(() => withServerErrors(clientValidation, draft, serverErrors), [clientValidation, draft, serverErrors]);
  const serverBasic: FieldErrors = serverErrors?.basic ?? {};
  const dirty = useMemo(() => snapshot(draft) !== baseline, [draft, baseline]);

  // Batches that use the open template (informational: saving keeps what was recorded on them).
  const usage = useMemo(() => {
    if (isNew || batches === null) return null;
    const mine = batches.filter((b) => b.sheet_id === draft.sheet_id);
    return { total: mine.length, inspected: mine.filter((b) => b.status !== 'CREATED_PENDING_OPERATOR').length };
  }, [batches, draft.sheet_id, isNew]);

  const open = useCallback((s: SheetTemplate) => {
    const d = toDraft(s);
    setDraft(d);
    setBaseline(snapshot(d));
    setSelectedId(s.sheet_id);
    setIsNew(false);
    setShowErrors(false);
    setServerErrors(null);
    setEditorKey((k) => k + 1);
  }, []);

  const openBlank = useCallback((partNo = '') => {
    const d = blankTemplate();
    d.items = standardItems();
    d.part_no = partNo;
    d.sheet_id = partNo ? normalizeSheetId(partNo) : '';
    sheetIdTouched.current = false;
    setBaseline(snapshot(blankTemplate()));
    setDraft(d);
    setSelectedId('');
    setIsNew(true);
    setShowErrors(false);
    setServerErrors(null);
    setEditorKey((k) => k + 1);
  }, []);

  /** Loads templates and batches from the server. `selectId` opens that template afterwards. */
  const load = useCallback(async (selectId?: string) => {
    const [list, bs] = await Promise.all([
      fetchSheets(),
      fetchBatches().catch(() => null),
    ]);
    const sorted = list || [];
    setSheets(sorted);
    setBatches(bs);
    const target = sorted.find((s) => s.sheet_id === selectId);
    if (target) open(target);
    return sorted;
  }, [open]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const list = await load();
        if (list.length > 0) open(list[0]);
        else openBlank();
      } catch (err: any) {
        setLoadError(err?.message || 'Could not load templates.');
      } finally {
        setLoading(false);
      }
    })();
  }, [load, open, openBlank]);

  // Success messages fade on their own. Errors stay until dismissed.
  useEffect(() => {
    if (banner?.type !== 'success') return;
    const t = window.setTimeout(() => setBanner(null), 6000);
    return () => window.clearTimeout(t);
  }, [banner]);

  // The "fix the highlighted items" message goes away once nothing is left to fix.
  useEffect(() => {
    if (banner?.kind === 'validation' && validation.total === 0) setBanner(null);
  }, [banner, validation.total]);

  // Warn before closing or reloading the browser tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Warn before leaving through the sidebar, header, logout, etc. (see lib/navGuard.ts).
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(
    () =>
      registerNavGuard((proceed) => {
        if (!dirtyRef.current) return false;
        // If several navigations arrive at once, the first one wins.
        setPendingDiscard((prev) => prev ?? proceed);
        return true;
      }),
    [],
  );

  const guard = (action: () => void) => (dirty ? setPendingDiscard((prev) => prev ?? action) : action());

  // ── Editing ──────────────────────────────────────────────────────────────
  const patchItems = (fn: (items: DraftItem[]) => DraftItem[]) =>
    setDraft((d) => ({ ...d, items: fn(d.items) }));

  /** Editing a row clears what the server last said about it. */
  const clearServerItemErrors = (uid: string) =>
    setServerErrors((s) => {
      if (!s || !s.items[uid]) return s;
      const { [uid]: _gone, ...rest } = s.items;
      return { ...s, items: rest };
    });

  const handleBasicChange = (field: Exclude<keyof DraftTemplate, 'items'>, value: string) => {
    if (field === 'sheet_id') sheetIdTouched.current = true;
    setServerErrors((s) => {
      if (!s || !s.basic[field]) return s;
      const { [field]: _gone, ...rest } = s.basic;
      return { ...s, basic: rest };
    });
    setDraft((d) => {
      const next = { ...d, [field]: value };
      // Until the admin types a Sheet ID, derive it from the part number (the previous behaviour on scan).
      if (field === 'part_no' && isNew && !sheetIdTouched.current) next.sheet_id = normalizeSheetId(value);
      return next;
    });
  };

  const handleLoadStandard = () => patchItems(() => standardItems());

  const handleAdd = (section: Section, stageArg?: string): string => {
    const stage = stageArg ?? [...draft.items].reverse().find((i) => (i.assigned_role === 'supervisor') === (section === 'supervisor'))?.stage_name ?? '';
    const item = createItem(section, section === 'operator' ? 'yesno' : 'numeric', stage.trim());
    patchItems((items) => [...items, item]);
    return item._uid;
  };

  const handleDuplicate = (uid: string): string => {
    const src = draft.items.find((i) => i._uid === uid);
    if (!src) return uid;
    const copy = duplicateItem(src);
    patchItems((items) => {
      const idx = items.findIndex((i) => i._uid === uid);
      return [...items.slice(0, idx + 1), copy, ...items.slice(idx + 1)];
    });
    return copy._uid;
  };

  const itemToDelete = draft.items.find((i) => i._uid === deleteUid);

  // ── Saving ───────────────────────────────────────────────────────────────
  const persist = async () => {
    setSaving(true);
    setBanner(null);
    setServerErrors(null);
    const sent = draft; // the rows are located by their position in what was sent
    try {
      const payload = toPayload(sent);
      const saved = isNew ? await createSheet(payload) : await updateSheet(sent.sheet_id, payload);
      await load(saved.sheet_id); // re-read from the server so the screen shows what was stored
      setBanner({ type: 'success', text: `Template '${saved.sheet_id}' ${isNew ? 'created' : 'saved'}.` });
    } catch (err: any) {
      const apiErr = err as ApiError;
      const msg: string = apiErr?.message || 'Could not save the template.';
      const mapped = mapServerErrors(apiErr?.detail, sent);
      // Duplicate part number / Sheet ID arrive as plain 400 messages.
      if (apiErr?.status === 400 && /part number/i.test(msg)) mapped.basic.part_no = msg;
      else if (apiErr?.status === 400 && /sheet id/i.test(msg)) mapped.basic.sheet_id = msg;

      const hasFieldErrors = Object.keys(mapped.basic).length > 0 || Object.keys(mapped.items).length > 0;
      if (hasFieldErrors) {
        setServerErrors(mapped);
        setShowErrors(true);
        setErrorJump((j) => j + 1);
      }
      if (apiErr?.status === 422) {
        setBanner({
          type: 'error',
          text: mapped.general.length ? mapped.general.join(' ') : 'The server rejected some fields. Fix the highlighted items and save again.',
        });
      } else if (apiErr?.status === 409) {
        setBanner({ type: 'error', text: msg });
      } else if (!(apiErr?.status === 400 && hasFieldErrors)) {
        setBanner({ type: 'error', text: msg });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    setShowErrors(true);
    if (clientValidation.total > 0) {
      setBanner({ type: 'error', kind: 'validation', text: 'Some fields need attention. Fix the highlighted items before saving.' });
      return;
    }
    void persist();
  };

  // ── Scan ─────────────────────────────────────────────────────────────────
  const handlePartScanned = (code: string) => {
    const part = code.trim();
    const existing = sheets.find((s) => (s.part_no || '').trim().toLowerCase() === part.toLowerCase());
    guard(() => {
      if (existing) {
        open(existing);
        setBanner({ type: 'success', text: `Opened the existing template for part number ${part}.` });
      } else {
        openBlank(part);
        setBanner({ type: 'success', text: `Part number ${part} added to a new template. Complete it and save.` });
      }
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="py-24 text-center" role="status">
        <div className="w-7 h-7 border-2 border-[var(--line2)] border-t-[var(--primary)] rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-[var(--muted)]">Loading templates...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="sv-card max-w-md mx-auto text-center space-y-3 !p-6">
        <AlertCircle className="w-8 h-8 text-[var(--ng)] mx-auto" />
        <p className="text-sm font-semibold text-[var(--ink)]">Could not load templates</p>
        <p className="sub">{loadError}</p>
        <button type="button" className="btn primary sm" onClick={() => window.location.reload()}>Try again</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="pb-3 border-b border-[var(--line)]">
        <h2>Templates</h2>
        <p className="sub mt-0.5">Define what operators check, what supervisors verify, and the rules that apply.</p>
      </div>

      {banner && (
        <div
          role={banner.type === 'error' ? 'alert' : 'status'}
          className={`p-3.5 rounded-xl text-sm flex items-start gap-2.5 border ${
            banner.type === 'success'
              ? 'border-[var(--ok)] bg-[var(--ok-bg)] text-[var(--ok)]'
              : 'border-[var(--ng)] bg-[var(--ng-bg)] text-[var(--ng)]'
          }`}
        >
          {banner.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span className="font-medium flex-1">{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} aria-label="Dismiss message" className="shrink-0 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-5 items-start">
        <TemplateList
          sheets={sheets}
          selectedId={selectedId}
          isNewSelected={isNew}
          newTitle={draft.document_title}
          onSelect={(id) => {
            if (!isNew && id === selectedId) return;
            const s = sheets.find((x) => x.sheet_id === id);
            if (s) guard(() => open(s));
          }}
          onNew={() => guard(() => openBlank())}
        />

        <TemplateEditor
          key={editorKey}
          draft={draft}
          isNew={isNew}
          dirty={dirty}
          saving={saving}
          validation={validation}
          showErrors={showErrors}
          serverErrors={serverBasic}
          usage={usage}
          errorJump={errorJump}
          onBasicChange={handleBasicChange}
          onScan={() => setIsScanOpen(true)}
          onViewQr={() => setIsPrintOpen(true)}
          onSave={handleSave}
          onAddItem={handleAdd}
          onLoadStandard={handleLoadStandard}
          onItemChange={(uid, patch) => {
            clearServerItemErrors(uid);
            patchItems((items) => items.map((i) => (i._uid === uid ? { ...i, ...patch } : i)));
          }}
          onItemKind={(uid, kind: Exclude<CheckKind, 'other'>) => {
            clearServerItemErrors(uid);
            patchItems((items) => items.map((i) => (i._uid === uid ? applyKind(i, kind) : i)));
          }}
          onItemMove={(uid, dir) => patchItems((items) => moveWithinSection(items, uid, dir))}
          onItemDuplicate={handleDuplicate}
          onItemDelete={(uid) => setDeleteUid(uid)}
        />
      </div>

      {/* Dialogs */}
      {pendingDiscard && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          confirmLabel="Discard changes"
          danger
          onCancel={() => setPendingDiscard(null)}
          onConfirm={() => { const run = pendingDiscard; setPendingDiscard(null); run(); }}
        >
          <p>You have edits that are not saved. If you leave now, they will be lost.</p>
        </ConfirmDialog>
      )}

      {itemToDelete && (
        <ConfirmDialog
          title={`Delete "${itemToDelete.control_item_name || 'this row'}"?`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteUid(null)}
          onConfirm={() => { patchItems((items) => items.filter((i) => i._uid !== deleteUid)); setDeleteUid(null); }}
        >
          <p>The row is removed when you save. Until then you can leave without saving to keep it.</p>
          {itemToDelete.item_id != null && (
            <p>If inspection values have already been recorded for this row, the server will refuse to delete it so that history is never lost.</p>
          )}
        </ConfirmDialog>
      )}

      {isPrintOpen && <PrintLabelModal isOpen onClose={() => setIsPrintOpen(false)} sheetId={draft.sheet_id} />}
      {isScanOpen && (
        <TFTScannerModal
          isOpen
          onClose={() => setIsScanOpen(false)}
          onResolved={() => setIsScanOpen(false)}
          scanAsPartNumber
          onUnregisteredCode={handlePartScanned}
        />
      )}
    </div>
  );
};
