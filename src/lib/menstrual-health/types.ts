export type FlowLevel = 'none' | 'spotting' | 'light' | 'medium' | 'heavy';

export type Mood = 'happy' | 'calm' | 'anxious' | 'irritable' | 'sad';

export type Symptom =
  | 'cramps'
  | 'headache'
  | 'bloating'
  | 'acne'
  | 'breast_tenderness'
  | 'back_pain'
  | 'fatigue'
  | 'nausea'
  | 'other';

export type SleepQuality = 'restful' | 'disrupted' | 'insomnia';

export interface PeriodRecord {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD (optional if ongoing or incomplete)
  flow: 'light' | 'medium' | 'heavy';
  cycleLength?: number; // Days between this start and the previous period start
  durationDays?: number; // Days inclusive: endDate - startDate + 1
  isOngoing?: boolean;
  source: 'user' | 'demo';
  notes?: string;
}

export interface DailyLog {
  id: string;
  date: string; // YYYY-MM-DD
  flow: FlowLevel;
  symptoms: Symptom[];
  mood?: Mood;
  energy?: 1 | 2 | 3 | 4 | 5;
  sleepHours?: number;
  sleepQuality?: SleepQuality;
  notes?: string;
  source: 'user' | 'demo';
}

export type CyclePhase = 'menstrual' | 'follicular' | 'ovulatory' | 'luteal';

/**
 * 4 Distinct Data Sufficiency Levels:
 * - 'none': 0 recorded periods.
 * - 'insufficient': 1 recorded period (0 completed cycle intervals). Cycle length cannot be calculated.
 * - 'minimal': 2 recorded periods (1 completed cycle interval). Average cycle length computable; variation requires 2+ intervals.
 * - 'sufficient': 3+ recorded periods (2+ completed cycle intervals). Both mean and sample standard deviation computable.
 */
export type DataSufficiencyLevel = 'none' | 'insufficient' | 'minimal' | 'sufficient';

export interface DataSufficiencyInfo {
  level: DataSufficiencyLevel;
  periodCount: number;
  completedCycles: number;
  message: string;
  limitations: string;
  canCalculateCycleLength: boolean;
  canCalculatePeriodDuration: boolean;
  canCalculateVariation: boolean;
}

export interface EstimatedPeriodWindow {
  estimatedStartDate: string; // YYYY-MM-DD
  windowStart: string;        // YYYY-MM-DD
  windowEnd: string;          // YYYY-MM-DD
  uncertaintyDays: number;    // +/- days for display window (clamped between 2 and 7 days for UI rendering)
  actualVariationDays: number | null; // unrounded/uncapped empirical sample standard deviation
  isCapped: boolean;          // true when actual sample variation exceeds the display cap of +/- 7 days
  historyDescription: string; // Descriptive history depth (not probability confidence)
  uncertaintyDescription: string; // Descriptive explanation of the estimation window
  disclaimer: string;
}

export interface CycleVariation {
  sampleStandardDeviation: number | null; // s = sqrt(sum(x - mean)^2 / (N - 1))
  rangeDays: number | null;               // max(cycleLength) - min(cycleLength)
  standardDeviationType: 'sample';        // explicitly sample standard deviation with Bessel's correction
  description: string;                    // Descriptive summary of observed historical variation
}

export interface CycleStats {
  averageCycleLength: number;
  averagePeriodDuration: number;
  shortestCycleLength: number | null;
  longestCycleLength: number | null;
  variationDays: number;                  // sample standard deviation in days (0 if < 2 completed cycles)
  sampleStandardDeviation: number | null;
  cycleVariationRangeDays: number | null;
  cycleCount: number;
  completedCycles: number;
  currentCycleDay: number | null;
  currentPhase: CyclePhase | null;
  lastPeriod: PeriodRecord | null;
  nextPeriodEstimatedDate: string | null;
  nextPeriodWindow: EstimatedPeriodWindow | null;
  daysUntilNextPeriod: number | null;
  sufficiency: DataSufficiencyInfo;
}

export type TrackerMode = 'demo' | 'empty';

export interface PeriodValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  details: {
    isInvalidDate?: boolean;
    isInverted?: boolean;
    isDuplicate?: boolean;
    hasOverlap?: boolean;
    isUnusuallyShortPeriod?: boolean;
    isUnusuallyLongPeriod?: boolean;
    isUnusuallyShortCycle?: boolean;
    isUnusuallyLongCycle?: boolean;
  };
}

export interface CycleThresholds {
  minNormalCycleDays: number;         // Clinical guideline baseline (e.g. 21 days)
  maxNormalCycleDays: number;         // Clinical guideline baseline (e.g. 35 days)
  minNormalPeriodDuration: number;    // Clinical guideline baseline (e.g. 2 days)
  maxNormalPeriodDuration: number;    // Clinical guideline baseline (e.g. 8 days)
  maxPlausiblePeriodDuration: number; // Plausibility cutoff (e.g. 14 days)
  maxPlausibleCycleDays: number;      // Plausibility/oligomenorrhea threshold (e.g. 90 days)
}
