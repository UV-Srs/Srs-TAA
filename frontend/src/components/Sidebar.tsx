import React, { useEffect, useState } from 'react';
import { User } from '../types';
import {
  LayoutGrid, Users, ClipboardList, PlusCircle, ShieldCheck, ScanLine
} from 'lucide-react';

interface SidebarProps {
  user: User;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onHoldCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  user,
  activeTab,
  setActiveTab,
  onHoldCount = 0,
}) => {
  const isAdmin = user.role === 'admin';

  // The sidebar is pinned just below the sticky top header, so it stays put while the
  // page scrolls. The header height is measured (not hard-coded) so it stays correct
  // if the header wraps or changes size on small screens.
  const [headerH, setHeaderH] = useState(58);
  useEffect(() => {
    const header = document.querySelector('header');
    if (!header) return;
    const measure = () => setHeaderH(Math.round(header.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  const navItems = [
    ...(isAdmin
      ? [
          { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
          { id: 'scan', label: 'Scan', icon: ScanLine },
          { id: 'users', label: 'Team', icon: Users },
          { id: 'sheet', label: 'Lots', icon: ClipboardList, badge: onHoldCount > 0 ? onHoldCount : null },
          { id: 'builder', label: 'Templates', icon: PlusCircle },
          { id: 'audit', label: 'Audit', icon: ShieldCheck },
        ]
      : [
          { id: 'sheet', label: 'Lots', icon: ClipboardList, badge: onHoldCount > 0 ? onHoldCount : null },
        ]),
  ];

  return (
    <nav
      className="svnav2 sticky self-start overflow-y-auto overflow-x-hidden w-[72px] sm:w-[84px] lg:w-[220px] shrink-0 bg-[var(--surface)] border-r border-[var(--line)] p-3 lg:p-4.5 flex flex-col gap-1 transition-all no-print select-none"
      style={{ top: headerH, height: `calc(100dvh - ${headerH}px)` }}
      aria-label="Admin Navigation"
    >
      {/* Section Heading: ADMIN (uppercase small muted) */}
      <div className="hidden lg:block px-3 py-2 text-[11px] font-semibold text-[var(--muted)] uppercase tracking-[0.07em]">
        {isAdmin ? 'Admin' : 'Menu'}
      </div>

      {/* Nav items */}
      <div className="flex flex-col gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          // Lots stays active while inspecting a lot (tab === 'sheet')
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`relative min-h-[48px] px-3 py-2.5 rounded-[12px] flex items-center gap-3 transition-colors text-left font-medium text-[15px] cursor-pointer ${
                isActive
                  ? 'bg-[var(--accent-soft)] text-[var(--primary)] font-semibold'
                  : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface2)]'
              }`}
              title={item.label}
            >
              <Icon className="w-5 h-5 shrink-0" />

              {/* Label (hidden on collapsed icon rail, shown on lg+) */}
              <span className="hidden lg:inline truncate">{item.label}</span>

              {/* Amber count badge for On Hold lots on the Lots tab */}
              {item.badge !== null && item.badge !== undefined && item.badge > 0 && (
                <span className="pill warn sm font-semibold ml-auto hidden lg:inline-flex">
                  {item.badge}
                </span>
              )}

              {/* Mobile badge indicator */}
              {item.badge !== null && item.badge !== undefined && item.badge > 0 && (
                <span className="lg:hidden absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--warn)] ring-2 ring-[var(--surface)]" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
