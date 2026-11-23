import React, { useEffect, useState, useRef } from 'react';
import { User, InAppNotification } from '../types';
import { Bell, WifiOff, Menu, FileText, LayoutDashboard, Layers, Users, ShieldCheck, ClipboardList, ClipboardCheck } from 'lucide-react';
import { getQueuedMutations, removeQueuedMutations } from '../db';
import { syncOfflineQueue, fetchNotifications, markNotificationsRead } from '../api';
import { onNotificationDispatched } from '../liveSync';

const SHEET_LABEL: Record<string, { label: string; Icon: React.ElementType }> = {
  admin:      { label: 'Inspection',  Icon: ClipboardList  },
  operator:   { label: 'My Batches', Icon: ClipboardList  },
  supervisor: { label: 'My Reviews', Icon: ClipboardCheck },
};

const TAB_LABELS: Record<string, { label: string; Icon: React.ElementType }> = {
  dashboard: { label: 'Dashboard',       Icon: LayoutDashboard },
  builder:   { label: 'Sheet Templates', Icon: Layers          },
  users:     { label: 'User Management', Icon: Users           },
  audit:     { label: 'Audit Log',       Icon: ShieldCheck     },
  profile:   { label: 'Profile',         Icon: ClipboardList   },
};

interface HeaderProps {
  user: User | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onSelectBatchByCode?: (batchCode: string) => void;
  onToggleSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  activeTab,
  setActiveTab,
  onSelectBatchByCode,
  onToggleSidebar,
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
  const tabMeta = activeTab === 'sheet'
    ? (SHEET_LABEL[user?.role ?? 'admin'] ?? SHEET_LABEL.admin)
    : (TAB_LABELS[activeTab] ?? { label: activeTab, Icon: FileText });

  if (!user) return null;

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3 shrink-0 sticky top-0 z-30 no-print select-none">
      {/* Hamburger — mobile only */}
      <button
        type="button"
        onClick={onToggleSidebar}
        className="lg:hidden p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
        aria-label="Toggle sidebar"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Page title */}
      <div className="flex items-center gap-2 text-slate-900">
        <tabMeta.Icon className="w-4 h-4 text-slate-500 shrink-0" />
        <span className="font-semibold text-sm">{tabMeta.label}</span>
      </div>

      <div className="flex-1" />

      {/* Offline / sync indicator */}
      {(!isOnline || pendingSyncCount > 0) && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-xs font-medium">
          <WifiOff className="w-3.5 h-3.5 text-amber-600" />
          <span>{pendingSyncCount > 0 ? `${pendingSyncCount} pending` : 'Offline'}</span>
        </div>
      )}

      {/* Notifications */}
      <div className="relative" ref={notifRef}>
        <button
          type="button"
          onClick={() => setIsNotifOpen(!isNotifOpen)}
          className="relative p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
          title="Notifications"
        >
          <Bell className="w-4.5 h-4.5" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-600 rounded-full animate-pulse ring-2 ring-white" />
          )}
        </button>

        {isNotifOpen && (
          <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden text-xs">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-sm">Notifications</span>
                {unreadCount > 0 && (
                  <span className="bg-red-100 text-red-700 font-semibold px-1.5 py-0.5 rounded-full text-[10px]">
                    {unreadCount}
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-xs text-slate-400 hover:text-slate-700 font-medium transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-slate-400">No notifications yet.</div>
              ) : (
                notifications.map(n => (
                  <button
                    key={n.notification_id}
                    type="button"
                    onClick={() => handleNotificationClick(n)}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-2.5
                      ${!n.is_read ? 'bg-slate-50/70' : ''}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${!n.is_read ? 'bg-indigo-500' : 'bg-transparent'}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`leading-snug ${!n.is_read ? 'text-slate-900 font-medium' : 'text-slate-600'}`}>
                        {n.text}
                      </p>
                      <span className="text-[10px] text-slate-400 mt-0.5 block font-normal">
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
    </header>
  );
};
