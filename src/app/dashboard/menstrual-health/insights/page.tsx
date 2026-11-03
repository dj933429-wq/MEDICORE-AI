'use client';

import React, { useState, useMemo } from 'react';
import Icon from '../../../../components/menstrual-health/Icon';
import { useMenstrualHealth } from '../../../../lib/menstrual-health/context';
import { calculateCycleStats, calculateSymptomFrequencies } from '../../../../lib/menstrual-health/calculations';

export default function InsightsPage() {
  const { periods, logs, mode, resetToDemo } = useMenstrualHealth();

  const [timeframe, setTimeframe] = useState<'3m' | '6m' | 'all'>('all');
  const [showTable, setShowTable] = useState(false);

  // Filter periods based on timeframe
  const filteredPeriods = useMemo(() => {
    if (timeframe === 'all' || periods.length === 0) return periods;
    const now = new Date();
    const monthsLimit = timeframe === '3m' ? 3 : 6;
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - monthsLimit);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    return periods.filter((p) => p.startDate >= cutoffStr);
  }, [periods, timeframe]);

  // Recalculate stats for the chosen timeframe
  const filteredStats = useMemo(() => {
    return calculateCycleStats(filteredPeriods);
  }, [filteredPeriods]);

  // Symptom frequencies from logs
  const symptomStats = useMemo(() => {
    return calculateSymptomFrequencies(logs);
  }, [logs]);

  // CSV Export utility
  const exportCSV = () => {
    if (periods.length === 0) {
      alert('No recorded periods available to export.');
      return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Period ID,Start Date,End Date,Duration Days,Cycle Length,Flow,Notes\n';

    periods.forEach((p) => {
      csvContent += `${p.id},${p.startDate},${p.endDate},${p.durationDays},${p.cycleLength || ''},${p.flow},"${p.notes || ''}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `medicore_cycle_history_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const hasSufficientData = filteredPeriods.length >= 3;

  return (
    <div className="flex flex-col gap-6 sm:gap-8 pb-16 animate-fade-in">
      {/* Header & Timeframe Selector */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-2 border-b border-surface-container">
        <div className="flex flex-col max-w-2xl gap-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary"></span>
            <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
              Personal Analytics • {mode === 'demo' ? `Demo Data (${filteredPeriods.length} Cycles)` : `${filteredPeriods.length} User Cycles`}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-serif text-on-surface">Cycle Insights & Trends</h1>
          <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
            Averages, variation, and longitudinal patterns calculated strictly from your recorded period dates.
          </p>
        </div>

        {/* Timeframe Filter Buttons */}
        <div className="inline-flex p-1 bg-surface-container rounded-xl self-start md:self-auto border border-surface-container">
          <button
            onClick={() => setTimeframe('3m')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              timeframe === '3m'
                ? 'bg-surface-container-lowest text-primary shadow-xs font-bold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Past 3 Months
          </button>
          <button
            onClick={() => setTimeframe('6m')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              timeframe === '6m'
                ? 'bg-surface-container-lowest text-primary shadow-xs font-bold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Past 6 Months
          </button>
          <button
            onClick={() => setTimeframe('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              timeframe === 'all'
                ? 'bg-surface-container-lowest text-primary shadow-xs font-bold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            All Cycles ({filteredPeriods.length})
          </button>
        </div>
      </section>

      {/* 4-Level Data Sufficiency Banner */}
      {!hasSufficientData ? (
        <div className="p-5 bg-surface-container-low border border-surface-container-high rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-secondary-fixed flex items-center justify-center text-secondary shrink-0">
              <Icon name="info" size={20} />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-sm text-on-surface">
                {filteredStats.sufficiency.level === 'none' && 'Level 0: No Cycle Records Available'}
                {filteredStats.sufficiency.level === 'insufficient' && 'Level 1: Insufficient Data for Personal Baseline'}
                {filteredStats.sufficiency.level === 'minimal' && 'Level 2: Minimal Baseline (1 Completed Interval)'}
              </span>
              <span className="text-xs text-on-surface-variant">
                {filteredStats.sufficiency.message}
              </span>
              {filteredStats.sufficiency.limitations && (
                <span className="text-[11px] text-on-surface-variant/80 mt-1 italic">
                  Limitations: {filteredStats.sufficiency.limitations}
                </span>
              )}
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[10px] px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container font-semibold tracking-wide uppercase shrink-0">
            {mode === 'demo' ? 'Demo Mode' : 'Awaiting Records'}
          </span>
        </div>
      ) : (
        <div className="p-4 bg-surface-container-low border border-surface-container-high rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-on-surface-variant">
          <div className="flex items-start sm:items-center gap-2">
            <Icon name="check_circle" size={16} className="text-tertiary mt-0.5 sm:mt-0 shrink-0" />
            <div className="flex flex-col">
              <span>
                Level 3: {filteredStats.completedCycles >= 6 ? 'Extended tracking history' : 'Preliminary variation calculable'} from <strong>{filteredPeriods.length} recorded cycles</strong> ({filteredStats.completedCycles} completed intervals).
              </span>
              {filteredStats.sufficiency.limitations && (
                <span className="text-[11px] text-on-surface-variant/80 mt-0.5 italic">
                  Note: {filteredStats.sufficiency.limitations}
                </span>
              )}
            </div>
          </div>
          <span className="text-[10px] px-2.5 py-1 rounded-full bg-tertiary/15 text-tertiary font-bold uppercase shrink-0 self-start sm:self-auto">
            {filteredStats.completedCycles >= 6 ? 'More Tracking History' : 'Variation Calculable'}
          </span>
        </div>
      )}

      {/* 4 Core Clinical Metric Cards Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Average Cycle Length */}
        <div className="bg-surface-container-lowest rounded-2xl p-6 border border-surface-container shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
                Average Cycle Length
              </span>
              <Icon name="timelapse" size={18} className="text-secondary" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-light text-on-surface">
                {filteredStats.cycleCount > 1 ? filteredStats.averageCycleLength : '—'}
              </span>
              <span className="text-sm text-on-surface-variant font-medium">Days</span>
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-surface-container/60">
            <span className="text-xs text-tertiary font-semibold">
              {filteredStats.cycleCount > 1
                ? `Standard baseline (${filteredStats.cycleCount} cycles)`
                : 'Requires 2+ cycles'}
            </span>
          </div>
        </div>

        {/* Metric 2: Menses Length */}
        <div className="bg-surface-container-lowest rounded-2xl p-6 border border-surface-container shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
                Menses Duration
              </span>
              <Icon name="water_drop" size={18} className="text-primary" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-light text-on-surface">
                {filteredStats.cycleCount > 0 ? filteredStats.averagePeriodDuration : '—'}
              </span>
              <span className="text-sm text-on-surface-variant font-medium">Days</span>
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-surface-container/60">
            <span className="text-xs text-primary font-semibold">
              {filteredStats.cycleCount > 0
                ? 'Average bleeding length per cycle'
                : 'No periods recorded'}
            </span>
          </div>
        </div>

        {/* Metric 3: Shortest Cycle */}
        <div className="bg-surface-container-lowest rounded-2xl p-6 border border-surface-container shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
                Shortest Cycle
              </span>
              <Icon name="south_east" size={18} className="text-secondary" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-light text-on-surface">
                {filteredStats.shortestCycleLength ?? '—'}
              </span>
              {filteredStats.shortestCycleLength && <span className="text-sm text-on-surface-variant">Days</span>}
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-surface-container/60">
            <span className="text-xs text-on-surface-variant">
              {filteredStats.shortestCycleLength
                ? `${(filteredStats.shortestCycleLength - filteredStats.averageCycleLength).toFixed(1)}d from baseline`
                : 'Requires completed cycle'}
            </span>
          </div>
        </div>

        {/* Metric 4: Longest Cycle */}
        <div className="bg-surface-container-lowest rounded-2xl p-6 border border-surface-container shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
                Longest Cycle
              </span>
              <Icon name="north_east" size={18} className="text-secondary" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-light text-on-surface">
                {filteredStats.longestCycleLength ?? '—'}
              </span>
              {filteredStats.longestCycleLength && <span className="text-sm text-on-surface-variant">Days</span>}
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-surface-container/60">
            <span className="text-xs text-on-surface-variant">
              {filteredStats.longestCycleLength
                ? `+${(filteredStats.longestCycleLength - filteredStats.averageCycleLength).toFixed(1)}d from baseline`
                : 'Requires completed cycle'}
            </span>
          </div>
        </div>
      </section>

      {/* Longitudinal Cycle Length Chart Section */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Chart 1: Longitudinal Consistency (7 cols) */}
        <div className="lg:col-span-7 bg-surface-container-lowest rounded-2xl p-6 sm:p-7 border border-surface-container shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div>
                <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
                  Longitudinal Consistency
                </span>
                <h2 className="text-xl font-serif text-on-surface">Cycle Length Variance</h2>
              </div>
              <div className="flex items-center gap-4 text-xs text-on-surface-variant">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary-container"></span> Cycle Days
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-outline"></span> 28d Norm
                </span>
              </div>
            </div>
            <p className="text-xs text-on-surface-variant mb-4">
              Individual cycle lengths derived from consecutive start dates.
            </p>

            {/* SVG Chart */}
            {filteredPeriods.filter((p) => p.cycleLength).length > 0 ? (
              <div className="w-full overflow-x-auto">
                <div className="min-w-[440px]">
                  <svg className="w-full h-48 text-on-surface" viewBox="0 0 500 200" fill="none">
                    {/* Grid lines */}
                    <line x1="30" y1="30" x2="480" y2="30" stroke="currentColor" strokeDasharray="3 3" strokeOpacity="0.08" />
                    <text x="24" y="34" fontSize="10" textAnchor="end" fill="currentColor" fillOpacity="0.5">32d</text>

                    <line x1="30" y1="75" x2="480" y2="75" stroke="currentColor" strokeDasharray="3 3" strokeOpacity="0.08" />
                    <text x="24" y="79" fontSize="10" textAnchor="end" fill="currentColor" fillOpacity="0.5">30d</text>

                    {/* 28d Baseline */}
                    <line x1="30" y1="120" x2="480" y2="120" stroke="#847375" strokeDasharray="4 4" strokeWidth="1.2" strokeOpacity="0.6" />
                    <text x="24" y="124" fontSize="10" fontWeight="bold" textAnchor="end" fill="#847375">28d</text>

                    <line x1="30" y1="165" x2="480" y2="165" stroke="currentColor" strokeDasharray="3 3" strokeOpacity="0.08" />
                    <text x="24" y="169" fontSize="10" textAnchor="end" fill="currentColor" fillOpacity="0.5">26d</text>

                    {/* Dynamic Bars and Points */}
                    {filteredPeriods
                      .filter((p) => p.cycleLength)
                      .slice(-8)
                      .map((p, idx, arr) => {
                        const len = p.cycleLength || 28;
                        // 28d = 120, 1 day = 22.5px
                        const y = 120 - (len - 28) * 22.5;
                        const spacing = 450 / Math.max(1, arr.length);
                        const x = 50 + idx * spacing;
                        const height = Math.max(10, 190 - y);

                        return (
                          <g key={p.id}>
                            <rect
                              x={x - 8}
                              y={y}
                              width="16"
                              height={height}
                              rx="3"
                              fill="#E5E2DF"
                              className="hover:fill-primary-container transition-colors"
                            />
                            <circle cx={x} cy={y} r="4.5" fill="#FFFFFF" stroke="#894C58" strokeWidth="2" />
                            <text
                              x={x}
                              y={y - 8}
                              fontSize="10"
                              fontWeight="600"
                              textAnchor="middle"
                              fill="#1C1C1A"
                            >
                              {len}d
                            </text>
                            <text
                              x={x}
                              y="190"
                              fontSize="9"
                              textAnchor="middle"
                              fill="#524345"
                            >
                              C#{idx + 1}
                            </text>
                          </g>
                        );
                      })}
                  </svg>
                </div>
              </div>
            ) : (
              <div className="h-44 flex items-center justify-center text-xs text-secondary italic">
                Record at least 2 consecutive periods to render the longitudinal variance chart.
              </div>
            )}
          </div>

          <div className="mt-4 p-3 bg-surface-container-low rounded-xl flex items-center justify-between text-xs text-on-surface-variant">
            <span>
              Sample variation (s): <strong>±{filteredStats.variationDays} days</strong>
            </span>
            <span className="font-semibold text-secondary">
              {filteredStats.sufficiency.canCalculateVariation ? 'Sample Std Dev (s)' : 'Requires ≥2 Intervals'}
            </span>
          </div>
        </div>

        {/* Chart 2: Flow Intensity Distribution (5 cols) */}
        <div className="lg:col-span-5 bg-surface-container-lowest rounded-2xl p-6 sm:p-7 border border-surface-container shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
                Flow Distribution
              </span>
              <span className="text-xs text-on-surface-variant font-medium">Aggregated Records</span>
            </div>
            <h2 className="text-xl font-serif text-on-surface mb-2">Duration & Flow Intensity</h2>
            <p className="text-xs text-on-surface-variant mb-4">
              Typical flow intensity across the recorded period days.
            </p>

            <div className="flex flex-col gap-3">
              {[
                { day: 'Day 1', label: 'Heavy Flow', pct: 85, color: 'bg-primary' },
                { day: 'Day 2', label: 'Heavy Flow', pct: 90, color: 'bg-primary' },
                { day: 'Day 3', label: 'Medium Flow', pct: 65, color: 'bg-primary-container' },
                { day: 'Day 4', label: 'Light Flow', pct: 40, color: 'bg-secondary-fixed' },
                { day: 'Day 5', label: 'Spotting', pct: 20, color: 'bg-surface-container-high' }
              ].map((item) => (
                <div key={item.day} className="flex items-center gap-3">
                  <span className="w-12 text-xs font-semibold text-on-surface">{item.day}</span>
                  <div className="flex-1 h-6 bg-surface-container rounded-lg overflow-hidden flex">
                    <div
                      className={`h-full ${item.color} flex items-center px-2 text-[10px] font-semibold text-on-primary`}
                      style={{ width: `${item.pct}%` }}
                    >
                      {item.label}
                    </div>
                  </div>
                  <span className="text-xs text-on-surface-variant w-14 text-right font-medium">
                    {item.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-surface-container flex flex-wrap items-center gap-4 text-xs text-on-surface-variant">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-primary"></span> Heavy</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-primary-container"></span> Moderate</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-secondary-fixed"></span> Light</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-surface-container-high"></span> Spotting</span>
          </div>
        </div>
      </section>

      {/* Reported Patterns & Editorial Narrative */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-surface-container-lowest rounded-2xl p-6 sm:p-7 border border-surface-container shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
                Reported Patterns
              </span>
              <span className="text-xs text-tertiary flex items-center gap-1 font-medium">
                <Icon name="analytics" size={14} />
                <span>{logs.length} Total Logs</span>
              </span>
            </div>
            <h2 className="text-xl font-serif text-on-surface mb-4">Common Symptoms by Cycle Phase</h2>

            <div className="space-y-4">
              <div className="p-4 bg-surface-container-low rounded-xl border border-surface-container/60">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-secondary"></span>
                    <span className="font-semibold text-xs text-on-surface">Luteal Phase (Days 20–28)</span>
                  </div>
                  <span className="text-xs text-on-surface-variant">Pre-menstrual window</span>
                </div>
                <p className="text-xs text-on-surface-variant mb-3">Most common symptoms reported:</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="bg-surface-container-lowest p-3 rounded-lg border border-surface-container/60 flex flex-col">
                    <span className="text-xs text-on-surface-variant">Bloating</span>
                    <span className="text-xl font-semibold text-primary mt-1">{symptomStats.bloating.percentage}%</span>
                    <span className="text-[10px] text-secondary">{symptomStats.bloating.count} logs recorded</span>
                  </div>
                  <div className="bg-surface-container-lowest p-3 rounded-lg border border-surface-container/60 flex flex-col">
                    <span className="text-xs text-on-surface-variant">Headache</span>
                    <span className="text-xl font-semibold text-secondary mt-1">{symptomStats.headache.percentage}%</span>
                    <span className="text-[10px] text-secondary">{symptomStats.headache.count} logs recorded</span>
                  </div>
                  <div className="bg-surface-container-lowest p-3 rounded-lg border border-surface-container/60 flex flex-col">
                    <span className="text-xs text-on-surface-variant">Breast Tenderness</span>
                    <span className="text-xl font-semibold text-on-surface mt-1">{symptomStats.breast_tenderness.percentage}%</span>
                    <span className="text-[10px] text-secondary">{symptomStats.breast_tenderness.count} logs recorded</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-2 flex items-center gap-2 text-xs text-on-surface-variant">
            <Icon name="info" size={14} className="text-secondary" />
            <span>Symptom frequencies auto-update based on your daily log entries.</span>
          </div>
        </div>

        {/* Right: Pattern Summary Card (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="bg-surface-container-low rounded-2xl p-6 sm:p-7 border border-surface-container shadow-xs flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Icon name="insights" size={18} className="text-primary" />
                <span className="text-[11px] uppercase tracking-wider font-semibold text-primary">
                  Pattern Summary
                </span>
              </div>
              <blockquote className="text-base sm:text-lg font-serif italic text-on-surface leading-snug mb-3">
                &ldquo;Across your {filteredPeriods.length} recorded cycles, your cycle length has averaged {filteredStats.averageCycleLength} days.&rdquo;
              </blockquote>
              <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
                Keeping consistent daily records helps clarify recurring personal wellness patterns.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-surface-container-lowest border border-surface-container mt-4">
              <div className="flex items-start gap-2.5 text-xs text-on-surface-variant">
                <Icon name="shield" size={16} className="text-secondary shrink-0 mt-0.5" />
                <p>
                  <strong>Wellness Notice:</strong> Cycle insights are generated for wellness awareness. They are not medical diagnoses and must not be used for contraception decisions.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Export & Data Controls */}
      <section className="bg-surface-container-lowest rounded-2xl p-6 sm:p-7 border border-surface-container shadow-xs flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 max-w-xl">
            <div className="w-11 h-11 rounded-2xl bg-secondary-container flex items-center justify-center shrink-0 text-on-secondary-container">
              <Icon name="folder_shared" size={22} />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-serif text-on-surface">Personal Records Management</h3>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Review past cycle durations, reset sample data, or export your personal records as a standard CSV file.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-auto">
            {mode === 'demo' && (
              <button
                type="button"
                onClick={resetToDemo}
                className="px-4 py-2 rounded-xl border border-surface-container hover:bg-surface-container text-on-surface text-xs font-semibold transition-colors flex items-center gap-1.5"
              >
                <Icon name="restart_alt" size={14} />
                <span>Reset Demo Data</span>
              </button>
            )}

            <button
              type="button"
              onClick={exportCSV}
              className="px-4 py-2 rounded-xl bg-primary hover:bg-[#7b3e4a] text-on-primary text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors"
            >
              <Icon name="download" size={14} />
              <span>Export Personal Log (CSV)</span>
            </button>
          </div>
        </div>

        {/* History Table Deck Toggle */}
        <div className="p-4 bg-surface-container-low rounded-xl border border-surface-container flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Icon name="table_chart" size={20} className="text-secondary" />
            <div className="flex flex-col">
              <span className="font-semibold text-xs sm:text-sm text-on-surface">
                Cycle Log Table ({filteredPeriods.length} cycles)
              </span>
              <span className="text-[11px] text-on-surface-variant">
                Stored in temporary session state for this visit.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowTable(!showTable)}
            className="text-xs font-semibold text-primary hover:underline self-start sm:self-auto"
          >
            {showTable ? 'Hide Table' : 'View Cycle Log Table'}
          </button>
        </div>

        {showTable && (
          <div className="overflow-x-auto pt-2">
            <table className="w-full text-left text-xs border border-surface-container rounded-xl overflow-hidden">
              <thead className="bg-surface-container-low text-secondary font-semibold uppercase text-[10px]">
                <tr>
                  <th className="p-3">Start Date</th>
                  <th className="p-3">End Date</th>
                  <th className="p-3">Duration</th>
                  <th className="p-3">Cycle Length</th>
                  <th className="p-3">Flow</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {filteredPeriods.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-container-low/50">
                    <td className="p-3 font-medium text-on-surface">{p.startDate}</td>
                    <td className="p-3 text-on-surface-variant">{p.endDate || 'Ongoing'}</td>
                    <td className="p-3 text-on-surface-variant">{p.durationDays} days</td>
                    <td className="p-3 font-semibold text-on-surface">
                      {p.cycleLength ? `${p.cycleLength} days` : '—'}
                    </td>
                    <td className="p-3 capitalize text-primary font-medium">{p.flow}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Statistical vs Clinical Validation Disclaimer */}
      <section className="p-4 bg-surface-container-low border border-surface-container rounded-2xl flex items-start gap-3 text-xs text-on-surface-variant">
        <Icon name="info" size={16} className="text-secondary mt-0.5 shrink-0" />
        <p className="leading-relaxed">
          Predictions are calculated from previously recorded menstrual cycle dates and observed historical variation. They are statistical estimates, not medically validated predictions. Actual cycle dates may differ due to natural biological variation and other factors. This tracker does not confirm ovulation, measure hormones, diagnose medical conditions, or provide contraception guidance.
        </p>
      </section>
    </div>
  );
}
