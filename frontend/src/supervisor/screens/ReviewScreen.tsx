import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DimensionParam, Disposition, Lot, Workspace } from '../data';
import { protoTime, shortName } from '../logic/format';
import {
  DEC, dimValue, fmt, isTodo, nItems, nSamples, paramsOf, sampleCount, sampleDone, sampleParams, st,
  svNextTodo, svProgress, templateOf,
} from '../logic/rules';
import type { SupervisorController } from '../hooks/useSupervisorController';
import { LotBar } from '../components/LotBar';

const READING = /^\d{0,4}(\.\d{0,3})?$/;

/**
 * One dimension reading as a field (replaces the prototype keypad). Typing is kept locally and
 * saved on Enter or when the field loses focus; Enter also moves to the next field.
 */
const DimField: React.FC<{ d: DimensionParam; v: number | null; onSave: (v: number | null) => void }> = ({ d, v, onSave }) => {
  const shown = v != null ? fmt(v) : '';
  const [txt, setTxt] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setTxt(shown); }, [shown, editing]);

  const typed = txt.trim() === '' ? null : parseFloat(txt);
  const cur = typed != null && !Number.isNaN(typed) ? typed : null;
  const cls = st(d, d.editable ? cur : v);

  const commit = () => {
    setEditing(false);
    if (cur === v) { setTxt(shown); return; }
    onSave(cur);
    setTxt(cur != null ? fmt(cur) : '');
  };

  return (
    <label className={`dtile dfield ${cls}`} title={d.editable ? undefined : 'Entered by the operator'}>
      <span className="dt-top"><b>{d.t}</b>{v != null && !editing && <span className="dt-ok" aria-label="Saved">✓</span>}</span>
      {d.editable ? (
        <input
          className="dv dinput"
          data-dim=""
          inputMode="decimal"
          autoComplete="off"
          placeholder="—"
          aria-label={`${d.t} reading`}
          value={txt}
          onFocus={(e) => { setEditing(true); e.currentTarget.select(); }}
          onChange={(e) => { if (READING.test(e.target.value)) setTxt(e.target.value); }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const all = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-dim]'));
              const next = all[all.indexOf(e.currentTarget) + 1];
              if (next) next.focus(); else e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setTxt(shown);
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <span className="dv">{v != null ? fmt(v) : '—'}</span>
      )}
      <span className="dl2">
        Min {d.min != null ? d.min.toFixed(2) : '—'} · Max {d.max != null ? d.max.toFixed(2) : '—'}
        {cls === 'warn' ? ', near limit' : cls === 'bad' ? ', out of spec' : ''}
        {!d.editable && (v == null ? ', not entered by the operator' : ', by the operator')}
      </span>
    </label>
  );
};

/**
 * Prototype svReview(L), on one scrolling page per item: the item sidebar, then
 * "Operator's checks" (every check, ✓ / ✕) and "Your review" (decision if bad, dimension
 * fields if a sample, both when both apply), with Previous / Next / Next to do.
 */
export const ReviewScreen: React.FC<{ ws: Workspace; c: SupervisorController; lot: Lot }> = ({ ws, c, lot: L }) => {
  const tpl = templateOf(ws, L);
  const ITEMS = tpl?.items ?? [];
  const GROUPS = tpl?.groups ?? [];
  const PARAMS = paramsOf(ws, L);
  const S = nSamples(ws, L);
  const N = nItems(ws, L);
  const pr = svProgress(ws, L);
  const done = pr.dec === pr.bad && pr.samp === S;
  const total = pr.bad + S;
  const dn = pr.dec + pr.samp;
  const lotChecks = L.lotChecks ?? {};

  const i = c.svItem != null && c.svItem < N ? c.svItem : 0;
  const p = L.parts[i] ?? null;
  const isBad = !!p && p.r === 'NG';
  const isSample = i < S;
  const nextTodo = svNextTodo(ws, L, i);

  // Prototype render(): keep the current item visible in the sidebar list.
  useLayoutEffect(() => {
    const ul = document.getElementById('ilist');
    const li = ul?.querySelector<HTMLElement>('.irow.now');
    if (!ul || !li) return;
    const t = li.offsetTop - ul.offsetTop;
    if (t < ul.scrollTop || t > ul.scrollTop + ul.clientHeight - 50) ul.scrollTop = t - ul.clientHeight / 2;
  });

  // A new item starts at the top of the page.
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => { mainRef.current?.scrollTo?.({ top: 0 }); }, [i, L.id]);

  // ---------------- sidebar ----------------

  const rows = Array.from({ length: N }, (_, k) => {
    const q = L.parts[k] ?? null;
    const bad = !!q && q.r === 'NG';
    const samp = k < S;
    const cls = k === i ? 'now' : bad ? 'bad' : q ? 'good' : '';
    const right = q && q.r === 'NG'
      ? (q.disp ? <span className={`pill ${DEC[q.disp]} sm`}>{q.disp}</span> : <span className="ist">✕ Decide</span>)
      : (q ? <span className="ist">✓</span> : <span className="ist">—</span>);
    return (
      <li key={k} className={`irow ${cls}`}>
        <button className="ilabel" onClick={() => c.svitem(k)}>
          <span>Item {k + 1}{samp && <> <span className={`sc ${sampleDone(ws, L, k) ? 'done' : ''}`}>▤ {sampleCount(ws, L, k)}/{sampleParams(ws, L, k).length}</span></>}</span>
          {right}
        </button>
      </li>
    );
  });

  const side = (
    <aside className="side opside">
      <div className="sub">Review progress</div>
      <div className="bignum">{dn}<span> / {total}</span></div>
      <div className="progress"><i style={{ width: `${total ? (dn / total) * 100 : 0}%` }}></i></div>
      <div className="counts">
        <span className={`pill ${pr.dec === pr.bad ? 'ok' : 'ng'}`}>{pr.dec}/{pr.bad} decided</span>
        <span className={`pill ${pr.samp === S ? 'ok' : 'neutral'}`}>{pr.samp}/{S} measured</span>
      </div>
      <p className="sub sideleg">▤ = sample to measure</p>
      <ul className="ilist" id="ilist">{rows}</ul>
    </aside>
  );

  // ---------------- Operator's checks ----------------

  // The item's own results, plus whole-lot checks (one result for the whole lot) that apply to it.
  const res: Record<string, { r: 'OK' | 'NG'; lot: boolean }> = {};
  Object.entries(lotChecks).forEach(([id, x]) => { res[id] = { r: x.r, lot: true }; });
  if (p) Object.entries(p.res ?? {}).forEach(([id, r]) => { res[id] = { r, lot: false }; });
  const checked = Object.keys(res).length > 0;
  const lotNg = Object.values(lotChecks).filter((x) => x.r === 'NG');
  const overallBad = isBad || (!p && lotNg.length > 0);
  const nProblems = Object.values(res).filter((x) => x.r === 'NG').length;

  const latestLot = Object.values(lotChecks).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))[0];
  const byId = p?.by ?? latestLot?.by ?? null;
  const checker = byId != null ? ws.users.find((u) => u.id === byId)?.name : null;
  const opName = shortName(checker ?? L.op?.by?.name) || 'the operator';
  const opAt = p?.at ?? latestLot?.at ?? L.op?.at ?? null;

  const operatorChecks = !checked ? (
    <div className="svnote">Not checked by the operator.</div>
  ) : (
    <>
      <p className="sub svopline">
        <span className={`pill ${overallBad ? 'ng' : 'ok'}`}>{overallBad ? '✕ Bad' : '✓ Good'}</span>
        <span>Checked by <b>{opName}</b>{opAt && <>, {protoTime(opAt)}</>}</span>
        {nProblems > 0 && <b style={{ color: 'var(--ng)' }}>{nProblems} problem{nProblems > 1 ? 's' : ''}</b>}
      </p>
      {GROUPS.map((g) => {
        const xs = ITEMS.filter((x) => x.g === g);
        if (!xs.length) return null;
        return (
          <React.Fragment key={g}>
            <div className="fsec">{g}</div>
            <div className="fgrid ro">
              {xs.map((x) => {
                const r = res[x.id];
                return (
                  <div key={x.id} className={`fcard ${r?.r === 'NG' ? 'bad' : r ? 'pass' : 'na'}`}>
                    <span className="fn">{ITEMS.indexOf(x) + 1}</span>
                    <span className="fb">
                      <b>{x.t}</b><span>{x.desc}</span>
                      <small>{r ? `${x.method}${r.lot ? ' · checked once for the whole lot' : ''}` : 'Not checked'}</small>
                    </span>
                    <span className="fx" aria-label={r?.r === 'NG' ? 'Rejected' : r ? 'Accepted' : 'Not checked'}>{r?.r === 'NG' ? '✕' : r ? '✓' : '—'}</span>
                  </div>
                );
              })}
            </div>
          </React.Fragment>
        );
      })}
    </>
  );

  // ---------------- Your review ----------------

  let decision: React.ReactNode = null;
  if (p && p.r === 'NG') {
    decision = (
      <>
        <div className="fsec">Your decision</div>
        <div className="decbtns">
          {([['Approved', '✓ Approve'], ['On hold', '‖ On hold'], ['Rejected', '✕ Reject']] as [Disposition, string][]).map(([v, t]) => (
            <button key={v} className={`dec ${DEC[v]} ${p.disp === v ? 'on' : ''}`} onClick={() => c.svdec(i, v)}><b>{t}</b></button>
          ))}
        </div>
      </>
    );
  }

  // A failed whole-lot check is decided once, on the item that holds it.
  const holders = [...new Set(lotNg.map((x) => x.item))].filter((k) => k !== i);
  const lotNote = holders.length > 0 && (
    <div className="svnote">
      A check for the whole lot failed. It’s decided once for the lot, on{' '}
      {holders.map((k, n) => (
        <React.Fragment key={k}>{n > 0 && ', '}<button className="linkbtn" onClick={() => c.svitem(k)}>Item {k + 1}</button></React.Fragment>
      ))}.
    </div>
  );

  let dims: React.ReactNode = null;
  if (isSample) {
    const groups: { g: string; ds: DimensionParam[] }[] = [];
    PARAMS.forEach((d) => {
      if (i >= d.samples.length) return;
      let grp = groups.find((x) => x.g === d.grp);
      if (!grp) groups.push((grp = { g: d.grp, ds: [] }));
      grp.ds.push(d);
    });
    dims = (
      <>
        <p className="sub svsampline">Sample {i + 1} of {S}: {sampleCount(ws, L, i)} of {sampleParams(ws, L, i).length} dimensions measured. Type each reading and press Enter.</p>
        {groups.map(({ g, ds }) => (
          <React.Fragment key={g}>
            <div className="fsec">{g}</div>
            <div className="dtiles">
              {ds.map((d) => (
                <DimField
                  key={`${L.id}-${i}-${d.id}`}
                  d={d}
                  v={dimValue(L, d, i)}
                  onSave={(v) => c.svreading(i, PARAMS.indexOf(d), v)}
                />
              ))}
            </div>
          </React.Fragment>
        ))}
      </>
    );
  }

  const review = decision || dims || lotNote ? <>{decision}{lotNote}{dims}</> : (
    <div className="svnote">Nothing to review on this item: it isn’t marked bad and isn’t a sample to measure.</div>
  );

  let hint: React.ReactNode;
  if (done) hint = <><b>All done.</b> Preview the report.</>;
  else if (pr.ready) hint = `${pr.opMissing} reading${pr.opMissing > 1 ? 's' : ''} not entered by the operator. You can still preview the report.`;
  else hint = `${pr.bad - pr.dec} to decide, ${S - pr.samp} sample${S - pr.samp === 1 ? '' : 's'} to measure.`;

  return (
    <div className="opshell">
      <LotBar lot={L} onBack={c.svlots} />
      {c.supMsg && <div className="listmsg sv-ban">{c.supMsg} Next lot opened.</div>}
      {c.errMsg && <div className="listmsg sv-ban">{c.errMsg}</div>}
      {L.returnNote && <div className="banner sv-ban"><b>Reopened by admin</b>{L.returnNote}</div>}
      <section className="layout svlayout">
        {side}
        <div className="main" ref={mainRef}>
          <div className="ckhead"><div>
            <h2>Item {i + 1} <span className="of">of {N}</span></h2>
            <p className="sub">
              {overallBad ? 'Marked bad' : checked ? 'Marked good' : 'Not checked'}
              {isSample && ' · Sample to measure'}
              {isTodo(ws, L, i) && ' · Still to do'}
            </p>
          </div></div>

          <h3 className="svsec">Operator’s checks</h3>
          {operatorChecks}

          <h3 className="svsec">Your review</h3>
          {review}

          <div className="grow"></div>
          <div className="actionbar">
            <span className="hint">{hint}</span>
            <button className="btn big" onClick={() => c.svstep(-1)} disabled={i === 0}>‹ Previous</button>
            <button className="btn big" onClick={() => c.svstep(1)} disabled={i >= N - 1}>Next ›</button>
            {!pr.ready && <button className="btn big primary" onClick={c.svnexttodo} disabled={nextTodo < 0 || nextTodo === i}>Next to do ›</button>}
            {pr.ready && <button className="btn big primary" onClick={c.svpreview}>Preview report ›</button>}
          </div>
        </div>
      </section>
    </div>
  );
};
