import React, { useEffect, useState, useRef } from 'react';
import { User, InAppNotification } from '../types';
import {
  Bell, FileText, LayoutDashboard, Users, PlusCircle,
  ShieldCheck, WifiOff, LogOut, ChevronDown, Check, UserCircle2
} from 'lucide-react';
import { getQueuedMutations, removeQueuedMutations } from '../db';
import { syncOfflineQueue, fetchNotifications, markNotificationsRead, loginUser } from '../api';
import { onNotificationDispatched } from '../liveSync';

interface HeaderProps {
  user: User | null;
  onLogout: () => void;
  onOpenScanner?: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onSelectBatchByCode?: (batchCode: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  onLogout,
  activeTab,
  setActiveTab,
  onSelectBatchByCode,
}) => {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState<boolean>(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState<boolean>(false);

  const notifRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);

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
    loadNotifs();

    const unsubNotif = onNotificationDispatched(() => {
      loadNotifs();
    });

    const notifInterval = setInterval(loadNotifs, 10000);
    const syncInterval = setInterval(checkPendingQueue, 6000);

    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      unsubNotif();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('mousedown', handleClickOutside);
      clearInterval(notifInterval);
      clearInterval(syncInterval);
    };
  }, [user]);

  const loadNotifs = async () => {
    if (!user) return;
    try {
      const data = await fetchNotifications();
      setNotifications(data);
    } catch {
      // offline fallback
    }
  };

  const checkPendingQueue = async () => {
    try {
      const queued = await getQueuedMutations();
      setPendingSyncCount(queued.length);
      if (queued.length > 0 && navigator.onLine && !isSyncing) {
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
      console.warn('Sync notice:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {}
  };

  const handleNotificationClick = async (notif: InAppNotification) => {
    try {
      await markNotificationsRead(notif.notification_id);
      setNotifications((prev) =>
        prev.map((n) => (n.notification_id === notif.notification_id ? { ...n, is_read: true } : n))
      );
      setIsNotifOpen(false);

      if (notif.batch_code && onSelectBatchByCode) {
        onSelectBatchByCode(notif.batch_code);
        setActiveTab('sheet');
      }
    } catch {}
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  if (!user) return null;

  const navTabs = [
    { id: 'sheet', label: 'Inspection', icon: FileText },
    ...(user.role === 'admin'
      ? [
          { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
          { id: 'builder', label: 'Templates', icon: PlusCircle },
          { id: 'users', label: 'Users', icon: Users },
          { id: 'audit', label: 'Audit', icon: ShieldCheck },
        ]
      : []),
  ];

  const renderTab = (tab: (typeof navTabs)[number]) => {
    const Icon = tab.icon;
    return (
      <button
        key={tab.id}
        type="button"
        onClick={() => setActiveTab(tab.id)}
        className={`px-3 py-2 lg:py-1.5 rounded-lg transition-all flex items-center gap-1.5 font-medium whitespace-nowrap shrink-0 ${
          activeTab === tab.id
            ? 'bg-white text-slate-900 shadow-2xs font-semibold'
            : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        <Icon className="w-3.5 h-3.5" />
        <span>{tab.label}</span>
      </button>
    );
  };

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 no-print select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-4">
        {/* Left: Brand & Main Navigation */}
        <div className="flex items-center gap-6 min-w-0">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-brand text-white flex items-center justify-center font-semibold text-sm">
              LS
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-semibold text-slate-900 leading-tight">LotSure</h1>
              <span className="text-xs sm:text-sm text-slate-500 hidden sm:block">Lot inspection made simple</span>
            </div>
          </div>

          {/* Desktop Navigation Tabs (lg+). Below lg the tabs move to a second row. */}
          {navTabs.length > 1 && (
            <nav className="hidden lg:flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs">
              {navTabs.map(renderTab)}
            </nav>
          )}
        </div>

        {/* Right: Actions, Notifications, & User Profile */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Offline Sync Status */}
          {(!isOnline || pendingSyncCount > 0) && (
            <div
              className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-xs font-medium"
              title={pendingSyncCount > 0 ? `${pendingSyncCount} pending sync` : 'Offline'}
            >
              <WifiOff className="w-3.5 h-3.5 text-amber-600" />
              <span className="hidden sm:inline">{pendingSyncCount > 0 ? `${pendingSyncCount} pending sync` : 'Offline'}</span>
            </div>
          )}

          {/* Notifications Bell */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setIsNotifOpen(!isNotifOpen)}
              className="relative p-2.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
              title="Notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-600 rounded-full animate-pulse ring-2 ring-white"></span>
              )}
            </button>

            {isNotifOpen && (
              <div className="fixed left-4 right-4 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden text-xs">
                <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="bg-red-100 text-red-700 font-bold px-1.5 py-0.2 rounded-full text-[10px]">
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="text-[11px] text-slate-500 hover:text-slate-900 font-medium"
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-slate-400">
                      No notifications yet.
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.notification_id}
                        type="button"
                        onClick={() => handleNotificationClick(n)}
                        className={`w-full text-left p-3 hover:bg-slate-50 transition-colors flex items-start gap-2.5 ${
                          !n.is_read ? 'bg-slate-50/80 font-medium' : 'text-slate-600'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${!n.is_read ? 'bg-red-600' : 'bg-transparent'}`}></span>
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-900 leading-snug">{n.text}</p>
                          <span className="text-[10px] text-slate-400 mt-1 block font-normal">
                            {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User Profile Menu */}
          <div className="relative" ref={profileRef}>
            <button
              type="button"
              onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
              className="flex items-center gap-1 p-1 bg-slate-100 hover:bg-slate-200/70 rounded-xl transition-colors"
              aria-label="Account menu"
            >
              <span className="flex flex-col items-start px-3 sm:px-4 py-1 sm:py-1.5 bg-white rounded-lg shadow-sm text-left">
                <span className="text-sm sm:text-base font-semibold text-slate-900 capitalize leading-tight">
                  {user.role}
                </span>
                <span className="text-[11px] sm:text-xs text-slate-500 leading-tight truncate max-w-[110px] sm:max-w-[140px]">
                  {user.full_name}
                </span>
              </span>
              <ChevronDown className="w-4 h-4 text-slate-500 mx-1" />
            </button>

            {isProfileMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden text-xs">
                {/* Account info */}
                <div className="p-3.5 bg-slate-50 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-brand text-white flex items-center justify-center font-semibold text-sm">
                      {user.full_name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 truncate text-xs">{user.full_name}</p>
                      <p className="text-[11px] text-slate-500 font-medium capitalize mt-0.5">
                        {user.role} • @{user.username}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Logout Button */}
                <div className="p-1.5">
                  <button
                    type="button"
                    onClick={onLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50 rounded-xl font-medium transition-colors text-xs"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Compact Navigation Row (below lg): horizontally scrollable so every tab stays reachable */}
      {navTabs.length > 1 && (
        <nav className="lg:hidden border-t border-slate-100 px-4 sm:px-6 py-1.5 overflow-x-auto">
          <div className="max-w-7xl mx-auto flex items-center gap-1 text-xs w-max">
            {navTabs.map(renderTab)}
          </div>
        </nav>
      )}
    </header>
  );
};
