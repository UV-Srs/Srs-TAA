import React, { useState, useEffect } from 'react';
import { fetchAuditLogs } from '../api';
import { RefreshCw, Search, ShieldCheck } from 'lucide-react';

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
    <div className="space-y-6 font-mono text-xs">
      {/* Header */}
      <div className="border-b-2 border-black pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black uppercase tracking-tight text-black font-sans">
            Audit Activity Trails & Regulatory Logs (FR-015)
          </h2>
          <p className="text-xs text-zinc-600">
            Immutable log of logins, field inputs, decisions, and supervisor overrides for active accounts
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search logs by action, role, sheet..."
              className="border-2 border-black px-3 py-1.5 pl-8 text-xs font-mono font-bold focus:outline-none w-64"
            />
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-500" />
          </div>

          <button
            onClick={loadLogs}
            className="p-2 border-2 border-black bg-white hover:bg-zinc-100 transition-colors"
            title="Refresh Logs"
          >
            <RefreshCw className="w-4 h-4 text-black" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-xs">Loading Audit Logs...</div>
      ) : (
        <div className="border-2 border-black bg-white overflow-x-auto">
          <table className="industrial-table min-w-full text-left">
            <thead>
              <tr className="industrial-header text-[11px] divide-x-2 divide-black">
                <th className="p-3 w-16">Log ID</th>
                <th className="p-3 w-28">Timestamp</th>
                <th className="p-3 w-20">User ID</th>
                <th className="p-3 w-24">Role</th>
                <th className="p-3 w-48">Action Type</th>
                <th className="p-3 w-32">Sheet / Batch</th>
                <th className="p-3">Details / Context</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-black">
              {filteredLogs.map((l) => (
                <tr key={l.log_id} className="divide-x-2 divide-black hover:bg-zinc-50">
                  <td className="p-2.5 font-bold">#{l.log_id}</td>
                  <td className="p-2.5 text-[11px] text-zinc-600">
                    {l.created_at ? new Date(l.created_at).toLocaleString('en-GB') : '-'}
                  </td>
                  <td className="p-2.5 font-bold">User #{l.user_id}</td>
                  <td className="p-2.5 font-extrabold uppercase">{l.role || '-'}</td>
                  <td className="p-2.5">
                    <span className="bg-black text-white px-1.5 py-0.5 text-[10px] font-bold">
                      {l.action_type}
                    </span>
                  </td>
                  <td className="p-2.5">
                    <div className="font-bold">{l.sheet_id || '-'}</div>
                    {l.batch_id && <div className="text-[10px] text-zinc-500">Batch #{l.batch_id}</div>}
                  </td>
                  <td className="p-2.5 text-[11px] text-zinc-700">
                    <pre className="whitespace-pre-wrap font-mono">
                      {l.details ? JSON.stringify(l.details) : '-'}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
