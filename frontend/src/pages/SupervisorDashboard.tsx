import React, { useState, useEffect, useMemo } from 'react';
import { User } from '../types';
import { RefreshCw } from 'lucide-react';
import { SupervisorLotItem, evalReading, SUPERVISOR_DIMENSIONS } from '../types/supervisorData';

interface SupervisorDashboardProps {
  currentUser: User;
  lots: SupervisorLotItem[];
  onOpenLotsWithFilter: (filter: 'all' | 'onhold' | 'reopened' | 'oos') => void;
  onRefresh?: () => void;
}

export const SupervisorDashboard: React.FC<SupervisorDashboardProps> = ({
  currentUser,
  lots,
  onOpenLotsWithFilter,
  onRefresh,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  })();

  const dateLabel = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const firstName = currentUser.full_name?.split(' ')[0] || 'Supervisor';

  // 1. Attention calculations
  const waitingLots = useMemo(() => lots.filter((l) => l.status === 'With supervisor'), [lots]);
  const onHoldLots = useMemo(() => lots.filter((l) => l.status === 'On hold'), [lots]);
  const reopenedLots = useMemo(
    () => lots.filter((l) => l.status === 'With supervisor' && Boolean(l.reopened_reason)),
    [lots]
  );

  // Out of spec waiting lots
  const oosLots = useMemo(() => {
    return lots.filter((l) => {
      if (l.status !== 'With supervisor') return false;
      const dims = l.dimension_readings || {};
      for (const sNum of Object.keys(dims)) {
        const sampleReadings = dims[Number(sNum)] || {};
        for (const dim of SUPERVISOR_DIMENSIONS) {
          const valStr = sampleReadings[dim.id];
          if (valStr) {
            const num = parseFloat(valStr);
            if (!isNaN(num) && evalReading(num, dim.min, dim.max) === 'out_of_spec') {
              return true;
            }
          }
        }
      }
      return false;
    });
  }, [lots]);

  const oldestWaitTimeText = useMemo(() => {
    if (waitingLots.length === 0) return 'All caught up';
    // Find oldest
    const sorted = [...waitingLots].sort(
      (a, b) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime()
    );
    const oldestMs = Date.now() - new Date(sorted[0].submitted_at).getTime();
    const mins = Math.max(1, Math.floor(oldestMs / (1000 * 60)));
    if (mins < 60) return `Oldest ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Oldest ${hours} h`;
    const days = Math.floor(hours / 24);
    return `Oldest ${days} days`;
  }, [waitingLots]);

  // Live operator activity derived from real lots data
  const operatorsNow = useMemo(() => {
    const opMap: Record<string, { name: string; inspectingLot: string | null; doneQty: number; totalQty: number; lotsToday: number; itemsToday: number; badToday: number }> = {};
    lots.forEach(l => {
      const name = l.operator_name;
      if (!name || name === '—') return;
      if (!opMap[name]) opMap[name] = { name, inspectingLot: null, doneQty: 0, totalQty: 0, lotsToday: 0, itemsToday: 0, badToday: 0 };
      opMap[name].lotsToday += 1;
      opMap[name].itemsToday += l.items_qty;
      opMap[name].badToday += l.bad_count;
      if (l.status === 'With supervisor') {
        opMap[name].inspectingLot = l.lot_barcode;
        opMap[name].totalQty = l.items_qty;
      }
    });
    return Object.values(opMap);
  }, [lots]);

  // 3. Your work today calculations
  const completedToday = useMemo(() => lots.filter((l) => l.status === 'Completed'), [lots]);
  const readingsEnteredToday = completedToday.length * 60;
  const reviewedTotal = completedToday.length + onHoldLots.length;

  // Most failed checks — no real data available from lots list; show empty state
  const topFailedChecks = useMemo<{ name: string; count: number }[]>(() => [], []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    if (onRefresh) await onRefresh();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      {/* ── Header: Greeting + Date ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-[var(--ink)] tracking-tight">
            {greeting}, {firstName}
          </h2>
          <p className="text-sm text-[var(--muted)] mt-1 font-medium">{dateLabel}</p>
        </div>

        <button
          onClick={handleRefresh}
          className="p-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface2)] transition-colors shadow-xs"
          title="Refresh dashboard"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── Section: NEEDS YOUR ATTENTION (4 Clickable Tiles) ───────────────── */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] px-1">
          NEEDS YOUR ATTENTION
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Tile 1: Lots waiting for review */}
          <button
            type="button"
            onClick={() => onOpenLotsWithFilter('all')}
            className={`p-5 rounded-2xl bg-[var(--surface)] border text-left transition-all hover:shadow-md cursor-pointer ${
              waitingLots.length > 0
                ? 'border-[#FEDF89] bg-[#FFFCF5]'
                : 'border-[var(--line)]'
            }`}
          >
            <div className={`text-3xl font-light tabular-nums ${waitingLots.length > 0 ? 'text-[#B54708] font-semibold' : 'text-[var(--ink)]'}`}>
              {waitingLots.length}
            </div>
            <div className="text-sm font-bold text-[var(--ink)] mt-2">
              Lots waiting for review
            </div>
            <div className="text-xs text-[var(--muted)] mt-0.5">
              {oldestWaitTimeText}
            </div>
          </button>

          {/* Tile 2: Lots on hold */}
          <button
            type="button"
            onClick={() => onOpenLotsWithFilter('onhold')}
            className={`p-5 rounded-2xl bg-[var(--surface)] border text-left transition-all hover:shadow-md cursor-pointer ${
              onHoldLots.length > 0
                ? 'border-[#FEDF89] bg-[#FFFCF5]'
                : 'border-[var(--line)]'
            }`}
          >
            <div className={`text-3xl font-light tabular-nums ${onHoldLots.length > 0 ? 'text-[#B54708] font-semibold' : 'text-[var(--ink)]'}`}>
              {onHoldLots.length}
            </div>
            <div className="text-sm font-bold text-[var(--ink)] mt-2">
              Lots on hold
            </div>
            <div className="text-xs text-[var(--muted)] mt-0.5">
              Approve or reject held items
            </div>
          </button>

          {/* Tile 3: Reopened by admin */}
          <button
            type="button"
            onClick={() => onOpenLotsWithFilter('reopened')}
            className={`p-5 rounded-2xl bg-[var(--surface)] border text-left transition-all hover:shadow-md cursor-pointer ${
              reopenedLots.length > 0
                ? 'border-[#FECDCA] bg-[#FEF6F6]'
                : 'border-[var(--line)]'
            }`}
          >
            <div className={`text-3xl font-light tabular-nums ${reopenedLots.length > 0 ? 'text-[#B42318] font-semibold' : 'text-[var(--ink)]'}`}>
              {reopenedLots.length}
            </div>
            <div className="text-sm font-bold text-[var(--ink)] mt-2">
              Reopened by admin
            </div>
            <div className="text-xs text-[var(--muted)] mt-0.5">
              {reopenedLots.length > 0 ? 'Reason shown in the lot' : 'None'}
            </div>
          </button>

          {/* Tile 4: Out-of-spec readings */}
          <button
            type="button"
            onClick={() => onOpenLotsWithFilter('oos')}
            className={`p-5 rounded-2xl bg-[var(--surface)] border text-left transition-all hover:shadow-md cursor-pointer ${
              oosLots.length > 0
                ? 'border-[#FECDCA] bg-[#FEF6F6]'
                : 'border-[var(--line)]'
            }`}
          >
            <div className={`text-3xl font-light tabular-nums ${oosLots.length > 0 ? 'text-[#B42318] font-semibold' : 'text-[var(--ink)]'}`}>
              {oosLots.length}
            </div>
            <div className="text-sm font-bold text-[var(--ink)] mt-2">
              Out-of-spec readings
            </div>
            <div className="text-xs text-[var(--muted)] mt-0.5">
              {oosLots.length > 0 ? 'Action needed before saving' : 'None'}
            </div>
          </button>
        </div>
      </section>

      {/* ── Section: OPERATORS NOW with pulsing green ● Live tag ────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
              OPERATORS NOW
            </h3>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold text-[#027A48] bg-[#ECFDF3] border border-[#ABEFC6]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#12B76A] animate-pulse" />
              Live
            </span>
          </div>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="vt w-full text-sm">
              <thead>
                <tr className="bg-[var(--surface2)] text-[var(--muted)] text-xs border-b border-[var(--line)]">
                  <th className="py-3 px-5 text-left font-semibold">Operator</th>
                  <th className="py-3 px-5 text-left font-semibold">Now inspecting</th>
                  <th className="py-3 px-5 text-left font-semibold w-48">Progress</th>
                  <th className="py-3 px-5 text-left font-semibold">Lots today</th>
                  <th className="py-3 px-5 text-left font-semibold">Items today</th>
                  <th className="py-3 px-5 text-left font-semibold">Bad today</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {operatorsNow.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>
                      No operator activity yet — data appears here as lots are processed.
                    </td>
                  </tr>
                )}
                {operatorsNow.map((op, i) => (
                  <tr key={i} className="hover:bg-[var(--surface2)] transition-colors">
                    {/* Operator Avatar + Name */}
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[#E7EFF8] text-[#2D5B8C] font-bold text-xs flex items-center justify-center shrink-0">
                          {op.name.charAt(0)}
                        </div>
                        <span className="font-semibold text-[var(--ink)]">{op.name}</span>
                      </div>
                    </td>

                    {/* Now inspecting barcode */}
                    <td className="py-3.5 px-5">
                      {op.inspectingLot ? (
                        <span className="font-mono text-xs font-semibold text-[var(--ink)]">
                          {op.inspectingLot}
                        </span>
                      ) : (
                        <span className="text-[var(--muted)] text-xs italic">Idle</span>
                      )}
                    </td>

                    {/* Progress with thin blue bar */}
                    <td className="py-3.5 px-5">
                      {op.inspectingLot ? (
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs tabular-nums text-[var(--muted)]">
                            <span>{op.doneQty} / {op.totalQty}</span>
                            <span>{Math.round((op.doneQty / op.totalQty) * 100)}%</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-[var(--line2)] overflow-hidden">
                            <div
                              className="h-full bg-[var(--primary)] rounded-full transition-all"
                              style={{ width: `${(op.doneQty / op.totalQty) * 100}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-[var(--muted)] text-xs">—</span>
                      )}
                    </td>

                    {/* Lots today */}
                    <td className="py-3.5 px-5 tabular-nums text-[var(--ink)] font-medium">
                      {op.lotsToday}
                    </td>

                    {/* Items today */}
                    <td className="py-3.5 px-5 tabular-nums text-[var(--ink)] font-medium">
                      {op.itemsToday}
                    </td>

                    {/* Bad today */}
                    <td className="py-3.5 px-5">
                      {op.badToday > 0 ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#FEF3F2] text-[#B42318] border border-[#FECDCA]">
                          {op.badToday}
                        </span>
                      ) : (
                        <span className="text-[var(--muted)] text-xs">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Bottom Row: Two Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Your work today */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-6 shadow-xs space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
            YOUR WORK TODAY
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-4 rounded-xl bg-[var(--surface2)] border border-[var(--line)] text-center">
              <div className="text-2xl font-light tabular-nums text-[var(--ink)]">
                {completedToday.length}
              </div>
              <div className="text-[11px] text-[var(--muted)] mt-1 font-medium">
                Lots reviewed
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[var(--surface2)] border border-[var(--line)] text-center">
              <div className="text-2xl font-light tabular-nums text-[var(--ink)]">
                {readingsEnteredToday}
              </div>
              <div className="text-[11px] text-[var(--muted)] mt-1 font-medium">
                Readings entered
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[var(--surface2)] border border-[var(--line)] text-center">
              <div className="text-2xl font-light tabular-nums text-[var(--ink)]">
                {reviewedTotal}
              </div>
              <div className="text-[11px] text-[var(--muted)] mt-1 font-medium">
                Reviewed in total
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Most failed checks */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-6 shadow-xs space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
            MOST FAILED CHECKS
          </h3>
          <div className="space-y-3">
            {topFailedChecks.length === 0 ? (
              <p className="text-xs py-4 text-center" style={{ color: 'var(--muted)' }}>
                Failure frequency data not yet available.
              </p>
            ) : topFailedChecks.map((item, idx) => {
              const maxCount = topFailedChecks[0].count;
              const pct = (item.count / maxCount) * 100;
              return (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-[var(--ink)]">{item.name}</span>
                    <span className="font-bold text-[var(--ng)] tabular-nums">{item.count}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[var(--surface2)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--ng)] rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
