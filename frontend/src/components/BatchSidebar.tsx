import React, { useState } from 'react';
import { InspectionBatch, User } from '../types';
import { getCsvExportUrl, downloadCsvReport, handleReportDownloadClick } from '../api';
import { Download, AlertCircle, Clock, Search, ChevronDown } from 'lucide-react';

interface BatchSidebarProps {
  batches: InspectionBatch[];
  selectedBatchId: number | null;
  currentUser: User;
  onSelectBatch: (batchId: number) => void;
  progressSummary?: {
    with_operator: number;
    with_supervisor: number;
    on_hold: number;
    overdue_holds: number;
    approved: number;
    rejected: number;
  };
}

export const BatchSidebar: React.FC<BatchSidebarProps> = ({
  batches,
  selectedBatchId,
  currentUser,
  onSelectBatch,
  progressSummary,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  // Below lg the queue stacks above the checksheet; let it collapse so the sheet is reachable.
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const selectedBatch = batches.find((b) => b.batch_id === selectedBatchId);

  const handleSelect = (batchId: number) => {
    onSelectBatch(batchId);
    if (window.matchMedia('(max-width: 1023px)').matches) setIsCollapsed(true);
  };

  // Role-based filtering
  let roleList = batches;
  let title = 'Batches Queue';

  if (currentUser.role === 'operator') {
    roleList = batches.filter((b) =>
      ['CREATED_PENDING_OPERATOR', 'OPERATOR_IN_PROGRESS', 'pending', 'op_progress'].includes(b.status)
    );
    title = 'To Inspect';
  } else if (currentUser.role === 'supervisor') {
    roleList = batches.filter((b) =>
      ['OPERATOR_APPROVED', 'OPERATOR_REJECTED', 'SUPERVISOR_IN_PROGRESS', 'ON_HOLD', 'op_approved', 'op_rejected', 'sup_progress', 'hold'].includes(b.status)
    );
    title = 'To Review';
  }

  // Search filter
  const filteredList = roleList.filter((b) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const lot = (b.lot_number || '').toLowerCase();
    const prod = (b.product_name || b.template?.part_name || '').toLowerCase();
    const line = (b.line_name || '').toLowerCase();
    return lot.includes(q) || prod.includes(q) || line.includes(q);
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CREATED_PENDING_OPERATOR':
      case 'pending':
        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">Pending</span>;
      case 'OPERATOR_IN_PROGRESS':
      case 'op_progress':
        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-800">In Progress</span>;
      case 'OPERATOR_APPROVED':
      case 'op_approved':
        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800">Op Approved</span>;
      case 'OPERATOR_REJECTED':
      case 'op_rejected':
        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-800">Op Flagged</span>;
      case 'SUPERVISOR_IN_PROGRESS':
      case 'sup_progress':
        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-800">Reviewing</span>;
      case 'ON_HOLD':
      case 'hold':
        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200">On Hold</span>;
      case 'APPROVED':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900">Approved</span>;
      case 'REJECTED':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-900">Rejected</span>;
      default:
        return <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{status}</span>;
    }
  };

  return (
    <aside className="w-full lg:w-80 shrink-0 border border-slate-200 bg-white rounded-2xl shadow-sm p-4 space-y-3.5 text-xs">
      {/* Header & Search */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-2 min-w-0 lg:pointer-events-none"
            aria-expanded={!isCollapsed}
          >
            <h3 className="font-bold text-sm text-slate-900">{title}</h3>
            <span className="text-[11px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
              {filteredList.length}
            </span>
            {isCollapsed && selectedBatch && (
              <span className="lg:hidden font-mono text-[11px] text-slate-500 truncate">
                · {selectedBatch.lot_number}
              </span>
            )}
            <ChevronDown
              className={`lg:hidden w-4 h-4 text-slate-500 shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
            />
          </button>

          {currentUser.role === 'admin' && (
            <a
              href={getCsvExportUrl()}
              download="taa-inspection-records.csv"
              onClick={(e) => handleReportDownloadClick(e, downloadCsvReport)}
              className="text-[11px] font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1 transition-colors"
              title="Download CSV"
            >
              <Download className="w-3 h-3" />
              <span>CSV</span>
            </a>
          )}
        </div>

        {/* Quick Search */}
        <div className={`relative ${isCollapsed ? 'hidden lg:block' : ''}`}>
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search lot or part..."
            className="w-full pl-8 pr-3 py-2 lg:py-1.5 bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-slate-900 focus:bg-white rounded-lg text-xs font-medium text-slate-800 placeholder-slate-400 outline-none transition-all"
          />
        </div>
      </div>

      {/* Batch Cards List */}
      <div className={`space-y-1.5 max-h-[50vh] lg:max-h-[calc(100vh-280px)] overflow-y-auto pr-0.5 ${isCollapsed ? 'hidden lg:block' : ''}`}>
        {filteredList.length === 0 ? (
          <div className="py-8 px-4 border border-dashed border-slate-200 rounded-xl text-center text-slate-400">
            <Clock className="w-5 h-5 mx-auto mb-1.5 opacity-40" />
            <p className="text-xs font-medium text-slate-500">No batches waiting</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Scan a barcode to load a sheet</p>
          </div>
        ) : (
          filteredList.map((b) => {
            const isSelected = b.batch_id === selectedBatchId;
            return (
              <button
                key={b.batch_id}
                type="button"
                onClick={() => handleSelect(b.batch_id)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  isSelected
                    ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900 shadow-2xs'
                    : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-bold text-xs text-slate-900 font-mono tracking-tight">
                    {b.lot_number}
                  </span>
                  {getStatusBadge(b.status)}
                </div>

                <p className="text-xs text-slate-700 font-medium truncate">
                  {b.product_name || b.template?.part_name || b.sheet_id}
                </p>

                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 font-medium">
                  <span>{b.line_name || 'Line 1'}</span>
                  {b.round > 1 && (
                    <span className="text-purple-700 font-semibold bg-purple-50 px-1.5 py-0.2 rounded text-[10px]">
                      Round {b.round}
                    </span>
                  )}
                </div>

                {b.is_overdue && (
                  <div className="text-[10px] text-red-600 font-bold flex items-center gap-1 mt-1.5 bg-red-50 p-1 rounded border border-red-200">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>Hold overdue for review</span>
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
};
