import React, { useState, useEffect } from 'react';
import { User, QRResolveResult } from './types';
import { getCurrentStoredUser, logoutUser, fetchBatches } from './api';
import { Header } from './components/Header';
import { LoginPage } from './pages/LoginPage';
import { ChecksheetView } from './pages/ChecksheetView';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminSheetBuilder } from './pages/AdminSheetBuilder';
import { AdminUserManagement } from './pages/AdminUserManagement';
import { AuditLogsView } from './pages/AuditLogsView';
import { TFTScannerModal } from './components/TFTScannerModal';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(getCurrentStoredUser());
  const [activeTab, setActiveTab] = useState<string>('sheet');
  const [currentBatchId, setCurrentBatchId] = useState<number>(1);
  const [isScannerModalOpen, setIsScannerModalOpen] = useState<boolean>(false);

  useEffect(() => {
    if (currentUser) {
      loadInitialBatch();
    }
  }, [currentUser]);

  const loadInitialBatch = async () => {
    try {
      const batches = await fetchBatches();
      if (batches.length > 0) {
        setCurrentBatchId(batches[0].batch_id);
      }
    } catch {
      // ignore
    }
  };

  const handleLogout = () => {
    logoutUser();
    setCurrentUser(null);
  };

  const handleQRResolved = (result: QRResolveResult) => {
    if (result.batch_id) {
      setCurrentBatchId(result.batch_id);
      setActiveTab('sheet');
    } else if (result.type === 'TEMPLATE') {
      setActiveTab('builder');
    }
  };

  if (!currentUser) {
    return <LoginPage onLoginSuccess={(u) => setCurrentUser(u)} />;
  }

  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <Header
        user={currentUser}
        onLogout={handleLogout}
        onOpenScanner={() => setIsScannerModalOpen(true)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {/* Main Workspace Canvas */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">
        {activeTab === 'sheet' && (
          <ChecksheetView
            batchId={currentBatchId}
            currentUser={currentUser}
            onBatchUpdated={loadInitialBatch}
          />
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

      {/* Global TFT Barcode & QR Scanner Modal */}
      <TFTScannerModal
        isOpen={isScannerModalOpen}
        onClose={() => setIsScannerModalOpen(false)}
        onResolved={handleQRResolved}
      />
    </div>
  );
};
export default App;
