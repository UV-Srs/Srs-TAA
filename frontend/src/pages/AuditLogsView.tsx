import React, { useState, useEffect, useRef } from 'react';
import { fetchAuditLogsPage, fetchAuditActions, downloadAuditCsv } from '../api';
import type { AuditLogEntry, AuditLogFilters } from '../types';
import { describeAction } from '../lib/auditLabels';
import { RefreshCw, Search, ShieldCheck, X, Download, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 25;
const ROLES: { id: string; label: string }[] = [
  { id: '', label: 'All roles' },
  { id: 'admin', label: 'Admin' },
  { id: 'supervisor', label: 'Supervisor' },
  { id: 'operator', label: 'Operator' },
];

const fmtTime = (iso?: string | null) =>
  iso
    ? new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    : '—';

const rolePill = (role?: string | null) => {
  const r = (role || '').toLowerCase();
  if (r === 'admin') return <span className="pill ok sm">Admin</span>;
  if (r === 'supervisor') return <span className="pill warn sm">Supervisor</span>;
  if (r === 'operator') return <span className="pill info sm">Operator</span>;
  return <span className="pill neutral sm">{role || 'System'}</span>;
};

/** Who did it: the saved name (kept after a user is removed), else the username, else System. */
const actorOf = (l: AuditLogEntry) => ({
  name: l.actor_name || l.actor_username || (l.role === 'system' || !l.user_id ? 'System' : `User #${l.user_id}`),
  sub: l.actor_name && l.actor_username ? `@${l.actor_username}` : '',
});

/** A short one-line summary of the details, for the table. */
const summarise = (details?: Record<string, unknown> | null) => {
  const entries = Object.entries(details || {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!entries.length) return '—';
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ') + (entries.length > 3 ? ` · +${entries.length - 3} more` : '');
};

export const AuditLogsView: React.FC = () => {
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actions, setActions] = useState<string[]>([]);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  const [exporting, setExporting] = useState(false);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [role, setRole] = useState('');
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filters: AuditLogFilters = { q: debounced, role, action_type: action, date_from: dateFrom, date_to: dateTo };
  const filterKey = JSON.stringify(filters);
  const lastKey = useRef(filterKey);

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    fetchAuditActions().then(setActions).catch(() => {});
  }, []);

  const load = async (p: number) => {
    try {
      setIsLoading(true);
      setError('');
      const res = await fetchAuditLogsPage(filters, p, PAGE_SIZE);
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the audit trail.');
    } finally {
      setIsLoading(false);
    }
  };

  // A changed filter goes back to page 1; paging reloads the same filter.
  useEffect(() => {
    if (lastKey.current !== filterKey) {
      lastKey.current = filterKey;
      if (page !== 1) { setPage(1); return; }
    }
    load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  const hasFilters = !!(debounced || role || action || dateFrom || dateTo);

  const clearFilters = () => {
    setSearch(''); setDebounced(''); setRole(''); setAction(''); setDateFrom(''); setDateTo('');
  };

  const handleExport = async () => {
    try {
      setExporting(true);
      await downloadAuditCsv(filters);
    } catch (err) {
      window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[var(--line)]">
        <div className="min-w-0">
          <h2>Audit Trail</h2>
          <p className="sub mt-0.5">Who signed in, changed or approved what, and when. History is kept even after a user is removed.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} disabled={exporting || total === 0} className="btn sm disabled:opacity-50" title="Download the filtered trail as CSV">
            <Download className="w-3.5 h-3.5" /><span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
          </button>
          <button onClick={() => load(page)} className="btn sm" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="sv-card flush">
        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <div className="p-4 sm:p-5 border-b border-[var(--line)] space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="w-4 h-4 text-[var(--muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, action, lot, sheet or address…"
                className="w-full min-h-[44px] pl-10 pr-4 rounded-[12px] border border-[var(--line2)] bg-[var(--surface)] text-[14px] text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>

            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="min-h-[44px] px-3 rounded-[12px] border border-[var(--line2)] bg-[var(--surface)] text-[14px] text-[var(--ink)] max-w-full"
              aria-label="Filter by action"
            >
              <option value="">All actions</option>
              {actions.map((a) => <option key={a} value={a}>{describeAction(a).label}</option>)}
            </select>

            <div className="flex items-center gap-2 px-3 min-h-[44px] bg-[var(--surface)] border border-[var(--line2)] rounded-[12px]">
              <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setDateTo(e.target.value); }}
                className="bg-transparent text-xs text-[var(--ink)] font-medium focus:outline-none cursor-pointer" title="Date" aria-label="Date" />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 p-1 bg-[var(--surface2)] rounded-full border border-[var(--line)] overflow-x-auto max-w-full">
              {ROLES.map((r) => (
                <button key={r.id || 'all'} type="button" onClick={() => setRole(r.id)} className={`stchip shrink-0 whitespace-nowrap ${role === r.id ? 'on' : ''}`}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {hasFilters && (
                <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted)] hover:text-[var(--ng)]">
                  <X className="w-3.5 h-3.5" /> Clear filters
                </button>
              )}
              <span className="pill neutral sm font-semibold">{total} {total === 1 ? 'event' : 'events'}</span>
            </div>
          </div>
        </div>

        {/* ── Table ───────────────────────────────────────────────────────── */}
        {error && <div className="m-4 p-3 rounded-xl bg-[var(--ng-bg)] text-[var(--ng)] text-sm">{error}</div>}
        <div className="overflow-x-auto">
          {isLoading && items.length === 0 ? (
            <div className="py-20 text-center">
              <div className="w-6 h-6 border-2 border-[var(--line2)] border-t-[var(--primary)] rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs text-[var(--muted)]">Loading audit trail…</p>
            </div>
          ) : (
            <table className="vt" style={{ opacity: isLoading ? 0.6 : 1 }}>
              <thead>
                <tr>
                  <th className="w-40">When</th>
                  <th className="w-48">Who</th>
                  <th className="w-56">Action</th>
                  <th className="w-44">Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-xs text-[var(--muted)]">
                      {hasFilters ? 'No events match these filters.' : 'No audit trail events recorded yet.'}
                    </td>
                  </tr>
                ) : (
                  items.map((l) => {
                    const act = describeAction(l.action_type);
                    const who = actorOf(l);
                    return (
                      <tr key={l.log_id} onClick={() => setSelected(l)} className="cursor-pointer hover:bg-[var(--surface2)]">
                        <td className="text-xs text-[var(--muted)] whitespace-nowrap mono">{fmtTime(l.created_at)}</td>
                        <td>
                          <div className="font-medium text-xs text-[var(--ink)]">{who.name}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">{rolePill(l.role)}{who.sub && <span className="text-[11px] text-[var(--muted)]">{who.sub}</span>}</div>
                        </td>
                        <td><span className={`pill ${act.tone} sm font-semibold`}>{act.label}</span></td>
                        <td>
                          {l.sheet_id || l.batch_id ? (
                            <div>
                              {l.sheet_id && <div className="font-medium text-xs text-[var(--ink)] mono">{l.sheet_id}</div>}
                              {l.batch_id && <div className="text-[11px] text-[var(--muted)] mono">Lot #{l.batch_id}</div>}
                            </div>
                          ) : <span className="text-[var(--muted)]">—</span>}
                        </td>
                        <td className="max-w-md text-xs text-[var(--muted)] truncate" title={summarise(l.details)}>{summarise(l.details)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pager ───────────────────────────────────────────────────────── */}
        <div className="p-3.5 bg-[var(--surface2)] border-t border-[var(--line)] text-xs text-[var(--muted)] flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1 font-medium text-[var(--ink)]">
            <ShieldCheck className="w-3.5 h-3.5 text-[var(--ok)]" />
            {from}–{to} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn sm disabled:opacity-50" disabled={page <= 1 || isLoading} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="w-3.5 h-3.5" /><span>Previous</span>
            </button>
            <span>Page {page} of {pages}</span>
            <button type="button" className="btn sm disabled:opacity-50" disabled={page >= pages || isLoading} onClick={() => setPage((p) => p + 1)}>
              <span>Next</span><ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Event detail ──────────────────────────────────────────────────── */}
      {selected && <AuditDetail log={selected} onClose={() => setSelected(null)} />}
    </div>
  );
};

const AuditDetail: React.FC<{ log: AuditLogEntry; onClose: () => void }> = ({ log, onClose }) => {
  const act = describeAction(log.action_type);
  const who = actorOf(log);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows: [string, React.ReactNode][] = [
    ['Event ID', <span className="mono">#{log.log_id}</span>],
    ['When', fmtTime(log.created_at)],
    ['Who', <>{who.name} {who.sub && <span className="text-[var(--muted)]">{who.sub}</span>} {rolePill(log.role)}</>],
    ['Sheet', log.sheet_id ? <span className="mono">{log.sheet_id}</span> : '—'],
    ['Lot', log.batch_id ? <span className="mono">#{log.batch_id}</span> : '—'],
    ['IP address', log.ip_address ? <span className="mono">{log.ip_address}</span> : '—'],
    ['Browser', log.user_agent ? <span className="text-xs break-words">{log.user_agent}</span> : '—'],
  ];
  const details = log.details && Object.keys(log.details).length ? log.details : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 no-print backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-label="Audit event details">
      <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--line)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className={`pill ${act.tone} sm font-semibold`}>{act.label}</span>
            <p className="text-[11px] text-[var(--muted)] mono mt-1 break-all">{log.action_type}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-[var(--muted)] hover:text-[var(--ink)] rounded-lg" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <dl className="px-5 py-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2.5 text-sm">
          {rows.map(([k, v]) => (<React.Fragment key={k}><dt className="text-[var(--muted)] text-xs pt-0.5">{k}</dt><dd className="text-[var(--ink)] min-w-0">{v}</dd></React.Fragment>))}
        </dl>
        <div className="px-5 pb-5">
          <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">Details</p>
          {details ? (
            <pre className="text-xs bg-[var(--surface2)] border border-[var(--line)] rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-words mono">{JSON.stringify(details, null, 2)}</pre>
          ) : (
            <p className="text-xs text-[var(--muted)]">No extra details were recorded.</p>
          )}
        </div>
      </div>
    </div>
  );
};
