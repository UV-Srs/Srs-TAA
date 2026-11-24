import React, { useState, useMemo } from 'react';
import { SupervisorLotItem, SUPERVISOR_DIMENSIONS, evalReading } from '../types/supervisorData';
import { Search, ChevronDown, RefreshCw } from 'lucide-react';

interface SupervisorLotsPageProps {
  lots: SupervisorLotItem[];
  preFilter?: 'all' | 'onhold' | 'reopened' | 'oos';
  onClearPreFilter: () => void;
  onOpenReview: (lotId: number) => void;
  onOpenSavedReport: (lotId: number) => void;
  onRefresh?: () => void;
}

function fmtWaitTime(submittedAt: string): string {
  const ms = Date.now() - new Date(submittedAt).getTime();
  const mins = Math.floor(ms / (1000 * 60));
  if (mins < 2) return 'just now';
  if (mins < 60) return `waiting ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `waiting ${hours} h`;
  const days = Math.floor(hours / 24);
  return `waiting ${days} days`;
}

function fmtDateOrTime(isoString?: string): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  const isToday = d.toDateString() === new Date().toDateString();
  if (isToday) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export const SupervisorLotsPage: React.FC<SupervisorLotsPageProps> = ({
  lots,
  preFilter = 'all',
  onClearPreFilter,
  onOpenReview,
  onOpenSavedReport,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [operatorFilter, setOperatorFilter] = useState('All operators');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [scanRequiredMsg, setScanRequiredMsg] = useState(false);

  // Unique operator names for dropdown
  const operatorOptions = useMemo(() => {
    const set = new Set<string>();
    lots.forEach((l) => {
      if (l.operator_name) set.add(l.operator_name);
    });
    return Array.from(set);
  }, [lots]);

  // Pre-filter banner label
  const preFilterLabel = useMemo(() => {
    if (preFilter === 'onhold') return 'Showing lots on hold';
    if (preFilter === 'reopened') return 'Showing lots reopened by admin';
    if (preFilter === 'oos') return 'Showing lots with out-of-spec readings';
    return null;
  }, [preFilter]);

  // Filtered and sorted lots
  const filteredLots = useMemo(() => {
    return lots.filter((l) => {
      // 1. Pre-filter
      if (preFilter === 'onhold' && l.status !== 'On hold') return false;
      if (preFilter === 'reopened' && !l.reopened_reason) return false;
      if (preFilter === 'oos') {
        const dims = l.dimension_readings || {};
        let hasOOS = false;
        for (const sNum of Object.keys(dims)) {
          const sample = dims[Number(sNum)] || {};
          for (const d of SUPERVISOR_DIMENSIONS) {
            const v = sample[d.id];
            if (v && evalReading(parseFloat(v), d.min, d.max) === 'out_of_spec') {
              hasOOS = true;
              break;
            }
          }
          if (hasOOS) break;
        }
        if (!hasOOS) return false;
      }

      // 2. Operator filter
      if (operatorFilter !== 'All operators' && l.operator_name !== operatorFilter) {
        return false;
      }

      // 3. Search query
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchesBarcode = l.lot_barcode.toLowerCase().includes(q);
        const matchesName = l.lot_name.toLowerCase().includes(q);
        const matchesOp = (l.operator_name || '').toLowerCase().includes(q);
        if (!matchesBarcode && !matchesName && !matchesOp) return false;
      }

      return true;
    }).sort((a, b) => {
      // Order: New -> Pending -> On hold -> Completed
      const rank = (lot: SupervisorLotItem) => {
        if (lot.status === 'With supervisor') return lot.is_new ? 1 : 2;
        if (lot.status === 'On hold') return 3;
        return 4; // Completed
      };
      const rankA = rank(a);
      const rankB = rank(b);
      if (rankA !== rankB) return rankA - rankB;

      // Within open groups, oldest first
      if (rankA < 4) {
        return new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();
      }
      // Within completed, newest first
      return new Date(b.saved_at || b.submitted_at).getTime() - new Date(a.saved_at || a.submitted_at).getTime();
    });
  }, [lots, preFilter, operatorFilter, search]);

  const handleRowClick = (lot: SupervisorLotItem) => {
    if (lot.status === 'Completed') {
      // Completed lots are read-only — open directly for review
      onOpenSavedReport(lot.batch_id);
    } else {
      // Pending lots must be opened by scanning the barcode
      setScanRequiredMsg(true);
      setTimeout(() => setScanRequiredMsg(false), 4000);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && search.trim()) {
      const q = search.toLowerCase().trim();
      const exact = lots.find(
        (l) => l.lot_barcode.toLowerCase() === q || l.lot_name.toLowerCase() === q
      );
      if (exact) {
        handleRowClick(exact);
      }
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    if (onRefresh) await onRefresh();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16">
      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl md:text-3xl font-bold text-[var(--ink)]">Lots</h2>
        <button
          onClick={handleRefresh}
          className="p-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface2)] transition-colors shadow-xs"
          title="Refresh lots list"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── Scan Required Banner ─────────────────────────────────────────────── */}
      {scanRequiredMsg && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold"
          style={{ background: '#FFF3CD', border: '1px solid #E9C97A', color: '#A46A0E' }}
        >
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 2h2v2H6V2zM10 2h2v2h-2V2zM14 2h2v2h-2V2zM6 10h2v2H6v-2zM6 14h2v2H6v-2zM6 18h2v2H6v-2zM14 10h2v2h-2v-2zM18 6h2v2h-2V6zM18 10h2v2h-2v-2zM18 14h2v2h-2v-2zM18 18h2v2h-2v-2zM14 18h2v2h-2v-2zM10 18h2v2h-2v-2zM10 14h2v2h-2v-2zM10 10h2v2h-2v-2z"/>
          </svg>
          Scan the lot barcode to open it for review. Direct access is not permitted.
        </div>
      )}

      {/* ── Toolbar: Search + Operator Filter ─────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search or scan barcode"
            aria-label="Search lots by barcode"
            className="w-full h-[46px] px-4 rounded-xl border border-[var(--line2)] bg-[var(--surface)] text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>

        {/* Operator Filter Dropdown */}
        <div className="relative min-w-[180px]">
          <select
            value={operatorFilter}
            onChange={(e) => setOperatorFilter(e.target.value)}
            aria-label="Filter by operator"
            className="w-full h-[46px] pl-4 pr-10 rounded-xl border border-[var(--line2)] bg-[var(--surface)] text-sm text-[var(--ink)] font-medium appearance-none focus:outline-none cursor-pointer"
          >
            <option value="All operators">All operators</option>
            {operatorOptions.map((op) => (
              <option key={op} value={op}>{op}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-[var(--muted)] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* ── Pre-Filter Banner (when arrived from Dashboard tile) ─────────────── */}
      {preFilterLabel && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--line)] text-xs text-[var(--muted)]">
          <span>{preFilterLabel}</span>
          <button
            type="button"
            onClick={onClearPreFilter}
            className="font-bold text-[var(--primary)] hover:underline"
          >
            Show all lots
          </button>
        </div>
      )}

      {/* ── Lots Table ───────────────────────────────────────────────────────── */}
      <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="vt w-full text-sm">
            <thead>
              <tr className="bg-[var(--surface2)] text-[var(--muted)] text-xs border-b border-[var(--line)]">
                <th className="py-3 px-5 text-left font-semibold">Lot barcode</th>
                <th className="py-3 px-5 text-left font-semibold">Operator</th>
                <th className="py-3 px-5 text-left font-semibold">Items</th>
                <th className="py-3 px-5 text-left font-semibold">Bad</th>
                <th className="py-3 px-5 text-left font-semibold">Review</th>
                <th className="py-3 px-5 text-left font-semibold">Submitted / saved</th>
                <th className="py-3 px-5 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {filteredLots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-[var(--muted)]">
                    {search ? `No lot matches "${search}".` : 'No lots with this status.'}
                  </td>
                </tr>
              ) : (
                filteredLots.map((lot) => {
                  const badCount = lot.bad_count;
                  const decidedCount = Object.keys(lot.visual_decisions || {}).length;
                  const samplesCount = Object.keys(lot.dimension_readings || {}).filter(
                    (s) => Object.keys(lot.dimension_readings[Number(s)] || {}).length > 0
                  ).length;

                  return (
                    <tr
                      key={lot.batch_id}
                      onClick={() => handleRowClick(lot)}
                      className="hover:bg-[var(--surface2)] cursor-pointer transition-colors"
                    >
                      {/* Lot Barcode + Lot Name below */}
                      <td className="py-3.5 px-5">
                        <div className="font-mono font-bold text-xs text-[var(--ink)]">
                          {lot.lot_barcode}
                        </div>
                        <div className="text-xs text-[var(--muted)] mt-0.5">
                          {lot.lot_name}
                        </div>
                      </td>

                      {/* Operator */}
                      <td className="py-3.5 px-5 font-medium text-[var(--ink)]">
                        {lot.operator_name}
                      </td>

                      {/* Items */}
                      <td className="py-3.5 px-5 tabular-nums text-[var(--ink)]">
                        {lot.items_qty}
                      </td>

                      {/* Bad */}
                      <td className="py-3.5 px-5">
                        {badCount > 0 ? (
                          <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#FEF3F2] text-[#B42318] border border-[#FECDCA]">
                            {badCount}
                          </span>
                        ) : (
                          <span className="text-[var(--muted)] text-xs">0</span>
                        )}
                      </td>

                      {/* Review */}
                      <td className="py-3.5 px-5">
                        {lot.status === 'Completed' ? (
                          <div>
                            {lot.spec_result === 'Out of spec' && (
                              <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#FEF3F2] text-[#B42318]">
                                Out of spec
                              </span>
                            )}
                            {lot.spec_result === 'Near limit' && (
                              <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#FFFAEB] text-[#B54708]">
                                Near limit
                              </span>
                            )}
                            {(!lot.spec_result || lot.spec_result === 'In spec') && (
                              <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#ECFDF3] text-[#027A48]">
                                In spec
                              </span>
                            )}
                            <div className="text-[11px] text-[var(--muted)] mt-0.5">
                              {lot.revision && lot.revision > 1 ? `Revision ${lot.revision}` : 'Final'}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="text-xs font-semibold text-[var(--ink)]">
                              {decidedCount}/{badCount} decided
                            </div>
                            <div className="text-[11px] text-[var(--muted)] mt-0.5">
                              {samplesCount}/10 samples
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Submitted / Saved */}
                      <td className="py-3.5 px-5">
                        {lot.status === 'With supervisor' && (
                          <div>
                            <div className="text-xs text-[var(--ink)]">
                              {fmtDateOrTime(lot.submitted_at)}
                            </div>
                            <div className="text-[11px] font-medium text-[#B54708] mt-0.5">
                              {fmtWaitTime(lot.submitted_at)}
                            </div>
                          </div>
                        )}
                        {lot.status === 'On hold' && (
                          <div>
                            <div className="text-xs text-[var(--ink)]">
                              {fmtDateOrTime(lot.saved_at || lot.submitted_at)}
                            </div>
                            <div className="text-[11px] font-medium text-[#B54708] mt-0.5">
                              Held items open
                            </div>
                          </div>
                        )}
                        {lot.status === 'Completed' && (
                          <div>
                            <div className="text-xs text-[var(--ink)]">
                              {fmtDateOrTime(lot.saved_at || lot.submitted_at)}
                            </div>
                            <div className="text-[11px] text-[var(--muted)] mt-0.5">
                              Saved
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-5">
                        <div>
                          {lot.status === 'With supervisor' && (
                            lot.is_new ? (
                              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#EFF8FF] text-[#175CD3] border border-[#B2DDFF]">
                                New
                              </span>
                            ) : (
                              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#FEF6EE] text-[#B54708] border border-[#F9DBAF]">
                                Pending
                              </span>
                            )
                          )}
                          {lot.status === 'On hold' && (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#FFFAEB] text-[#B54708] border border-[#FEDF89]">
                              On hold
                            </span>
                          )}
                          {lot.status === 'Completed' && (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#ECFDF3] text-[#027A48] border border-[#ABEFC6]">
                              Completed
                            </span>
                          )}

                          {/* Extra info lines */}
                          {lot.reopened_reason && (
                            <div className="mt-1">
                              <span className="inline-block px-1.5 py-0.2 rounded text-[10px] font-bold bg-[#FEF3F2] text-[#B42318]">
                                Reopened by admin
                              </span>
                            </div>
                          )}
                          {lot.locked_by && (
                            <div className="text-[11px] text-[var(--muted)] mt-0.5 italic">
                              Being reviewed by {lot.locked_by}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[var(--surface2)] border-t border-[var(--line)] text-xs text-[var(--muted)] flex justify-between items-center">
          <span>New and pending lots first, oldest at the top. Tap a lot to open it.</span>
          <span className="font-semibold">{filteredLots.length} lot{filteredLots.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
};
