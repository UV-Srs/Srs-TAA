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
  onOpenScanner: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onSelectBatchByCode?: (batchCode: string) => void;
  onUserSwitched?: (newUser: User) => void;
}

const PERSONAS = [
  { key: 'operator', name: 'Ravi Kumar', roleName: 'Operator', pass: 'oper123', color: 'bg-emerald-600' },
  { key: 'supervisor', name: 'Meena Rao', roleName: 'Supervisor', pass: 'super123', color: 'bg-purple-600' },
  { key: 'admin', name: 'Kiran Shah', roleName: 'Admin', pass: 'admin123', color: 'bg-blue-600' },
];

export const Header: React.FC<HeaderProps> = ({
  user,
  onLogout,
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

  const handleRoleSwitch = async (roleKey: string, pass: string) => {
    try {
      const res = await loginUser(roleKey, pass);
      setIsProfileMenuOpen(false);
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

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  if (!user) return null;

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 no-print select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        {/* Left: Brand & Main Navigation */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-black text-white flex items-center justify-center font-black text-sm tracking-tight shadow-sm">
              TAA
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900 leading-none">Inspection System</h1>
              <span className="text-[10px] text-slate-400 font-medium">Shop Floor Quality</span>
            </div>
          </div>

          {/* Clean Navigation Tabs */}
          <nav className="hidden sm:flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs">
            <button
              onClick={() => setActiveTab('sheet')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 font-medium ${
                activeTab === 'sheet'
                  ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Inspection</span>
            </button>

            {user.role === 'admin' && (
              <>
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 font-medium ${
                    activeTab === 'dashboard'
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  <span>Dashboard</span>
                </button>

                <button
                  onClick={() => setActiveTab('builder')}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 font-medium ${
                    activeTab === 'builder'
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Templates</span>
                </button>

                <button
                  onClick={() => setActiveTab('users')}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 font-medium ${
                    activeTab === 'users'
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Users</span>
                </button>

                <button
                  onClick={() => setActiveTab('audit')}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 font-medium ${
                    activeTab === 'audit'
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Audit</span>
                </button>
              </>
            )}
          </nav>
        </div>

        {/* Right: Actions, Notifications, & User Profile */}
        <div className="flex items-center gap-3">
          {/* Offline Sync Status */}
          {(!isOnline || pendingSyncCount > 0) && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-xs font-medium">
              <WifiOff className="w-3.5 h-3.5 text-amber-600" />
              <span>{pendingSyncCount > 0 ? `${pendingSyncCount} pending sync` : 'Offline'}</span>
            </div>
          )}

          {/* Notifications Bell */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setIsNotifOpen(!isNotifOpen)}
              className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-600 rounded-full animate-pulse ring-2 ring-white"></span>
              )}
            </button>

            {isNotifOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden text-xs">
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
              className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all text-xs"
            >
              <div className="w-6 h-6 rounded-lg bg-black text-white flex items-center justify-center font-bold text-xs uppercase">
                {user.full_name.charAt(0)}
              </div>
              <div className="text-left hidden md:block">
                <span className="font-bold text-slate-900 block leading-tight truncate max-w-[120px]">
                  {user.full_name}
                </span>
                <span className="text-[10px] text-slate-500 font-medium capitalize">
                  {user.role}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            </button>

            {isProfileMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden text-xs">
                {/* Account info */}
                <div className="p-3 bg-slate-50 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-black text-white flex items-center justify-center font-bold text-sm">
                      {user.full_name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 truncate">{user.full_name}</p>
                      <p className="text-[11px] text-slate-500 font-medium capitalize">
                        {user.role} • @{user.username}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Persona Switcher Section (Clean & Organized) */}
                <div className="p-2 border-b border-slate-100">
                  <p className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Switch Active Role
                  </p>
                  {PERSONAS.map((p) => {
                    const isCurrent = user.username === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => handleRoleSwitch(p.key, p.pass)}
                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left transition-colors ${
                          isCurrent
                            ? 'bg-slate-100 font-bold text-slate-900'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${p.color}`}></span>
                          <div>
                            <span className="block text-xs leading-none">{p.name}</span>
                            <span className="text-[10px] text-slate-400 capitalize">{p.roleName}</span>
                          </div>
                        </div>
                        {isCurrent && <Check className="w-3.5 h-3.5 text-black" />}
                      </button>
                    );
                  })}
                </div>

                {/* Logout Button */}
                <div className="p-1.5">
                  <button
                    type="button"
                    onClick={onLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium transition-colors"
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
    </header>
  );
};
