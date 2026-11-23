import React, { useState, useEffect, useMemo } from 'react';
import { fetchAuditLogs } from '../api';
import { RefreshCw, Search, ShieldCheck, Calendar, X } from 'lucide-react';

export const AuditLogsView: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [filterText, setFilterText] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    try {
      setIsLoading(true);
      const res = await fetchAuditLogs();
      setLogs(res || []);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (roleFilter !== 'all' && l.role?.toLowerCase() !== roleFilter.toLowerCase()) {
        return false;
      }
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        if (new Date(l.timestamp) < start) return false;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (new Date(l.timestamp) > end) return false;
      }
      if (!filterText.trim()) return true;
      const q = filterText.toLowerCase().trim();
      return (
        l.action_type?.toLowerCase().includes(q) ||
        l.role?.toLowerCase().includes(q) ||
        l.sheet_id?.toLowerCase().includes(q) ||
        String(l.user_id).includes(q) ||
        String(l.batch_id).includes(q) ||
        JSON.stringify(l.details || {}).toLowerCase().includes(q)
      );
    });
  }, [logs, filterText, roleFilter, startDate, endDate]);

  const getRolePill = (role?: string) => {
    const r = (role || '').toLowerCase();
    if (r === 'admin') return <span className="pill ok sm">Admin</span>;
    if (r === 'supervisor') return <span className="pill warn sm">Supervisor</span>;
    if (r === 'operator') return <span className="pill info sm">Operator</span>;
    return <span className="pill neutral sm">{role || 'System'}</span>;
  };

  const formatDetails = (details: any) => {
    if (!details) return <span className="text-[var(--muted)]">—</span>;
    if (typeof details === 'string') {
      try {
        details = JSON.parse(details);
      } catch {
        return <span className="text-xs text-[var(--ink)] mono">{details}</span>;
      }
    }
    if (typeof details === 'object') {
      const keys = Object.keys(details);
      if (keys.length === 0) return <span className="text-[var(--muted)]">—</span>;
      return (
        <div className="flex flex-wrap gap-1.5 items-center">
          {keys.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--surface2)] text-[11px] text-[var(--ink)] border border-[var(--line)]"
            >
              <span className="text-[var(--muted)] font-medium">{k}:</span>
              <strong className="font-semibold mono">{String(details[k])}</strong>
            </span>
          ))}
        </div>
      );
    }
    return <span className="text-xs text-[var(--ink)]">{String(details)}</span>;
  };

  return (
    <div className="space-y-6">
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--line)]">
        <div>
          <h2>Audit Trail</h2>
          <p className="sub mt-0.5">
            Immutable log of logins, field inputs, supervisor sign-offs, and administrative overrides
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Start Date & End Date Range Selector */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--surface)] border border-[var(--line2)] rounded-xl shadow-xs">
            <Calendar className="w-4 h-4 text-[var(--muted)] shrink-0" />
            <div className="flex items-center gap-1.5 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">From</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-transparent text-xs text-[var(--ink)] font-medium focus:outline-none cursor-pointer"
                  title="Start Date"
                />
              </div>
              <span className="text-[var(--muted)] font-normal">—</span>
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">To</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-transparent text-xs text-[var(--ink)] font-medium focus:outline-none cursor-pointer"
                  title="End Date"
                />
              </div>
            </div>

            {(startDate || endDate) ? (
              <button
                type="button"
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                }}
                className="p-1 text-[var(--muted)] hover:text-[var(--ng)] rounded-md transition-colors cursor-pointer ml-1"
                title="Clear date range (Reset to All over time)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <span className="pill neutral sm text-[10px] font-semibold ml-1">All over time</span>
            )}
          </div>

          {/* Role Filter Chips */}
          <div className="flex items-center gap-1.5 p-1 bg-[var(--surface2)] rounded-full border border-[var(--line)]">
            {['all', 'admin', 'supervisor', 'operator'].map((r) => {
              const labels: Record<string, string> = {
                all: 'All roles',
                admin: 'Admin',
                supervisor: 'Supervisor',
                operator: 'Operator',
              };
              const isSelected = roleFilter === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoleFilter(r)}
                  className={`stchip ${isSelected ? 'on' : ''}`}
                >
                  {labels[r]}
                </button>
              );
            })}
          </div>

          <button
            onClick={loadLogs}
            className="btn sm"
            title="Refresh logs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Main Audit Table Card ─────────────────────────────────────────── */}
      <div className="sv-card flush">
        {/* Toolbar */}
        <div className="p-4 sm:p-5 border-b border-[var(--line)] flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-4 h-4 text-[var(--muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search audit trail by action, role, user, or sheet..."
              className="w-full min-h-[44px] pl-10 pr-4 rounded-[12px] border border-[var(--line2)] bg-[var(--surface)] text-[14px] text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="pill neutral sm font-semibold">
              {filteredLogs.length} {filteredLogs.length === 1 ? 'event' : 'events'}
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="py-20 text-center">
              <div className="w-6 h-6 border-2 border-[var(--line2)] border-t-[var(--primary)] rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs text-[var(--muted)]">Loading audit trail...</p>
            </div>
          ) : (
            <table className="vt">
              <thead>
                <tr>
                  <th className="w-16">#ID</th>
                  <th className="w-40">Timestamp</th>
                  <th className="w-32">User</th>
                  <th className="w-28">Role</th>
                  <th className="w-56">Action</th>
                  <th className="w-44">Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-xs text-[var(--muted)]">
                      {filterText ? `No audit logs match "${filterText}".` : 'No audit trail events recorded yet.'}
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((l) => {
                    const formattedDate = l.created_at
                      ? new Date(l.created_at).toLocaleString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })
                      : '—';

                    return (
                      <tr key={l.log_id}>
                        <td className="font-semibold text-[var(--muted)] mono text-xs">
                          #{l.log_id}
                        </td>
                        <td className="text-xs text-[var(--muted)] whitespace-nowrap mono">
                          {formattedDate}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-[var(--accent-soft)] text-[var(--primary)] flex items-center justify-center font-semibold text-[11px] shrink-0">
                              {l.user_id ? String(l.user_id).slice(-1) : 'U'}
                            </div>
                            <span className="font-medium text-xs text-[var(--ink)]">
                              User #{l.user_id}
                            </span>
                          </div>
                        </td>
                        <td>{getRolePill(l.role)}</td>
                        <td>
                          <span className="pill neutral sm font-semibold mono">
                            {l.action_type}
                          </span>
                        </td>
                        <td>
                          {l.sheet_id || l.batch_id ? (
                            <div>
                              {l.sheet_id && (
                                <div className="font-medium text-xs text-[var(--ink)] mono">{l.sheet_id}</div>
                              )}
                              {l.batch_id && (
                                <div className="text-[11px] text-[var(--muted)] mono">Batch #{l.batch_id}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )}
                        </td>
                        <td className="max-w-md">
                          {formatDetails(l.details)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Note */}
        <div className="p-3.5 bg-[var(--surface2)] border-t border-[var(--line)] text-xs text-[var(--muted)] flex items-center justify-between">
          <span>All inspection transactions and login attempts are cryptographically timestamped and retained.</span>
          <span className="flex items-center gap-1 font-medium text-[var(--ink)]">
            <ShieldCheck className="w-3.5 h-3.5 text-[var(--ok)]" />
            Append-only ledger
          </span>
        </div>
      </div>
    </div>
  );
};
