'use client';

import React, { useState } from 'react';
import NextLink from 'next/link';
import Icon from '../../../components/menstrual-health/Icon';
import CycleWheel from '../../../components/menstrual-health/CycleWheel';
import QuickLogModal from '../../../components/menstrual-health/QuickLogModal';
import { useMenstrualHealth } from '../../../lib/menstrual-health/context';
import { formatDateISO } from '../../../lib/menstrual-health/calculations';

export default function OverviewPage() {
  const { stats, mode, getLogForDate, toggleMode } = useMenstrualHealth();
  const [modalOpen, setModalOpen] = useState(false);

  const todayStr = formatDateISO(new Date());
  const todayLog = getLogForDate(todayStr);

  const hasHistory = stats.cycleCount > 0 && stats.currentCycleDay !== null;

  // Format today's display date
  const todayDateObj = new Date();
  const dateFormatted = todayDateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="flex flex-col gap-6 sm:gap-8 pb-12 animate-fade-in">
      {/* 1. Privacy & Clinical Safety State Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl bg-surface-container text-on-surface-variant border border-surface-container-high/60">
        <div className="flex items-center gap-2.5">
          <Icon name="info" size={18} className="text-secondary shrink-0" />
          <div className="text-xs sm:text-sm">
            <span className="font-semibold text-secondary uppercase tracking-wider text-[11px] mr-2">
              {mode === 'demo' ? 'Demo Preview / Sample Data' : 'Personal Tracking Mode'}
            </span>
            <span className="text-outline hidden sm:inline">•</span>{' '}
            <span>
              Estimates are based on cycle history and are for informational purposes only. Not intended as medical advice or contraception guidance.
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${mode === 'demo' ? 'bg-tertiary' : 'bg-secondary'}`}></span>
          <span className="text-xs font-medium text-tertiary">
            {mode === 'demo' ? 'Sample History Active' : 'User History'}
          </span>
        </div>
      </div>

      {/* 2. Header Welcome & Narrative Bar */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div className="flex flex-col max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-secondary text-xs sm:text-sm mb-1.5">
            <span className="uppercase font-semibold tracking-wider text-[11px]">{dateFormatted}</span>
            <span className="text-outline-variant">•</span>
            <span className="font-semibold tracking-wider text-tertiary uppercase text-[11px]">
              {hasHistory ? `Cycle Day ${stats.currentCycleDay}` : 'No Active Cycle'}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-semibold text-[10px] uppercase">
              {mode === 'demo' ? 'Demo Preview' : 'New User'}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-serif text-on-surface tracking-tight">
            Good morning.
          </h1>
          <p className="text-sm sm:text-base text-on-surface-variant mt-2 leading-relaxed font-sans">
            {hasHistory
              ? 'Welcome to your cycle overview. Cycle dates and phase estimates are calculated from recorded start dates.'
              : 'Welcome to your menstrual wellness tracker. Log your first period to begin tracking your cycle phases, symptoms, and trends.'}
          </p>
        </div>

        {/* Quick Action Hub */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary text-xs sm:text-sm font-semibold shadow-xs hover:bg-[#7b3e4a] transition-colors"
          >
            <Icon name="add" size={16} />
            <span>Log Period</span>
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container-lowest text-on-surface text-xs sm:text-sm font-semibold shadow-xs border border-surface-container hover:bg-surface-container-low transition-colors"
          >
            <Icon name="add_notes" size={16} className="text-primary" />
            <span>Record Today&apos;s Symptoms</span>
          </button>
          <NextLink
            href="/dashboard/menstrual-health/calendar"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-on-surface-variant text-xs sm:text-sm font-semibold hover:bg-surface-container transition-colors"
          >
            <Icon name="calendar_month" size={16} />
            <span>Full Calendar</span>
          </NextLink>
        </div>
      </section>

      {/* 3. Main Current Cycle Visualization Panel */}
      <section className="w-full rounded-2xl bg-surface-container-lowest p-6 sm:p-8 lg:p-10 shadow-xs border border-surface-container relative overflow-hidden">
        {/* Soft atmospheric gradient */}
        <div className="absolute -right-20 -top-20 w-80 h-80 rounded-full bg-gradient-to-br from-secondary-container/30 via-tertiary-fixed/20 to-transparent blur-3xl pointer-events-none"></div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center relative z-10">
          {/* Left Telemetry (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed self-start text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-tertiary"></span>
              <span className="uppercase tracking-wider">Cycle Overview</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-surface-container-lowest text-secondary font-bold">
                {mode === 'demo' ? 'Sample' : 'Live'}
              </span>
            </div>

            <div className="flex flex-col">
              <span className="text-xs uppercase tracking-wider font-semibold text-on-surface-variant">
                Cycle Progress
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-4xl sm:text-5xl font-light text-on-surface">
                  {hasHistory ? `Day ${stats.currentCycleDay}` : 'Day —'}
                </span>
                <span className="text-xl sm:text-2xl font-serif text-secondary">
                  / {Math.round(stats.averageCycleLength) || 28}
                </span>
              </div>
              <p className="text-sm sm:text-base font-serif italic text-on-surface mt-1">
                {hasHistory
                  ? `Estimated ${stats.currentPhase} phase based on cycle history`
                  : 'No period recorded yet'}
              </p>
            </div>

            {/* Metric cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-4 rounded-xl bg-surface-container-low border border-surface-container/60 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-on-surface-variant text-xs uppercase font-semibold">
                    <Icon name="water_drop" size={16} className="text-primary" />
                    <span>Last Period</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-bold">
                    {stats.lastPeriod ? 'Logged' : 'None'}
                  </span>
                </div>
                <span className="font-semibold text-sm sm:text-base text-on-surface mt-1">
                  {stats.lastPeriod
                    ? `${stats.lastPeriod.startDate} to ${stats.lastPeriod.endDate || 'Ongoing'}`
                    : 'No records'}
                </span>
                <span className="text-xs text-secondary">
                  {stats.lastPeriod
                    ? `Duration: ${stats.lastPeriod.durationDays} days`
                    : 'Awaiting first log'}
                </span>
              </div>

              <div className="p-4 rounded-xl bg-surface-container-low border border-surface-container/60 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-on-surface-variant text-xs uppercase font-semibold">
                    <Icon name="event_upcoming" size={16} className="text-tertiary" />
                    <span>Estimated Next</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-tertiary-fixed text-on-tertiary-fixed font-bold">
                    Estimate
                  </span>
                </div>
                <span className="font-semibold text-sm sm:text-base text-on-surface mt-1">
                  {stats.nextPeriodEstimatedDate
                    ? `${stats.nextPeriodEstimatedDate} (Est.)`
                    : 'Requires data'}
                </span>
                <span className="text-xs text-secondary">
                  {stats.daysUntilNextPeriod !== null
                    ? stats.daysUntilNextPeriod > 0
                      ? `Expected in ~${stats.daysUntilNextPeriod} days`
                      : 'Expected around now'
                    : 'Calculate after 1st cycle'}
                </span>
                {stats.nextPeriodWindow && (
                  <div className="flex flex-col mt-0.5">
                    <span className="text-[11px] text-on-surface-variant font-medium">
                      Window: {stats.nextPeriodWindow.windowStart} to {stats.nextPeriodWindow.windowEnd} (±{stats.nextPeriodWindow.uncertaintyDays}d{stats.nextPeriodWindow.isCapped ? ' display cap*' : ''})
                    </span>
                    {stats.nextPeriodWindow.isCapped && (
                      <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                        *Observed variability is wider (±{stats.nextPeriodWindow.actualVariationDays}d sample std dev). Window is capped for calendar display.
                      </span>
                    )}
                    <span className="text-[10px] text-on-surface-variant/80">
                      {stats.nextPeriodWindow.historyDescription}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-xl bg-surface-container text-on-surface-variant text-xs">
              <Icon name="info" size={16} className="text-secondary mt-0.5 shrink-0" />
              <p className="leading-relaxed">
                {stats.nextPeriodWindow?.disclaimer ||
                  'Predictions are calculated from previously recorded menstrual cycle dates and observed historical variation. They are statistical estimates, not medically validated predictions. Actual cycle dates may differ due to natural biological variation and other factors. This tracker does not confirm ovulation, measure hormones, diagnose medical conditions, or provide contraception guidance.'}
              </p>
            </div>
          </div>

          {/* Right Visual Dial & Phase Map (7 cols) */}
          <div className="lg:col-span-7 flex flex-col items-center justify-center">
            <CycleWheel stats={stats} />
          </div>
        </div>
      </section>

      {/* 4. Quick Cycle Statistics Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Average Cycle */}
        <div className="p-5 sm:p-6 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-[11px] uppercase tracking-wider font-semibold">Average Cycle</span>
            <Icon name="timelapse" size={18} className="text-secondary" />
          </div>
          <div className="my-4 flex flex-col">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-light text-on-surface">
                {stats.cycleCount > 1 ? stats.averageCycleLength : '—'}
              </span>
              <span className="text-sm text-on-surface-variant">days</span>
            </div>
            <span className="text-xs text-tertiary mt-1 flex items-center gap-1 font-medium">
              <Icon name="check_circle" size={14} />
              {stats.cycleCount > 1 ? `Calculated across ${stats.cycleCount} cycles` : 'Minimum 2 cycles needed'}
            </span>
          </div>
          <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
            <div
              className="h-full bg-tertiary rounded-full"
              style={{ width: stats.cycleCount > 1 ? `${Math.min(100, (stats.averageCycleLength / 35) * 100)}%` : '0%' }}
            ></div>
          </div>
        </div>

        {/* Card 2: Period Duration */}
        <div className="p-5 sm:p-6 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-[11px] uppercase tracking-wider font-semibold">Period Duration</span>
            <Icon name="water_drop" size={18} className="text-primary" />
          </div>
          <div className="my-4 flex flex-col">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-light text-on-surface">
                {stats.cycleCount > 0 ? stats.averagePeriodDuration : '—'}
              </span>
              <span className="text-sm text-on-surface-variant">days</span>
            </div>
            <span className="text-xs text-secondary mt-1">
              {stats.cycleCount > 0 ? 'Logged menses duration' : 'No records logged'}
            </span>
          </div>
          <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-container rounded-full"
              style={{ width: stats.cycleCount > 0 ? `${Math.min(100, (stats.averagePeriodDuration / 8) * 100)}%` : '0%' }}
            ></div>
          </div>
        </div>

        {/* Card 3: Cycle Variation */}
        <div className="p-5 sm:p-6 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-[11px] uppercase tracking-wider font-semibold">Cycle Variation</span>
            <Icon name="query_stats" size={18} className="text-tertiary" />
          </div>
          <div className="my-4 flex items-end justify-between">
            <div className="flex flex-col">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-light text-on-surface">
                  {stats.cycleCount > 2 ? `±${stats.variationDays}` : '—'}
                </span>
                {stats.cycleCount > 2 && <span className="text-sm text-on-surface-variant">days</span>}
              </div>
              <span className="text-xs text-tertiary mt-1">
                {stats.cycleCount > 2 ? 'Sample std dev (Bessel, s)' : 'Awaiting 3+ cycles (2+ intervals)'}
              </span>
            </div>
            <div className="w-16 h-8 text-tertiary">
              <svg className="w-full h-full" viewBox="0 0 80 40">
                <path d="M 0,28 Q 15,22 30,24 T 55,14 T 80,18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="80" cy="18" fill="currentColor" r="3" />
              </svg>
            </div>
          </div>
          <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
            <div className="h-full bg-tertiary rounded-full" style={{ width: stats.cycleCount > 2 ? '75%' : '0%' }}></div>
          </div>
        </div>

        {/* Card 4: Recorded History */}
        <div className="p-5 sm:p-6 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-[11px] uppercase tracking-wider font-semibold">Recorded History</span>
            <Icon name="history_edu" size={18} className="text-secondary" />
          </div>
          <div className="my-4 flex flex-col">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-light text-on-surface">{stats.cycleCount}</span>
              <span className="text-sm text-on-surface-variant">cycles</span>
            </div>
            <span className="text-xs text-on-surface-variant mt-1">
              {stats.cycleCount > 0 ? 'Historical periods recorded' : 'Empty profile'}
            </span>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${mode === 'demo' ? 'bg-tertiary' : 'bg-primary'}`}></span>
              <span className="text-[11px] font-semibold text-tertiary">
                {mode === 'demo' ? 'Sample Profile' : 'Personal Profile'}
              </span>
            </div>
            <button
              onClick={toggleMode}
              className="text-[11px] text-secondary hover:text-primary font-semibold underline"
            >
              {mode === 'demo' ? 'Try Empty' : 'Try Demo'}
            </button>
          </div>
        </div>
      </section>

      {/* 5. Today's Daily Wellness & Symptom Snapshot */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Daily Summary Bento (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-4 p-6 sm:p-7 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
                  Daily Log
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-secondary-container text-on-secondary-container font-bold">
                  {mode === 'demo' ? 'Demo' : 'Live'}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-serif text-on-surface mt-0.5">
                Today&apos;s Daily Summary
              </h2>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
              todayLog ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-surface-container text-on-surface-variant'
            }`}>
              {todayLog ? 'Logged Today' : 'Not Logged'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="p-4 rounded-xl bg-surface-container-low border border-surface-container/60 flex flex-col justify-between gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-on-surface-variant">Mood</span>
                <Icon name="self_improvement" size={18} className="text-secondary" />
              </div>
              <span className="text-lg font-semibold text-on-surface capitalize">
                {todayLog?.mood || 'Unspecified'}
              </span>
              <span className="text-xs text-secondary">
                {todayLog?.mood ? 'Emotional balance recorded' : 'Log your feelings'}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-low border border-surface-container/60 flex flex-col justify-between gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-on-surface-variant">Energy</span>
                <Icon name="bolt" size={18} className="text-tertiary" />
              </div>
              <span className="text-lg font-semibold text-on-surface">
                {todayLog?.energy ? `${todayLog.energy} / 5 Level` : 'Unspecified'}
              </span>
              <span className="text-xs text-tertiary">
                {todayLog?.energy ? 'Daily vitality level' : 'Log your energy'}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-low border border-surface-container/60 flex flex-col justify-between gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-on-surface-variant">Sleep</span>
                <Icon name="bedtime" size={18} className="text-tertiary" />
              </div>
              <span className="text-lg font-semibold text-on-surface">
                {todayLog?.sleepHours ? `${todayLog.sleepHours} hrs logged` : 'Unspecified'}
              </span>
              <span className="text-xs text-tertiary capitalize">
                {todayLog?.sleepQuality ? `${todayLog.sleepQuality} sleep` : 'Log sleep duration'}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-low border border-surface-container/60 flex flex-col justify-between gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-on-surface-variant">Symptoms</span>
                <Icon name="spa" size={18} className="text-primary" />
              </div>
              <span className="text-lg font-semibold text-on-surface">
                {todayLog && todayLog.symptoms.length > 0 ? `${todayLog.symptoms.length} Logged` : 'None logged'}
              </span>
              <span className="text-xs text-on-surface-variant truncate">
                {todayLog && todayLog.symptoms.length > 0 ? todayLog.symptoms.join(', ') : 'Comfortable baseline'}
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-surface-container-lowest text-tertiary">
                <Icon name="schedule" size={18} />
              </div>
              <div className="flex flex-col">
                <span className="text-xs sm:text-sm font-semibold text-on-surface">
                  {todayLog ? "Today's Check-in Complete" : "No Check-in Recorded for Today"}
                </span>
                <span className="text-xs text-on-surface-variant">
                  {todayLog ? 'Changes update across all views' : 'Takes less than 1 minute'}
                </span>
              </div>
            </div>
            <NextLink
              href="/dashboard/menstrual-health/log"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container-highest text-on-surface text-xs font-semibold hover:bg-surface-container-low transition-colors"
            >
              <span>{todayLog ? 'Update Daily Log' : 'Start Check-in'}</span>
              <Icon name="arrow_forward" size={14} />
            </NextLink>
          </div>
        </div>

        {/* Right: Educational Guide Card (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="p-6 sm:p-7 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex flex-col justify-between flex-1 gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-primary">
                  Cycle Guide
                </span>
                <Icon name="menu_book" size={18} className="text-primary" />
              </div>
              <h3 className="text-xl font-serif text-on-surface">Understanding Your Cycle Phases</h3>
              <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
                The menstrual cycle transitions through four phases: Menstrual, Follicular, Ovulatory, and Luteal. Tracking changes in your energy and daily symptoms helps you understand individual bodily patterns over time.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-low flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-on-surface">Cycle Phases Overview</span>
                <span className="text-xs text-secondary">Informational wellness reading</span>
              </div>
              <NextLink
                href="/dashboard/menstrual-health/insights"
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                <span>View Insights</span>
                <Icon name="arrow_forward" size={14} />
              </NextLink>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Log Modal Trigger */}
      <QuickLogModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}

