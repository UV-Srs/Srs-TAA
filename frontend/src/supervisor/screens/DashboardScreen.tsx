import React from 'react';
import type { Workspace } from '../data';
import { isToday, shortName, waitTxt } from '../logic/format';
import { doneN, itemById, lotTs, paramsOf, stats, supLots } from '../logic/rules';
import type { SvPre } from '../hooks/useSupervisorController';

interface DashboardScreenProps {
  ws: Workspace;
  onGo: (v: 'pending' | Exclude<SvPre, ''>) => void;
}

/** Prototype svDashboard() */
export const DashboardScreen: React.FC<DashboardScreenProps> = ({ ws, onGo }) => {
  const me = shortName(ws.me.name);
  const lots = ws.lots;
  const pend = supLots(lots);
  const oldest = pend.slice().sort((a, b) => lotTs(a) - lotTs(b))[0];
  const ret = pend.filter((l) => l.returnNote);
  const oos = pend.filter((l) => stats(ws, l).bad.length);
  const onHold = lots.filter((l) => l.status === 'onhold').length;

  const ops = ws.users
    .filter((u) => u.role === 'operator' && u.active)
    .map((u) => {
      const n = shortName(u.name);
      const cur = lots.find((l) => l.status === 'operator' && l.opBy?.id === u.id);
      const tl = lots.filter((l) => l.op?.by?.id === u.id && isToday(l.op.at));
      return { id: u.id, n, cur, tl };
    });

  const mine = lots.filter((l) => l.sup?.by?.id === ws.me.id && ['completed', 'onhold'].includes(l.status));
  const mineT = mine.filter((l) => isToday(l.sup?.at));
  // Prototype: mineT.length * 60 (10 samples x 6 dimensions per lot); here each lot's own count.
  const readingsToday = mineT.reduce((a, l) => a + paramsOf(ws, l).reduce((s, p) => s + p.samples.length, 0), 0);

  const fc: Record<string, number> = {};
  lots.forEach((l) => l.parts.forEach((p) => {
    if (p && p.r === 'NG') p.ng.forEach((n) => { fc[n.id] = (fc[n.id] || 0) + 1; });
  }));
  const top = Object.entries(fc).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const mx = top.length ? top[0][1] : 1;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  return (
    <div className="sv-page">
      <div className="sv-hello">
        <h2>Good {greeting}, {me.split(' ')[0]}</h2>
        <span className="sub">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </div>

      <div className="sv-label">Needs your attention</div>
      <div className="sv-att four">
        <button className={`att ${pend.length ? 'warn' : ''}`} onClick={() => onGo('pending')}>
          <b>{pend.length}</b><span>Lots waiting for review</span>
          <small>{oldest ? `Oldest ${waitTxt(oldest.ts).replace('waiting ', '')}` : 'All caught up'}</small>
        </button>
        <button className={`att ${onHold ? 'warn' : ''}`} onClick={() => onGo('onhold')}>
          <b>{onHold}</b><span>Lots on hold</span><small>Approve or reject held items</small>
        </button>
        <button className={`att ${ret.length ? 'bad' : ''}`} onClick={() => onGo('returned')}>
          <b>{ret.length}</b><span>Reopened by admin</span><small>{ret.length ? 'Reason shown in the lot' : 'None'}</small>
        </button>
        <button className={`att ${oos.length ? 'bad' : ''}`} onClick={() => onGo('oos')}>
          <b>{oos.length}</b><span>Out-of-spec readings</span><small>{oos.length ? 'Action needed before saving' : 'None'}</small>
        </button>
      </div>

      <div className="sv-label">Operators now <span className="live"><i></i>Live</span></div>
      <div className="sv-card">
        <table className="vt">
          <thead>
            <tr>
              <th>Operator</th><th>Now inspecting</th><th>Progress</th>
              <th className="n">Lots today</th><th className="n">Items today</th><th className="n">Bad today</th>
            </tr>
          </thead>
          <tbody>
            {ops.map((o) => {
              const d = o.cur ? doneN(o.cur) : 0;
              // parts has one entry per item of the lot (1..qty), as in the prototype.
              const total = o.cur ? o.cur.parts.length : 0;
              const bad = o.tl.reduce((a, l) => a + l.parts.filter((p) => p && p.r === 'NG').length, 0);
              return (
                <tr key={o.id}>
                  <td><span className="av">{o.n[0]}</span><b>{o.n}</b></td>
                  <td>{o.cur ? <span className="mono">{o.cur.code}</span> : <span className="sub">Idle</span>}</td>
                  <td>
                    {o.cur ? (
                      <><span className="pbar"><i style={{ width: `${total ? (d / total) * 100 : 0}%` }}></i></span> {d} / {total}</>
                    ) : '—'}
                  </td>
                  <td className="n">{o.tl.length}</td>
                  <td className="n">{o.tl.reduce((a, l) => a + l.qty, 0)}</td>
                  <td className="n">{bad ? <span className="pill ng">{bad}</span> : '0'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sv-two">
        <div className="sv-card">
          <h3>Your work today</h3>
          <div className="kpis k3">
            <div><b>{mineT.length}</b><span>Lots reviewed</span></div>
            <div><b>{readingsToday}</b><span>Readings entered</span></div>
            <div><b>{mine.length}</b><span>Reviewed in total</span></div>
          </div>
        </div>
        <div className="sv-card">
          <h3>Most failed checks</h3>
          {top.length ? top.map(([id, n]) => (
            <div className="prob" key={id}>
              <span>{itemById(ws, id)?.t ?? '—'}</span>
              <span className="bar"><i style={{ width: `${(n / mx) * 100}%` }}></i></span>
              <b>{n}</b>
            </div>
          )) : <p className="sub">No failed checks yet.</p>}
        </div>
      </div>
    </div>
  );
};
