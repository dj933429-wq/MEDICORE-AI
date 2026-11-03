'use client';

import React from 'react';
import NextLink from 'next/link';
import Icon from './Icon';
import { useAuth } from '../../lib/auth';
import { useMenstrualHealth } from '../../lib/menstrual-health/context';

interface TrackerHeaderProps {
  onOpenMobile?: () => void;
}

export default function TrackerHeader({ onOpenMobile }: TrackerHeaderProps) {
  const { user } = useAuth();
  const { mode, feedbackMessage, clearFeedback } = useMenstrualHealth();

  const userName = user?.name || (user?.email ? user.email.split('@')[0] : 'Patient');

  return (
    <>
      <header className="sticky top-0 z-30 h-16 bg-surface/90 backdrop-blur-md border-b border-surface-container flex items-center justify-between px-4 sm:px-8">
        <div className="flex items-center gap-3">
          {/* Mobile hamburger menu toggle */}
          <button
            onClick={onOpenMobile}
            className="lg:hidden p-2 rounded-xl text-on-surface-variant hover:bg-surface-container"
            aria-label="Open Navigation"
          >
            <Icon name="tune" size={20} />
          </button>

          <NextLink
            href="/dashboard"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-on-surface-variant text-xs sm:text-sm font-medium hover:bg-surface-container hover:text-on-surface transition-colors"
          >
            <Icon name="arrow_back" size={16} />
            <span className="hidden sm:inline">Back to Patient Portal</span>
            <span className="sm:hidden">Portal</span>
          </NextLink>
        </div>

        <div className="flex items-center gap-3">
          {/* Demo badge */}
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide ${
            mode === 'demo'
              ? 'bg-secondary-container text-on-secondary-container'
              : 'bg-surface-container-high text-on-surface-variant'
          }`}>
            {mode === 'demo' ? 'Demo Mode • Sample Data' : 'New-User Mode'}
          </span>

          {/* User profile avatar / pill */}
          <div className="flex items-center gap-2 pl-1 border-l border-surface-container">
            <div className="w-8 h-8 rounded-full bg-primary-fixed flex items-center justify-center text-primary font-bold text-xs uppercase shadow-xs">
              {userName.charAt(0)}
            </div>
            <span className="hidden md:inline text-xs font-medium text-on-surface max-w-[120px] truncate">
              {userName}
            </span>
          </div>
        </div>
      </header>

      {/* Floating feedback notification toast */}
      {feedbackMessage && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md bg-inverse-surface text-surface text-xs sm:text-sm px-4 py-3 rounded-2xl shadow-xl flex items-center justify-between gap-3 animate-fade-in border border-surface-container-highest/20">
          <div className="flex items-center gap-2">
            <Icon name="check_circle" size={18} className="text-tertiary-fixed shrink-0" />
            <span>{feedbackMessage}</span>
          </div>
          <button
            onClick={clearFeedback}
            className="p-1 rounded-lg text-surface-dim hover:text-surface hover:bg-surface-container/20 transition-colors"
            aria-label="Dismiss message"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </>
  );
}

