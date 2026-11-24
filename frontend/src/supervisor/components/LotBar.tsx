import React from 'react';
import type { Lot } from '../data';
import { protoTime, shortName, shortTime } from '../logic/format';

/** Prototype svLotBar(L) */
export const LotBar: React.FC<{ lot: Lot; onBack: () => void }> = ({ lot: L, onBack }) => (
  <div className="lotbar">
    <div className="lb-f"><button className="linkbtn lb-backlink" onClick={onBack}>‹ Lots</button></div>
    <div className="lb-code">
      <span className="lb-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </span>
      <div><small>Lot barcode</small><b className="mono">{L.code}</b></div>
    </div>
    <div className="lb-f"><small>Operator</small><b>{L.op?.by ? shortName(L.op.by.name) : '—'}</b></div>
    <div className="lb-f"><small>Items</small><b>{L.qty}</b></div>
    <div className="lb-f wide"><small>Operator clearance</small><b>{L.clearance ? L.clearance.d : '—'}</b></div>
    <div className="lb-f"><small>Submitted</small><b>{L.op ? shortTime(protoTime(L.op.at)) : '—'}</b></div>
  </div>
);
