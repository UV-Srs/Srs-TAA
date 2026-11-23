import React, { useState, useEffect } from 'react';
import { fetchProgressDashboard } from '../api';
import { User } from '../types';
import { RefreshCw } from 'lucide-react';

interface SupervisorDashboardProps {
  currentUser: User;
  onGoToReviews: () => void;
}

export const SupervisorDashboard: React.FC<SupervisorDashboardProps> = ({ currentUser, onGoToReviews }) => {
  const [data, setData]       = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  })();

  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });

  const load = async () => {
    try {
      setIsLoading(true);
      const res = await fetchProgressDashboard();
      setData(res);
    } catch { /* ignore */ } finally { setIsLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3" style={{ color: 'var(--muted)' }}>
        <RefreshCw className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  const summary = data?.summary || {};
  const withSupervisor  = summary.awaiting_supervisor || 0;
  const onHold          = summary.on_hold || 0;
  const batches         = data?.batches || [];
  const reopened        = batches.filter((b: any) => b.round > 1).length;
  const outOfSpec       = 0; // extend when backend exposes this

  return (
    <div className="space-y-8">

      {/* ── Greeting ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold" style={{ fontSize: 24, letterSpacing: '-0.015em', color: 'var(--ink)' }}>
            {greeting}, {currentUser.full_name.split(' ')[0]}
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{dateLabel}</p>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg transition-colors"
          style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--muted)' }}
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* ── NEEDS YOUR ATTENTION ────────────────────────────────── */}
      <section>
        <span className="sv-label">Needs your attention</span>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

          <button className={`att${withSupervisor > 0 ? ' warn' : ''}`} onClick={onGoToReviews}>
            <span className={`att-number${withSupervisor > 0 ? ' warn' : ''}`}>{withSupervisor}</span>
            <span className="att-title">Waiting for review</span>
            <span className="att-caption">
              {withSupervisor > 0 ? 'Open lots' : 'All caught up'}
            </span>
          </button>

          <button className={`att${onHold > 0 ? ' warn' : ''}`} onClick={onGoToReviews}>
            <span className={`att-number${onHold > 0 ? ' warn' : ''}`}>{onHold}</span>
            <span className="att-title">Lots on hold</span>
            <span className="att-caption">Approve or reject held items</span>
          </button>

          <button className={`att${reopened > 0 ? ' ng' : ''}`} onClick={onGoToReviews}>
            <span className={`att-number${reopened > 0 ? ' ng' : ''}`}>{reopened}</span>
            <span className="att-title">Reopened lots</span>
            <span className="att-caption">{reopened > 0 ? 'Reason shown in the lot' : 'None'}</span>
          </button>

          <button className={`att${outOfSpec > 0 ? ' ng' : ''}`} onClick={onGoToReviews}>
            <span className={`att-number${outOfSpec > 0 ? ' ng' : ''}`}>{outOfSpec}</span>
            <span className="att-title">Out-of-spec readings</span>
            <span className="att-caption">{outOfSpec > 0 ? 'Action needed before saving' : 'None'}</span>
          </button>

        </div>
      </section>

      {/* ── YOUR WORK TODAY ─────────────────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>
          <span className="sv-label">Your work</span>
          <div className="kpis mt-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <div className="kpi-tile">
              <div className="kpi-num">{summary.approved || 0}</div>
              <div className="kpi-label">Approved</div>
            </div>
            <div className="kpi-tile">
              <div className={`kpi-num${onHold > 0 ? ' warn' : ''}`}>{onHold}</div>
              <div className="kpi-label">On hold</div>
            </div>
            <div className="kpi-tile">
              <div className={`kpi-num${(summary.rejected || 0) > 0 ? ' ng' : ''}`}>{summary.rejected || 0}</div>
              <div className="kpi-label">Rejected</div>
            </div>
          </div>
        </div>

        {/* Lots pending — quick list */}
        <div className="p-5" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>
          <span className="sv-label">Queue</span>
          {batches.filter((b: any) => ['OPERATOR_APPROVED', 'SUPERVISOR_IN_PROGRESS', 'ON_HOLD'].includes(b.status)).length === 0 ? (
            <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>No lots waiting. All clear!</p>
          ) : (
            <div className="mt-2 space-y-2">
              {batches
                .filter((b: any) => ['OPERATOR_APPROVED', 'SUPERVISOR_IN_PROGRESS', 'ON_HOLD'].includes(b.status))
                .slice(0, 4)
                .map((b: any) => (
                  <div key={b.batch_id} className="flex items-center justify-between gap-3">
                    <span className="font-mono font-semibold text-sm" style={{ color: 'var(--ink)' }}>{b.lot_number}</span>
                    <span className="pill" style={
                      b.status === 'ON_HOLD'
                        ? { background: 'var(--warn-bg)', color: 'var(--warn)' }
                        : { background: 'var(--accent-soft)', color: 'var(--accent)' }
                    }>
                      {b.status === 'ON_HOLD' ? 'On hold' : 'Waiting'}
                    </span>
                  </div>
                ))}
              {batches.filter((b: any) => ['OPERATOR_APPROVED', 'SUPERVISOR_IN_PROGRESS', 'ON_HOLD'].includes(b.status)).length > 4 && (
                <button onClick={onGoToReviews} className="text-sm font-medium mt-1" style={{ color: 'var(--accent)' }}>
                  View all →
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Go to reviews CTA ───────────────────────────────────── */}
      {withSupervisor > 0 && (
        <div className="flex justify-center">
          <button onClick={onGoToReviews} className="btn primary">
            Open Review Queue ({withSupervisor} waiting)
          </button>
        </div>
      )}

    </div>
  );
};
