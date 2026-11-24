import React from 'react';
import type { Lot, Workspace } from '../data';
import { protoTime, shortName, shortTime, waitTxt } from '../logic/format';
import { REVIEWABLE_STATUSES, lotTs, nSamples, stats, svAllLots, svProgress, svStatusOf } from '../logic/rules';
import type { SupervisorController } from '../hooks/useSupervisorController';

const RANK = { New: 0, Pending: 1, 'On hold': 2, Completed: 3 } as const;

/** Prototype svRows(): filtered and sorted lots. */
function svRows(ws: Workspace, supQ: string, svPre: string, svOp: string): Lot[] {
  const q = supQ.trim().toUpperCase();
  let l = svAllLots(ws.lots);
  if (svPre === 'returned') l = l.filter((x) => x.status === 'supervisor' && x.returnNote);
  if (svPre === 'onhold') l = l.filter((x) => x.status === 'onhold');
  if (svPre === 'oos') l = l.filter((x) => x.status === 'supervisor' && stats(ws, x).bad.length);
  if (svOp) l = l.filter((x) => x.op?.by && shortName(x.op.by.name) === svOp);
  if (q) l = l.filter((x) => x.code.toUpperCase().includes(q) || x.name.toUpperCase().includes(q));
  return l.slice().sort((a, b) =>
    RANK[svStatusOf(a)] - RANK[svStatusOf(b)]
    || (svStatusOf(a) === 'Completed' ? lotTs(b) - lotTs(a) : lotTs(a) - lotTs(b)));
}

/** Prototype svLots() */
export const LotsScreen: React.FC<{ ws: Workspace; c: SupervisorController }> = ({ ws, c }) => {
  const rows = svRows(ws, c.supQ, c.svPre, c.svOp);
  const q = c.supQ.trim().toUpperCase();
  const operators = ws.users.filter((u) => u.role === 'operator');

  return (
    <div className="sv-page">
      <div className="sv-hello"><h2>Lots</h2></div>
      <div className="sv-tools">
        <input
          id="supq"
          className="mono search"
          placeholder="Search or scan barcode"
          value={c.supQ}
          onChange={(e) => c.setSupQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void c.openFromSearch();
            }
          }}
          autoComplete="off"
          aria-label="Search lots by barcode"
        />
        <select id="svop" aria-label="Filter by operator" value={c.svOp} onChange={(e) => c.setSvOp(e.target.value)}>
          <option value="">All operators</option>
          {operators.map((u) => <option key={u.id}>{shortName(u.name)}</option>)}
        </select>
      </div>
      {c.svPre && (
        <div className="prefilter">
          Showing {c.svPre === 'returned' ? 'lots reopened by admin' : c.svPre === 'onhold' ? 'lots on hold' : 'lots with out-of-spec readings'}{' '}
          <button className="linkbtn" onClick={c.svclearpre}>Show all lots</button>
        </div>
      )}
      {c.supMsg && <div className="listmsg" style={{ margin: '0 0 10px' }}>{c.supMsg}</div>}
      <div className="sv-card flush">
        <table className="vt sv-table">
          <thead>
            <tr>
              <th>Lot barcode</th><th>Operator</th><th className="n">Items</th><th className="n">Bad</th>
              <th>Review</th><th>Submitted / saved</th><th>Status</th>
            </tr>
          </thead>
          <tbody id="convlist">
            {!rows.length ? (
              <tr>
                <td colSpan={7} className="sub" style={{ padding: 22, textAlign: 'center' }}>
                  {q ? `No lot matches “${q}”.` : 'No lots with this status.'}
                </td>
              </tr>
            ) : rows.map((x) => <LotRow key={x.id} ws={ws} x={x} onOpen={() => void c.openFromList(x)} />)}
          </tbody>
        </table>
      </div>
      <p className="sub" style={{ marginTop: 8 }}>New and pending lots first, oldest at the top. Tap a lot to open it.</p>
    </div>
  );
};

const LotRow: React.FC<{ ws: Workspace; x: Lot; onOpen: () => void }> = ({ ws, x, onOpen }) => {
  const ng = x.parts.filter((p) => p && p.r === 'NG').length;
  const stt = svStatusOf(x);
  const pr = svProgress(ws, x);
  const ss = stats(ws, x);
  const reviewable = REVIEWABLE_STATUSES.includes(x.status);
  const lockedByOther = !!x.lockBy && x.lockBy.id !== ws.me.id && reviewable;

  let review: React.ReactNode;
  if (reviewable) {
    review = <>{pr.dec}/{pr.bad} decided<br /><span className="sub">{pr.samp}/{nSamples(ws, x)} samples</span></>;
  } else {
    const v = ss.bad.length ? ['ng', 'Out of spec'] : ss.warn.length ? ['warn', 'Near limit'] : ['ok', 'In spec'];
    review = <><span className={`pill ${v[0]} sm`}>{v[1]}</span><br /><span className="sub">{x.rev > 1 ? `Revision ${x.rev}` : 'Final'}</span></>;
  }

  let when: React.ReactNode;
  if (x.status === 'onhold') when = <>{shortTime(protoTime(x.sup?.at))}<br /><span className="wait">Held items open</span></>;
  else if (x.status !== 'completed') when = <>{shortTime(protoTime(x.op?.at))}<br /><span className="wait">{waitTxt(x.ts)}</span></>;
  else when = <>{shortTime(protoTime(x.sup?.at))}<br /><span className="sub">Saved</span></>;

  return (
    <tr className="click" onClick={onOpen}>
      <td><span className="mono">{x.code}</span><div className="sub">{x.name}</div></td>
      <td>{shortName(x.op?.by?.name)}</td>
      <td className="n">{x.qty}</td>
      <td className="n">{ng ? <span className="pill ng">{ng}</span> : '0'}</td>
      <td>{review}</td>
      <td>{when}</td>
      <td>
        <span className={`pill ${stt === 'New' ? 'info' : stt === 'Completed' ? 'ok' : 'warn'}`}>{stt}</span>
        {x.status === 'supervisor' && x.returnNote && <div><span className="pill ng sm">Reopened by admin</span></div>}
        {lockedByOther && x.lockBy && <div className="sub">Being reviewed by {shortName(x.lockBy.name)}</div>}
      </td>
    </tr>
  );
};
