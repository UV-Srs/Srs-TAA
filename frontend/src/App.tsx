import React, { useState, useEffect, useCallback } from 'react';
import { User, InspectionBatch, QRResolveResult } from './types';
import { getCurrentStoredUser, logoutUser, fetchBatches, fetchProgressDashboard } from './api';
import { onBatchCreated, onBatchUpdated, onSheetUpdated } from './liveSync';
import { Header } from './components/Header';
import { UniversalScanBar } from './components/UniversalScanBar';
import { BatchSidebar } from './components/BatchSidebar';
import { LoginPage } from './pages/LoginPage';
import { ChecksheetView } from './pages/ChecksheetView';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminSheetBuilder } from './pages/AdminSheetBuilder';
import { AdminUserManagement } from './pages/AdminUserManagement';
import { AuditLogsView } from './pages/AuditLogsView';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(getCurrentStoredUser());
  const [activeTab, setActiveTab] = useState<string>('sheet');
  const [currentBatchId, setCurrentBatchId] = useState<number | null>(null);
  const [batches, setBatches] = useState<InspectionBatch[]>([]);
  const [progressSummary, setProgressSummary] = useState<any>(null);

  useEffect(() => {
    if (currentUser) {
      loadBatches();
    }

    // Real-Time Live Sync: Automatically refresh batches and progress when any change occurs
    const unsub1 = onBatchCreated(() => {
      loadBatches();
    });
    const unsub2 = onBatchUpdated(() => {
      loadBatches();
    });
    const unsub3 = onSheetUpdated(() => {
      loadBatches();
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [currentUser]);

  const loadBatches = async () => {
    try {
      const bList = await fetchBatches();
      setBatches(bList);
      if (bList.length > 0 && !currentBatchId) {
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
    logoutUser();
    setCurrentUser(null);
  };

  const handleSelectBatchByCode = (batchCode: string) => {
    const found = batches.find((b) => b.lot_number === batchCode || b.lot_number === `TAA-${batchCode}`);
    if (found) {
      setCurrentBatchId(found.batch_id);
      setActiveTab('sheet');
    }
  };

  if (!currentUser) {
    return <LoginPage onLoginSuccess={(u) => setCurrentUser(u)} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Universal Top Header with Role Switcher & In-App Notification Bell */}
      <Header
        user={currentUser}
        onLogout={handleLogout}
        onOpenScanner={() => {}}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onSelectBatchByCode={handleSelectBatchByCode}
        onUserSwitched={(newUser) => {
          setCurrentUser(newUser);
          loadBatches();
        }}
      />

      {/* Universal Scan Adapter & Device Simulator Bar (FR-017, FR-018, FR-019) */}
      <UniversalScanBar
        currentUser={currentUser}
        onBatchResolved={(bId) => {
          setCurrentBatchId(bId);
          setActiveTab('sheet');
          loadBatches();
        }}
        onTemplateResolved={() => {
          setActiveTab('builder');
        }}
      />

      {/* Main Workspace Canvas */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 md:p-6">
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
                <div className="p-8 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl bg-white">
                  No batch selected. Scan a code or pick one from the queue.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'dashboard' && currentUser.role === 'admin' && (
          <AdminDashboard
            onSelectBatch={(bId) => {
              setCurrentBatchId(bId);
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
  );
};

export default App;
