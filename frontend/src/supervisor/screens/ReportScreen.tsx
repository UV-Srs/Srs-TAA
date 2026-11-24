import React, { useRef } from 'react';
import { OOS_ACTIONS, type Lot, type Workspace } from '../data';
import { protoTime, shortName } from '../logic/format';
import { DEC, badIdx, dimStatusSV, fmt, nSamples, paramsOf, st, stats, templateOf } from '../logic/rules';
import { downloadReport } from '../logic/download';
import type { SupervisorController } from '../hooks/useSupervisorController';
import { LotBar } from '../components/LotBar';

const PER = 30;

/** Prototype svReport(L, readOnly): the report preview (before Save) and the saved read-only report. */
export const ReportScreen: React.FC<{ ws: Workspace; c: SupervisorController; lot: Lot; readOnly: boolean }> = ({ ws, c, lot: L, readOnly }) => {
  const ref = useRef<HTMLElement>(null);
  const tpl = templateOf(ws, L);
  const ITEMS = tpl?.items ?? [];
  const GROUPS = tpl?.groups ?? [];
  const PARAMS = paramsOf(ws, L);
  const S = nSamples(ws, L);
  const ss = stats(ws, L);
  const bad = badIdx(L);
  const cnt = { Approved: 0, 'On hold': 0, Rejected: 0 } as Record<string, number>;
  bad.forEach((i) => { const p = L.parts[i]; if (p && p.r === 'NG' && p.disp) cnt[p.disp]++; });
  // parts has one entry per item of the lot (1..qty), as in the prototype.
  const nIt = L.parts.length;
  const pages = Math.ceil(nIt / PER);
  const me = shortName(ws.me.name);
  const needOos = !!ss.bad.length && !L.oos && !readOnly;
  const lotDate = L.date ? new Date(L.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const methods = [...new Set(PARAMS.map((p) => p.method).filter(Boolean))].join(' / ');

  const blocks = Array.from({ length: pages }, (_, k) => {
    const idx: number[] = [];
    for (let i = k * PER; i < Math.min(nIt, (k + 1) * PER); i++) idx.push(i);
    const pad = PER - idx.length;
    const padCells = (tag: 'td' | 'th') => Array.from({ length: pad }, (_, j) => (tag === 'th' ? <th key={`p${j}`} className="c"></th> : <td key={`p${j}`} className="c"></td>));
    const cell = (i: number, id: string) => {
      const p = L.parts[i];
      if (!p) return <td key={i} className="c"></td>;
      return p.r === 'NG' && p.ng.some((n) => n.id === id) ? <td key={i} className="c ng">✕</td> : <td key={i} className="c ok">✓</td>;
    };
    return (
      <section key={k} className="rblock">
        <div className="rb-head"><b>Items {idx[0] + 1} – {idx[idx.length - 1] + 1}</b><span>Page {k + 1} of {pages}</span></div>
        <div className="rb-scroll">
          <table className="rt">
            <colgroup>
              <col style={{ width: 34 }} /><col style={{ width: 150 }} /><col style={{ width: 190 }} /><col style={{ width: 86 }} />
              {Array.from({ length: PER }, (_, j) => <col key={j} />)}
            </colgroup>
            <thead>
              <tr>
                <th>S.No</th><th>Control item</th><th>Content</th><th>Method</th>
                {idx.map((i) => <th key={i} className="c">{i + 1}</th>)}{padCells('th')}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((g) => (
                <React.Fragment key={g}>
                  <tr className="rg"><td colSpan={4 + PER}>{g}</td></tr>
                  {ITEMS.filter((x) => x.g === g).map((x) => (
                    <tr key={x.id}>
                      <td className="c">{ITEMS.indexOf(x) + 1}</td><td><b>{x.t}</b></td><td className="ds">{x.desc}</td><td className="ds">{x.method}</td>
                      {idx.map((i) => cell(i, x.id))}{padCells('td')}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Operator result</td>
                {idx.map((i) => { const p = L.parts[i]; return p ? (p.r === 'NG' ? <td key={i} className="c ng">✕</td> : <td key={i} className="c ok">✓</td>) : <td key={i} className="c"></td>; })}
                {padCells('td')}
              </tr>
              <tr className="decrow">
                <td colSpan={4}>Supervisor decision</td>
                {idx.map((i) => {
                  const p = L.parts[i];
                  if (!p || p.r !== 'NG') return <td key={i} className="c"></td>;
                  const d = p.disp;
                  return <td key={i} className={`c ${d ? DEC[d] : ''}`} title={d || ''}>{d === 'Approved' ? 'A' : d === 'On hold' ? 'H' : d === 'Rejected' ? 'R' : '—'}</td>;
                })}
                {padCells('td')}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    );
  });

  const dims = S > 0 && (
    <section className="rblock">
      <div className="rb-head"><b>Dimension check, samples (items 1 – {S})</b><span>{methods}</span></div>
      <div className="rb-scroll">
        <table className="rt dimt">
          <colgroup>
            <col style={{ width: 200 }} /><col style={{ width: 120 }} />
            {Array.from({ length: S }, (_, j) => <col key={j} />)}
            <col style={{ width: 100 }} />
          </colgroup>
          <thead>
            <tr><th>Dimension</th><th>Spec</th>{Array.from({ length: S }, (_, j) => <th key={j} className="c">{j + 1}</th>)}<th>Result</th></tr>
          </thead>
          <tbody>
            {PARAMS.map((q) => {
              const vals = Array.from({ length: q.samples.length }, (_, j) => (L.dims[q.id] || [])[j] ?? null);
              const [cls, t] = dimStatusSV(q, vals);
              return (
                <tr key={q.id}>
                  <td><b>{q.t}</b></td><td className="ds">{q.spec}</td>
                  {Array.from({ length: S }, (_, j) => {
                    const v = j < vals.length ? vals[j] : null;
                    const s = st(q, v);
                    return <td key={j} className={`c ${s === 'bad' ? 'ng' : s === 'warn' ? 'warn' : ''}`}>{v != null ? fmt(v) : ''}</td>;
                  })}
                  <td><span className={`pill ${cls} sm`}>{t}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );

  const held = cnt['On hold'];
  const actionbar = (
    <div className="actionbar">
      {readOnly ? (
        <>
          <span className="hint">Read-only. {L.status === 'onhold' ? 'On hold.' : 'Completed.'}</span>
          <button className="btn big" onClick={c.svlots}>‹ Back to lots</button>
        </>
      ) : (
        <>
          <span className="hint">
            {needOos ? <><b>Say what was done</b> about the out-of-spec readings.</>
              : held ? <><b>{held} item{held > 1 ? 's' : ''} on hold.</b> The lot stays on hold until you approve or reject them.</>
                : <><b>Report correct?</b> Save completes the lot.</>}
          </span>
          <button className="btn big" onClick={() => ref.current && downloadReport(ref.current, L.code)}>Download</button>
          <button className="btn big primary" onClick={() => void c.sign()} disabled={needOos || c.saving}>{held ? 'Save, keep on hold' : 'Save'}</button>
        </>
      )}
    </div>
  );

  return (
    <div className="opshell">
      <LotBar lot={L} onBack={c.svlots} />
      {c.errMsg && <div className="listmsg sv-ban">{c.errMsg}</div>}
      <section ref={ref} className="pvwrap svpv">
        <div className="pvhead">
          <div>
            <h2>{readOnly ? 'Lot report' : 'Preview the lot report'}</h2>
            <p className="sub">{readOnly
              ? `Saved by ${shortName(L.sup?.by?.name)}, ${protoTime(L.sup?.at)}.`
              : 'Visual results with your decisions, and the sample dimensions. Read it through, then save.'}</p>
          </div>
          <div className="pvsum">
            <span><b>{nIt}</b>Items</span>
            <span className="g"><b>{nIt - bad.length}</b>Good</span>
            <span className={bad.length ? 'r' : ''}><b>{bad.length}</b>Bad</span>
            <span><b>{ss.filled}/{ss.total}</b>Readings</span>
          </div>
        </div>
        <div className="card rmeta">
          <dl className="dl pv">
            <div><dt>Part no.</dt><dd>{tpl?.sheet.part ?? '—'}</dd></div>
            <div><dt>Part name</dt><dd>{tpl?.sheet.partName ?? '—'}</dd></div>
            <div><dt>Lot barcode</dt><dd className="mono">{L.code}</dd></div>
            <div><dt>Lot</dt><dd>{L.name}, {lotDate}</dd></div>
            <div><dt>Inspected by</dt><dd>{shortName(L.op?.by?.name)}</dd></div>
            <div><dt>Operator clearance</dt><dd>{L.clearance ? L.clearance.d : '—'}</dd></div>
            <div><dt>Bad item decisions</dt><dd>{cnt.Approved} approved, {cnt['On hold']} on hold, {cnt.Rejected} rejected</dd></div>
            <div><dt>Reviewed by</dt><dd>{readOnly ? shortName(L.sup?.by?.name) : me}</dd></div>
          </dl>
        </div>
        {dims}
        {ss.bad.length > 0 && (
          <div className={`card ${needOos ? 'warnblock2' : ''}`}>
            <h3>{ss.bad.length} reading{ss.bad.length > 1 ? 's' : ''} out of spec</h3>
            <p className="sub">
              {ss.bad.map((b) => `${b.p.t} ${fmt(b.v)} on item ${b.j + 1}`).join('; ')}.
              {readOnly ? ` Action: ${L.oos || '—'}` : ' What was done?'}
            </p>
            {!readOnly && (
              <div className="rowbtns" style={{ margin: '10px 0 0' }}>
                {OOS_ACTIONS.map((v) => <button key={v} className={`chip ${L.oos === v ? 'sel' : ''}`} onClick={() => c.oos(v)}>{v}</button>)}
              </div>
            )}
          </div>
        )}
        {blocks}
        {actionbar}
      </section>
    </div>
  );
};
