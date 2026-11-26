import React, { useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { InspectionBatch, User } from '../types';
import { UniversalScanBar } from '../components/UniversalScanBar';

interface OperatorHomeProps {
  currentUser: User;
  batches: InspectionBatch[];
  onOpenBatch: (batchId: number) => void;
  onTemplateResolved: (sheetId: string) => void;
  /** Phones only: switch to "phone as scanner for a desktop" mode. */
  onUsePhoneAsScanner?: () => void;
}

const WAITING_STATUSES = ['CREATED_PENDING_OPERATOR', 'OPERATOR_IN_PROGRESS', 'pending', 'op_progress'];
const PAGE_SIZE = 10;

// Number of items the operator marked bad (computed by the server from the saved results)
const badCount = (b: InspectionBatch) => b.bad_item_count ?? 0;

const isToday = (iso?: string | null) => {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};

const statusPill = (b: InspectionBatch): { label: string; cls: string } => {
  switch (b.status) {
    case 'CREATED_PENDING_OPERATOR':
      return { label: 'To inspect', cls: 'bg-slate-100 text-slate-700' };
    case 'OPERATOR_IN_PROGRESS':
      return { label: 'In progress', cls: 'bg-brand-soft text-brand' };
    case 'OPERATOR_APPROVED':
    case 'OPERATOR_REJECTED':
    case 'SUPERVISOR_IN_PROGRESS':
      return { label: 'With supervisor', cls: 'bg-amber-50 text-amber-700' };
    case 'ON_HOLD':
      return { label: b.is_overdue ? 'Hold overdue' : 'On hold', cls: 'bg-orange-50 text-orange-700' };
    case 'APPROVED':
      return { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700' };
    case 'REJECTED':
      return { label: 'Rejected', cls: 'bg-red-50 text-red-700' };
    default:
      return { label: String(b.status), cls: 'bg-slate-100 text-slate-600' };
  }
};

const clearanceText = (b: InspectionBatch): string => {
  switch (b.status) {
    case 'CREATED_PENDING_OPERATOR':
      return 'Waiting for inspection';
    case 'OPERATOR_IN_PROGRESS':
      return 'Inspection in progress';
    case 'ON_HOLD':
      return b.hold_reason ? `On hold: ${b.hold_reason}` : 'On hold';
    case 'REJECTED':
      return 'Lot rejected';
    default:
      // The clearance the operator chose on submit; older lots fall back to the results
      return b.operator_clearance || (badCount(b) > 0 ? 'Cleared, NG items segregated' : 'Lot cleared');
  }
};

export const OperatorHome: React.FC<OperatorHomeProps> = ({ currentUser, batches, onOpenBatch, onTemplateResolved, onUsePhoneAsScanner }) => {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  // Only lots this operator scanned (prepared_by is set when they scan or submit a lot).
  // Lots still in progress come first so unfinished work is at the top.
  const myLots = useMemo(() => {
    const relevant = batches.filter((b) => b.prepared_by === currentUser.user_id);
    const ts = (b: InspectionBatch) => new Date(b.updated_at || b.created_at || 0).getTime();
    return relevant.sort((a, b) => {
      const aw = WAITING_STATUSES.includes(a.status) ? 0 : 1;
      const bw = WAITING_STATUSES.includes(b.status) ? 0 : 1;
      return aw - bw || ts(b) - ts(a);
    });
  }, [batches, currentUser.user_id]);

  const today = useMemo(() => {
    const done = myLots.filter((b) => isToday(b.operator_submitted_at));
    return {
      lots: done.length,
      items: done.reduce((sum, b) => sum + (b.lot_quantity || 0), 0),
      bad: done.reduce((sum, b) => sum + badCount(b), 0),
      total: myLots.length,
    };
  }, [myLots]);

  const filtered = myLots.filter((b) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [b.lot_number, b.product_name, b.template?.part_name, b.line_name]
      .some((v) => (v || '').toLowerCase().includes(q));
  });
  const visible = showAll ? filtered : filtered.slice(0, PAGE_SIZE);

  const stats = [
    { value: today.lots, label: 'Lots inspected' },
    { value: today.items, label: 'Items checked' },
    { value: today.bad, label: 'Bad items' },
    { value: today.total, label: 'Lots in total' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Scan card (keyboard-wedge, typed code and camera scanning all live in UniversalScanBar) */}
      <UniversalScanBar
        variant="hero"
        currentUser={currentUser}
        onBatchResolved={onOpenBatch}
        onTemplateResolved={onTemplateResolved}
      />
      {onUsePhoneAsScanner && (
        <div className="-mt-2 text-center">
          <button type="button" onClick={onUsePhoneAsScanner} className="text-sm font-medium text-brand hover:underline py-2">
            Use this phone as a scanner for a desktop instead
          </button>
        </div>
      )}

      {/* Today */}
      <section className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-5">
        <h3 className="text-base font-semibold text-slate-900 mb-3">Today</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="bg-canvas rounded-xl px-4 py-3.5">
              <div className={`text-2xl sm:text-3xl font-normal ${s.label === 'Bad items' && s.value > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {s.value}
              </div>
              <div className="text-xs sm:text-sm text-slate-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent lots */}
      <section className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <h3 className="text-base font-semibold text-slate-900">Your recent lots</h3>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search barcode or part"
              className="w-full pl-9 pr-3 py-2 border border-slate-200 focus:border-brand focus:ring-2 focus:ring-brand/20 rounded-lg text-sm outline-none"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl">
            {query ? 'No lots match your search.' : 'No lots yet. Scan a lot barcode to start an inspection.'}
          </div>
        ) : (
          <>
            {/* Table (md and up) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-semibold tracking-wider uppercase text-slate-500 border-b border-slate-200">
                    <th className="py-3 px-2.5">Barcode</th>
                    <th className="py-3 px-2.5">Part</th>
                    <th className="py-3 px-2.5 text-right">Items</th>
                    <th className="py-3 px-2.5 text-right">Bad</th>
                    <th className="py-3 px-2.5">Clearance</th>
                    <th className="py-3 px-2.5">Status</th>
                    <th className="py-3 px-1 w-6" aria-label="Open" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((b) => {
                    const pill = statusPill(b);
                    const bad = badCount(b);
                    return (
                      <tr
                        key={b.batch_id}
                        onClick={() => onOpenBatch(b.batch_id)}
                        className="cursor-pointer hover:bg-slate-50 transition-colors text-slate-800"
                      >
                        <td className="py-3.5 px-2.5 whitespace-nowrap">{b.lot_number}</td>
                        <td className="py-3.5 px-2.5">{b.product_name || b.template?.part_name || '—'}</td>
                        <td className="py-3.5 px-2.5 text-right tabular-nums">{b.lot_quantity ?? '—'}</td>
                        <td className={`py-3.5 px-2.5 text-right tabular-nums ${bad > 0 ? 'text-red-600 font-medium' : ''}`}>{bad}</td>
                        <td className="py-3.5 px-2.5">{clearanceText(b)}</td>
                        <td className="py-3.5 px-2.5">
                          <span className={`inline-block whitespace-nowrap px-3 py-1 rounded-full text-xs font-semibold ${pill.cls}`}>
                            {pill.label}
                          </span>
                        </td>
                        <td className="py-3.5 px-1 text-slate-300">
                          <ChevronRight className="w-4 h-4" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cards (below md) */}
            <ul className="md:hidden divide-y divide-slate-100">
              {visible.map((b) => {
                const pill = statusPill(b);
                const bad = badCount(b);
                return (
                  <li key={b.batch_id}>
                    <button
                      type="button"
                      onClick={() => onOpenBatch(b.batch_id)}
                      className="w-full text-left py-3.5 flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-900 truncate">{b.lot_number}</span>
                          <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${pill.cls}`}>
                            {pill.label}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">
                          {b.product_name || b.template?.part_name || '—'}
                        </div>
                        <div className="text-xs text-slate-600 mt-1">
                          {b.lot_quantity ?? '—'} items ·{' '}
                          <span className={bad > 0 ? 'text-red-600 font-medium' : ''}>{bad} bad</span> · {clearanceText(b)}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                    </button>
                  </li>
                );
              })}
            </ul>

            {filtered.length > PAGE_SIZE && (
              <button
                type="button"
                onClick={() => setShowAll(!showAll)}
                className="mt-3 w-full py-2 text-sm font-medium text-brand hover:bg-brand-soft rounded-lg transition-colors"
              >
                {showAll ? 'Show fewer' : `Show all ${filtered.length} lots`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default OperatorHome;
