import React, { useEffect, useState } from 'react';
import { User } from '../types';
import { QrCode, LogOut, FileText, LayoutDashboard, Users, PlusCircle, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { getQueuedMutations, removeQueuedMutations } from '../db';
import { syncOfflineQueue } from '../api';

interface HeaderProps {
  user: User | null;
  onLogout: () => void;
  onOpenScanner: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  onLogout,
  onOpenScanner,
  activeTab,
  setActiveTab,
}) => {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      await triggerSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    checkPendingQueue();
    const interval = setInterval(checkPendingQueue, 5000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const checkPendingQueue = async () => {
    try {
      const queued = await getQueuedMutations();
      setPendingSyncCount(queued.length);
      if (navigator.onLine && queued.length > 0 && !isSyncing) {
        await triggerSync();
      }
    } catch {
      // ignore
    }
  };

  const triggerSync = async () => {
    try {
      setIsSyncing(true);
      const queued = await getQueuedMutations();
      if (queued.length > 0) {
        const res = await syncOfflineQueue(queued);
        if (res.success) {
          const ids = queued.map((m) => m.client_mutation_id);
          await removeQueuedMutations(ids);
          setPendingSyncCount(0);
        }
      }
    } catch (err) {
      console.error('Background sync failed:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  if (!user) return null;

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="bg-slate-900 text-white font-bold text-sm px-2.5 py-1 rounded-md tracking-wider">
            TAA
          </div>
          <div>
            <h1 className="font-bold text-sm text-slate-900 tracking-tight leading-none">
              Inspection System
            </h1>
            <p className="text-[11px] text-slate-500 font-medium">IFM Quality Checksheet</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-lg border border-slate-200 text-xs font-medium">
          <button
            onClick={() => setActiveTab('sheet')}
            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
              activeTab === 'sheet'
                ? 'bg-white text-slate-900 shadow-sm font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Checksheet
          </button>

          {user.role === 'admin' && (
            <>
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                  activeTab === 'dashboard'
                    ? 'bg-white text-slate-900 shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                Dashboard
              </button>

              <button
                onClick={() => setActiveTab('builder')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                  activeTab === 'builder'
                    ? 'bg-white text-slate-900 shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Sheet Builder
              </button>

              <button
                onClick={() => setActiveTab('users')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                  activeTab === 'users'
                    ? 'bg-white text-slate-900 shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                Users
              </button>

              <button
                onClick={() => setActiveTab('audit')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                  activeTab === 'audit'
                    ? 'bg-white text-slate-900 shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Audit Logs
              </button>
            </>
          )}
        </nav>

        {/* Right Section: Status, Scan, User, Logout */}
        <div className="flex items-center gap-3">
          {/* Online/Offline status badge */}
          {isOnline ? (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Online</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-800 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-300">
              <WifiOff className="w-3 h-3 text-amber-600" />
              <span>Offline (Saved)</span>
            </div>
          )}

          {pendingSyncCount > 0 && (
            <span className="text-[10px] bg-slate-800 text-white font-mono px-2 py-0.5 rounded">
              Sync ({pendingSyncCount})
            </span>
          )}

          {/* Quick TFT Scan */}
          <button
            onClick={onOpenScanner}
            className="bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Scan QR</span>
          </button>

          {/* User profile */}
          <div className="text-right">
            <div className="text-xs font-semibold text-slate-800 leading-tight">
              {user.full_name}
            </div>
            <div className="text-[10px] text-slate-500 capitalize font-medium">
              {user.role}
            </div>
          </div>

          {/* Logout */}
          <button
            onClick={onLogout}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
