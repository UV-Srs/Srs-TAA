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
      <div className="border-b border-slate-200 pb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">Audit Activity Trail</h2>
          <p className="text-xs text-slate-500">Immutable log of logins, field inputs, decisions, and supervisor overrides</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Inline search */}
          <div className="relative">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search in results..."
              className="border border-slate-300 rounded-lg px-3 py-1.5 pl-8 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 w-52"
            />
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(s => !s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors ${
              hasFilters ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {hasFilters && <span className="bg-indigo-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">!</span>}
          </button>

          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors">
              <X className="w-3 h-3" /> Clear
            </button>
          )}

          <button
            onClick={loadLogs}
            className="p-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Action Type</label>
            <select
              value={filterAction}
              onChange={e => setFilterAction(e.target.value)}
              className="border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="">All actions</option>
              {ACTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Date From</label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={e => setFilterDateFrom(e.target.value)}
              className="border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Date To</label>
            <input
              type="date"
              value={filterDateTo}
              onChange={e => setFilterDateTo(e.target.value)}
              className="border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
        </div>
      )}

      {/* Count */}
      <div className="text-[11px] text-slate-400">
        Showing {filteredLogs.length} {filteredLogs.length !== logs.length ? `of ${logs.length} ` : ''}entries
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-xs text-slate-400">Loading audit logs...</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
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
                    <td colSpan={7} className="py-10 text-center text-slate-400">No audit logs match your filters</td>
                  </tr>
                ) : filteredLogs.map((l) => (
                  <tr key={l.log_id}>
                    <td className="font-semibold text-slate-500">#{l.log_id}</td>
                    <td className="text-[11px] text-slate-500 whitespace-nowrap">
                      {l.created_at ? new Date(l.created_at).toLocaleString('en-GB') : '-'}
                    </td>
                    <td className="font-medium text-slate-800">{l.user_id ? `User #${l.user_id}` : 'System'}</td>
                    <td className="capitalize text-slate-600">{l.role || '-'}</td>
                    <td>
                      <span className="font-semibold text-slate-900 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                        {l.action_type}
                      </span>
                    </td>
                    <td>
                      <div className="font-medium text-slate-800">{l.sheet_id || '-'}</div>
                      {l.batch_id && <div className="text-[10px] text-slate-400">Batch #{l.batch_id}</div>}
                    </td>
                    <td className="text-[11px] text-slate-600 max-w-xs truncate">
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
