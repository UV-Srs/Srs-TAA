import React, { useEffect, useState } from 'react';
import { User } from '../types';
import { QrCode, Wifi, WifiOff, LogOut, FileText, LayoutDashboard, Users, PlusCircle, ShieldCheck } from 'lucide-react';
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
      // Trigger background sync
      await triggerSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check for pending mutations
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
    <header className="border-b-2 border-black bg-white no-print">
      {/* Top Utility Bar */}
      <div className="bg-black text-white px-4 py-1.5 flex flex-wrap items-center justify-between text-xs font-mono font-medium">
        <div className="flex items-center gap-4">
          <span className="font-bold tracking-wider">TAA QUALITY PLATFORM v2.0</span>
          <span className="text-zinc-400">|</span>
          <span>OPERATING MODE: INDUSTRIAL TFT</span>
        </div>

        <div className="flex items-center gap-4">
          {/* Offline/Online Status Indicator */}
          {isOnline ? (
            <div className="flex items-center gap-1.5 text-zinc-300">
              <Wifi className="w-3.5 h-3.5 text-white" />
              <span>ONLINE (WI-FI CONNECTED)</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-white text-black px-2 py-0.5 font-bold tracking-wide animate-pulse">
              <WifiOff className="w-3.5 h-3.5 text-black" />
              <span>OFFLINE — SAVED LOCALLY</span>
            </div>
          )}

          {pendingSyncCount > 0 && (
            <span className="bg-zinc-800 text-white px-2 py-0.5 border border-zinc-600">
              {isSyncing ? 'SYNCING...' : `QUEUED: ${pendingSyncCount}`}
            </span>
          )}

          <span className="text-zinc-400">|</span>
          <span>{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        </div>
      </div>

      {/* Main Navigation Bar */}
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="bg-black text-white font-extrabold text-xl px-2.5 py-1 tracking-tighter">
            TAA
          </div>
          <div>
            <h1 className="font-extrabold text-base tracking-tight leading-none text-black">
              INSPECTION MANAGEMENT SYSTEM
            </h1>
            <p className="text-xs text-zinc-600 font-medium">IFM Checksheet & Batch Quality Platform</p>
          </div>
        </div>

        {/* Navigation Tabs based on role */}
        <div className="flex items-center gap-1 bg-zinc-100 p-1 border border-black">
          <button
            onClick={() => setActiveTab('sheet')}
            className={`px-3 py-1.5 text-xs font-bold uppercase transition-colors flex items-center gap-1.5 ${
              activeTab === 'sheet'
                ? 'bg-black text-white'
                : 'text-black hover:bg-zinc-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Checksheet
          </button>

          {user.role === 'admin' && (
            <>
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`px-3 py-1.5 text-xs font-bold uppercase transition-colors flex items-center gap-1.5 ${
                  activeTab === 'dashboard'
                    ? 'bg-black text-white'
                    : 'text-black hover:bg-zinc-200'
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                Progress Dashboard
              </button>

              <button
                onClick={() => setActiveTab('builder')}
                className={`px-3 py-1.5 text-xs font-bold uppercase transition-colors flex items-center gap-1.5 ${
                  activeTab === 'builder'
                    ? 'bg-black text-white'
                    : 'text-black hover:bg-zinc-200'
                }`}
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Sheet Builder
              </button>

              <button
                onClick={() => setActiveTab('users')}
                className={`px-3 py-1.5 text-xs font-bold uppercase transition-colors flex items-center gap-1.5 ${
                  activeTab === 'users'
                    ? 'bg-black text-white'
                    : 'text-black hover:bg-zinc-200'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                Users & Access
              </button>

              <button
                onClick={() => setActiveTab('audit')}
                className={`px-3 py-1.5 text-xs font-bold uppercase transition-colors flex items-center gap-1.5 ${
                  activeTab === 'audit'
                    ? 'bg-black text-white'
                    : 'text-black hover:bg-zinc-200'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Audit Logs
              </button>
            </>
          )}
        </div>

        {/* User Info & Actions */}
        <div className="flex items-center gap-3">
          {/* Quick TFT Scan Button */}
          <button
            onClick={onOpenScanner}
            className="bg-black hover:bg-zinc-800 text-white font-bold text-xs px-3 py-2 flex items-center gap-1.5 uppercase transition-colors shadow-sm"
            title="Scan QR / Barcode via TFT Scanner or Camera"
          >
            <QrCode className="w-4 h-4" />
            <span>TFT Scan</span>
          </button>

          {/* User Profile Badge */}
          <div className="border border-black px-2.5 py-1 text-right">
            <div className="text-xs font-bold text-black uppercase tracking-wide leading-tight">
              {user.full_name}
            </div>
            <div className="text-[10px] font-mono text-zinc-600 uppercase font-bold">
              ROLE: <span className="bg-black text-white px-1 py-0.2">{user.role}</span>
            </div>
          </div>

          {/* Logout */}
          <button
            onClick={onLogout}
            className="p-2 border border-black hover:bg-zinc-100 text-black transition-colors"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
