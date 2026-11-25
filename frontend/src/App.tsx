import React, { useState, useEffect } from 'react';
import { User, InspectionBatch, QRResolveResult } from './types';
import { getCurrentStoredUser, logoutUser, fetchBatches, fetchProgressDashboard, startInspectionFromTemplate, fetchPendingScan, apiRequest } from './api';
import { onBatchCreated, onBatchUpdated, onSheetUpdated, onScanNotFound, liveSync } from './liveSync';
import { guardedNavigate } from './lib/navGuard';
import { Header } from './components/Header';
import { UniversalScanBar } from './components/UniversalScanBar';
import { BatchSidebar } from './components/BatchSidebar';
import { Sidebar } from './components/Sidebar';
import { AdminScanPage } from './pages/AdminScanPage';
import { CreateBatchModal } from './components/CreateBatchModal';
import { LoginPage } from './pages/LoginPage';
import { ChecksheetView } from './pages/ChecksheetView';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminSheetBuilder } from './pages/AdminSheetBuilder';
import { AdminUserManagement } from './pages/AdminUserManagement';
import { AuditLogsView } from './pages/AuditLogsView';
import { MobileScannerPage } from './pages/MobileScannerPage';
import { SupervisorApp } from './supervisor/SupervisorApp';
import { OperatorHome } from './pages/OperatorHome';
import { OperatorInspection } from './pages/OperatorInspection';

function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('sheet');
  const [currentBatchId, setCurrentBatchId] = useState<number | null>(null);
  const [batches, setBatches] = useState<InspectionBatch[]>([]);
  // Phones: operators inspect directly; they can opt into "phone as scanner for a desktop" mode
  const [phoneScannerMode, setPhoneScannerMode] = useState<boolean>(false);
  const [progressSummary, setProgressSummary] = useState<any>(null);
  const [isCreateBatchOpen, setIsCreateBatchOpen] = useState<boolean>(false);
  const [createBatchCode, setCreateBatchCode] = useState<string>('');
  const [createBatchSheetId, setCreateBatchSheetId] = useState<string>('');
  const [createBatchLinkBarcode, setCreateBatchLinkBarcode] = useState<string>('');

  // Verify stored token with backend on startup — prevents stale/expired token from bypassing login
  useEffect(() => {
    const stored = getCurrentStoredUser();
    if (!stored) {
      setAuthChecked(true);
      return;
    }
    apiRequest<User>('/api/auth/me')
      .then((user) => {
        setCurrentUser(user);
      })
      .catch(() => {
        // Token invalid/expired — apiRequest already cleared localStorage
        setCurrentUser(null);
      })
      .finally(() => setAuthChecked(true));
  }, []);
  const handleOpenCreateBatch = (code = '', sheetId = '', linkBarcode = '') => {
    setCreateBatchCode(code);
    setCreateBatchSheetId(sheetId);
    setCreateBatchLinkBarcode(linkBarcode);
    setIsCreateBatchOpen(true);
  };

  const handleBatchCreatedFromModal = (newBatchId: number) => {
    setIsCreateBatchOpen(false);
    setCurrentBatchId(newBatchId);
    setActiveTab('sheet');
    loadBatches();
  };

  useEffect(() => {
    if (!currentUser) return;

    loadBatches();

    // Real-Time Live Sync: Automatically refresh batches and progress when any change occurs
    const unsub1 = onBatchCreated(() => loadBatches());
    const unsub2 = onBatchUpdated(() => loadBatches());
    const unsub3 = onSheetUpdated(() => loadBatches());

    // SCAN_NOT_FOUND: phone scanned an unregistered barcode — open CreateBatchModal on desktop
    const unsub4 = onScanNotFound((data) => {
      if (currentUser.role === 'admin' && !isMobileDevice()) {
        handleOpenCreateBatch(data.raw_code, '', data.raw_code);
      }
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, [currentUser]);

  // Polling fallback: catches SCAN_NOT_FOUND events if WebSocket missed them
  useEffect(() => {
    if (!currentUser || isMobileDevice()) return;
    const interval = setInterval(async () => {
      try {
        const scan = await fetchPendingScan();
        if (!scan) return;
        if (scan.type === 'SCAN_NOT_FOUND' && currentUser.role === 'admin') {
          handleOpenCreateBatch(scan.raw_code, '', scan.raw_code);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [currentUser]);

  const loadBatches = async () => {
    try {
      const bList = await fetchBatches();
      setBatches(bList);
      // Operators start on their home screen, so don't auto-open the first batch for them
      if (bList.length > 0 && !currentBatchId && currentUser?.role !== 'operator') {
        setCurrentBatchId(bList[0].batch_id);
      }

      if (currentUser?.role === 'admin') {
        const prog = await fetchProgressDashboard();
        setProgressSummary(prog?.summary || null);
      }
    } catch (err) {
      console.warn('Failed to load batch list:', err);
    }
  };

  const handleLogout = () => {
    guardedNavigate(() => {
      logoutUser();
      setCurrentUser(null);
    });
  };

  // Every in-app tab change goes through here so a screen with unsaved work can ask first.
  const requestTab = (tab: string) => guardedNavigate(() => setActiveTab(tab));

  const handleSelectBatchByCode = (batchCode: string) => {
    const found = batches.find((b) => b.lot_number === batchCode || b.lot_number === `TAA-${batchCode}`);
    if (found) {
      guardedNavigate(() => {
        setCurrentBatchId(found.batch_id);
        setActiveTab('sheet');
      });
    }
  };

  const handleTemplateResolved = async (sheetId: string) => {
    if (currentUser?.role === 'admin') {
      requestTab('builder');
      return;
    }
    try {
      const { batch_id } = await startInspectionFromTemplate(sheetId);
      await loadBatches();
      setCurrentBatchId(batch_id);
      setActiveTab('sheet');
    } catch (err) {
      console.error('Failed to open checksheet for scanned part:', err);
    }
  };

  const handleOpenBatch = (bId: number) => {
    guardedNavigate(() => {
      setCurrentBatchId(bId);
      setActiveTab('sheet');
      loadBatches();
    });
  };
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-slate-500 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginPage
        onLoginSuccess={(u) => {
          setCurrentUser(u);
          liveSync.reconnect();
        }}
      />
    );
  }

  // Supervisors get their own app (scan → lots → review). Checked before the mobile
  // check so supervisors on tablets (which match isMobileDevice) get it too.
  if (currentUser.role === 'supervisor') {
    return <SupervisorApp currentUser={currentUser} onLogout={handleLogout} />;
  }

  // Mobile phones get a simplified scanning interface
  if (isMobileDevice() && (currentUser.role !== 'operator' || phoneScannerMode)) {
    return (
      <MobileScannerPage
        currentUser={currentUser}
        onLogout={() => { logoutUser(); setCurrentUser(null); }}
        onExitScannerMode={currentUser.role === 'operator' ? () => setPhoneScannerMode(false) : undefined}
      />
    );
  }

  // ---------- Operator layout: home (scan + today + recent lots) <-> checksheet ----------
  if (currentUser.role === 'operator') {
    return (
      <div className="min-h-screen bg-canvas text-slate-900 flex flex-col font-sans">
        <Header
          user={currentUser}
          onLogout={handleLogout}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onSelectBatchByCode={handleSelectBatchByCode}
        />

        {currentBatchId ? (
          <>
            {/* No visible scan bar here (per design), but a hardware scan still opens the next lot */}
            <UniversalScanBar
              variant="listener"
              currentUser={currentUser}
              onBatchResolved={handleOpenBatch}
              onTemplateResolved={handleTemplateResolved}
            />
            <OperatorInspection
              key={currentBatchId}
              batchId={currentBatchId}
              currentUser={currentUser}
              onBack={() => {
                setCurrentBatchId(null);
                loadBatches();
              }}
              onBatchUpdated={loadBatches}
              onSubmitted={() => {
                setCurrentBatchId(null);
                loadBatches();
              }}
            />
          </>
        ) : (
          <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-5 sm:px-6 sm:py-8">
            <OperatorHome
              currentUser={currentUser}
              batches={batches}
              onOpenBatch={handleOpenBatch}
              onTemplateResolved={handleTemplateResolved}
              onUsePhoneAsScanner={isMobileDevice() ? () => setPhoneScannerMode(true) : undefined}
            />
          </main>
        )}
      </div>
    );
  }
  const onHoldCount = batches.filter((b) => (b.status as string) === 'ON_HOLD' || (b.status as string) === 'hold').length;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)] flex flex-col font-sans">
      {/* Top Header */}
      <Header
        user={currentUser}
        onLogout={handleLogout}
        activeTab={activeTab}
        setActiveTab={requestTab}
        onSelectBatchByCode={handleSelectBatchByCode}
      />

      {/* Search / scan lives in the admin Scan tab. On the other tabs a hardware scanner
          (keyboard wedge) still opens the scanned lot, with no visible bar (FR-017 - FR-019). */}
      {!(currentUser.role === 'admin' && activeTab === 'scan') && (
        <UniversalScanBar
          variant={currentUser.role === 'admin' ? 'listener' : 'bar'}
          currentUser={currentUser}
          onBatchResolved={handleOpenBatch}
          onTemplateResolved={handleTemplateResolved}
          onRequestCreateBatch={(code) => handleOpenCreateBatch(code, '', code)}
        />
      )}

      {/* Global Body: Sidebar (220px) + Main Content Area */}
      <div className="flex-1 flex min-h-[calc(100vh-115px)]">
        <Sidebar
          user={currentUser}
          activeTab={activeTab}
          setActiveTab={requestTab}
          onHoldCount={onHoldCount}
        />

        {/* Main Workspace Canvas */}
        <main className="svbody flex-1 min-w-0 p-3 sm:p-5 lg:p-6 w-full max-w-[1400px]">
          {activeTab === 'sheet' && (
            <div className="flex flex-col lg:flex-row gap-5 items-start">
              {/* Left Queue Sidebar (Ready for inspection / Awaiting review / All batches + Progress) */}
              <BatchSidebar
                batches={batches}
                selectedBatchId={currentBatchId}
                currentUser={currentUser}
                onSelectBatch={(bId) => setCurrentBatchId(bId)}
                progressSummary={progressSummary}
              />

              {/* Right Main Checksheet Matrix & Approval Ledger */}
              <div className="flex-1 min-w-0 w-full">
                {currentBatchId ? (
                  <ChecksheetView
                    batchId={currentBatchId}
                    currentUser={currentUser}
                    onBatchUpdated={loadBatches}
                  />
                ) : (
                  <div className="p-8 text-center text-[var(--muted)] border border-dashed border-[var(--line)] rounded-2xl bg-[var(--surface)]">
                    No batch selected. Scan a code or pick one from the queue.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'scan' && currentUser.role === 'admin' && (
            <AdminScanPage
              onBatchResolved={handleOpenBatch}
              onTemplateResolved={handleTemplateResolved}
              onUnregistered={(code) => handleOpenCreateBatch(code, '', code)}
            />
          )}

          {activeTab === 'dashboard' && currentUser.role === 'admin' && (
            <AdminDashboard
              onSelectBatch={(bId) => {
                setCurrentBatchId(bId);
                setActiveTab('sheet');
              }}
              onFilterLots={() => {
                setActiveTab('sheet');
              }}
            />
          )}

          {activeTab === 'builder' && currentUser.role === 'admin' && (
            <AdminSheetBuilder />
          )}

          {activeTab === 'users' && currentUser.role === 'admin' && (
            <AdminUserManagement />
          )}

          {activeTab === 'audit' && currentUser.role === 'admin' && (
            <AuditLogsView />
          )}
        </main>
      </div>

      {/* Powered by footer */}
      <footer className="flex items-center justify-center gap-2 py-2 border-t border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] text-xs select-none">
        <span>Powered by</span>
        <img src="/srs-logo.png" alt="SRS Consulting" className="h-5 w-5 object-contain" />
        <span className="font-semibold text-[var(--ink)]">SRS Consulting Inc.</span>
      </footer>

      {/* CreateBatchModal — opens when an unregistered barcode is scanned */}
      {isCreateBatchOpen && (
        <CreateBatchModal
          isOpen={isCreateBatchOpen}
          onClose={() => setIsCreateBatchOpen(false)}
          onBatchCreated={handleBatchCreatedFromModal}
          initialCode={createBatchCode}
          initialSheetId={createBatchSheetId}
          linkBarcode={createBatchLinkBarcode}
        />
      )}
    </div>
  );
};

export default App;
