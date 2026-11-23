import React from 'react';
import { User } from '../types';
import {
  LayoutDashboard, Layers, Users, ShieldCheck,
  LogOut, X, ClipboardList, ClipboardCheck, UserCircle,
} from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
  supervisorOnly?: boolean;
  operatorOnly?: boolean;
  section?: 'workspace' | 'admin';
}

const NAV_ITEMS: NavItem[] = [
  { id: 'sheet',     label: 'Inspection', icon: ClipboardList,  section: 'workspace' },
  { id: 'sheet',     label: 'My Batches', icon: ClipboardList,  section: 'workspace', operatorOnly: true },
  { id: 'sheet',     label: 'My Reviews', icon: ClipboardCheck, section: 'workspace', supervisorOnly: true },
  { id: 'profile',   label: 'Profile',    icon: UserCircle,      section: 'workspace' },
  { id: 'dashboard', label: 'Dashboard',  icon: LayoutDashboard, adminOnly: true, section: 'admin' },
  { id: 'builder',   label: 'Templates',  icon: Layers,          adminOnly: true, section: 'admin' },
  { id: 'users',     label: 'Users',      icon: Users,           adminOnly: true, section: 'admin' },
  { id: 'audit',     label: 'Audit Log',  icon: ShieldCheck,     adminOnly: true, section: 'admin' },
];

export interface SidebarProps {
  user: User;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function NavLink({
  item, activeTab, setActiveTab, onClose,
}: {
  item: NavItem;
  activeTab: string;
  setActiveTab: (t: string) => void;
  onClose: () => void;
}) {
  const Icon = item.icon;
  const isActive = activeTab === item.id;

  return (
    <button
      type="button"
      onClick={() => { setActiveTab(item.id); onClose(); }}
      className={`w-full flex items-center gap-3 px-3 rounded-xl text-[15px] font-medium transition-all h-12
        ${isActive
          ? 'bg-[#E7EFF8] text-[#2D5B8C] font-semibold'
          : 'text-[#677386] hover:bg-[#EEF1F6] hover:text-[#1B2533]'
        }`}
    >
      <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-[#2D5B8C]' : 'text-[#677386]'}`} />
      <span className="truncate leading-none">{item.label}</span>
    </button>
  );
}

function SidebarContent({
  user, activeTab, setActiveTab, onLogout, onClose,
}: {
  user: User;
  activeTab: string;
  setActiveTab: (t: string) => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  const workspaceItems = NAV_ITEMS.filter(i => {
    if (i.section !== 'workspace') return false;
    if (i.adminOnly && user.role !== 'admin') return false;
    if (i.supervisorOnly && user.role !== 'supervisor') return false;
    if (i.operatorOnly && user.role !== 'operator') return false;
    if (i.label === 'Inspection' && (user.role === 'operator' || user.role === 'supervisor')) return false;
    return true;
  });
  const adminItems = NAV_ITEMS.filter(i => i.adminOnly && user.role === 'admin');

  return (
    <>
      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="px-3 pb-2 text-[11px] font-semibold text-[#677386] uppercase tracking-wider">
          Workspace
        </p>
        {workspaceItems.map((item, i) => (
          <NavLink
            key={`${item.id}-${i}`}
            item={item}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onClose={onClose}
          />
        ))}

        {user.role === 'admin' && adminItems.length > 0 && (
          <>
            <div className="my-3 border-t border-[#E2E6EC]" />
            <p className="px-3 pb-2 text-[11px] font-semibold text-[#677386] uppercase tracking-wider">
              Admin Tools
            </p>
            {adminItems.map((item, i) => (
              <NavLink
                key={`${item.id}-admin-${i}`}
                item={item}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                onClose={onClose}
              />
            ))}
          </>
        )}
      </nav>

      {/* User card */}
      <div className="shrink-0 border-t border-[#E2E6EC] p-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#E7EFF8] text-[#2D5B8C] flex items-center justify-center font-bold text-sm uppercase shrink-0 select-none">
            {user.full_name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[#1B2533] text-xs font-semibold leading-tight truncate">{user.full_name}</p>
            <p className="text-[#677386] text-[10px] capitalize leading-tight mt-0.5">{user.role}</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="p-1.5 text-[#677386] hover:text-[#C8463E] hover:bg-[#FCEAE8] rounded-md transition-colors shrink-0"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}

export const Sidebar: React.FC<SidebarProps> = ({
  user, activeTab, setActiveTab, onLogout, mobileOpen, onCloseMobile,
}) => {
  return (
    <>
      {/* Desktop — fixed width, always visible */}
      <div
        className="hidden lg:flex flex-col h-screen w-[220px] sticky top-0 shrink-0"
        style={{ background: 'var(--surface)', borderRight: '1px solid var(--line)' }}
      >
        {/* Brand */}
        <div
          className="flex items-center gap-3 h-14 px-4 shrink-0"
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          <div className="w-[34px] h-[34px] rounded-[10px] bg-[#2D5B8C] text-white flex items-center justify-center font-black text-[11px] tracking-tight shrink-0 select-none">
            TAA
          </div>
          <div className="min-w-0">
            <p className="text-[#1B2533] font-semibold text-[16px] leading-none truncate">TAA Inspection</p>
            <p className="text-[#677386] text-[13px] mt-0.5 leading-none">Lot inspection made simple</p>
          </div>
        </div>

        <SidebarContent
          user={user}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onLogout={onLogout}
          onClose={() => {}}
        />
      </div>

      {/* Mobile — overlay drawer */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={onCloseMobile} />
          <div
            className="fixed inset-y-0 left-0 z-50 w-[220px] flex flex-col lg:hidden"
            style={{ background: 'var(--surface)', borderRight: '1px solid var(--line)' }}
          >
            {/* Brand + close */}
            <div
              className="flex items-center justify-between h-14 px-4 shrink-0"
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              <div className="flex items-center gap-3">
                <div className="w-[34px] h-[34px] rounded-[10px] bg-[#2D5B8C] text-white flex items-center justify-center font-black text-[11px]">
                  TAA
                </div>
                <div>
                  <p className="text-[#1B2533] font-semibold text-[16px] leading-none">TAA Inspection</p>
                  <p className="text-[#677386] text-[13px] mt-0.5">Lot inspection made simple</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCloseMobile}
                className="p-1.5 text-[#677386] hover:text-[#1B2533] hover:bg-[#EEF1F6] rounded-md transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <SidebarContent
              user={user}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onLogout={onLogout}
              onClose={onCloseMobile}
            />
          </div>
        </>
      )}
    </>
  );
};
