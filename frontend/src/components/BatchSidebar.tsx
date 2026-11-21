import React from 'react';
import { InspectionBatch, User } from '../types';
import { getCsvExportUrl } from '../api';
import { Download, AlertCircle, Clock } from 'lucide-react';

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
  // Filter lists by role
  let list = batches;
  let title = 'All batches';

  if (currentUser.role === 'operator') {
    list = batches.filter((b) =>
      ['CREATED_PENDING_OPERATOR', 'OPERATOR_IN_PROGRESS', 'pending', 'op_progress'].includes(b.status)
    );
    title = 'Ready for inspection';
  } else if (currentUser.role === 'supervisor') {
    list = batches.filter((b) =>
      ['OPERATOR_APPROVED', 'OPERATOR_REJECTED', 'SUPERVISOR_IN_PROGRESS', 'ON_HOLD', 'op_approved', 'op_rejected', 'sup_progress', 'hold'].includes(b.status)
    );
    title = 'Awaiting your review';
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CREATED_PENDING_OPERATOR':
      case 'pending':
        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">Pending Operator</span>;
      case 'OPERATOR_IN_PROGRESS':
      case 'op_progress':
        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200">In Progress</span>;
      case 'OPERATOR_APPROVED':
      case 'op_approved':
        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">Operator Approved</span>;
      case 'OPERATOR_REJECTED':
      case 'op_rejected':
        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-50 text-red-800 border border-red-200">Operator Rejected</span>;
      case 'SUPERVISOR_IN_PROGRESS':
      case 'sup_progress':
        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-purple-50 text-purple-800 border border-purple-200">Reviewing</span>;
      case 'ON_HOLD':
      case 'hold':
        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-300">On Hold</span>;
      case 'APPROVED':
        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold">Approved</span>;
      case 'REJECTED':
        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-100 text-red-900 font-bold">Rejected</span>;
      default:
        return <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-700">{status}</span>;
    }
  };

  return (
    <aside className="w-full lg:w-72 shrink-0 border-r border-slate-200 p-4 space-y-4 text-xs bg-white">
      {/* Admin KPI Progress Tiles */}
      {currentUser.role === 'admin' && progressSummary && (
        <div className="space-y-2">
          <h3 className="font-bold text-xs text-slate-900">Progress</h3>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
              <b className="text-base font-bold text-slate-900 block leading-tight">
                {progressSummary.with_operator}
              </b>
              <span className="text-[10px] text-slate-500 font-medium">With Operator</span>
            </div>

            <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
              <b className="text-base font-bold text-purple-900 block leading-tight">
                {progressSummary.with_supervisor}
              </b>
              <span className="text-[10px] text-slate-500 font-medium">With Supervisor</span>
            </div>

            <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
              <b className="text-base font-bold text-amber-700 block leading-tight">
                {progressSummary.on_hold}
                {progressSummary.overdue_holds > 0 && (
                  <span className="text-[10px] text-red-600 block font-normal">
                    {progressSummary.overdue_holds} overdue
                  </span>
                )}
              </b>
              <span className="text-[10px] text-slate-500 font-medium">On Hold</span>
            </div>

            <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
              <b className="text-base font-bold text-slate-900 block leading-tight">
                {progressSummary.approved} / {progressSummary.rejected}
              </b>
              <span className="text-[10px] text-slate-500 font-medium">Approved / Rejected</span>
            </div>
          </div>

          <a
            href={getCsvExportUrl()}
            download="taa-inspection-records.csv"
            className="w-full py-1.5 px-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors text-[11px]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download records (CSV)</span>
          </a>
        </div>
      )}

      {/* Queue Header */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-xs text-slate-900">{title}</h3>
          <span className="text-[11px] font-semibold text-slate-500">
            {list.length} {list.length === 1 ? 'batch' : 'batches'}
          </span>
        </div>

        {/* Batch Queue Cards */}
        <div className="space-y-1.5 max-h-[620px] overflow-y-auto pr-1">
          {list.length === 0 ? (
            <div className="p-4 border border-dashed border-slate-200 rounded-xl text-center text-slate-400">
              <Clock className="w-6 h-6 mx-auto mb-1 opacity-40" />
              <p className="text-[11px]">Nothing waiting in queue.</p>
            </div>
          ) : (
            list.map((b) => {
              const isSelected = b.batch_id === selectedBatchId;
              return (
                <button
                  key={b.batch_id}
                  type="button"
                  onClick={() => onSelectBatch(b.batch_id)}
                  className={`w-full text-left p-2.5 rounded-xl border transition-all ${
                    isSelected
                      ? 'border-slate-900 bg-slate-50 shadow-sm border-l-4'
                      : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-bold text-xs text-slate-900">{b.lot_number}</span>
                    {getStatusBadge(b.status)}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {b.product_name || b.template?.part_name || b.sheet_id},{' '}
                    {b.line_name || 'Line 1'}
                    {b.round > 1 && (
                      <span className="text-purple-700 font-semibold ml-1">
                        • Round {b.round}
                      </span>
                    )}
                  </div>
                  {b.is_overdue && (
                    <div className="text-[10px] text-red-600 font-bold flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      <span>Hold overdue</span>
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        <p className="text-[10px] text-slate-400 mt-3 italic leading-relaxed">
          On the floor, scan a batch label to open it immediately. Tap any batch above to view or inspect it.
        </p>
      </div>
    </aside>
  );
};
