import React, { useEffect, useState, useRef } from 'react';
import { User, InAppNotification } from '../types';
import { Bell, WifiOff, Menu, LogOut } from 'lucide-react';
import { SRSLogo } from './SRSLogo';
import { getQueuedMutations, removeQueuedMutations } from '../db';
import { syncOfflineQueue, fetchNotifications, markNotificationsRead } from '../api';
import { onNotificationDispatched } from '../liveSync';

interface HeaderProps {
  user: User | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onSelectBatchByCode?: (batchCode: string) => void;
  onToggleSidebar: () => void;
  onLogout?: () => void;
  desktopSidebarOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  activeTab,
  setActiveTab,
  onSelectBatchByCode,
  onToggleSidebar,
  onLogout,
  desktopSidebarOpen,
}) => {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState<boolean>(false);
  const notifRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOnline = async () => { setIsOnline(true); await triggerSync(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    checkPendingQueue();
    loadNotifs();

    const unsubNotif = onNotificationDispatched(() => loadNotifs());
    const notifInterval = setInterval(loadNotifs, 10_000);
    const syncInterval  = setInterval(checkPendingQueue, 6_000);

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
    try { setNotifications(await fetchNotifications()); } catch {}
  };

  const checkPendingQueue = async () => {
    try {
      const queued = await getQueuedMutations();
      setPendingSyncCount(queued.length);
      if (queued.length > 0 && navigator.onLine && !isSyncing) await triggerSync();
    } catch {}
  };

  const triggerSync = async () => {
    try {
      setIsSyncing(true);
      const queued = await getQueuedMutations();
      if (queued.length > 0) {
        const res = await syncOfflineQueue(queued);
        if (res.success) {
          await removeQueuedMutations(queued.map(m => m.client_mutation_id));
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
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch {}
  };

  const handleNotificationClick = async (notif: InAppNotification) => {
    try {
      await markNotificationsRead(notif.notification_id);
      setNotifications(prev =>
        prev.map(n => n.notification_id === notif.notification_id ? { ...n, is_read: true } : n)
      );
      setIsNotifOpen(false);
      if (notif.batch_code && onSelectBatchByCode) {
        onSelectBatchByCode(notif.batch_code);
        setActiveTab('sheet');
      }
    } catch {}
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (!user) return null;

  return (
    <header
      className="h-14 flex items-center px-4 gap-3 shrink-0 sticky top-0 z-30 no-print select-none"
      style={{ background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}
    >
      {/* Sidebar toggle button (both desktop and mobile) */}
      <button
        type="button"
        onClick={onToggleSidebar}
        className="p-2 rounded-lg transition-colors hover:bg-[var(--surface2)]"
        style={{ color: 'var(--muted)' }}
        aria-label="Toggle sidebar"
        title={desktopSidebarOpen === false ? 'Expand navigation sidebar' : 'Close navigation sidebar'}
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Brand — visible on mobile or when desktop sidebar is collapsed */}
      {(!desktopSidebarOpen) && (
        <div className="flex items-center gap-2.5">
          <SRSLogo size={32} />
          <div>
            <p className="font-semibold text-[15px] leading-none" style={{ color: 'var(--ink)' }}>Smart Scan</p>
            <p className="text-[12px] leading-none mt-0.5" style={{ color: 'var(--muted)' }}>Lot inspection made simple</p>
          </div>
        </div>
      )}

      <div className="flex-1" />

      {/* Offline / sync indicator */}
      {(!isOnline || pendingSyncCount > 0) && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
          style={{ background: 'var(--warn-bg)', color: 'var(--warn)', border: '1px solid #e9c97a' }}
        >
          <WifiOff className="w-3.5 h-3.5" />
          <span>{pendingSyncCount > 0 ? `${pendingSyncCount} pending` : 'Offline'}</span>
        </div>
      )}

      {/* Notifications */}
      <div className="relative" ref={notifRef}>
        <button
          type="button"
          onClick={() => setIsNotifOpen(!isNotifOpen)}
          className="relative p-2 rounded-md transition-colors"
          style={{ color: 'var(--muted)' }}
          title="Notifications"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#C8463E] rounded-full animate-pulse ring-2 ring-white" />
          )}
        </button>

        {isNotifOpen && (
          <div
            className="absolute right-0 top-full mt-2 w-80 rounded-xl shadow-xl z-50 overflow-hidden text-xs"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
          >
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Notifications</span>
                {unreadCount > 0 && (
                  <span className="bg-[#FCEAE8] text-[#C8463E] font-semibold px-1.5 py-0.5 rounded-full text-[10px]">
                    {unreadCount}
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-xs font-medium transition-colors"
                  style={{ color: 'var(--muted)' }}
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y" style={{ borderColor: 'var(--line)' }}>
              {notifications.length === 0 ? (
                <div className="p-8 text-center" style={{ color: 'var(--muted)' }}>No notifications yet.</div>
              ) : (
                notifications.map(n => (
                  <button
                    key={n.notification_id}
                    type="button"
                    onClick={() => handleNotificationClick(n)}
                    className={`w-full text-left px-4 py-3 transition-colors flex items-start gap-2.5`}
                    style={{ background: !n.is_read ? 'var(--accent-soft)' : 'transparent' }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                      style={{ background: !n.is_read ? 'var(--accent)' : 'transparent' }}
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className="leading-snug"
                        style={{ color: !n.is_read ? 'var(--ink)' : 'var(--muted)', fontWeight: !n.is_read ? 500 : 400 }}
                      >
                        {n.text}
                      </p>
                      <span className="text-[10px] mt-0.5 block font-normal" style={{ color: 'var(--muted)' }}>
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

      {/* User profile / logout */}
      {user && (
        <div className="flex items-center gap-2 pl-3 border-l border-[var(--line)]">
          <div className="w-8 h-8 rounded-full bg-[var(--accent-soft)] text-[var(--primary)] flex items-center justify-center font-bold text-xs uppercase">
            {user.full_name?.charAt(0) || user.username?.charAt(0) || 'U'}
          </div>
          <div className="hidden sm:block text-left">
            <p className="text-xs font-semibold leading-tight text-[var(--ink)]">
              {user.full_name || user.username}
            </p>
            <p className="text-[11px] text-[var(--muted)] capitalize">{user.role}</p>
          </div>
          {onLogout && (
            <button
              onClick={onLogout}
              className="p-1.5 ml-1 text-[var(--muted)] hover:text-[var(--ng)] rounded-lg transition-colors cursor-pointer"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </header>
  );
};
