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
    } catch { }
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
    } catch { }
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
    const isActive = activeTab === tab.id;
    return (
      <button
        key={tab.id}
        type="button"
        onClick={() => setActiveTab(tab.id)}
        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 font-medium whitespace-nowrap shrink-0 text-xs cursor-pointer ${isActive
            ? 'bg-[var(--surface)] text-[var(--primary)] shadow-sm font-semibold'
            : 'text-[var(--muted)] hover:text-[var(--ink)]'
          }`}
      >
        <Icon className="w-3.5 h-3.5" />
        <span>{tab.label}</span>
      </button>
    );
  };

  return (
    <header className="bg-white border-b border-[var(--line)] sticky top-0 z-40 no-print select-none shadow-[var(--shadow)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4">
        {/* Left: LotSure Brand */}
        <div className="flex items-center gap-6 min-w-0">
          <div className="flex items-center gap-2.5 shrink-0">
            <img src="/srs-logo.png" alt="SRS Consulting" className="w-[34px] h-[34px] object-contain rounded-[10px]" />
            <div>
              <h1 className="text-[16px] font-semibold text-[var(--ink)] leading-tight tracking-tight">TAA Inspection</h1>
              <span className="text-[13px] text-[var(--muted)] font-normal hidden sm:block leading-tight">Lot inspection made simple</span>
            </div>
          </div>
        </div>

        {/* Right: Actions, Notifications, & User Profile */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Offline Sync Status */}
          {(!isOnline || pendingSyncCount > 0) && (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[var(--warn-bg)] text-[var(--warn)] border border-[var(--warn)] rounded-lg text-xs font-medium"
              title={pendingSyncCount > 0 ? `${pendingSyncCount} pending sync` : 'Offline'}
            >
              <WifiOff className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{pendingSyncCount > 0 ? `${pendingSyncCount} pending sync` : 'Offline'}</span>
            </div>
          )}

          {/* Notifications Bell */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setIsNotifOpen(!isNotifOpen)}
              className="relative p-2 text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface2)] rounded-xl transition-colors cursor-pointer"
              title="Notifications"
              aria-label={`Notifications, ${unreadCount} unread`}
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[18px] h-[18px] bg-[var(--ng)] text-white font-bold text-[10px] rounded-full flex items-center justify-center px-1 ring-2 ring-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {isNotifOpen && (
              <div className="fixed left-4 right-4 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 bg-[var(--surface)] border border-[var(--line)] rounded-2xl shadow-xl z-50 overflow-hidden text-xs">
                <div className="p-3.5 border-b border-[var(--line)] flex items-center justify-between bg-[var(--surface2)]">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-[var(--ink)]">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="bg-[var(--ng-bg)] text-[var(--ng)] font-semibold px-2 py-0.5 rounded-full text-[10px]">
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="text-[12px] text-[var(--primary)] hover:underline font-medium cursor-pointer"
                    >
                      Mark all as read
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-[var(--line)]">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-[var(--muted)]">
                      No notifications yet.
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.notification_id}
                        type="button"
                        onClick={() => handleNotificationClick(n)}
                        className={`w-full text-left p-3.5 hover:bg-[var(--surface2)] transition-colors flex items-start gap-2.5 ${!n.is_read ? 'bg-[var(--accent-soft)]/50 font-medium' : 'text-[var(--muted)]'
                          }`}
                      >
                        <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${!n.is_read ? 'bg-[var(--ng)]' : 'bg-transparent'}`}></span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[var(--ink)] leading-snug">{n.text}</p>
                          <span className="text-[11px] text-[var(--muted)] mt-1 block font-normal">
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
              className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 bg-[var(--surface2)] hover:bg-[var(--line)] rounded-xl transition-all text-xs cursor-pointer"
            >
              <div className="w-7 h-7 rounded-lg bg-[var(--primary)] text-white flex items-center justify-center font-bold text-xs uppercase">
                {user.full_name.charAt(0)}
              </div>
              <div className="text-left hidden xl:block">
                <span className="font-semibold text-[var(--ink)] block leading-tight truncate max-w-[120px]">
                  {user.full_name}
                </span>
                <span className="text-[11px] text-[var(--muted)] font-medium capitalize">
                  {user.role}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[var(--muted)]" />
            </button>

            {isProfileMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-[var(--surface)] border border-[var(--line)] rounded-2xl shadow-xl z-50 overflow-hidden text-xs">
                {/* Account info */}
                <div className="p-3.5 bg-[var(--surface2)] border-b border-[var(--line)]">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-[var(--primary)] text-white flex items-center justify-center font-bold text-sm shadow-sm">
                      {user.full_name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--ink)] truncate text-xs">{user.full_name}</p>
                      <p className="text-[11px] text-[var(--muted)] font-medium capitalize mt-0.5">
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
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-[var(--ng)] hover:bg-[var(--ng-bg)] rounded-xl font-medium transition-colors text-xs cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
