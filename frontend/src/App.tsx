import React, { useState, useEffect, useRef } from 'react';
import { User, InspectionBatch } from './types';
import { getCurrentStoredUser, logoutUser, fetchBatches, fetchProgressDashboard, openBatchWorkflow, fetchPendingScan, onAuthError } from './api';
import { onBatchCreated, onBatchUpdated, onSheetUpdated, onScanResolved, onScanNotFound, liveSync } from './liveSync';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { UniversalScanBar } from './components/UniversalScanBar';
import { BatchSidebar } from './components/BatchSidebar';
import { LoginPage } from './pages/LoginPage';
import { ChecksheetView } from './pages/ChecksheetView';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminSheetBuilder } from './pages/AdminSheetBuilder';
import { AdminUserManagement } from './pages/AdminUserManagement';
import { AuditLogsView } from './pages/AuditLogsView';
import { MobileScannerPage } from './pages/MobileScannerPage';
import { ProfilePage } from './pages/ProfilePage';
import { SupervisorDashboard } from './pages/SupervisorDashboard';
import { CreateBatchModal } from './components/CreateBatchModal';
import { PanelLeft } from 'lucide-react';

const isMobileDevice = () =>
  typeof window !== 'undefined' && window.innerWidth < 768 &&
  /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(getCurrentStoredUser());
  const [activeTab, setActiveTab] = useState<string>('sheet');
  const [currentBatchId, setCurrentBatchId] = useState<number | null>(null);
  const [batches, setBatches] = useState<InspectionBatch[]>([]);
  const [progressSummary, setProgressSummary] = useState<any>(null);
  const [pendingScan, setPendingScan] = useState<any | null>(null);
  const [isCreateBatchOpen, setIsCreateBatchOpen] = useState<boolean>(false);
  const [createBatchCode, setCreateBatchCode] = useState<string>('');
  const [createBatchSheetId, setCreateBatchSheetId] = useState<string>('');
  const [createBatchLinkBarcode, setCreateBatchLinkBarcode] = useState<string>('');
  const [builderSheetId, setBuilderSheetId] = useState<string | null>(null);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [batchPanelOpen, setBatchPanelOpen] = useState<boolean>(true);
  const currentBatchIdRef = useRef<number | null>(currentBatchId);
  useEffect(() => { currentBatchIdRef.current = currentBatchId; }, [currentBatchId]);

  const handleOpenCreateBatch = (code = '', sheetId = '', linkBarcode = '') => {
    setCreateBatchCode(code);
    setCreateBatchSheetId(sheetId);
    setCreateBatchLinkBarcode(linkBarcode);
    setIsCreateBatchOpen(true);
  };

  const handleBatchCreatedFromModal = (newBatchId: number) => {
    setCurrentBatchId(newBatchId);
    setActiveTab('sheet');
    loadBatches();
  };

  // Global 401 handler — log out automatically when token expires or is revoked
  useEffect(() => {
    return onAuthError(() => {
      setCurrentUser(null);
    });
  }, []);

  useEffect(() => {
    if (currentUser) loadBatches();

    const unsub1 = onBatchCreated(() => loadBatches());
    const unsub2 = onBatchUpdated(() => loadBatches());
    const unsub3 = onSheetUpdated(() => loadBatches());

    const unsub4 = onScanResolved(async (data) => {
      if (!currentUser) return;
      if (data.user_id !== currentUser.user_id) return;
      try { await openBatchWorkflow(data.batch_id); } catch { /* already open */ }
      setCurrentBatchId(data.batch_id);
      setActiveTab('sheet');
      loadBatches();
    });

    const unsub5 = onScanNotFound((data) => {
      if (!currentUser) return;
      if (data.user_id !== currentUser.user_id) return;
      if (currentUser.role !== 'admin') return;
      handleOpenCreateBatch(data.raw_code, '', data.raw_code);
    });

    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || isMobileDevice()) return;
    const interval = setInterval(async () => {
      try {
        const scan = await fetchPendingScan();
        if (!scan) return;
        if (scan.type === 'SCAN_RESOLVED') {
          setPendingScan(scan);
        } else if (scan.type === 'SCAN_NOT_FOUND' && currentUser.role === 'admin') {
          handleOpenCreateBatch(scan.raw_code, '', scan.raw_code);
        }
      } catch { /* silently ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [currentUser]);

  const loadBatches = async () => {
    try {
      const bList = await fetchBatches();
      setBatches(bList);
      if (bList.length > 0 && !currentBatchIdRef.current) setCurrentBatchId(bList[0].batch_id);
      if (currentUser?.role === 'admin') {
        const prog = await fetchProgressDashboard();
        setProgressSummary(prog?.summary || null);
      }
    } catch (err) {
      console.warn('Failed to load batch list:', err);
    }
  };

  const handleLogout = () => {
    logoutUser();
    setCurrentUser(null);
  };

  const handleSelectBatchByCode = (batchCode: string) => {
    const found = batches.find(b => b.lot_number === batchCode || b.lot_number === `TAA-${batchCode}`);
    if (found) {
      setCurrentBatchId(found.batch_id);
      setActiveTab('sheet');
    }
  };

  if (!currentUser) return <LoginPage onLoginSuccess={u => {
  setActiveTab(u.role === 'supervisor' ? 'sup-dashboard' : 'sheet');
  setCurrentUser(u);
  liveSync.reconnect();
}} />;

  if (isMobileDevice()) {
    return <MobileScannerPage currentUser={currentUser} onLogout={() => setCurrentUser(null)} />;
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      {/* ── Left nav sidebar ──────────────────────────────────────── */}
      <Sidebar
        user={currentUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLogout={handleLogout}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      {/* ── Right column: topbar + content ────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Slim topbar */}
        <Header
          user={currentUser}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onSelectBatchByCode={handleSelectBatchByCode}
          onToggleSidebar={() => setMobileSidebarOpen(o => !o)}
        />

        {/* ── Scrollable main content ──────────────────────────────── */}
        <main className="flex-1 overflow-auto">

          {/* Inspection tab: scan bar + 2-column layout (batch queue | checksheet) */}
          {activeTab === 'sheet' && (
            <div className="flex flex-col h-full">
              {/* Scan bar — only on inspection tab */}
              <div className="px-3 py-2 shrink-0 flex items-center gap-2" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
                <button
                  type="button"
                  onClick={() => setBatchPanelOpen(o => !o)}
                  className="p-2 rounded-lg shrink-0 transition-colors"
                  style={{
                    color: batchPanelOpen ? 'var(--primary)' : 'var(--muted)',
                    background: batchPanelOpen ? 'var(--accent-soft)' : 'var(--surface2)',
                    border: '1px solid var(--line)',
                  }}
                  title={batchPanelOpen ? 'Hide batch queue' : 'Show batch queue'}
                >
                  <PanelLeft className="w-4 h-4" />
                </button>
                <div className="flex-1 min-w-0">
                  <UniversalScanBar
                    currentUser={currentUser}
                    onBatchResolved={(bId) => {
                      setCurrentBatchId(bId);
                      setActiveTab('sheet');
                      loadBatches();
                    }}
                    onTemplateResolved={(sheetId) => {
                      if (currentUser.role === 'admin') handleOpenCreateBatch('', sheetId);
                      else setActiveTab('builder');
                    }}
                    onRequestCreateBatch={handleOpenCreateBatch}
                  />
                </div>
              </div>
            <div className="flex flex-1 min-h-0">
              {/* Batch queue panel — collapsible */}
              <div
                className={`batch-panel${batchPanelOpen ? ' open' : ' closed'}`}
                style={{ background: 'var(--surface)', borderRight: batchPanelOpen ? '1px solid var(--line)' : 'none' }}
              >
                <BatchSidebar
                  batches={batches}
                  selectedBatchId={currentBatchId}
                  currentUser={currentUser}
                  onSelectBatch={async (bId) => {
                    setCurrentBatchId(bId);
                    if (currentUser.role !== 'admin') {
                      try { await openBatchWorkflow(bId); } catch {}
                      loadBatches();
                    }
                  }}
                  onBatchDeleted={(bId) => {
                    if (currentBatchId === bId) setCurrentBatchId(null);
                    loadBatches();
                  }}
                  onCreateBatch={() => handleOpenCreateBatch()}
                  onSearch={async (query) => {
                    try { setBatches(await fetchBatches(query || undefined)); } catch {}
                  }}
                  progressSummary={progressSummary}
                />
              </div>

              {/* Checksheet panel */}
              <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6">
                {currentBatchId ? (
                  <ChecksheetView
                    batchId={currentBatchId}
                    currentUser={currentUser}
                    onBatchUpdated={loadBatches}
                    onEditTemplate={currentUser.role === 'admin' ? (sheetId) => {
                      setBuilderSheetId(sheetId);
                      setActiveTab('builder');
                    } : undefined}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 rounded-xl"
                    style={{ border: '2px dashed var(--line2)', background: 'var(--surface)' }}>
                    <svg className="w-10 h-10 mb-3" style={{ color: 'var(--line2)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>No batch selected</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Scan a barcode or pick a batch from the queue</p>
                  </div>
                )}
              </div>
            </div>
            </div>
          )}

          {activeTab === 'dashboard' && currentUser.role === 'admin' && (
            <div className="p-4 md:p-6">
              <AdminDashboard
                onSelectBatch={(bId) => {
                  setCurrentBatchId(bId);
                  setActiveTab('sheet');
                }}
              />
            </div>
          )}

          {activeTab === 'builder' && currentUser.role === 'admin' && (
            <div className="p-4 md:p-6">
              <AdminSheetBuilder jumpToSheetId={builderSheetId} />
            </div>
          )}

          {activeTab === 'users' && currentUser.role === 'admin' && (
            <div className="p-4 md:p-6">
              <AdminUserManagement />
            </div>
          )}

          {activeTab === 'audit' && currentUser.role === 'admin' && (
            <div className="p-4 md:p-6">
              <AuditLogsView />
            </div>
          )}

          {activeTab === 'sup-dashboard' && currentUser.role === 'supervisor' && (
            <div className="p-4 md:p-6">
              <SupervisorDashboard
                currentUser={currentUser}
                onGoToReviews={() => setActiveTab('sheet')}
              />
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="p-4 md:p-6">
              <ProfilePage currentUser={currentUser} />
            </div>
          )}
        </main>
      </div>

      {/* ── Phone scan popup ─────────────────────────────────────── */}
      {pendingScan?.type === 'SCAN_RESOLVED' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center mx-4" style={{ background: 'rgba(27,37,51,0.4)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-sm overflow-hidden shadow-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>
            <div className="p-5 flex items-center gap-3" style={{ background: 'var(--ok-bg)', borderBottom: '1px solid #b2dcc5' }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--ok-bg)', border: '2px solid #b2dcc5' }}>
                <svg className="w-5 h-5" style={{ color: 'var(--ok)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold" style={{ color: 'var(--ok)' }}>Scanned from phone</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--ok)' }}>Open this sheet on the laptop?</p>
              </div>
            </div>
            <div className="p-5 space-y-2">
              {[
                ['Lot Number', pendingScan.lot_number],
                ['Sheet', pendingScan.sheet_id],
                ['Batch #', pendingScan.batch_id],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between text-sm">
                  <span style={{ color: 'var(--muted)' }}>{label}</span>
                  <span className="font-semibold" style={{ color: 'var(--ink)' }}>{val}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button
                onClick={() => setPendingScan(null)}
                className="flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors"
                style={{ background: 'var(--surface2)', color: 'var(--ink)' }}
              >
                Dismiss
              </button>
              <button
                onClick={async () => {
                  const scan = pendingScan;
                  setPendingScan(null);
                  try { await openBatchWorkflow(scan.batch_id); } catch {}
                  setCurrentBatchId(scan.batch_id);
                  setActiveTab('sheet');
                  loadBatches();
                }}
                className="flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors"
                style={{ background: 'var(--ok)', color: '#fff' }}
              >
                Open Sheet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Batch Modal ───────────────────────────────────── */}
      <CreateBatchModal
        isOpen={isCreateBatchOpen}
        initialCode={createBatchCode}
        initialSheetId={createBatchSheetId}
        linkBarcode={createBatchLinkBarcode}
        onClose={() => setIsCreateBatchOpen(false)}
        onBatchCreated={handleBatchCreatedFromModal}
      />
    </div>
  );
};

export default App;
