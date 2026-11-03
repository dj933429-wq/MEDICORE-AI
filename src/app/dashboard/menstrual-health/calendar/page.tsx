'use client';

import React, { useState, useMemo } from 'react';
import Icon from '../../../../components/menstrual-health/Icon';
import PeriodRecordModal from '../../../../components/menstrual-health/PeriodRecordModal';
import QuickLogModal from '../../../../components/menstrual-health/QuickLogModal';
import { useMenstrualHealth } from '../../../../lib/menstrual-health/context';
import { formatDateISO, parseDate, daysBetween } from '../../../../lib/menstrual-health/calculations';

export default function CalendarPage() {
  const { periods, logs, stats, mode, selectedDate, setSelectedDate, getLogForDate } = useMenstrualHealth();

  // Month navigation state: Year and Month index (0-11)
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth());
  const [viewMode, setViewMode] = useState<'month' | 'cycle'>('month');

  // Modals
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [quickLogOpen, setQuickLogOpen] = useState(false);

  const todayIso = formatDateISO(new Date());

  // Navigate months
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleGoToday = () => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
    setSelectedDate(formatDateISO(now));
  };

  // Month title string (e.g. "October 2026")
  const monthTitle = new Date(currentYear, currentMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  });

  // Build calendar matrix (Monday through Sunday)
  const calendarCells = useMemo(() => {
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);

    // Day of week: 0 (Sun) to 6 (Sat). We want Monday as 0:
    let startingDayOfWeek = firstDayOfMonth.getDay() - 1;
    if (startingDayOfWeek === -1) startingDayOfWeek = 6;

    const totalDays = lastDayOfMonth.getDate();

    // Previous month filler days
    const prevMonthLastDay = new Date(currentYear, currentMonth, 0).getDate();
    const cells = [];

    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      const prevDate = new Date(currentYear, currentMonth - 1, dayNum);
      cells.push({
        dateStr: formatDateISO(prevDate),
        dayNum,
        isCurrentMonth: false
      });
    }

    // Current month days
    for (let day = 1; day <= totalDays; day++) {
      const d = new Date(currentYear, currentMonth, day);
      cells.push({
        dateStr: formatDateISO(d),
        dayNum: day,
        isCurrentMonth: true
      });
    }

    // Trailing next month filler days to complete grid (multiples of 7)
    const remaining = 7 - (cells.length % 7);
    if (remaining < 7) {
      for (let day = 1; day <= remaining; day++) {
        const nextDate = new Date(currentYear, currentMonth + 1, day);
        cells.push({
          dateStr: formatDateISO(nextDate),
          dayNum: day,
          isCurrentMonth: false
        });
      }
    }

    return cells;
  }, [currentYear, currentMonth]);

  // Determine period status for each date
  const isPeriodDay = (dateStr: string) => {
    return periods.find((p) => dateStr >= p.startDate && dateStr <= (p.endDate || p.startDate));
  };

  // Determine estimated next period days (3 days span starting at nextPeriodEstimatedDate)
  const isEstimatedNextPeriod = (dateStr: string) => {
    if (!stats.nextPeriodEstimatedDate) return false;
    const estStart = parseDate(stats.nextPeriodEstimatedDate);
    const estEnd = new Date(estStart);
    estEnd.setDate(estEnd.getDate() + 2); // 3 day window

    const check = parseDate(dateStr);
    return check >= estStart && check <= estEnd;
  };

  // Check if date has a daily log with symptoms
  const getSymptomsForDate = (dateStr: string) => {
    const log = logs.find((l) => l.date === dateStr);
    return log && log.symptoms.length > 0 ? log.symptoms : null;
  };

  // Selected date details
  const selectedLog = getLogForDate(selectedDate);
  const selectedPeriod = isPeriodDay(selectedDate);

  // Compute cycle day for selected date if within recent period
  const selectedCycleDay = useMemo(() => {
    if (!stats.lastPeriod) return null;
    const lastStart = parseDate(stats.lastPeriod.startDate);
    const sel = parseDate(selectedDate);
    const diff = daysBetween(lastStart, sel);
    if (diff >= 0 && diff < (stats.averageCycleLength || 28) + 14) {
      return diff + 1;
    }
    return null;
  }, [stats.lastPeriod, stats.averageCycleLength, selectedDate]);

  const selectedDateFormatted = useMemo(() => {
    try {
      const [y, m, d] = selectedDate.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  return (
    <div className="flex flex-col gap-6 sm:gap-8 pb-12 animate-fade-in">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-2 border-b border-surface-container">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-widest font-semibold text-secondary">
              Menstrual Rhythm
            </span>
            <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-semibold text-[10px] uppercase">
              {mode === 'demo' ? 'Demo Sample Data' : 'Live User Calendar'}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-serif text-on-surface tracking-tight">Cycle Calendar</h1>
        </div>

        {/* View Switcher */}
        <div className="flex items-center gap-1 bg-surface-container-low p-1 rounded-xl self-start md:self-auto border border-surface-container">
          <button
            onClick={() => setViewMode('month')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'month'
                ? 'bg-surface-container-lowest text-on-surface shadow-xs font-bold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Month View
          </button>
          <button
            onClick={() => setViewMode('cycle')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'cycle'
                ? 'bg-surface-container-lowest text-on-surface shadow-xs font-bold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Cycle View (Day 1–28)
          </button>
        </div>
      </div>

      {/* Month Navigation & Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-surface-container-lowest p-4 sm:p-5 rounded-2xl border border-surface-container shadow-xs">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-1">
            <button
              onClick={handlePrevMonth}
              aria-label="Previous month"
              className="w-8 h-8 rounded-xl flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors"
            >
              <Icon name="chevron_left" size={18} />
            </button>
            <span className="font-serif text-lg sm:text-xl font-semibold text-on-surface min-w-[150px] text-center">
              {monthTitle}
            </span>
            <button
              onClick={handleNextMonth}
              aria-label="Next month"
              className="w-8 h-8 rounded-xl flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors"
            >
              <Icon name="chevron_right" size={18} />
            </button>
          </div>
          <button
            onClick={handleGoToday}
            className="px-3.5 py-1 rounded-full bg-surface-container text-on-surface text-xs uppercase font-semibold tracking-wider hover:bg-surface-container-high transition-colors"
          >
            Today
          </button>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-on-surface-variant">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-primary"></span>
            <span>Recorded Period</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-primary-fixed border border-dashed border-primary"></span>
            <span>Estimated Next Period</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-outline"></span>
            <span>Logged Symptoms</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Calendar (8 cols) + Detail Inspection Drawer (4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: 7-Column Calendar Grid */}
        <div className="xl:col-span-8 flex flex-col gap-4">
          <div className="bg-surface-container-lowest rounded-2xl p-4 sm:p-6 border border-surface-container shadow-xs">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 mb-2 text-center">
              {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((dayName) => (
                <span key={dayName} className="text-[11px] font-semibold text-secondary py-2 tracking-wider">
                  {dayName}
                </span>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {calendarCells.map((cell) => {
                const period = isPeriodDay(cell.dateStr);
                const isEstimated = isEstimatedNextPeriod(cell.dateStr);
                const symptoms = getSymptomsForDate(cell.dateStr);
                const isSelected = selectedDate === cell.dateStr;
                const isToday = todayIso === cell.dateStr;

                return (
                  <div
                    key={cell.dateStr}
                    onClick={() => setSelectedDate(cell.dateStr)}
                    className={`min-h-[85px] sm:min-h-[96px] p-2 rounded-xl transition-all cursor-pointer flex flex-col justify-between border ${
                      !cell.isCurrentMonth
                        ? 'bg-surface-container-low/40 opacity-40 border-transparent'
                        : isSelected
                        ? 'bg-surface-container-lowest border-primary ring-2 ring-primary/30 shadow-md'
                        : period
                        ? 'bg-primary-fixed/25 border-primary/20 hover:bg-primary-fixed/35'
                        : isEstimated
                        ? 'bg-primary-fixed/15 border-dashed border-primary/50'
                        : 'bg-surface-container-lowest border-surface-container/60 hover:bg-surface-container-low'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <span
                          className={`text-xs font-semibold ${
                            period || isEstimated ? 'text-primary font-bold' : cell.isCurrentMonth ? 'text-on-surface' : 'text-on-surface-variant'
                          }`}
                        >
                          {cell.dayNum}
                        </span>
                        {isToday && (
                          <span className="px-1 py-0.2 rounded-full bg-primary text-on-primary text-[8px] uppercase font-bold">
                            Today
                          </span>
                        )}
                      </div>

                      {period && (
                        <span className="text-[9px] font-semibold text-primary uppercase">
                          {period.flow === 'heavy' ? 'Heavy' : period.flow === 'light' ? 'Light' : 'Med'}
                        </span>
                      )}

                      {isEstimated && (
                        <span className="text-[9px] px-1 rounded bg-primary/10 text-primary font-bold">
                          Est.
                        </span>
                      )}
                    </div>

                    {/* Bottom Status / Symptom Dot */}
                    <div className="flex items-center justify-between mt-auto pt-1">
                      {period ? (
                        <div className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                          <span className="text-[9px] text-primary hidden sm:inline capitalize">
                            Period
                          </span>
                        </div>
                      ) : isEstimated ? (
                        <span className="text-[9px] text-primary/80 font-medium hidden sm:inline">
                          Expected
                        </span>
                      ) : (
                        <span className="h-1.5"></span>
                      )}

                      {symptoms && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-outline"
                          title={`Symptoms: ${symptoms.join(', ')}`}
                        ></span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Baseline & Estimation Disclaimer Deck */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-surface-container-lowest p-5 rounded-2xl border border-surface-container shadow-xs flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="info" size={18} className="text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wider text-secondary">
                  Cycle Estimation Notice
                </span>
              </div>
              <p className="text-xs sm:text-sm text-on-surface leading-relaxed mb-3">
                Calendar predictions are calculated from recorded start dates. They are not medical advice or contraception guidance.
              </p>
              <div className="flex items-center gap-1.5 text-secondary text-xs">
                <Icon name="restart_alt" size={14} />
                <span>Predictions recalculate when period dates are saved</span>
              </div>
            </div>

            <div className="bg-surface-container-lowest p-5 rounded-2xl border border-surface-container shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-secondary">
                  Cycle Baseline
                </span>
                <span className="text-xs font-bold text-primary">
                  {stats.cycleCount} Cycles Recorded
                </span>
              </div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-3xl font-light text-on-surface">
                  {stats.cycleCount > 1 ? stats.averageCycleLength : '—'}
                </span>
                <span className="text-xs text-on-surface-variant">Day Average Cycle</span>
              </div>
              <div className="p-2.5 rounded-xl bg-surface-container-low text-xs text-on-surface-variant flex items-start gap-2">
                <Icon name="calendar_today" size={14} className="text-secondary mt-0.5 shrink-0" />
                <span>Consistent logging of each period start date improves calendar accuracy.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Selected Date Inspection Drawer (4 cols) */}
        <div className="xl:col-span-4 flex flex-col gap-4">
          <div className="bg-surface-container-lowest rounded-2xl p-5 sm:p-6 border border-surface-container shadow-xs flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
                  Selected Date
                </span>
                {selectedCycleDay && (
                  <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface text-xs font-semibold">
                    Cycle Day {selectedCycleDay}
                  </span>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-serif text-on-surface">{selectedDateFormatted}</h2>
              <span className="text-xs text-on-surface-variant">
                {selectedPeriod ? 'Recorded bleeding day' : isEstimatedNextPeriod(selectedDate) ? 'Estimated next period window' : 'Regular cycle day'}
              </span>
            </div>

            {/* Logged details cards */}
            <div className="flex flex-col gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-secondary">
                Logged Details
              </span>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 bg-surface-container-low rounded-xl border border-surface-container/60">
                  <span className="text-[10px] text-on-surface-variant block uppercase font-semibold">
                    Period Status
                  </span>
                  <span className="font-semibold text-sm text-on-surface mt-0.5 capitalize">
                    {selectedPeriod ? `${selectedPeriod.flow} Flow` : selectedLog?.flow !== 'none' && selectedLog?.flow ? `${selectedLog.flow} Flow` : 'No Bleeding'}
                  </span>
                </div>

                <div className="p-3 bg-surface-container-low rounded-xl border border-surface-container/60">
                  <span className="text-[10px] text-on-surface-variant block uppercase font-semibold">
                    Mood & Energy
                  </span>
                  <span className="font-semibold text-sm text-on-surface mt-0.5 capitalize">
                    {selectedLog?.mood ? `${selectedLog.mood}` : 'Not logged'}
                    {selectedLog?.energy ? ` (${selectedLog.energy}/5)` : ''}
                  </span>
                </div>
              </div>

              {/* Symptoms */}
              <div className="p-3 bg-surface-container-low rounded-xl border border-surface-container/60 flex flex-col gap-1.5">
                <span className="text-[10px] text-on-surface-variant uppercase font-semibold">Symptoms</span>
                {selectedLog && selectedLog.symptoms.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {selectedLog.symptoms.map((s) => (
                      <span
                        key={s}
                        className="px-2 py-0.5 rounded-full bg-surface-container-lowest text-on-surface text-xs font-medium border border-surface-container"
                      >
                        {s.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-secondary italic">No symptoms recorded for this day</span>
                )}
              </div>

              {/* Personal Notes */}
              <div className="p-3 bg-surface-container-low rounded-xl border border-surface-container/60 flex flex-col gap-1">
                <span className="text-[10px] text-on-surface-variant uppercase font-semibold">Personal Notes</span>
                <span className="text-xs text-on-surface leading-relaxed">
                  {selectedLog?.notes || selectedPeriod?.notes || 'No notes added for this date.'}
                </span>
              </div>
            </div>

            {/* Quick Actions for Selected Day */}
            <div className="flex flex-col gap-2 pt-2 border-t border-surface-container/80">
              <button
                onClick={() => setPeriodModalOpen(true)}
                className="w-full py-2.5 px-4 rounded-xl bg-primary hover:bg-[#7b3e4a] text-on-primary text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center gap-2 shadow-xs"
              >
                <Icon name="water_drop" size={16} />
                <span>Log Period for This Day</span>
              </button>

              <button
                onClick={() => setQuickLogOpen(true)}
                className="w-full py-2.5 px-4 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center gap-2 border border-surface-container"
              >
                <Icon name="add_notes" size={16} className="text-primary" />
                <span>Edit Symptoms & Notes</span>
              </button>
            </div>

            {/* Upcoming Milestones */}
            <div className="flex flex-col gap-3 pt-2 border-t border-surface-container/80">
              <span className="text-xs font-semibold uppercase tracking-wider text-secondary">
                Upcoming Milestones
              </span>

              <div className="flex flex-col gap-3 relative pl-4 before:content-[''] before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:bg-surface-container-high">
                <div className="relative flex flex-col gap-0.5">
                  <span className="absolute -left-[19px] top-1.5 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-surface-container-lowest"></span>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-on-surface">Estimated Next Period</span>
                    <span className="text-xs font-bold text-primary">
                      {stats.nextPeriodEstimatedDate || 'Calculate after 1st cycle'}
                    </span>
                  </div>
                  <span className="text-[11px] text-on-surface-variant">
                    {stats.daysUntilNextPeriod !== null
                      ? stats.daysUntilNextPeriod > 0
                        ? `Expected in ~${stats.daysUntilNextPeriod} days`
                        : 'Expected around now'
                      : 'Based on average cycle length'}
                  </span>
                </div>

                <div className="relative flex flex-col gap-0.5">
                  <span className="absolute -left-[19px] top-1.5 w-2.5 h-2.5 rounded-full bg-secondary ring-4 ring-surface-container-lowest"></span>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-on-surface">PMS Window Estimate</span>
                    <span className="text-xs font-bold text-secondary">
                      {stats.nextPeriodEstimatedDate ? 'Luteal phase' : '—'}
                    </span>
                  </div>
                  <span className="text-[11px] text-on-surface-variant">
                    Expected luteal symptom window
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <PeriodRecordModal
        isOpen={periodModalOpen}
        onClose={() => setPeriodModalOpen(false)}
        initialStartDate={selectedDate}
        editRecord={selectedPeriod}
      />
      <QuickLogModal
        isOpen={quickLogOpen}
        onClose={() => setQuickLogOpen(false)}
      />
    </div>
  );
}

