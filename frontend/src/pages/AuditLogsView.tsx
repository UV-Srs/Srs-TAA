import React, { useState, useEffect, useCallback } from 'react';
import { fetchAuditLogs } from '../api';
import { RefreshCw, Search, Filter, X } from 'lucide-react';

const ACTION_TYPES = [
  'USER_LOGIN', 'USER_CREATED', 'USER_CHANGE_PASSWORD',
  'SHEET_TEMPLATE_CREATED', 'SHEET_UPDATED', 'SHEET_DELETED', 'SHEET_SET_DEFAULT',
  'BATCH_QUICK_REGISTERED', 'BATCH_DELETED',
  'OPERATOR_STARTED_INSPECTION', 'OPERATOR_SUBMITTED',
  'SUPERVISOR_OPENED_REVIEW', 'SUPERVISOR_FIELD_REVIEW', 'SUPERVISOR_REVIEWED',
  'HOLD_RELEASED_APPROVE', 'HOLD_RELEASED_REJECT', 'HOLD_RELEASED_REINSPECT',
  'HOLD_OVERDUE_ESCALATION',
];

export const AuditLogsView: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [filterText, setFilterText] = useState<string>('');
  const [filterAction, setFilterAction] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  const hasFilters = filterAction || filterDateFrom || filterDateTo;

  const loadLogs = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetchAuditLogs({
        action_type: filterAction || undefined,
        date_from: filterDateFrom || undefined,
        date_to: filterDateTo ? filterDateTo + 'T23:59:59' : undefined,
        limit: 500,
      });
      setLogs(res);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [filterAction, filterDateFrom, filterDateTo]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const clearFilters = () => {
    setFilterAction('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  const filteredLogs = logs.filter((l) => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    return (
      l.action_type?.toLowerCase().includes(q) ||
      l.role?.toLowerCase().includes(q) ||
      l.sheet_id?.toLowerCase().includes(q) ||
      String(l.user_id).includes(q) ||
      String(l.batch_id).includes(q)
    );
  });

  return (
    <div className="space-y-4 text-xs">
      {/* Header */}
      <div className="pb-4 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--line)' }}>
        <div>
          <h2 className="font-semibold" style={{ fontSize: 24, letterSpacing: '-0.015em', color: 'var(--ink)' }}>Audit Log</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Immutable log of logins, field inputs, decisions, and supervisor overrides</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Inline search */}
          <div className="relative">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search in results..."
              className="rounded-lg px-3 py-1.5 pl-8 text-xs outline-none w-52"
              style={{ border: '1px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)' }}
            />
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: 'var(--muted)' }} />
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(s => !s)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={hasFilters
              ? { border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)' }
              : { border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--muted)' }
            }
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {hasFilters && (
              <span className="text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center"
                style={{ background: 'var(--accent)', color: '#fff' }}>!</span>
            )}
          </button>

          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs transition-colors" style={{ color: 'var(--muted)' }}>
              <X className="w-3 h-3" /> Clear
            </button>
          )}

          <button
            onClick={loadLogs}
            className="p-1.5 rounded-lg transition-colors"
            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--muted)' }}
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="rounded-lg p-4 flex flex-wrap gap-4 items-end" style={{ background: 'var(--surface2)', border: '1px solid var(--line)' }}>
          <div>
            <label className="block text-[10px] font-semibold mb-1 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Action Type</label>
            <select
              value={filterAction}
              onChange={e => setFilterAction(e.target.value)}
              className="rounded-lg px-2.5 py-1.5 text-xs outline-none"
              style={{ border: '1px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)' }}
            >
              <option value="">All actions</option>
              {ACTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold mb-1 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Date From</label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={e => setFilterDateFrom(e.target.value)}
              className="rounded-lg px-2.5 py-1.5 text-xs outline-none"
              style={{ border: '1px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)' }}
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold mb-1 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Date To</label>
            <input
              type="date"
              value={filterDateTo}
              onChange={e => setFilterDateTo(e.target.value)}
              className="rounded-lg px-2.5 py-1.5 text-xs outline-none"
              style={{ border: '1px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)' }}
            />
          </div>
        </div>
      )}

      {/* Count */}
      <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
        Showing {filteredLogs.length} {filteredLogs.length !== logs.length ? `of ${logs.length} ` : ''}entries
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-xs" style={{ color: 'var(--muted)' }}>Loading audit logs...</div>
      ) : (
        <div className="overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>
          <div className="overflow-x-auto">
            <table className="clean-table min-w-full text-xs">
              <thead>
                <tr>
                  <th className="w-16">ID</th>
                  <th className="w-36">Timestamp</th>
                  <th className="w-24">User</th>
                  <th className="w-24">Role</th>
                  <th className="w-52">Action</th>
                  <th className="w-32">Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center" style={{ color: 'var(--muted)' }}>No audit logs match your filters</td>
                  </tr>
                ) : filteredLogs.map((l) => (
                  <tr key={l.log_id}>
                    <td className="font-semibold tabular-nums" style={{ color: 'var(--muted)' }}>#{l.log_id}</td>
                    <td className="text-[11px] whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                      {l.created_at ? new Date(l.created_at).toLocaleString('en-GB') : '-'}
                    </td>
                    <td className="font-medium" style={{ color: 'var(--ink)' }}>{l.user_id ? `User #${l.user_id}` : 'System'}</td>
                    <td className="capitalize" style={{ color: 'var(--muted)' }}>{l.role || '-'}</td>
                    <td>
                      <span className="font-semibold text-[11px] px-2 py-0.5 rounded"
                        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                        {l.action_type}
                      </span>
                    </td>
                    <td>
                      <div className="font-medium" style={{ color: 'var(--ink)' }}>{l.sheet_id || '-'}</div>
                      {l.batch_id && <div className="text-[10px]" style={{ color: 'var(--muted)' }}>Batch #{l.batch_id}</div>}
                    </td>
                    <td className="text-[11px] max-w-xs truncate" style={{ color: 'var(--muted)' }}>
                      {l.details ? JSON.stringify(l.details) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
