import React, { useEffect, useLayoutEffect } from 'react';
import { SPOT_CHECKS, type Disposition, type Lot, type Workspace } from '../data';
import {
  DEC, badIdx, checkValue, dimValue, fmt, nItems, nSamples, paramsOf, sampleChecks, sampleCount, sampleOwnDone,
  sampleParams, sampleTotal, spotsOf, st, svProgress, templateOf,
} from '../logic/rules';
import type { SupervisorController } from '../hooks/useSupervisorController';
import { LotBar } from '../components/LotBar';

const DECISIONS: [Disposition, string][] = [['Approved', '✓'], ['On hold', '‖'], ['Rejected', '✕']];

/**
 * Prototype svReview(L): the item list on the left; on the right the open item's card (its checks
 * as chips, a spot check for good items), the bad items to decide, the 3 spot checks, the sample
 * dimensions (tiles with a keypad popup) and comments. Preview is enabled once everything is done.
 */
export const ReviewScreen: React.FC<{ ws: Workspace; c: SupervisorController; lot: Lot }> = ({ ws, c, lot: L }) => {
  const tpl = templateOf(ws, L);
  const ITEMS = tpl?.items ?? [];
  const PARAMS = paramsOf(ws, L);
  const S = nSamples(ws, L);
  const N = nItems(ws, L);
  const pr = svProgress(ws, L);
  const sp = spotsOf(L);
  const done = pr.ready;
  const total = pr.bad + S + pr.spotNeed;
  const dn = pr.dec + pr.samp + Math.min(pr.spot, pr.spotNeed);
  const titleOf = (id: string) => ITEMS.find((x) => x.id === id)?.t ?? id;

  const i = c.svItem != null && c.svItem < N ? c.svItem : 0;
  const p = L.parts[i] ?? null;
  const it = c.sel.s < S ? c.sel.s : 0;

  // Prototype render(): keep the current item visible in the sidebar list.
  useLayoutEffect(() => {
    const ul = document.getElementById('ilist');
    const li = ul?.querySelector<HTMLElement>('.irow.now');
    if (!ul || !li) return;
    const t = li.offsetTop - ul.offsetTop;
    if (t < ul.scrollTop || t > ul.scrollTop + ul.clientHeight - 50) ul.scrollTop = t - ul.clientHeight / 2;
  });

  // Prototype keydown: with the keypad open, digits / . / Backspace / Enter / Tab / Escape drive it.
  useEffect(() => {
    if (!c.kpOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (e.key === 'Escape') c.kpclose();
      else if (/^[0-9.]$/.test(e.key)) c.key(e.key);
      else if (e.key === 'Backspace') c.bksp();
      else if (e.key === 'Enter' || e.key === 'Tab') c.advance();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------------- sidebar ----------------

  const rows = Array.from({ length: N }, (_, k) => {
    const q = L.parts[k] ?? null;
    const bad = !!q && q.r === 'NG';
    const cls = k === i ? 'now' : bad ? 'bad' : q ? 'good' : '';
    const right = q && q.r === 'NG'
      ? (q.disp ? <span className={`pill ${DEC[q.disp]} sm`}>{q.disp}</span> : <span className="ist">✕ Decide</span>)
      : (q ? <span className="ist">✓</span> : <span className="ist">—</span>);
    return (
      <li key={k} className={`irow ${cls}`}>
        <button className="ilabel" onClick={() => c.svitem(k)}>
          <span>
            Item {k + 1}
            {k < S && <> <span className={`sc ${sampleOwnDone(ws, L, k) ? 'done' : ''}`}>▤ {sampleCount(ws, L, k)}/{sampleTotal(ws, L, k)}</span></>}
            {L.spot?.[String(k)] && <> <span className="sc spot">★</span></>}
          </span>
          {right}
        </button>
      </li>
    );
  });

  const side = (
    <aside className="side opside">
      <div className="sub">Review progress</div>
      <div className="bignum">{dn}<span> / {total}</span></div>
      <div className="progress"><i style={{ width: `${total ? (dn / total) * 100 : 100}%` }}></i></div>
      <div className="counts">
        <span className={`pill ${pr.dec === pr.bad ? 'ok' : 'ng'}`}>{pr.dec}/{pr.bad} decided</span>
        <span className={`pill ${pr.spot >= pr.spotNeed ? 'ok' : 'neutral'}`}>{pr.spot}/{pr.spotNeed} spot</span>
        {S > 0 && <span className={`pill ${pr.samp === S ? 'ok' : 'neutral'}`}>{pr.samp}/{S} measured</span>}
      </div>
      <p className="sub sideleg">▤ sample to measure · ★ your spot check</p>
      <ul className="ilist" id="ilist">{rows}</ul>
    </aside>
  );

  // ---------------- selected item ----------------

  const marks = new Set(p && p.r === 'NG' ? p.ng.map((n) => n.id) : []);
  const spot = L.spot?.[String(i)];
  const opRes = !p ? 'Not checked by the operator' : p.r === 'NG' ? 'Operator: bad' : 'Operator: good';

  const chips = ITEMS.map((x, n) => (
    <span
      key={x.id}
      className={`mchip ${marks.has(x.id) ? 'bad' : ''} ${spot && spot.r === 'NG' && spot.ng.includes(x.id) ? 'sbad' : ''}`}
      title={x.t}
    >
      {n + 1}. {x.t}
    </span>
  ));

  let action: React.ReactNode = null;
  if (p && p.r === 'NG') {
    action = (
      <p className="sub" style={{ margin: '10px 0 0' }}>
        {p.disp ? <>Your decision: <b className={`pill ${DEC[p.disp]}`}>{p.disp}</b></> : 'Decide this item in the list below.'}
      </p>
    );
  } else if (p) {
    const full = !spot && sp.length >= SPOT_CHECKS;
    action = (
      <div className="rv-row">
        <span className="lbl2">Spot check this item {spot ? '' : `(${sp.length}/${SPOT_CHECKS} used)`}</span>
        <div className="seg3 two">
          <button className={`ok ${spot && spot.r === 'OK' ? 'on' : ''}`} onClick={() => c.svspot('OK')} disabled={full}>✓ Agree, good</button>
          <button className={`ng ${spot && spot.r === 'NG' ? 'on' : ''}`} onClick={() => c.svspot('NG')} disabled={full}>✕ Found a problem</button>
        </div>
        {spot && spot.r === 'NG' && (
          <>
            <p className="sub" style={{ margin: '8px 0 4px' }}>Tap what’s wrong:</p>
            <div className="fchips">
              {ITEMS.map((x) => (
                <button key={x.id} className={`fchip ${spot.ng.includes(x.id) ? 'on' : ''}`} onClick={() => c.svspotf(x.id)}>{x.t}</button>
              ))}
            </div>
          </>
        )}
        {spot && <button className="linkbtn" onClick={() => c.svspotdel(i)}>Remove spot check</button>}
      </div>
    );
  }

  const itemCard = (
    <section className="rv-card">
      <div className="rv-head">
        <div>
          <h3>Item {i + 1} <span className="of">of {N}</span></h3>
          <p className={`sub ${p && p.r === 'NG' ? 'ngt' : ''}`}>
            {opRes}{p && p.r === 'NG' && `: ${p.ng.map((n) => titleOf(n.id)).join(', ')}`}
          </p>
        </div>
      </div>
      <div className="mchips">{chips}</div>
      {action}
    </section>
  );

  // ---------------- bad items ----------------

  const bl = badIdx(L);
  const badSec = (
    <>
      <div className="fsec">Bad items from the operator ({pr.dec}/{bl.length} decided)</div>
      {bl.length ? (
        <div className="rv-list">
          {bl.map((k) => {
            const q = L.parts[k];
            if (!q || q.r !== 'NG') return null;
            return (
              <div key={k} className={`rv-li ${k === i ? 'cur' : ''}`}>
                <button className="rv-open" onClick={() => c.svitem(k)}>
                  <b>Item {k + 1}</b>
                  <span>{q.ng.map((n) => titleOf(n.id)).join(', ')}</span>
                </button>
                <div className="seg3 sm">
                  {DECISIONS.map(([v, t]) => (
                    <button key={v} className={`${DEC[v]} ${q.disp === v ? 'on' : ''}`} title={v} onClick={() => c.svdec(k, v)}>{t} {v}</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : <p className="sub">No bad items in this lot.</p>}
    </>
  );

  // ---------------- spot checks ----------------

  const spotSec = (
    <>
      <div className="fsec">Your spot checks ({sp.length}/{pr.spotNeed})</div>
      <p className="sub" style={{ margin: '-2px 0 8px' }}>
        Pick {pr.spotNeed} item{pr.spotNeed === 1 ? '' : 's'} at random from the lot, check them yourself, and record the result. They appear in the right-side columns of the report.
      </p>
      {sp.length > 0 && (
        <div className="rv-list">
          {sp.map((k) => {
            const s2 = L.spot[String(k)];
            return (
              <div key={k} className="rv-li">
                <button className="rv-open" onClick={() => c.svitem(k)}>
                  <b>Item {k + 1}</b>
                  <span>{s2.r === 'OK' ? 'Agree, good' : `Problem: ${s2.ng.map(titleOf).join(', ') || 'choose what’s wrong'}`}</span>
                </button>
                <span className={`pill ${s2.r === 'OK' ? 'ok' : 'ng'}`}>{s2.r === 'OK' ? '✓ Good' : '✕ Bad'}</span>
              </div>
            );
          })}
        </div>
      )}
      {sp.length < pr.spotNeed && <button className="btn" onClick={c.svspotrand}>Pick a random item</button>}
    </>
  );

  // ---------------- sample dimensions ----------------

  const tiles = sampleParams(ws, L, it);
  const checksHere = sampleChecks(ws, L, it);
  const hasDims = PARAMS.length > 0;
  const hasChecks = (tpl?.supChecks ?? []).length > 0;
  const secTitle = hasDims && hasChecks ? 'Sample dimensions and checks' : hasChecks ? 'Sample checks' : 'Sample dimensions';
  const dimSec = S > 0 && (
    <>
      <div className="fsec">{secTitle} ({pr.samp}/{S} items done)</div>
      <div className="samplechips" style={{ gridTemplateColumns: `repeat(${Math.min(S, 10)},minmax(0,1fr))` }}>
        {Array.from({ length: S }, (_, k) => (
          <button key={k} className={`${k === it ? 'on' : ''} ${sampleOwnDone(ws, L, k) ? 'done' : ''}`} onClick={() => c.svsample(k)}>
            Item {k + 1}<small>{sampleCount(ws, L, k)}/{sampleTotal(ws, L, k)}</small>
          </button>
        ))}
      </div>
      {tiles.length > 0 && <div className="dtiles six">
        {tiles.map((d) => {
          const pi = PARAMS.indexOf(d);
          const v = dimValue(L, d, it);
          const on = c.kpOpen && c.sel.p === pi;
          const typ = on && !!c.buf;
          const cls = typ ? '' : st(d, v);
          return (
            <button
              key={d.id}
              className={`dtile ${cls} ${on ? 'on' : ''}`}
              onClick={() => c.svdim(pi)}
              title={d.editable ? undefined : 'Entered by the operator'}
            >
              <span className="dt-top"><small>{d.grp.split(',')[0]}</small>{v != null && !typ && <span className="dt-ok" aria-label="Saved">✓</span>}</span>
              <b>{d.t}</b>
              <span className="dv">{typ ? c.buf : v != null ? fmt(v) : '—'}</span>
              <span className="dl2">
                Min {d.min != null ? d.min.toFixed(2) : '—'} · Max {d.max != null ? d.max.toFixed(2) : '—'}
                {!d.editable && ' · by the operator'}
              </span>
            </button>
          );
        })}
      </div>}
      {tiles.length > 0 && <p className="sub" style={{ margin: '6px 0 0' }}>Tap a box to enter its reading.</p>}
      {checksHere.length > 0 && (
        <div className="fgrid" style={{ marginTop: tiles.length ? 14 : 0 }}>
          {checksHere.map((x) => {
            const v = checkValue(L, x, it);
            return (
              <div key={x.id} className={`fcard yn ${v === 'NG' ? 'bad' : v === 'OK' ? 'good' : ''}`}>
                <span className="fb"><b>{x.t}</b><span>{x.desc}</span>{x.method && <small>{x.method}</small>}</span>
                <span className="ynb">
                  <button className={`yb ${v === 'OK' ? 'on' : ''}`} aria-pressed={v === 'OK'} onClick={() => c.svcheck(it, x.id, 'OK')}>✓ Good</button>
                  <button className={`nb2 ${v === 'NG' ? 'on' : ''}`} aria-pressed={v === 'NG'} onClick={() => c.svcheck(it, x.id, 'NG')}>✕ Bad</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  // ---------------- comments ----------------

  const comment = (
    <>
      <div className="fsec">Comments</div>
      <textarea
        id="svcomment"
        placeholder="Anything the report should note about this lot (optional)"
        value={L.supComment ?? ''}
        onChange={(e) => c.setComment(e.target.value)}
      />
    </>
  );

  // ---------------- keypad popup ----------------

  const q = PARAMS[c.sel.p];
  const qv = q ? dimValue(L, q, it) : null;
  const pop = c.kpOpen && q && (
    <>
      <div className="kpop-bg" onClick={c.kpclose}></div>
      <div className="kpop" role="dialog" aria-label="Enter reading">
        <div className="kpop-h">
          <div><b>{q.t}</b><span className="sub">Item {it + 1} · Min {q.min != null ? q.min.toFixed(2) : '—'} · Max {q.max != null ? q.max.toFixed(2) : '—'}</span></div>
          <button className="ghost" onClick={c.kpclose} aria-label="Close">✕</button>
        </div>
        <div className={`kpop-v ${c.buf ? '' : st(q, qv)}`}>{c.buf ? c.buf : fmt(qv) || '—'}</div>
        <div className="kp-grid">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <button key={n} className="key" onClick={() => c.key(String(n))}>{n}</button>)}
          <button className="key" onClick={() => c.key('.')} aria-label="Decimal point">.</button>
          <button className="key" onClick={() => c.key('0')}>0</button>
          <button className="key small" onClick={c.bksp} aria-label="Delete">⌫</button>
        </div>
        <button className="btn big primary" onClick={c.kpclose} style={{ width: '100%', marginTop: 10 }}>Done</button>
      </div>
    </>
  );

  // ---------------- action bar ----------------

  const todo: string[] = [];
  if (pr.bad - pr.dec) todo.push(`${pr.bad - pr.dec} to decide`);
  if (pr.spotNeed - pr.spot > 0) todo.push(`${pr.spotNeed - pr.spot} spot check${pr.spotNeed - pr.spot > 1 ? 's' : ''}`);
  if (S - pr.samp) todo.push(`${S - pr.samp} sample${S - pr.samp > 1 ? 's' : ''} to ${hasDims ? 'measure' : 'check'}`);
  let hint: React.ReactNode;
  if (!done) hint = `Still to do: ${todo.join(', ')}.`;
  else if (pr.opMissing) hint = <><b>All done.</b> {pr.opMissing} reading{pr.opMissing > 1 ? 's' : ''} not entered by the operator. Preview the report.</>;
  else hint = <><b>All done.</b> Preview the report.</>;

  return (
    <div className="opshell">
      <LotBar lot={L} onBack={c.svlots} />
      {c.supMsg && <div className="listmsg sv-ban">{c.supMsg} Next lot opened.</div>}
      {c.errMsg && <div className="listmsg sv-ban">{c.errMsg}</div>}
      {L.returnNote && <div className="banner sv-ban"><b>Reopened by admin</b>{L.returnNote}</div>}
      <section className="layout svlayout">
        {side}
        <div className="main">
          {itemCard}
          {badSec}
          {spotSec}
          {dimSec}
          {comment}
          <div className="grow"></div>
          <div className="actionbar">
            <span className="hint">{hint}</span>
            <button className="btn big primary" onClick={c.svpreview} disabled={!done}>Preview report ›</button>
          </div>
        </div>
      </section>
      {pop}
    </div>
  );
};
