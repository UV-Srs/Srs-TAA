import React, { useCallback, useEffect, useState } from 'react';
import { fetchNotificationsPage, markNotificationsRead } from '../api';
import { onNotificationDispatched } from '../liveSync';
import type { InAppNotification } from '../types';
import { NOTIFICATION_KINDS } from '../lib/auditLabels';
import { Bell, CheckCheck, ChevronLeft, ChevronRight, AlertTriangle, Info, ShieldAlert } from 'lucide-react';

const PAGE_SIZE = 20;

interface NotificationsViewProps {
  /** Open the lot a notification is about (by its lot number). */
  onOpenLot: (lotNumber: string) => void;
}

const when = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const SEVERITY: Record<string, { icon: React.ReactNode; cls: string }> = {
  critical: { icon: <ShieldAlert className="w-4 h-4" />, cls: 'bg-[var(--ng-bg)] text-[var(--ng)]' },
  warn: { icon: <AlertTriangle className="w-4 h-4" />, cls: 'bg-[var(--warn-bg)] text-[var(--warn)]' },
  info: { icon: <Info className="w-4 h-4" />, cls: 'bg-[var(--accent-soft)] text-[var(--primary)]' },
};

export const NotificationsView: React.FC<NotificationsViewProps> = ({ onOpenLot }) => {
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [kind, setKind] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await fetchNotificationsPage({ offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE, unreadOnly, kind });
      setItems(res.items);
      setTotal(res.total);
      setUnreadTotal(res.unread_total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load notifications.');
    } finally {
      setIsLoading(false);
    }
  }, [page, unreadOnly, kind]);

  useEffect(() => { setIsLoading(true); load(); }, [load]);
  // New notifications arrive live.
  useEffect(() => onNotificationDispatched(() => { load(); }), [load]);

  const changeFilter = (fn: () => void) => { fn(); setPage(1); };

  const markAll = async () => {
    try { await markNotificationsRead(); await load(); } catch { /* keep the list as it is */ }
  };

  const openOne = async (n: InAppNotification) => {
    if (!n.is_read) {
      try { await markNotificationsRead(n.notification_id); } catch { /* ignore */ }
      setItems((prev) => prev.map((x) => (x.notification_id === n.notification_id ? { ...x, is_read: true } : x)));
      setUnreadTotal((u) => Math.max(0, u - 1));
    }
    if (n.batch_code) onOpenLot(n.batch_code);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[var(--line)]">
        <div className="min-w-0">
          <h2>Notifications</h2>
          <p className="sub mt-0.5">Lots, reviews, holds, user changes and security alerts. Read state is yours alone.</p>
        </div>
        <button type="button" onClick={markAll} disabled={unreadTotal === 0} className="btn sm disabled:opacity-50">
          <CheckCheck className="w-3.5 h-3.5" /><span>Mark all as read</span>
        </button>
      </div>

      <div className="sv-card flush">
        <div className="p-4 sm:p-5 border-b border-[var(--line)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 p-1 bg-[var(--surface2)] rounded-full border border-[var(--line)] overflow-x-auto max-w-full">
            <button type="button" className={`stchip shrink-0 whitespace-nowrap ${!kind ? 'on' : ''}`} onClick={() => changeFilter(() => setKind(''))}>All types</button>
            {NOTIFICATION_KINDS.map((k) => (
              <button key={k.id} type="button" className={`stchip shrink-0 whitespace-nowrap ${kind === k.id ? 'on' : ''}`} onClick={() => changeFilter(() => setKind(k.id))}>
                {k.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 p-1 bg-[var(--surface2)] rounded-full border border-[var(--line)]">
              <button type="button" className={`stchip shrink-0 whitespace-nowrap ${!unreadOnly ? 'on' : ''}`} onClick={() => changeFilter(() => setUnreadOnly(false))}>All</button>
              <button type="button" className={`stchip shrink-0 whitespace-nowrap ${unreadOnly ? 'on' : ''}`} onClick={() => changeFilter(() => setUnreadOnly(true))}>
                Unread{unreadTotal > 0 ? ` (${unreadTotal})` : ''}
              </button>
            </div>
          </div>
        </div>

        {error && <div className="m-4 p-3 rounded-xl bg-[var(--ng-bg)] text-[var(--ng)] text-sm">{error}</div>}

        {isLoading && items.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-6 h-6 border-2 border-[var(--line2)] border-t-[var(--primary)] rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs text-[var(--muted)]">Loading notifications…</p>
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-[var(--muted)]">
            <Bell className="w-6 h-6 mx-auto mb-2 opacity-60" />
            <p className="text-sm">{unreadOnly ? 'You are all caught up.' : 'No notifications yet.'}</p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {items.map((n) => {
              const sev = SEVERITY[n.severity || 'info'] || SEVERITY.info;
              const kindLabel = NOTIFICATION_KINDS.find((k) => k.id === n.kind)?.label;
              return (
                <li key={n.notification_id}>
                  <button
                    type="button"
                    onClick={() => openOne(n)}
                    className={`w-full text-left px-4 sm:px-5 py-3.5 flex items-start gap-3 hover:bg-[var(--surface2)] transition-colors ${!n.is_read ? 'bg-[var(--accent-soft)]/40' : ''}`}
                  >
                    <span className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${sev.cls}`}>{sev.icon}</span>
                    <span className="flex-1 min-w-0">
                      <span className={`block text-sm leading-snug ${!n.is_read ? 'font-semibold text-[var(--ink)]' : 'text-[var(--muted)]'}`}>{n.text}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted)]">
                        <span>{when(n.created_at)}</span>
                        {kindLabel && <span className="pill neutral sm">{kindLabel}</span>}
                        {n.batch_code && <span className="mono">Lot {n.batch_code}</span>}
                      </span>
                    </span>
                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-[var(--ng)] mt-2 shrink-0" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="p-3.5 bg-[var(--surface2)] border-t border-[var(--line)] text-xs text-[var(--muted)] flex flex-wrap items-center justify-between gap-2">
          <span>{total} {total === 1 ? 'notification' : 'notifications'}</span>
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
    </div>
  );
};
