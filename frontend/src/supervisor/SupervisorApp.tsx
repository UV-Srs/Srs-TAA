import React, { useLayoutEffect, useRef, useState } from 'react';
import type { User } from '../types';
import { Header } from '../components/Header';
import { useSupervisorController } from './hooks/useSupervisorController';
import { REVIEWABLE_STATUSES, supLots } from './logic/rules';
import { DashboardScreen } from './screens/DashboardScreen';
import { LotsScreen } from './screens/LotsScreen';
import { ReportScreen } from './screens/ReportScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { ScanScreen } from './screens/ScanScreen';
import './supervisor.css';
import './supervisor-additions.css';

interface SupervisorAppProps {
  currentUser: User;
  onLogout: () => void;
}

/**
 * Supervisor app: our existing Header (unchanged) above the prototype's supervisor shell
 * (renderSupervisor): left nav Dashboard / Scan / Lots and the current screen.
 */
export const SupervisorApp: React.FC<SupervisorAppProps> = ({ currentUser, onLogout }) => {
  const c = useSupervisorController();
  const headerRef = useRef<HTMLDivElement>(null);
  const [hdr, setHdr] = useState(74);

  // Prototype render(): --hdr = header height, used by the .svshell / .opshell heights.
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHdr(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Header notification click: open that lot like a row in the Lots list.
  const openByCode = (code: string) => {
    const lot = c.ws?.lots.find((l) => l.code === code);
    if (lot) void c.openFromList(lot);
  };

  const nWaiting = c.ws ? supLots(c.ws.lots).length : 0;
  const v = c.svView;
  const L = c.supLot;
  const lotReviewable = !!L && REVIEWABLE_STATUSES.includes(L.status);

  let body: React.ReactNode;
  if (v === 'scan') {
    // Needs no preloaded data: each scan looks the code up in fresh data.
    body = <ScanScreen onScan={c.scan} />;
  } else if (!c.ws) {
    body = c.loadError
      ? <section className="empty"><h2>Couldn’t load lots</h2><p className="sub">{c.loadError}</p><button className="btn" onClick={() => void c.reload()}>Try again</button></section>
      : <section className="empty"><p className="sub">Loading…</p></section>;
  } else if (v === 'review' && L && lotReviewable) {
    body = <ReviewScreen ws={c.ws} c={c} lot={L} />;
  } else if (v === 'preview' && L && lotReviewable) {
    body = <ReportScreen ws={c.ws} c={c} lot={L} readOnly={false} />;
  } else if (v === 'saved' && L && L.status === 'completed') {
    body = <ReportScreen ws={c.ws} c={c} lot={L} readOnly />;
  } else if (v === 'dash') {
    body = <DashboardScreen ws={c.ws} onGo={c.svgo} />;
  } else {
    body = <LotsScreen ws={c.ws} c={c} />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div ref={headerRef}>
        <Header
          user={currentUser}
          onLogout={onLogout}
          activeTab="sheet"
          setActiveTab={() => undefined}
          onSelectBatchByCode={openByCode}
          sidebar="supervisor"
        />
      </div>
      <div className="sv-root" style={{ '--hdr': `${hdr}px` } as React.CSSProperties}>
        <div className="svshell">
          <nav className="svnav2" aria-label="Supervisor">
            <div className="nv-sec">Supervisor</div>
            <button className={v === 'dash' ? 'on' : ''} onClick={() => c.svnav('dash')}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
              <span>Dashboard</span>
            </button>
            <button className={v === 'scan' ? 'on' : ''} onClick={() => c.svnav('scan')}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              <span>Scan</span>
            </button>
            <button className={v !== 'dash' && v !== 'scan' ? 'on' : ''} onClick={() => c.svnav('lots')}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span>Lots</span>
              {nWaiting > 0 && <em className="nb">{nWaiting}</em>}
            </button>
          </nav>
          <div className="svbody">{body}</div>
        </div>
      </div>
    </div>
  );
};
