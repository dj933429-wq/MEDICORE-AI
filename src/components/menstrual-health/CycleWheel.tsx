'use client';

import React from 'react';
import { CycleStats } from '../../lib/menstrual-health/types';

interface CycleWheelProps {
  stats: CycleStats;
}

export default function CycleWheel({ stats }: CycleWheelProps) {
  const currentDay = stats.currentCycleDay ?? 0;
  const cycleLength = stats.averageCycleLength > 0 ? Math.round(stats.averageCycleLength) : 28;
  const hasHistory = stats.cycleCount > 0 && currentDay > 0;

  // Radius = 96, Circumference = 2 * PI * 96 ~ 603.18
  const r = 96;
  const circumference = 2 * Math.PI * r;

  // Proportions of the 4 standard phases:
  // Menstrual: Days 1-5 (5 days)
  // Follicular: Days 6-13 (8 days)
  // Ovulatory: Days 14-16 (3 days)
  // Luteal: Days 17-cycleLength (remainder)
  const menstrualDays = 5;
  const follicularDays = 8;
  const ovulatoryDays = 3;
  const lutealDays = Math.max(1, cycleLength - (menstrualDays + follicularDays + ovulatoryDays));

  const menstrualStroke = (menstrualDays / cycleLength) * circumference;
  const follicularStroke = (follicularDays / cycleLength) * circumference;
  const ovulatoryStroke = (ovulatoryDays / cycleLength) * circumference;
  const lutealStroke = (lutealDays / cycleLength) * circumference;

  // Angle for marker based on currentDay
  // Day 1 starts at top (-90 degrees)
  const dayClamped = Math.min(Math.max(1, currentDay), cycleLength);
  const angleRad = ((dayClamped - 0.5) / cycleLength) * (2 * Math.PI) - Math.PI / 2;
  const markerX = 120 + r * Math.cos(angleRad);
  const markerY = 120 + r * Math.sin(angleRad);

  return (
    <div className="flex flex-col items-center justify-center w-full">
      {/* SVG Cycle Wheel */}
      <div className="relative w-64 h-64 sm:w-80 sm:h-80 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 240 240">
          {/* Base track */}
          <circle
            cx="120"
            cy="120"
            r={r}
            fill="none"
            stroke="#E5E2DF"
            strokeWidth="8"
          />

          {hasHistory && (
            <>
              {/* Phase 1: Menstrual */}
              <circle
                cx="120"
                cy="120"
                r={r}
                fill="none"
                stroke="#C9828F"
                strokeWidth="8"
                strokeDasharray={`${menstrualStroke} ${circumference - menstrualStroke}`}
                strokeDashoffset={0}
                strokeLinecap="round"
              />

              {/* Phase 2: Follicular */}
              <circle
                cx="120"
                cy="120"
                r={r}
                fill="none"
                stroke="#E8C9CC"
                strokeWidth="8"
                strokeDasharray={`${follicularStroke} ${circumference - follicularStroke}`}
                strokeDashoffset={-menstrualStroke}
                strokeLinecap="round"
              />

              {/* Phase 3: Ovulatory */}
              <circle
                cx="120"
                cy="120"
                r={r}
                fill="none"
                stroke="#A6B5A0"
                strokeWidth="11"
                strokeDasharray={`${ovulatoryStroke} ${circumference - ovulatoryStroke}`}
                strokeDashoffset={-(menstrualStroke + follicularStroke)}
                strokeLinecap="round"
              />

              {/* Phase 4: Luteal */}
              <circle
                cx="120"
                cy="120"
                r={r}
                fill="none"
                stroke="#806779"
                strokeWidth="8"
                strokeDasharray={`${lutealStroke} ${circumference - lutealStroke}`}
                strokeDashoffset={-(menstrualStroke + follicularStroke + ovulatoryStroke)}
                strokeLinecap="round"
              />

              {/* Marker pin at current day */}
              <circle
                cx={markerX}
                cy={markerY}
                r="7"
                fill="#546250"
                className="animate-pulse"
              />
              <circle
                cx={markerX}
                cy={markerY}
                r="3.5"
                fill="#FFFFFF"
              />
            </>
          )}
        </svg>

        {/* Center Text Hub */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4">
          <span className="text-[11px] uppercase tracking-widest text-secondary font-semibold">
            {hasHistory ? 'Cycle Day (Estimated)' : 'No Period Recorded'}
          </span>
          <span className="text-3xl sm:text-4xl font-light text-on-surface leading-none mt-1.5 font-sans">
            {hasHistory ? `Day ${currentDay}` : '—'}
          </span>
          <span className="text-sm sm:text-base font-serif italic text-primary mt-1">
            {hasHistory
              ? stats.currentPhase
                ? `${stats.currentPhase.charAt(0).toUpperCase() + stats.currentPhase.slice(1)} Phase`
                : 'Active Cycle'
              : 'Add First Period'}
          </span>
          <span className="text-[11px] text-on-surface-variant mt-0.5">
            {hasHistory ? '(Estimated Range)' : 'Start tracking today'}
          </span>
        </div>
      </div>

      {/* 4 Phase Legend Indicator */}
      <div className="w-full max-w-lg mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
        <div className="p-2 rounded-xl bg-surface-container flex flex-col items-center">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#C9828F' }}></span>
            <span className="font-semibold text-on-surface">Menstrual</span>
          </div>
          <span className="text-on-surface-variant text-[11px]">Days 1–5</span>
        </div>

        <div className="p-2 rounded-xl bg-surface-container flex flex-col items-center">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#E8C9CC' }}></span>
            <span className="font-semibold text-on-surface">Follicular</span>
          </div>
          <span className="text-on-surface-variant text-[11px]">Days 6–13</span>
        </div>

        <div className={`p-2 rounded-xl flex flex-col items-center ${
          stats.currentPhase === 'ovulatory'
            ? 'bg-surface-container-high ring-1 ring-tertiary/40 shadow-xs'
            : 'bg-surface-container'
        }`}>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#A6B5A0' }}></span>
            <span className="font-semibold text-tertiary">Ovulatory</span>
          </div>
          <span className="text-tertiary text-[11px]">Days 14–16 {stats.currentPhase === 'ovulatory' ? '(Now)' : ''}</span>
        </div>

        <div className="p-2 rounded-xl bg-surface-container flex flex-col items-center">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#806779' }}></span>
            <span className="font-semibold text-on-surface">Luteal</span>
          </div>
          <span className="text-on-surface-variant text-[11px]">Days 17–{cycleLength}</span>
        </div>
      </div>
    </div>
  );
}

