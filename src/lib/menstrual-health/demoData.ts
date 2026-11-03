import { PeriodRecord, DailyLog } from './types';
import { formatDateISO } from './calculations';

/**
 * Generates an internally consistent 8-cycle demo dataset anchored to the reference date.
 * Guarantees that referenceDate is Cycle Day 14.
 */
export function generateDemoDataset(referenceDate = new Date()): {
  periods: PeriodRecord[];
  logs: DailyLog[];
} {
  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);

  // Cycle lengths going backward from the most recent completed cycle:
  // Most recent cycle: 28 days
  // Previous: 29 days, 27 days, 28 days, 30 days, 29 days, 28 days
  const cycleIntervals = [28, 29, 27, 28, 30, 29, 28]; // 7 intervals between 8 starts
  const durations = [5, 5, 5, 4, 5, 5, 5, 5]; // menses durations (mean: 4.875 ~ 4.9)
  const flows: ('light' | 'medium' | 'heavy')[] = [
    'medium',
    'heavy',
    'medium',
    'medium',
    'heavy',
    'medium',
    'heavy',
    'medium'
  ];

  // Most recent period started 13 days ago -> today is day 14
  const startOffsets = [13];
  let accumulated = 13;
  for (const interval of cycleIntervals) {
    accumulated += interval;
    startOffsets.push(accumulated);
  }

  // Reverse so earliest cycle is index 0
  startOffsets.reverse();
  const sortedIntervals = [...cycleIntervals].reverse();

  const periods: PeriodRecord[] = startOffsets.map((offset, idx) => {
    const sDate = new Date(today);
    sDate.setDate(sDate.getDate() - offset);

    const dur = durations[idx];
    const eDate = new Date(sDate);
    eDate.setDate(eDate.getDate() + (dur - 1));

    const cycleLen = idx > 0 ? sortedIntervals[idx - 1] : undefined;

    return {
      id: `demo-period-${idx + 1}`,
      startDate: formatDateISO(sDate),
      endDate: formatDateISO(eDate),
      flow: flows[idx],
      durationDays: dur,
      cycleLength: cycleLen,
      source: 'demo',
      notes: idx === 7 ? 'Current cycle period (sample)' : `Cycle #${idx + 1} sample log`
    };
  });

  // Generate illustrative daily logs around the current cycle
  const logs: DailyLog[] = [];

  // Today (Cycle Day 14)
  logs.push({
    id: 'demo-log-today',
    date: formatDateISO(today),
    flow: 'none',
    symptoms: ['headache', 'bloating'],
    mood: 'calm',
    energy: 3,
    sleepHours: 8,
    sleepQuality: 'restful',
    notes: 'Took morning walk and stayed well hydrated.',
    source: 'demo'
  });

  // Yesterday (Day 13)
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  logs.push({
    id: 'demo-log-yesterday',
    date: formatDateISO(yesterday),
    flow: 'none',
    symptoms: ['bloating'],
    mood: 'calm',
    energy: 4,
    sleepHours: 7.5,
    sleepQuality: 'restful',
    notes: 'Energy felt steady all afternoon.',
    source: 'demo'
  });

  // Current period days (Days 1–5: heavy -> medium -> light -> spotting)
  const lastPeriodStart = new Date(today);
  lastPeriodStart.setDate(lastPeriodStart.getDate() - 13);

  const flowProgression: ('heavy' | 'heavy' | 'medium' | 'light' | 'spotting')[] = [
    'heavy',
    'heavy',
    'medium',
    'light',
    'spotting'
  ];

  for (let i = 0; i < 5; i++) {
    const logDate = new Date(lastPeriodStart);
    logDate.setDate(logDate.getDate() + i);
    logs.push({
      id: `demo-log-current-period-${i + 1}`,
      date: formatDateISO(logDate),
      flow: flowProgression[i],
      symptoms: i === 0 ? ['cramps', 'fatigue'] : i === 1 ? ['cramps', 'back_pain'] : ['fatigue'],
      mood: i < 2 ? 'irritable' : 'calm',
      energy: (i < 2 ? 2 : 3) as 1 | 2 | 3 | 4 | 5,
      sleepHours: 8,
      sleepQuality: i === 0 ? 'disrupted' : 'restful',
      notes: i === 0 ? 'First day of period. Rested with heat pack.' : undefined,
      source: 'demo'
    });
  }

  return { periods, logs };
}

export const EMPTY_DATASET: {
  periods: PeriodRecord[];
  logs: DailyLog[];
} = {
  periods: [],
  logs: []
};

