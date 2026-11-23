import React, { useState, useEffect, useRef } from 'react';
import { InspectionBatch, User } from '../types';
import { downloadCsvExport, deleteBatch } from '../api';
import { Download, AlertCircle, Clock, Search, ScanLine, Plus, Trash2, X } from 'lucide-react';

interface BatchSidebarProps {
  batches: InspectionBatch[];
  selectedBatchId: number | null;
  currentUser: User;
  onSelectBatch: (batchId: number) => void;
  onBatchDeleted?: (batchId: number) => void;
  onSearch?: (query: string) => void;
  onCreateBatch?: () => void;
  progressSummary?: {
    with_operator: number;
    with_supervisor: number;
    on_hold: number;
    overdue_holds: number;
    approved: number;
    rejected: number;
  };
}

type StatusFilter = 'all' | 'pending' | 'active' | 'review' | 'done';

const STATUS_FILTERS: { key: StatusFilter; label: string; statuses: string[] }[] = [
  { key: 'all',     label: 'All',     statuses: [] },
  { key: 'pending', label: 'Pending', statuses: ['CREATED_PENDING_OPERATOR', 'pending'] },
  { key: 'active',  label: 'Active',  statuses: ['OPERATOR_IN_PROGRESS', 'op_progress'] },
  { key: 'review',  label: 'Review',  statuses: ['OPERATOR_APPROVED', 'OPERATOR_REJECTED', 'SUPERVISOR_IN_PROGRESS', 'ON_HOLD', 'op_approved', 'op_rejected', 'sup_progress', 'hold'] },
  { key: 'done',    label: 'Done',    statuses: ['APPROVED', 'REJECTED'] },
];

export const BatchSidebar: React.FC<BatchSidebarProps> = ({
  batches,
  selectedBatchId,
  currentUser,
  onSelectBatch,
  onBatchDeleted,
  onSearch,
  onCreateBatch,
  progressSummary,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const debounceRef = useRef<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      onSearch?.(val.trim());
    }, 350);
  };

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const handleDelete = async (batchId: number) => {
    setDeletingId(batchId);
    try {
      await deleteBatch(batchId);
      setConfirmDeleteId(null);
      onBatchDeleted?.(batchId);
    } catch (err: any) {
      alert(err.message || 'Failed to delete batch.');
    } finally {
      setDeletingId(null);
    }
  };

  const title =
    currentUser.role === 'operator' ? 'My Batches' :
    currentUser.role === 'supervisor' ? 'My Reviews' : 'Batches Queue';

  const getStatusInfo = (status: string): { dotColor: string; label: string } => {
    switch (status) {
      case 'CREATED_PENDING_OPERATOR':
      case 'pending':         return { dotColor: 'var(--muted)',   label: 'Pending' };
      case 'OPERATOR_IN_PROGRESS':
      case 'op_progress':     return { dotColor: 'var(--accent)',  label: 'In Progress' };
      case 'OPERATOR_APPROVED':
      case 'op_approved':     return { dotColor: 'var(--ok)',      label: 'Op Approved' };
      case 'OPERATOR_REJECTED':
      case 'op_rejected':     return { dotColor: 'var(--ng)',      label: 'Flagged' };
      case 'SUPERVISOR_IN_PROGRESS':
      case 'sup_progress':    return { dotColor: 'var(--accent)',  label: 'Under Review' };
      case 'ON_HOLD':
      case 'hold':            return { dotColor: 'var(--warn)',    label: 'On Hold' };
      case 'APPROVED':        return { dotColor: 'var(--ok)',      label: 'Approved' };
      case 'REJECTED':        return { dotColor: 'var(--ng)',      label: 'Rejected' };
      default:                return { dotColor: 'var(--line2)',   label: status };
    }
  };

  const isScanRole = currentUser.role === 'operator' || currentUser.role === 'supervisor';
  const isAdmin = currentUser.role === 'admin';

  const filteredBatches = statusFilter === 'all'
    ? batches
    : batches.filter(b => STATUS_FILTERS.find(f => f.key === statusFilter)?.statuses.includes(b.status));

  return (
    <aside className="w-full h-full overflow-hidden text-xs flex flex-col" style={{ background: 'var(--surface)' }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold" style={{ color: 'var(--ink)' }}>{title}</h3>
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--muted)' }}>{batches.length}</span>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-1">
            {onCreateBatch && (
              <button
                type="button"
                onClick={onCreateBatch}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors"
                style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
                title="Create New Inspection Batch"
              >
                <Plus className="w-3 h-3" />
                New Batch
              </button>
            )}
            <button
              type="button"
              onClick={() => downloadCsvExport().catch(console.error)}
              className="flex items-center gap-1 transition-colors px-2 py-1 rounded"
              style={{ color: 'var(--muted)' }}
              title="Export CSV"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ── Search ──────────────────────────────────────────────── */}
      <div className="px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--muted)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search lot or part..."
            className="w-full pl-8 pr-3 py-1.5 rounded text-xs outline-none transition-colors"
            style={{ background: 'var(--surface2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
          />
        </div>
      </div>

      {/* ── Status filter pills ─────────────────────────────────────── */}
      <div className="px-3 py-1.5 flex gap-1 overflow-x-auto shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
        {STATUS_FILTERS.map(f => {
          const count = f.key === 'all' ? batches.length : batches.filter(b => f.statuses.includes(b.status)).length;
          const isActive = statusFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors whitespace-nowrap"
              style={isActive
                ? { background: 'var(--primary)', color: 'var(--on-primary)' }
                : { background: 'var(--surface2)', color: 'var(--muted)' }
              }
            >
              {f.label} <span style={{ opacity: 0.7 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* ── Batch list ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: 'var(--line)' }}>
        {filteredBatches.length === 0 ? (
          currentUser.role === 'supervisor' && statusFilter === 'all' ? (
            <div className="py-10 px-5 text-center space-y-2">
              <Clock className="w-6 h-6 mx-auto" style={{ color: 'var(--line2)' }} />
              <p className="font-medium" style={{ color: 'var(--muted)' }}>No batches pending review</p>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                Batches will appear here once operators complete their inspection.
              </p>
            </div>
          ) : isScanRole ? (
            <div className="py-10 px-5 text-center space-y-2">
              <ScanLine className="w-6 h-6 mx-auto" style={{ color: 'var(--line2)' }} />
              <p className="font-medium" style={{ color: 'var(--muted)' }}>Scan a barcode to begin</p>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                Use the scan bar above or a USB / Bluetooth scanner to open your batch.
              </p>
            </div>
          ) : (
            <div className="py-10 px-5 text-center space-y-1">
              <Clock className="w-5 h-5 mx-auto" style={{ color: 'var(--line2)' }} />
              <p className="font-medium" style={{ color: 'var(--muted)' }}>
                {statusFilter !== 'all' ? 'No batches in this status' : 'No batches found'}
              </p>
              {statusFilter !== 'all' && (
                <button onClick={() => setStatusFilter('all')} className="text-[11px] underline" style={{ color: 'var(--muted)' }}>Clear filter</button>
              )}
            </div>
          )
        ) : (
          filteredBatches.map((b) => {
            const isSelected = b.batch_id === selectedBatchId;
            const { dotColor, label } = getStatusInfo(b.status);
            const isConfirming = confirmDeleteId === b.batch_id;
            const isDeleting = deletingId === b.batch_id;

            return (
              <div
                key={b.batch_id}
                className="relative group border-l-2 transition-colors"
                style={{
                  borderLeftColor: isSelected ? 'var(--primary)' : 'transparent',
                  background: isSelected ? 'var(--accent-soft)' : 'transparent',
                }}
              >
                {/* Main row button */}
                <button
                  type="button"
                  onClick={() => { setConfirmDeleteId(null); onSelectBatch(b.batch_id); }}
                  className="w-full text-left px-3 py-2.5 flex items-start gap-2.5"
                >
                  <span className="mt-[5px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
                  <div className="flex-1 min-w-0 pr-5">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="font-mono font-bold text-[11px] truncate" style={{ color: 'var(--ink)' }}>
                        {b.lot_number}
                      </span>
                      <span className="text-[10px] font-medium shrink-0" style={{ color: 'var(--muted)' }}>{label}</span>
                    </div>
                    <p className="text-[11px] truncate" style={{ color: 'var(--muted)' }}>
                      {b.product_name || b.template?.part_name || b.sheet_id}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px]" style={{ color: 'var(--muted)' }}>
                      <span>{b.line_name || 'Line 1'}</span>
                      {b.round > 1 && (
                        <span className="font-semibold" style={{ color: 'var(--accent)' }}>Round {b.round}</span>
                      )}
                    </div>
                    {b.is_overdue && (
                      <div className="flex items-center gap-1 mt-1 text-[10px] font-semibold" style={{ color: 'var(--ng)' }}>
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        Hold overdue
                      </div>
                    )}
                  </div>
                </button>

                {/* Admin delete icon — appears on hover */}
                {isAdmin && !isConfirming && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setConfirmDeleteId(b.batch_id); }}
                    title="Delete this batch"
                    className="absolute top-2.5 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-all"
                    style={{ color: 'var(--muted)' }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Inline delete confirmation */}
                {isConfirming && (
                  <div className="px-3 pb-3 -mt-1">
                    <div className="rounded-lg p-2.5 space-y-2" style={{ background: 'var(--ng-bg)', border: '1px solid #f1b8b5' }}>
                      <p className="text-[11px] font-semibold leading-snug" style={{ color: 'var(--ng)' }}>
                        Delete <span className="font-mono">{b.lot_number}</span>?
                      </p>
                      <p className="text-[10px] leading-snug" style={{ color: 'var(--ng)' }}>
                        All measurements, decisions and attachments will be permanently removed.
                      </p>
                      <div className="flex gap-1.5 pt-0.5">
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}
                          className="flex-1 py-1 rounded text-[11px] font-medium transition-colors flex items-center justify-center gap-1"
                          style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--muted)' }}
                        >
                          <X className="w-3 h-3" /> Cancel
                        </button>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={e => { e.stopPropagation(); handleDelete(b.batch_id); }}
                          className="flex-1 py-1 rounded text-[11px] font-semibold transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                          style={{ background: 'var(--ng)', color: '#fff' }}
                        >
                          <Trash2 className="w-3 h-3" />
                          {isDeleting ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
