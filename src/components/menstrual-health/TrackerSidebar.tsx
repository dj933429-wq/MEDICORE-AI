'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import NextLink from 'next/link';
import Icon from './Icon';
import { useMenstrualHealth } from '../../lib/menstrual-health/context';

interface TrackerSidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export default function TrackerSidebar({ mobileOpen = false, onCloseMobile }: TrackerSidebarProps) {
  const pathname = usePathname();
  const { stats, mode, toggleMode } = useMenstrualHealth();

  const navItems = [
    { label: 'Overview', path: '/dashboard/menstrual-health', icon: 'radio_button_checked' },
    { label: 'Calendar', path: '/dashboard/menstrual-health/calendar', icon: 'calendar_today' },
    { label: 'Daily Log', path: '/dashboard/menstrual-health/log', icon: 'favorite' },
    { label: 'Insights', path: '/dashboard/menstrual-health/insights', icon: 'trending_up' }
  ];

  const isActive = (itemPath: string) => {
    if (itemPath === '/dashboard/menstrual-health') {
      return pathname === '/dashboard/menstrual-health';
    }
    return pathname.startsWith(itemPath);
  };

  const sidebarContent = (
    <div className="flex flex-col justify-between h-full bg-surface-container-lowest text-on-surface shadow-[0_1px_8px_rgba(0,0,0,0.04)] border-r border-surface-container">
      <div className="flex flex-col">
        {/* Header / Logo */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-surface-container/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary-container/20 flex items-center justify-center text-primary font-bold shadow-sm">
              <Icon name="vital_signs" size={20} />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-sm tracking-tight text-on-surface">MEDICORE-AI</span>
              <span className="text-[10px] uppercase font-bold tracking-wider text-secondary">Menstrual Wellness</span>
            </div>
          </div>
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="lg:hidden p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container"
              aria-label="Close Navigation"
            >
              <Icon name="close" size={18} />
            </button>
          )}
        </div>

        {/* Navigation Links */}
        <div className="p-4">
          <nav className="flex flex-col gap-1.5">
            {navItems.map((item) => {
              const active = isActive(item.path);
              return (
                <NextLink
                  key={item.path}
                  href={item.path}
                  onClick={() => onCloseMobile?.()}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-150 ${
                    active
                      ? 'bg-secondary-container text-on-secondary-container shadow-xs font-semibold'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                  }`}
                >
                  <Icon name={item.icon} size={18} className={active ? 'text-on-secondary-container' : 'text-secondary'} />
                  <span>{item.label}</span>
                </NextLink>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Footer / Cycle Status & Mode Card */}
      <div className="p-4 flex flex-col gap-3">
        {/* Cycle status mini badge */}
        <div className="p-3.5 rounded-2xl bg-surface-container-low flex flex-col gap-2 border border-surface-container">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${stats.currentCycleDay ? 'bg-tertiary' : 'bg-outline/50'}`}></span>
              <span className="text-[11px] uppercase tracking-wider font-semibold text-tertiary">
                {stats.currentCycleDay ? 'Active Phase' : 'Status'}
              </span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-container-highest font-medium text-secondary">
              {mode === 'demo' ? 'Demo' : 'Empty'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sm text-on-surface">
              {stats.currentCycleDay ? `Cycle Day ${stats.currentCycleDay}` : 'No Cycles Recorded'}
            </span>
            <span className="text-xs text-on-surface-variant">
              {stats.currentPhase ? `Estimated ${stats.currentPhase.charAt(0).toUpperCase() + stats.currentPhase.slice(1)} Phase` : 'Add your first period'}
            </span>
          </div>

          <div className="pt-1 flex items-center justify-between border-t border-surface-container/60">
            <button
              onClick={toggleMode}
              className="text-xs font-medium text-secondary hover:text-primary transition-colors text-left"
              title="Toggle between demo sample data and empty new-user state"
            >
              {mode === 'demo' ? 'Switch to New-User Mode' : 'Load Demo Sample'}
            </button>
          </div>
        </div>

        {/* Back to Patient Portal link */}
        <NextLink
          href="/dashboard"
          className="inline-flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-surface-container text-on-surface-variant text-xs font-medium hover:bg-surface-container-high hover:text-on-surface transition-colors"
        >
          <Icon name="arrow_back" size={14} />
          <span>Back to Patient Portal</span>
        </NextLink>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop fixed sidebar */}
      <aside className="hidden lg:block fixed left-0 top-0 h-full w-72 z-40">
        {sidebarContent}
      </aside>

      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-xs transition-opacity"
          onClick={onCloseMobile}
        >
          <div
            className="w-72 h-full max-w-[85vw] bg-surface-container-lowest shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
