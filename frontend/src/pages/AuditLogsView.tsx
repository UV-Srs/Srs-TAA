import React, { useState, useEffect } from 'react';
import { fetchAuditLogs } from '../api';
import { RefreshCw, Search } from 'lucide-react';

export const AuditLogsView: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [filterText, setFilterText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    try {
      setIsLoading(true);
      const res = await fetchAuditLogs();
      setLogs(res);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
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
    <div className="space-y-6 text-xs">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Audit Activity Trail
          </h2>
          <p className="text-xs text-slate-500">
            Immutable log of logins, field inputs, decisions, and supervisor overrides
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search logs..."
              className="border border-slate-300 rounded-lg px-3 py-1.5 pl-8 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 w-full sm:w-60"
            />
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          </div>

          <button
            onClick={loadLogs}
            className="p-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-lg transition-colors"
            title="Refresh Logs"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-xs text-slate-400">Loading audit logs...</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="clean-table min-w-full text-xs">
              <thead>
                <tr>
                  <th className="w-16">ID</th>
                  <th className="w-32">Timestamp</th>
                  <th className="w-24">User</th>
                  <th className="w-24">Role</th>
                  <th className="w-48">Action</th>
                  <th className="w-32">Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((l) => (
                  <tr key={l.log_id}>
                    <td className="font-semibold text-slate-500">#{l.log_id}</td>
                    <td className="text-[11px] text-slate-500">
                      {l.created_at ? new Date(l.created_at).toLocaleString('en-GB') : '-'}
                    </td>
                    <td className="font-medium text-slate-800">User #{l.user_id}</td>
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
                    <td className="text-[11px] text-slate-600 max-w-md truncate">
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
