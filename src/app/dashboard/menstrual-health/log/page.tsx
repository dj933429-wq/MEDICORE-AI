'use client';

import React, { useState } from 'react';
import Icon from '../../../../components/menstrual-health/Icon';
import PeriodRecordModal from '../../../../components/menstrual-health/PeriodRecordModal';
import { useMenstrualHealth } from '../../../../lib/menstrual-health/context';
import { FlowLevel, Symptom, Mood, SleepQuality, PeriodRecord, DailyLog } from '../../../../lib/menstrual-health/types';
import { formatDateISO } from '../../../../lib/menstrual-health/calculations';

export default function DailyLogPage() {
  const {
    periods,
    stats,
    mode,
    saveDailyLog,
    getLogForDate,
    selectedDate,
    setSelectedDate
  } = useMenstrualHealth();

  const [activeTab, setActiveTab] = useState<'daily' | 'history'>('daily');
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<PeriodRecord | null>(null);

  const existingLog = getLogForDate(selectedDate);

  // Navigate relative date (-1 = Yesterday, 0 = Today)
  const setRelativeDate = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    setSelectedDate(formatDateISO(d));
  };

  return (
    <div className="flex flex-col gap-6 sm:gap-8 pb-16 animate-fade-in">
      {/* Header & Mode Switcher */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-2 border-b border-surface-container">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary"></span>
            <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
              Daily Health Journal • Cycle Phase (Illustrative)
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-serif text-on-surface">Daily Wellness & Cycle Log</h1>
          <p className="text-xs sm:text-sm text-on-surface-variant max-w-2xl leading-relaxed">
            Track how you feel today. Consistent daily logging helps identify patterns, symptom trends, and personal wellness rhythms.
          </p>
        </div>

        {/* Mode Toggle Tabs */}
        <div className="inline-flex p-1 rounded-xl bg-surface-container self-start md:self-auto shadow-xs border border-surface-container">
          <button
            onClick={() => setActiveTab('daily')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'daily'
                ? 'bg-surface-container-lowest text-on-surface shadow-xs font-bold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <Icon name="edit_calendar" size={16} className={activeTab === 'daily' ? 'text-primary' : 'text-secondary'} />
            <span>Daily Health Journal</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'history'
                ? 'bg-surface-container-lowest text-on-surface shadow-xs font-bold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <Icon name="history" size={16} />
            <span>Period Log & Cycle History</span>
          </button>
        </div>
      </div>

      {/* Main Form and Side Deck Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Main Form Column (8 Cols) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {activeTab === 'daily' ? (
            <DailyJournalForm
              key={selectedDate}
              selectedDate={selectedDate}
              existingLog={existingLog}
              onSave={saveDailyLog}
              onSetRelativeDate={setRelativeDate}
              onSetDate={setSelectedDate}
              mode={mode}
            />
          ) : (
            /* Tab 2: Period Log & Cycle History View */
            <div className="flex flex-col gap-5">
              <div className="p-6 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-serif text-on-surface">Historical Period Entries</h2>
                  <p className="text-xs text-on-surface-variant mt-1">
                    Manage all recorded menses spans. Consecutive start dates calculate cycle lengths automatically.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingPeriod(null);
                    setPeriodModalOpen(true);
                  }}
                  className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-semibold flex items-center gap-1.5 shadow-xs hover:bg-[#7b3e4a]"
                >
                  <Icon name="add" size={16} />
                  <span>Log Period</span>
                </button>
              </div>

              {periods.length === 0 ? (
                <div className="p-12 text-center rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex flex-col items-center">
                  <div className="w-12 h-12 rounded-2xl bg-primary-fixed/40 flex items-center justify-center text-primary mb-3">
                    <Icon name="water_drop" size={24} />
                  </div>
                  <h3 className="text-base font-serif text-on-surface font-semibold">No Periods Recorded Yet</h3>
                  <p className="text-xs text-on-surface-variant max-w-sm mt-1 mb-4">
                    Click &quot;Log Period&quot; above to record your first cycle start and end dates.
                  </p>
                  <button
                    onClick={() => {
                      setEditingPeriod(null);
                      setPeriodModalOpen(true);
                    }}
                    className="px-5 py-2 rounded-xl bg-primary text-on-primary text-xs font-semibold"
                  >
                    Record First Period
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {[...periods].reverse().map((period) => (
                    <div
                      key={period.id}
                      className="p-5 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex items-center justify-between hover:bg-surface-container-low transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-primary shrink-0">
                          <Icon name="water_drop" size={18} />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-semibold text-sm text-on-surface">
                            {period.startDate} to {period.endDate || 'Ongoing'}
                          </span>
                          <span className="text-xs text-on-surface-variant">
                            {period.durationDays} days • {period.flow} flow
                            {period.notes ? ` • ${period.notes}` : ''}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {period.cycleLength ? (
                          <span className="px-2.5 py-1 rounded-full bg-surface-container text-xs font-bold text-on-surface">
                            {period.cycleLength}d cycle
                          </span>
                        ) : (
                          <span className="text-xs text-secondary italic">Initial cycle</span>
                        )}

                        <button
                          onClick={() => {
                            setEditingPeriod(period);
                            setPeriodModalOpen(true);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-semibold text-primary transition-colors"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Aside Column (4 Cols on Desktop) */}
        <aside className="lg:col-span-4 flex flex-col gap-6">
          {/* Cycle Manager Quick Action */}
          <div className="p-6 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-lg text-on-surface">Cycle Manager</h3>
              <span className="px-2.5 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed text-[10px] font-bold uppercase">
                Active
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-surface-container-low border border-surface-container/60 flex items-start gap-3">
              <Icon name="calendar_today" size={18} className="text-primary mt-0.5 shrink-0" />
              <div className="flex flex-col text-xs leading-relaxed">
                <span className="font-semibold text-on-surface">Period Span Tracking</span>
                <span className="text-on-surface-variant">
                  Record cycle dates to calculate accurate cycle lengths in this interactive module.
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                setEditingPeriod(null);
                setPeriodModalOpen(true);
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold transition-colors flex items-center justify-center gap-2 border border-surface-container"
            >
              <Icon name="add_circle" size={16} className="text-primary" />
              <span>Log Previous / New Period</span>
            </button>
          </div>

          {/* Recent Recorded Periods Feed */}
          <div className="p-6 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-serif text-lg text-on-surface">Recent Periods</h3>
                <span className="text-[10px] px-2 py-0.5 rounded bg-surface-container font-semibold text-secondary">
                  {mode === 'demo' ? 'Demo' : 'Live'}
                </span>
              </div>
              <button
                onClick={() => setActiveTab('history')}
                className="text-xs text-primary hover:underline font-semibold"
              >
                View All
              </button>
            </div>

            <div className="flex flex-col gap-2.5">
              {periods.slice(-3).reverse().map((p) => (
                <div
                  key={p.id}
                  className="p-3.5 rounded-xl bg-surface-container-low border border-surface-container/60 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-primary-fixed flex items-center justify-center text-primary shrink-0">
                      <Icon name="water_drop" size={14} />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-semibold text-xs text-on-surface">
                        {p.startDate}
                      </span>
                      <span className="text-[11px] text-on-surface-variant">
                        {p.durationDays}d • {p.flow}
                      </span>
                    </div>
                  </div>
                  {p.cycleLength && (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-surface-container-lowest font-semibold text-on-surface">
                      {p.cycleLength}d cycle
                    </span>
                  )}
                </div>
              ))}

              {periods.length === 0 && (
                <span className="text-xs text-secondary italic py-2 text-center">
                  No periods logged yet
                </span>
              )}
            </div>

            <div className="pt-2 border-t border-surface-container">
              <div className="p-3 rounded-xl bg-surface-container-high/60 flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-semibold text-secondary">Average Cycle Length</span>
                  <span className="text-sm font-semibold text-on-surface">
                    {stats.cycleCount > 1 ? `${stats.averageCycleLength} Days` : 'Awaiting data'}
                  </span>
                </div>
                <Icon name="insights" size={20} className="text-tertiary" />
              </div>
            </div>
          </div>

          {/* Physiology Educational Card */}
          <div className="p-6 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Icon name="menu_book" size={18} className="text-secondary" />
              <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
                Physiology Primer
              </span>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              Tracking consistent cycle start dates and flow intensity helps you build personal historical awareness over time.
            </p>
          </div>
        </aside>
      </div>

      {/* Period Modal */}
      <PeriodRecordModal
        isOpen={periodModalOpen}
        onClose={() => {
          setPeriodModalOpen(false);
          setEditingPeriod(null);
        }}
        editRecord={editingPeriod}
      />
    </div>
  );
}

function DailyJournalForm({
  selectedDate,
  existingLog,
  onSave,
  onSetRelativeDate,
  onSetDate,
  mode
}: {
  selectedDate: string;
  existingLog: DailyLog | undefined;
  onSave: (data: Omit<DailyLog, 'id' | 'source'>) => void;
  onSetRelativeDate: (offset: number) => void;
  onSetDate: (date: string) => void;
  mode: string;
}) {
  const [flow, setFlow] = useState<FlowLevel>(() => existingLog?.flow || 'none');
  const [symptoms, setSymptoms] = useState<Symptom[]>(() => existingLog?.symptoms || []);
  const [mood, setMood] = useState<Mood | undefined>(() => existingLog?.mood);
  const [energy, setEnergy] = useState<1 | 2 | 3 | 4 | 5 | undefined>(() => existingLog?.energy || 3);
  const [sleepHours, setSleepHours] = useState<number>(() => existingLog?.sleepHours || 7.5);
  const [sleepQuality, setSleepQuality] = useState<SleepQuality>(() => existingLog?.sleepQuality || 'restful');
  const [notes, setNotes] = useState<string>(() => existingLog?.notes || '');

  const toggleSymptom = (sym: Symptom) => {
    setSymptoms((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]
    );
  };

  const handleSave = () => {
    onSave({
      date: selectedDate,
      flow,
      symptoms,
      mood,
      energy,
      sleepHours,
      sleepQuality,
      notes
    });
  };

  const handleResetForm = () => {
    setFlow(existingLog?.flow || 'none');
    setSymptoms(existingLog?.symptoms || []);
    setMood(existingLog?.mood);
    setEnergy(existingLog?.energy || 3);
    setSleepHours(existingLog?.sleepHours || 7.5);
    setSleepQuality(existingLog?.sleepQuality || 'restful');
    setNotes(existingLog?.notes || '');
  };

  const allSymptoms: { id: Symptom; label: string; icon: string }[] = [
    { id: 'cramps', label: 'Cramps', icon: 'healing' },
    { id: 'headache', label: 'Headache', icon: 'psychology_alt' },
    { id: 'bloating', label: 'Bloating', icon: 'bubble_chart' },
    { id: 'acne', label: 'Acne', icon: 'face_2' },
    { id: 'breast_tenderness', label: 'Breast tenderness', icon: 'vital_signs' },
    { id: 'back_pain', label: 'Back pain', icon: 'accessibility_new' },
    { id: 'fatigue', label: 'Fatigue', icon: 'battery_2_bar' },
    { id: 'nausea', label: 'Nausea', icon: 'sick' }
  ];

  const allMoods: Mood[] = ['happy', 'calm', 'anxious', 'irritable', 'sad'];

  return (
    <>
      {/* Date Selection Anchor Card */}
      <div className="p-5 sm:p-6 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary-fixed flex items-center justify-center text-primary">
            <Icon name="today" size={24} />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-widest font-semibold text-secondary">
              Entry Date
            </span>
            <span className="text-xl sm:text-2xl font-serif text-on-surface">
              {selectedDate}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSetRelativeDate(-1)}
            className="px-3.5 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold transition-colors flex items-center gap-1"
          >
            <Icon name="chevron_left" size={14} />
            <span>Yesterday</span>
          </button>
          <button
            type="button"
            onClick={() => onSetRelativeDate(0)}
            className="px-3.5 py-2 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface-variant text-xs font-semibold transition-colors border border-surface-container"
          >
            Today
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => onSetDate(e.target.value)}
            className="px-2 py-1.5 rounded-xl bg-surface-container text-xs text-on-surface border border-surface-container focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Section 01: Flow & Spotting */}
      <section className="p-6 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
              Section 01
            </span>
            <h2 className="text-lg font-serif text-on-surface">Period Flow</h2>
          </div>
          <span className="text-xs text-on-surface-variant font-medium">Select today&apos;s flow</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          {[
            { id: 'none', label: 'None', sub: 'Dry / Baseline', icon: 'block' },
            { id: 'light', label: 'Light', sub: 'Spotting or low', icon: 'water_drop' },
            { id: 'medium', label: 'Medium', sub: 'Standard pad/tampon', icon: 'invert_colors' },
            { id: 'heavy', label: 'Heavy', sub: 'Frequent change', icon: 'water_full' }
          ].map((item) => {
            const isSelected = flow === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFlow(item.id as FlowLevel)}
                className={`p-4 rounded-xl transition-all flex flex-col items-center text-center gap-2 border ${
                  isSelected
                    ? 'bg-primary-fixed/30 border-primary ring-2 ring-primary/20 shadow-xs'
                    : 'bg-surface-container-low border-surface-container/60 hover:bg-surface-container'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    isSelected
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container text-on-surface-variant'
                  }`}
                >
                  <Icon name={item.icon} size={20} />
                </div>
                <span className="font-semibold text-sm text-on-surface">{item.label}</span>
                <span className="text-[11px] text-on-surface-variant">{item.sub}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Section 02: Physical Symptoms */}
      <section className="p-6 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
              Section 02
            </span>
            <h2 className="text-lg font-serif text-on-surface">Physical Symptoms</h2>
          </div>
          <span className="text-xs text-on-surface-variant font-medium">Select all that apply</span>
        </div>

        <div className="flex flex-wrap gap-2.5 pt-1">
          {allSymptoms.map((sym) => {
            const isSelected = symptoms.includes(sym.id);
            return (
              <button
                key={sym.id}
                type="button"
                onClick={() => toggleSymptom(sym.id)}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all flex items-center gap-2 border ${
                  isSelected
                    ? 'bg-primary text-on-primary border-primary shadow-xs'
                    : 'bg-surface-container-low text-on-surface-variant border-surface-container/60 hover:bg-surface-container'
                }`}
              >
                <Icon name={sym.icon} size={16} />
                <span>{sym.label}</span>
                {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-surface-container-lowest"></span>}
              </button>
            );
          })}
        </div>
      </section>

      {/* Section 03: Mood & Energy */}
      <section className="p-6 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
              Section 03
            </span>
            <h2 className="text-lg font-serif text-on-surface">Mood & Energy Levels</h2>
          </div>
          <span className="text-xs text-on-surface-variant font-medium">Emotional & physical baseline</span>
        </div>

        <div className="flex flex-col gap-4 pt-1">
          {/* Mood chips */}
          <div className="flex flex-wrap gap-2">
            {allMoods.map((m) => {
              const isSelected = mood === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMood(m)}
                  className={`px-4 py-2 rounded-xl text-xs sm:text-sm capitalize font-medium transition-all border ${
                    isSelected
                      ? 'bg-secondary text-on-secondary border-secondary shadow-xs'
                      : 'bg-surface-container-low text-on-surface-variant border-surface-container/60 hover:bg-surface-container'
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>

          {/* Energy level selector (1 to 5) */}
          <div className="p-4 rounded-xl bg-surface-container-low border border-surface-container/60 flex flex-col gap-2.5">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-on-surface">Energy Level</span>
              <span className="text-secondary font-medium">
                {energy === 1
                  ? 'Low (1/5)'
                  : energy === 2
                  ? 'Mild (2/5)'
                  : energy === 3
                  ? 'Moderate (3/5)'
                  : energy === 4
                  ? 'High (4/5)'
                  : 'Peak (5/5)'}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((lvl) => {
                const isSelected = energy === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setEnergy(lvl as 1 | 2 | 3 | 4 | 5)}
                    className={`py-2 rounded-xl text-xs font-bold transition-all ${
                      isSelected
                        ? 'bg-primary text-on-primary shadow-xs'
                        : 'bg-surface-container text-on-surface hover:bg-surface-container-high'
                    }`}
                  >
                    {lvl}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Section 04: Sleep & Notes */}
      <section className="p-6 rounded-2xl bg-surface-container-lowest border border-surface-container shadow-xs flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
              Section 04
            </span>
            <h2 className="text-lg font-serif text-on-surface">Sleep & Personal Notes</h2>
          </div>
          <span className="text-sm font-bold text-primary">{sleepHours} hrs</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start pt-1">
          <div className="flex flex-col gap-3 p-4 rounded-xl bg-surface-container-low border border-surface-container/60">
            <div className="flex justify-between text-xs text-on-surface-variant font-medium">
              <span>Duration</span>
              <span>3h – 12h</span>
            </div>
            <input
              type="range"
              min="3"
              max="12"
              step="0.5"
              value={sleepHours}
              onChange={(e) => setSleepHours(Number(e.target.value))}
              className="w-full accent-primary h-2 bg-surface-container rounded-lg cursor-pointer"
            />
            <div className="grid grid-cols-3 gap-2 pt-1">
              {(['restful', 'disrupted', 'insomnia'] as SleepQuality[]).map((q) => {
                const isSelected = sleepQuality === q;
                return (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setSleepQuality(q)}
                    className={`py-2 px-1 rounded-xl text-xs font-semibold capitalize transition-all ${
                      isSelected
                        ? 'bg-secondary-container text-on-secondary-container font-bold shadow-xs'
                        : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    {q}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col">
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add brief notes, physical observations, or reflections (optional)..."
              className="w-full p-3.5 rounded-xl bg-surface-container-low text-on-surface text-xs sm:text-sm border border-surface-container/60 focus:outline-none focus:ring-1 focus:ring-primary focus:bg-surface-container-lowest resize-none leading-relaxed"
            ></textarea>
          </div>
        </div>
      </section>

      {/* Sticky Confirmation Strip */}
      <div className="sticky bottom-4 z-20 p-4 rounded-2xl bg-surface-container-lowest/95 backdrop-blur-md border border-surface-container shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse shrink-0"></span>
          <span className="text-xs text-on-surface-variant">
            {mode === 'demo'
              ? 'Demo only: entries are held in temporary session state. No external server connection.'
              : 'Saved to temporary session state for this visit.'}
          </span>
        </div>
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleResetForm}
            className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold transition-colors"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 sm:flex-initial px-6 py-2.5 rounded-xl bg-primary hover:bg-[#7b3e4a] text-on-primary text-xs font-semibold shadow-xs flex items-center justify-center gap-2 transition-colors"
          >
            <Icon name="check_circle" size={16} />
            <span>Save Entry ({mode === 'demo' ? 'Demo' : 'Session'})</span>
          </button>
        </div>
      </div>
    </>
  );
}
