import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DimensionParam, Lot, Workspace } from '../data';
import {
  ITEM_FILTERS, SV_TAG, checkValue, dimValue, effAns, fmt, itemDecision, nItems, nSamples, paramsOf, sampleChecks,
  sampleParams, spotDimValue, spotMissing, spotUsesSample, st, supRejected, svProgress, svStatusItem,
  svVisibleItems, templateOf, type ItemStatus,
} from '../logic/rules';
import type { SupervisorController } from '../hooks/useSupervisorController';
import { LotBar } from '../components/LotBar';

/**
 * Prototype v2 svReview(L): every item of the lot on the left (filter + Go to item); on the right
 * the open item's visual checks as Yes/No cards. Every tap is saved at once (no Save button):
 * - bad items (operator) get a decision: Approve / On hold / Reject;
 * - on a good item, answering any check No means the supervisor found it bad (rejected);
 * - good items not rejected can be spot checks, and a spot check needs every dimension reading.
 * Sample readings are typed straight into the boxes; Pick a random item / Preview report at the bottom.
 */
export const ReviewScreen: React.FC<{ ws: Workspace; c: SupervisorController; lot: Lot }> = ({ ws, c, lot: L }) => {
  const tpl = templateOf(ws, L);
  const ITEMS = tpl?.items ?? [];
  const PARAMS = paramsOf(ws, L);
  const NS = nSamples(ws, L);
  const N = nItems(ws, L);
  const pr = svProgress(ws, L);
  const NSP = pr.spotNeed;
  const done = pr.ready;

  const i = c.svItem != null && c.svItem < N ? c.svItem : 0;
  const p = L.parts[i] ?? null;
  const ist = svStatusItem(L, i);
  const isBad = !!p && p.r === 'NG';
  const spot = L.spot?.[String(i)];

  // Prototype render(): keep the current item visible in the sidebar list.
  useLayoutEffect(() => {
    const ul = document.getElementById('ilist');
    const li = ul?.querySelector<HTMLElement>('.irow.now');
    if (!ul || !li) return;
    const t = li.offsetTop - ul.offsetTop;
    if (t < ul.scrollTop || t > ul.scrollTop + ul.clientHeight - 50) ul.scrollTop = t - ul.clientHeight / 2;
  });

  // ---------------- sidebar ----------------

  const [jump, setJump] = useState('');
  const goJump = () => { if (!c.jumpgo(jump)) setJump(''); };

  const visible = svVisibleItems(ws, L, c.svFilt);
  const rows = visible.length ? visible.map((k) => {
    const q = L.parts[k] ?? null;
    const sk = svStatusItem(L, k);
    const tag: [string, string] | undefined = sk === 'spot' && spotMissing(ws, L, k) > 0 ? ['warn', 'Measure'] : SV_TAG[sk];
    return (
      <li key={k} className={`irow ${k === i ? 'now' : q && q.r === 'NG' ? 'bad' : q ? 'good' : ''}`}>
        <button className="ilabel" onClick={() => c.svitem(k)}>
          <span>
            Item {k + 1}
            {L.spot?.[String(k)] && <> <span className="spotstar" title="Spot checked by you" aria-label="Spot checked">★</span></>}
          </span>
          {tag
            ? <span className={`pill ${tag[0]} sm`}>{tag[1]}</span>
            : <span className="ist">{q ? (q.r === 'NG' ? '✕' : '✓') : '—'}</span>}
        </button>
      </li>
    );
  }) : <li className="sub" style={{ padding: '16px 8px' }}>No items with this status.</li>;

  const tot = pr.bad + NS + NSP;
  const dn = pr.dec + Math.min(pr.samp, NS) + Math.min(pr.spot, NSP);
  const side = (
    <aside className="side opside">
      <div className="sub">Review progress</div>
      <div className="bignum">{dn}<span> / {tot}</span></div>
      <div className="progress"><i style={{ width: `${tot ? (dn / tot) * 100 : 100}%` }}></i></div>
      <div className="counts">
        <span className={`pill ${pr.dec === pr.bad ? 'ok' : 'ng'}`}>{pr.dec}/{pr.bad} decided</span>
        <span className={`pill ${pr.spot >= NSP ? 'ok' : 'neutral'}`} title="Spot checks with every dimension measured">{Math.min(pr.spot, NSP)}/{NSP} spot</span>
        {NS > 0 && <span className={`pill ${pr.samp >= NS ? 'ok' : 'neutral'}`}>{Math.min(pr.samp, NS)}/{NS} measured</span>}
      </div>
      <div className="jump">
        <input
          id="jumpin"
          inputMode="numeric"
          placeholder="Go to item #"
          aria-label="Go to item number"
          value={jump}
          onChange={(e) => setJump(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); goJump(); } }}
        />
        <button className="btn" onClick={goJump}>Go</button>
      </div>
      <label className="svfsel">
        <select id="svfiltsel" aria-label="Filter items" value={c.svFilt} onChange={(e) => c.svfilt(e.target.value as typeof c.svFilt)}>
          {ITEM_FILTERS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
      </label>
      <ul className="ilist" id="ilist">{rows}</ul>
    </aside>
  );

  // ---------------- item header ----------------

  const spotLeft = spot ? spotMissing(ws, L, i) : 0;
  const rejGood = supRejected(L, i);
  const foundBad = rejGood ? 'The operator marked this item good; you found it bad. ' : '';
  const decTxt: Record<ItemStatus, string> = {
    todo: rejGood ? `${foundBad}Decide it below.` : 'The operator marked this item bad. Decide it.',
    rejected: `${foundBad}Rejected by you.`,
    hold: `${foundBad}Kept on hold by you.`,
    spot: spotLeft
      ? `Spot checked by you. Enter every dimension reading (${spotLeft} still to do).`
      : 'Spot checked by you. All dimensions measured.',
    approved: `${foundBad}Approved by you.`,
    none: p ? `The operator marked this item ${isBad ? 'bad' : 'good'}.` : 'Not checked by the operator.',
  };
  const head = (
    <div className="ckhead">
      <div>
        <h2>Item {i + 1} <span className="of">of {N}</span></h2>
        <p className={`sub ${ist === 'todo' || ist === 'rejected' ? 'ngt' : ''}`}>{decTxt[ist]}</p>
      </div>
      {p && p.r === 'OK' && (
        <div className="spotwrap">
          <button
            className={`spotbtn ${spot ? 'on' : ''}`}
            onClick={c.svspot3}
            aria-pressed={!!spot}
            disabled={rejGood && !spot}
            title={rejGood ? 'An item you rejected can’t be a spot check' : undefined}
          >
            {spot ? '▣ Spot checked' : '▢ Mark as spot check'}
          </button>
          <span className="sub spotnote">
            {rejGood ? 'Rejected items can’t be spot checks' : <><span className="spotstar">★</span> spot check needs every dimension</>}
          </span>
        </div>
      )}
    </div>
  );

  // ---------------- visual check cards ----------------

  const opNg = new Set(isBad && p && p.r === 'NG' ? p.ng.map((n) => n.id) : []);
  const saved = effAns(L, i);
  const ans: Record<string, 'Y' | 'N'> = Object.fromEntries(ITEMS.map((x) => [x.id, saved.has(x.id) ? 'N' : 'Y']));

  const cards = ITEMS.map((x, n) => {
    const no = ans[x.id] === 'N';
    const changed = !!p && no !== opNg.has(x.id);
    return (
      <div key={x.id} className={`fcard yn ${!p ? '' : no ? 'bad' : 'good'} ${changed ? 'chg' : ''}`}>
        <span className="fn">{n + 1}</span>
        <span className="fb">
          <b>{x.t}</b>
          <span>{x.desc}</span>
          <small>
            {x.method}
            {changed && <>{x.method ? ' · ' : ''}<em>Operator: {opNg.has(x.id) ? 'No' : 'Yes'}, changed by supervisor</em></>}
          </small>
        </span>
        {p ? (
          <span className="ynb ynb2">
            <button className={`yb ${!no ? 'on' : ''}`} onClick={() => c.svans(x.id, 'Y')} aria-label={`${x.t}: yes`} aria-pressed={!no}>✓</button>
            <button className={`nb2 ${no ? 'on' : ''}`} onClick={() => c.svans(x.id, 'N')} aria-label={`${x.t}: no`} aria-pressed={no}>✕</button>
          </span>
        ) : <span className="roic" aria-label="Not checked">—</span>}
      </div>
    );
  });

  // Bad items only (the operator's, or good items you found bad): the decision, saved at once.
  const decision = itemDecision(L, i);
  const needsDecision = decision !== undefined;
  const disp = decision ?? null;
  const actions = needsDecision && (
    <div className="svact2">
      <span className="hint">
        <b>Your decision</b> for this bad item. Changes to the checks above are saved automatically.
      </span>
      <div className="decrow">
        <button className={`btn big ${disp === 'Approved' ? 'primary' : ''}`} aria-pressed={disp === 'Approved'} onClick={() => c.svdecide('Approved')}>✓ Approve</button>
        <button className={`btn big ${disp === 'On hold' ? 'warn' : ''}`} aria-pressed={disp === 'On hold'} onClick={() => c.svdecide('On hold')}>‖ On hold</button>
        <button className={`btn big ${disp === 'Rejected' ? 'danger' : ''}`} aria-pressed={disp === 'Rejected'} onClick={() => c.svdecide('Rejected')}>✕ Reject</button>
      </div>
    </div>
  );
  const goodNote = p && !needsDecision && (
    <p className="sub" style={{ margin: '10px 0 0' }}>
      Saved automatically. If the operator marked a check good that is actually bad, tap ✕: the item then needs your decision.
    </p>
  );

  // ---------------- sample dimensions (typed into the boxes) ----------------

  const isSample = i < NS;
  const tiles: DimensionParam[] = isSample ? sampleParams(ws, L, i) : PARAMS;
  const spotSec = !!spot && PARAMS.length > 0 && (
    <>
      <div className="fsec">
        Spot check dimensions, item {i + 1}
        <span className="fsec-sub">required: {PARAMS.length - spotLeft} of {PARAMS.length} measured</span>
      </div>
      <div className="dtiles six">
        {PARAMS.map((d, pi) => {
          const sampleV = i < d.samples.length ? dimValue(L, d, i) : null;
          // A sample reading entered by the operator stays theirs; anything else the supervisor types.
          const canEdit = spotUsesSample(d, i) || sampleV == null;
          return (
            <DimTile
              key={d.id}
              d={d}
              v={spotDimValue(L, d, i)}
              item={i}
              locked={false}
              canEdit={canEdit}
              onValue={(nv) => c.typeSpotReading(pi, nv)}
            />
          );
        })}
      </div>
      <p className="sub" style={{ margin: '6px 0 0' }}>A spot check counts once every dimension is measured on this item.</p>
    </>
  );
  const checksHere = isSample ? sampleChecks(ws, L, i) : [];
  const hasSec = !spot && NS > 0 && (PARAMS.length > 0 || (tpl?.supChecks ?? []).length > 0);
  const dims = hasSec && (
    <>
      <div className="fsec">
        {PARAMS.length ? 'Sample dimensions' : 'Sample checks'}, item {i + 1}
        <span className="fsec-sub">{Math.min(pr.samp, NS)} of {NS} items measured</span>
      </div>
      {!isSample && (
        <p className="lockmsg">
          Readings are taken on items 1 to {NS}. These boxes are locked. Open a measured item (Show: Measured) to enter or change its readings.
        </p>
      )}
      {tiles.length > 0 && (
        <div className={`dtiles six ${isSample ? '' : 'locked'}`}>
          {tiles.map((d) => {
            const pi = PARAMS.indexOf(d);
            const v = isSample ? dimValue(L, d, i) : null;
            return (
              <DimTile
                key={d.id}
                d={d}
                v={v}
                item={i}
                locked={!isSample}
                canEdit={d.editable}
                onValue={(nv) => c.typeReading(pi, i, nv)}
              />
            );
          })}
        </div>
      )}
      {isSample && tiles.some((d) => d.editable) && (
        <p className="sub" style={{ margin: '6px 0 0' }}>Tap a box and type the reading, e.g. 8.04. It moves to the next box after two decimals.</p>
      )}
      {checksHere.length > 0 && (
        <div className="fgrid" style={{ marginTop: tiles.length ? 14 : 0 }}>
          {checksHere.map((x) => {
            const cv = checkValue(L, x, i);
            return (
              <div key={x.id} className={`fcard yn ${cv === 'NG' ? 'bad' : cv === 'OK' ? 'good' : ''}`}>
                <span className="fb"><b>{x.t}</b><span>{x.desc}</span>{x.method && <small>{x.method}</small>}</span>
                <span className="ynb ynb2">
                  <button className={`yb ${cv === 'OK' ? 'on' : ''}`} aria-pressed={cv === 'OK'} aria-label={`${x.t}: good`} onClick={() => c.svcheck(i, x.id, 'OK')}>✓</button>
                  <button className={`nb2 ${cv === 'NG' ? 'on' : ''}`} aria-pressed={cv === 'NG'} aria-label={`${x.t}: bad`} onClick={() => c.svcheck(i, x.id, 'NG')}>✕</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  // ---------------- action bar ----------------

  const todo: string[] = [];
  const toDecide = pr.bad - pr.dec;
  const toMeasure = NS - pr.samp;
  const toSpot = NSP - pr.spot;
  if (toDecide > 0) todo.push(`${toDecide} bad item${toDecide > 1 ? 's' : ''} to decide`);
  if (toMeasure > 0) todo.push(`${toMeasure} item${toMeasure > 1 ? 's' : ''} to measure`);
  if (toSpot > 0) {
    const open = pr.spotMarked - pr.spot;
    todo.push(open > 0
      ? `${toSpot} spot check${toSpot > 1 ? 's' : ''} (${open} need${open > 1 ? '' : 's'} dimension readings)`
      : `${toSpot} spot check${toSpot > 1 ? 's' : ''}`);
  }
  let hint: React.ReactNode;
  if (!done) hint = `To finish: ${todo.join(', ')}.`;
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
          {head}
          <div className="fsec">Visual check <span className="fsec-sub">operator’s answers, change any that are wrong</span></div>
          <div className="fgrid">{cards}</div>
          {actions}
          {goodNote}
          {spotSec}
          {spot && isSample && sampleChecks(ws, L, i).length > 0 && <SampleChecks ws={ws} c={c} lot={L} i={i} />}
          {dims}
          <div className="grow"></div>
          <div className="actionbar">
            <span className="hint">{hint}</span>
            <button className="btn big" onClick={c.svrand}>Pick a random item</button>
            <button className="btn big primary" onClick={c.svpreview} disabled={!done}>Preview report ›</button>
          </div>
        </div>
      </section>
      {c.toast && <div className={`sv-toast ${c.toast.kind}`} role="status" aria-live="polite">{c.toast.text}</div>}
    </div>
  );
};

/**
 * Prototype v2 dimension box (.dtile.din with a .dvin input): the reading is typed straight in and
 * saved as you type; after two decimals the cursor moves to the next empty box. Readings owned by the
 * operator are shown but can't be changed.
 */
const DimTile: React.FC<{
  d: DimensionParam; v: number | null; item: number; locked: boolean; canEdit: boolean; onValue: (v: number | null) => void;
}> = ({ d, v, item, locked, canEdit, onValue }) => {
  const [text, setText] = useState(fmt(v));
  const focused = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  // Show the saved value unless the box is being typed in.
  useEffect(() => { if (!focused.current) setText(fmt(v)); }, [v, item]);

  const disabled = locked || !canEdit;
  const shown = focused.current ? (text === '' ? null : parseFloat(text)) : v;
  const cls = st(d, shown != null && !Number.isNaN(shown) ? shown : null);

  const onChange = (raw: string) => {
    const t = raw.replace(',', '.').replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    setText(t);
    const n = parseFloat(t);
    onValue(t && !Number.isNaN(n) ? n : null);
    if (/^\d+\.\d{2}$/.test(t)) {
      const all = [...document.querySelectorAll<HTMLInputElement>('.dvin:not(:disabled)')];
      const k = all.indexOf(ref.current as HTMLInputElement);
      const next = all.slice(k + 1).find((x) => !x.value) ?? all[k + 1];
      if (next) next.focus(); else ref.current?.blur();
    }
  };

  return (
    <label className={`dtile din ${cls}`} title={!locked && !canEdit ? 'Entered by the operator' : undefined}>
      <span className="dt-top">
        <small>{d.grp.split(',')[0]}</small>
        {v != null && !locked && <span className="dt-ok" aria-hidden="true">✓</span>}
      </span>
      <b>{d.t}</b>
      <input
        ref={ref}
        className="dvin"
        type="text"
        inputMode="decimal"
        enterKeyHint="next"
        autoComplete="off"
        disabled={disabled}
        tabIndex={disabled ? -1 : undefined}
        value={locked ? '' : text}
        placeholder={locked ? 'Locked' : canEdit ? 'Enter reading' : 'Not entered by the operator'}
        aria-label={`${d.t}, item ${item + 1}`}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(fmt(v)); }}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const all = [...document.querySelectorAll<HTMLInputElement>('.dvin:not(:disabled)')];
            const k = all.indexOf(e.currentTarget);
            if (all[k + 1]) all[k + 1].focus(); else e.currentTarget.blur();
          }
        }}
      />
      <span className="dl2">
        Min {d.min != null ? d.min.toFixed(2) : '—'} · Max {d.max != null ? d.max.toFixed(2) : '—'}
        {!canEdit && !locked && ' · by the operator'}
      </span>
    </label>
  );
};

/** Supervisor pass/fail checks of a sample item (shown with the spot check dimensions). */
const SampleChecks: React.FC<{ ws: Workspace; c: SupervisorController; lot: Lot; i: number }> = ({ ws, c, lot: L, i }) => (
  <div className="fgrid" style={{ marginTop: 14 }}>
    {sampleChecks(ws, L, i).map((x) => {
      const cv = checkValue(L, x, i);
      return (
        <div key={x.id} className={`fcard yn ${cv === 'NG' ? 'bad' : cv === 'OK' ? 'good' : ''}`}>
          <span className="fb"><b>{x.t}</b><span>{x.desc}</span>{x.method && <small>{x.method}</small>}</span>
          <span className="ynb ynb2">
            <button className={`yb ${cv === 'OK' ? 'on' : ''}`} aria-pressed={cv === 'OK'} aria-label={`${x.t}: good`} onClick={() => c.svcheck(i, x.id, 'OK')}>✓</button>
            <button className={`nb2 ${cv === 'NG' ? 'on' : ''}`} aria-pressed={cv === 'NG'} aria-label={`${x.t}: bad`} onClick={() => c.svcheck(i, x.id, 'NG')}>✕</button>
          </span>
        </div>
      );
    })}
  </div>
);
