import React, { useEffect, useState, useRef } from 'react';
import { User, InAppNotification } from '../types';
import {
  Bell, Check, FileText, LayoutDashboard, Users, PlusCircle,
  ShieldCheck, WifiOff, LogOut, ExternalLink, X
} from 'lucide-react';
import { getQueuedMutations, removeQueuedMutations } from '../db';
import { syncOfflineQueue, fetchNotifications, markNotificationsRead, loginUser } from '../api';
import { onNotificationDispatched } from '../liveSync';

interface HeaderProps {
  user: User | null;
  onLogout: () => void;
  onOpenScanner: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onSelectBatchByCode?: (batchCode: string) => void;
  onUserSwitched?: (newUser: User) => void;
}

const ROLES = [
  { key: 'operator', name: 'Ravi Kumar', roleName: 'Operator', id: 'OP-104', color: 'bg-teal-600', pass: 'oper123' },
  { key: 'supervisor', name: 'Meena Rao', roleName: 'Supervisor', id: 'SV-021', color: 'bg-purple-600', pass: 'super123' },
  { key: 'admin', name: 'Kiran Shah', roleName: 'Admin', id: 'AD-001', color: 'bg-blue-600', pass: 'admin123' },
  { key: 'admin2', name: 'Admin Backup', roleName: 'Admin', id: 'AD-002', color: 'bg-slate-700', pass: 'admin123' },
];

export const Header: React.FC<HeaderProps> = ({
  user,
  onLogout,
  onOpenScanner,
  activeTab,
  setActiveTab,
  onSelectBatchByCode,
  onUserSwitched,
}) => {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState<boolean>(false);
  const notifRef = useRef<HTMLDivElement | null>(null);

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

    // Live real-time notification push
    const unsubNotif = onNotificationDispatched(() => {
      loadNotifs();
    });

    const notifInterval = setInterval(loadNotifs, 8000);
    const syncInterval = setInterval(checkPendingQueue, 5000);

    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
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
      const items = await fetchNotifications(40);
      setNotifications(items);
    } catch {
      // ignore
    }
  };

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

  const handleRoleSwitch = async (roleKey: string, pass: string) => {
    try {
      const res = await loginUser(roleKey, pass);
      if (onUserSwitched) {
        onUserSwitched(res.user);
      }
    } catch (err) {
      console.error('Role switch failed:', err);
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

  const formatAgo = (isoTime: string) => {
    const diffMs = Date.now() - new Date(isoTime).getTime();
    const min = Math.round(diffMs / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hrs = Math.round(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };

  if (!user) return null;

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 no-print text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
        {/* Brand & Quick Role Switcher */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="bg-slate-900 text-white font-black text-xs px-2.5 py-1 rounded tracking-wider">
              TAA
            </span>
            <span className="font-bold text-sm text-slate-900 tracking-tight hidden sm:inline">
              Inspection
            </span>
          </div>

          {/* Quick Role Switcher Buttons */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
            {ROLES.map((r) => {
              const isActive = (user.username === r.key) || (user.role === (r.key as any) && r.key !== 'admin2');
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => handleRoleSwitch(r.key, r.pass)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-all text-[11px] ${
                    isActive
                      ? 'bg-white text-slate-900 shadow-sm font-semibold border border-slate-300'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                  title={`Switch to ${r.name} (${r.roleName})`}
                >
                  <span className={`w-2 h-2 rounded-full ${r.color}`}></span>
                  <span>{r.name.split(' ')[0]}</span>
                  <span className="text-slate-400 hidden md:inline">({r.roleName})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Section: Navigation, Notifications, Online, User */}
        <div className="flex items-center gap-2.5">
          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-medium">
            <button
              onClick={() => setActiveTab('sheet')}
              className={`px-3 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                activeTab === 'sheet'
                  ? 'bg-white text-slate-900 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Checksheet</span>
            </button>

            {user.role === 'admin' && (
              <>
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className={`px-3 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                    activeTab === 'dashboard'
                      ? 'bg-white text-slate-900 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  <span>Dashboard</span>
                </button>

                <button
                  onClick={() => setActiveTab('builder')}
                  className={`px-3 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                    activeTab === 'builder'
                      ? 'bg-white text-slate-900 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Builder</span>
                </button>

                <button
                  onClick={() => setActiveTab('users')}
                  className={`px-3 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                    activeTab === 'users'
                      ? 'bg-white text-slate-900 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Users</span>
                </button>

                <button
                  onClick={() => setActiveTab('audit')}
                  className={`px-3 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                    activeTab === 'audit'
                      ? 'bg-white text-slate-900 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Audit</span>
                </button>
              </>
            )}
          </nav>

          {/* In-App Notifications Bell (FR-052 & FR-053) */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setIsNotifOpen(!isNotifOpen)}
              className="relative p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors flex items-center gap-1"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-600 text-white font-bold text-[10px] w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notification Dropdown Menu */}
            {isNotifOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 overflow-hidden text-xs">
                <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-900">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="bg-red-100 text-red-800 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {unreadCount} unread
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="text-[11px] text-slate-600 hover:text-slate-900 font-medium"
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {notifications.length === 0 ? (
                    <div className="p-4 text-center text-slate-400">
                      No notifications yet.
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.notification_id}
                        type="button"
                        onClick={() => handleNotificationClick(n)}
                        className={`w-full text-left p-3 hover:bg-slate-50 transition-colors flex items-start gap-2.5 ${
                          !n.is_read ? 'bg-slate-50/80 font-medium' : ''
                        }`}
                      >
                        {!n.is_read ? (
                          <span className="w-2 h-2 rounded-full bg-blue-600 mt-1 shrink-0"></span>
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-slate-200 mt-1 shrink-0"></span>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-800 leading-snug">{n.text}</p>
                          <span className="text-[10px] text-slate-400 mt-0.5 block">
                            {formatAgo(n.created_at)}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Online/Offline status */}
          {!isOnline && (
            <div className="flex items-center gap-1 text-[11px] font-medium text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-300">
              <WifiOff className="w-3 h-3 text-amber-600" />
              <span className="hidden sm:inline">Offline</span>
            </div>
          )}

          {/* User Sign-out */}
          <button
            onClick={onLogout}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
