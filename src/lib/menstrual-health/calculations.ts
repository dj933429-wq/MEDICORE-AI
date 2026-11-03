import {
  PeriodRecord,
  CycleStats,
  CyclePhase,
  DailyLog,
  Symptom,
  CycleThresholds,
  PeriodValidationResult,
  DataSufficiencyInfo,
  EstimatedPeriodWindow,
  CycleVariation
} from './types';

/**
 * Clinically documented cycle evaluation thresholds.
 *
 * Clinical Context (FIGO Menstrual Disorders Committee):
 * - Normal cycle length typically spans 21 to 35 days for reproductive-age adults.
 * - Normal menses duration typically spans 2 to 8 days.
 * - Records outside these ranges yield advisory warnings rather than hard rejections,
 *   preserving honest user tracking for physiological variations, irregular cycles, or clinical evaluation.
 */
export const DEFAULT_CYCLE_THRESHOLDS: CycleThresholds = {
  minNormalCycleDays: 21,
  maxNormalCycleDays: 35,
  minNormalPeriodDuration: 2,
  maxNormalPeriodDuration: 8,
  maxPlausiblePeriodDuration: 14,
  maxPlausibleCycleDays: 90
};

// ============================================================================
// PURE CALENDAR DATE ARITHMETIC (Zero Timezone Shift & DST Immune)
// ============================================================================

/**
 * Validates whether a string is a strictly valid Gregorian calendar date in YYYY-MM-DD format.
 * Validates days per month including Leap Years (e.g. 2024-02-29 is valid, 2023-02-29 is invalid).
 */
export function isValidISODateString(dateStr: string): boolean {
  if (typeof dateStr !== 'string') return false;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;

  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [
    31,
    isLeap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ];

  const maxDays = daysInMonth[month - 1];
  return day >= 1 && day <= maxDays;
}

/**
 * Parses YYYY-MM-DD into numeric year, month (1-12), and day components.
 */
export function parseISODate(dateStr: string): { year: number; month: number; day: number } | null {
  if (!isValidISODateString(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/**
 * Backward-compatible helper that returns a Date representation of YYYY-MM-DD.
 */
export function parseDate(dateStr: string): Date {
  const parsed = parseISODate(dateStr);
  if (!parsed) {
    return new Date(NaN);
  }
  return new Date(parsed.year, parsed.month - 1, parsed.day);
}

/**
 * Formats a Date object into YYYY-MM-DD using local calendar year, month, and day.
 */
export function formatDateISO(d: Date): string {
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculates whole days difference: (bDate - aDate).
 * Operates purely on UTC midnight timestamps to eliminate local daylight-savings and timezone off-by-one errors.
 */
export function daysBetween(a: Date | string, b: Date | string): number {
  const aStr = typeof a === 'string' ? a : formatDateISO(a);
  const bStr = typeof b === 'string' ? b : formatDateISO(b);

  const parsedA = parseISODate(aStr);
  const parsedB = parseISODate(bStr);

  if (!parsedA || !parsedB) return NaN;

  const utcA = Date.UTC(parsedA.year, parsedA.month - 1, parsedA.day);
  const utcB = Date.UTC(parsedB.year, parsedB.month - 1, parsedB.day);

  return Math.round((utcB - utcA) / (1000 * 60 * 60 * 24));
}

/**
 * Adds (or subtracts) whole days to a YYYY-MM-DD date string.
 * Returns the exact Gregorian calendar date string.
 */
export function addDaysToDate(dateStr: string, days: number): string {
  const parsed = parseISODate(dateStr);
  if (!parsed) return '';

  const utc = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  const ry = utc.getUTCFullYear();
  const rm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const rd = String(utc.getUTCDate()).padStart(2, '0');
  return `${ry}-${rm}-${rd}`;
}

// ============================================================================
// CORE CYCLE & PERIOD CALCULATIONS
// ============================================================================

/**
 * Calculates cycle length from consecutive period start dates:
 * Difference in calendar days between previous period start and current period start.
 */
export function calculateCycleLength(prevStartDate: string, currentStartDate: string): number {
  return daysBetween(prevStartDate, currentStartDate);
}

/**
 * Calculates inclusive period bleeding duration in days:
 * (endDate - startDate + 1). If endDate is omitted (ongoing period), returns null.
 */
export function calculatePeriodDuration(startDate: string, endDate?: string): number | null {
  if (!endDate) return null;
  const days = daysBetween(startDate, endDate);
  if (isNaN(days) || days < 0) return null;
  return days + 1;
}

/**
 * Sorts period records chronologically ascending by startDate.
 * Enriches each record with calculated cycleLength (from consecutive start dates)
 * and inclusive durationDays (when endDate is present).
 */
export function processPeriodRecords(rawRecords: PeriodRecord[]): PeriodRecord[] {
  const validRecords = rawRecords.filter((r) => r && isValidISODateString(r.startDate));
  const sorted = [...validRecords].sort((a, b) => a.startDate.localeCompare(b.startDate));

  return sorted.map((record, index) => {
    const duration = calculatePeriodDuration(record.startDate, record.endDate);
    const durationDays = duration !== null ? Math.max(1, duration) : (record.durationDays ?? 1);

    let cycleLength: number | undefined = undefined;
    if (index > 0) {
      const prevStart = sorted[index - 1].startDate;
      const len = calculateCycleLength(prevStart, record.startDate);
      if (len > 0) {
        cycleLength = len;
      }
    }

    return {
      ...record,
      durationDays,
      cycleLength,
      isOngoing: !record.endDate
    };
  });
}

/**
 * Evaluates sufficiency of historical period records for statistical cycle computation.
 *
 * 4 Distinct Data Sufficiency Levels:
 * - 'none': 0 recorded periods.
 * - 'insufficient': 1 recorded period (0 completed cycle intervals). Cycle length cannot be calculated.
 * - 'minimal': 2 recorded periods (1 completed cycle interval). Average cycle length computable; variation requires 2+ intervals.
 * - 'sufficient': 3+ recorded periods (2+ completed cycle intervals). Both mean and sample standard deviation computable.
 */
export function checkDataSufficiency(records: PeriodRecord[]): DataSufficiencyInfo {
  const processed = processPeriodRecords(records);
  const periodCount = processed.length;
  const completedCycles = Math.max(0, periodCount - 1);
  const hasLoggedDuration = processed.some((r) => r.endDate && isValidISODateString(r.endDate));

  if (periodCount === 0) {
    return {
      level: 'none',
      periodCount: 0,
      completedCycles: 0,
      message: 'No menstrual cycle records available. Log your period start date to begin tracking.',
      limitations: 'Cycle length, bleeding duration, and next-period estimates cannot be calculated without recorded period dates.',
      canCalculateCycleLength: false,
      canCalculatePeriodDuration: false,
      canCalculateVariation: false
    };
  }

  if (periodCount === 1) {
    return {
      level: 'insufficient',
      periodCount: 1,
      completedCycles: 0,
      message: '1 period recorded. At least 2 consecutive period start dates are required to calculate your personal cycle length.',
      limitations: 'Cycle length requires at least 2 consecutive period start dates. Bleeding duration can be calculated if an end date is logged. Predictions are provisional baselines only.',
      canCalculateCycleLength: false,
      canCalculatePeriodDuration: hasLoggedDuration,
      canCalculateVariation: false
    };
  }

  if (completedCycles === 1) {
    return {
      level: 'minimal',
      periodCount: 2,
      completedCycles: 1,
      message: '1 completed cycle interval recorded. Your average cycle length is available.',
      limitations: 'Assessing historical variation and sample standard deviation requires at least 2 completed cycle intervals (3+ recorded periods).',
      canCalculateCycleLength: true,
      canCalculatePeriodDuration: hasLoggedDuration,
      canCalculateVariation: false
    };
  }

  const hasMoreHistory = completedCycles >= 6;
  return {
    level: 'sufficient',
    periodCount,
    completedCycles,
    message: hasMoreHistory
      ? `More tracking history available (${completedCycles} completed cycle intervals recorded). Metrics reflect your observed historical dates.`
      : `Variation calculable (${completedCycles} completed cycle intervals recorded). Mathematical sample variance is available; 6+ cycles are an application reference for longer tracking history, not a guarantee of predictive accuracy.`,
    limitations: hasMoreHistory
      ? 'Six or more completed intervals are an application-level reference for longer tracking history, not a clinically validated threshold or guarantee of predictive accuracy. Normal biological variation can still occur.'
      : `Preliminary dataset (${completedCycles} completed intervals). While mathematically sufficient to calculate sample standard deviation, a small sample may not capture long-term personal variation.`,
    canCalculateCycleLength: true,
    canCalculatePeriodDuration: hasLoggedDuration,
    canCalculateVariation: true
  };
}

/**
 * Calculates mean cycle length across valid completed cycle intervals.
 * Returns null if fewer than 2 period start dates exist (0 completed cycles).
 */
export function calculateAverageCycleLength(records: PeriodRecord[]): number | null {
  const processed = processPeriodRecords(records);
  const validLengths = processed
    .map((r) => r.cycleLength)
    .filter((len): len is number => typeof len === 'number' && len > 0);

  if (validLengths.length === 0) return null;

  const total = validLengths.reduce((acc, val) => acc + val, 0);
  return Number((total / validLengths.length).toFixed(1));
}

/**
 * Calculates mean period bleeding duration in days across completed period spans.
 * Returns null if no periods have a valid recorded end date.
 */
export function calculateAveragePeriodDuration(records: PeriodRecord[]): number | null {
  const processed = processPeriodRecords(records);
  const completedPeriods = processed.filter((r) => r.endDate && isValidISODateString(r.endDate));

  if (completedPeriods.length === 0) return null;

  const totalDuration = completedPeriods.reduce((acc, r) => acc + (r.durationDays ?? 1), 0);
  return Number((totalDuration / completedPeriods.length).toFixed(1));
}

/**
 * Returns shortest and longest recorded completed cycles.
 */
export function calculateCycleLengthBounds(records: PeriodRecord[]): {
  shortest: number | null;
  longest: number | null;
} {
  const processed = processPeriodRecords(records);
  const validLengths = processed
    .map((r) => r.cycleLength)
    .filter((len): len is number => typeof len === 'number' && len > 0);

  if (validLengths.length === 0) {
    return { shortest: null, longest: null };
  }

  return {
    shortest: Math.min(...validLengths),
    longest: Math.max(...validLengths)
  };
}

/**
 * Calculates cycle length variation using Sample Standard Deviation (Bessel's correction):
 *
 * Statistical Definition:
 * - Menstrual cycles recorded by an individual represent a dynamic biological sample, not a static population.
 * - Sample variance uses Bessel's correction with degrees of freedom (N - 1):
 *     s = sqrt( sum( (x_i - mean)^2 ) / (N - 1) )
 * - For N < 2 completed cycle intervals (fewer than 3 recorded periods), sample variance has
 *   <= 0 degrees of freedom and is mathematically undefined; sampleStandardDeviation is null.
 *
 * Clinical & Regulatory Safety:
 * - Does not categorize cycles as "regular" or "irregular" using arbitrary thresholds,
 *   as menstrual variability naturally fluctuates and binary classification lacks clinical validity.
 */
export function calculateCycleVariation(records: PeriodRecord[]): CycleVariation {
  const processed = processPeriodRecords(records);
  const validLengths = processed
    .map((r) => r.cycleLength)
    .filter((len): len is number => typeof len === 'number' && len > 0);

  if (validLengths.length < 2) {
    return {
      sampleStandardDeviation: null,
      rangeDays: null,
      standardDeviationType: 'sample',
      description: validLengths.length === 1
        ? 'Assessing cycle variation requires at least 2 completed cycle intervals (1 recorded).'
        : 'No completed cycle intervals available to evaluate variability.'
    };
  }

  const n = validLengths.length;
  const mean = validLengths.reduce((acc, val) => acc + val, 0) / n;
  const sumSquaredDiffs = validLengths.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0);
  const sampleVariance = sumSquaredDiffs / (n - 1);
  const sampleStandardDeviation = Number(Math.sqrt(sampleVariance).toFixed(1));
  const rangeDays = Math.max(...validLengths) - Math.min(...validLengths);

  return {
    sampleStandardDeviation,
    rangeDays,
    standardDeviationType: 'sample',
    description: `Observed cycle lengths range from ${Math.min(...validLengths)} to ${Math.max(...validLengths)} days (${rangeDays} days range) with a sample standard deviation of ±${sampleStandardDeviation} days across ${n} completed cycle intervals.`
  };
}

// ============================================================================
// ESTIMATION & PREDICTION ENGINE (Safety First, Uncertainty Communicated)
// ============================================================================

/**
 * Calculates estimated next period start date:
 * lastPeriodStartDate + round(averageCycleLength).
 */
export function estimateNextPeriodDate(lastStartDate: string, averageCycleLength: number): string {
  if (!isValidISODateString(lastStartDate) || !averageCycleLength || averageCycleLength <= 0) {
    return '';
  }
  return addDaysToDate(lastStartDate, Math.round(averageCycleLength));
}

/**
 * Computes estimated next period window with statistical uncertainty bounds.
 *
 * Medical & Prediction Constraints:
 * - Explicitly labelled as a statistical estimate.
 * - Does not use subjective probability labels (e.g. "high confidence") which mislead users regarding biological certainty.
 * - Communicates descriptive uncertainty based on empirical historical sample standard deviation.
 * - Never claims confirmed ovulation, hormone surge, or contraception efficacy.
 */
export function estimateNextPeriodWindow(
  lastPeriodStart: string,
  averageCycleLength: number,
  sampleStdDev: number | null,
  completedCycles: number
): EstimatedPeriodWindow {
  const roundedCycle = Math.round(averageCycleLength);
  const estimatedStartDate = addDaysToDate(lastPeriodStart, roundedCycle);

  // Presentation display cap: clamp between +/- 2 and +/- 7 days for calendar rendering
  const roundedStdDev = sampleStdDev !== null ? Math.round(sampleStdDev) : 2;
  const isCapped = roundedStdDev > 7;
  const uncertaintyDays = Math.max(2, Math.min(7, roundedStdDev));

  const windowStart = addDaysToDate(estimatedStartDate, -uncertaintyDays);
  const windowEnd = addDaysToDate(estimatedStartDate, uncertaintyDays);

  let historyDescription: string;
  if (completedCycles === 0) {
    historyDescription = 'Provisional estimate based on 28-day standard population baseline (0 completed personal cycles logged).';
  } else if (completedCycles === 1) {
    historyDescription = 'Preliminary estimate based on 1 recorded cycle interval. Minimum 2 intervals required to calculate personal historical variation.';
  } else if (completedCycles < 6) {
    historyDescription = `Derived from ${completedCycles} recorded cycle intervals with a preliminary sample standard deviation of ±${sampleStdDev} days. 6+ cycles serve as an application reference for more tracking history.`;
  } else {
    historyDescription = `Derived from ${completedCycles} recorded cycle intervals with an application sample standard deviation of ±${sampleStdDev} days (longer tracking history reference).`;
  }

  let uncertaintyDescription: string;
  if (isCapped) {
    uncertaintyDescription = `Presentation window is capped at ±7 days (${windowStart} to ${windowEnd}) for calendar rendering. Note: observed cycle variation is significantly wider (sample standard deviation: ±${sampleStdDev} days, representing high cycle variability).`;
  } else {
    uncertaintyDescription = `Window spans ±${uncertaintyDays} days (${windowStart} to ${windowEnd}) reflecting historical variation across recorded cycles.`;
  }

  return {
    estimatedStartDate,
    windowStart,
    windowEnd,
    uncertaintyDays,
    actualVariationDays: sampleStdDev,
    isCapped,
    historyDescription,
    uncertaintyDescription,
    disclaimer:
      'Predictions are calculated from previously recorded menstrual cycle dates and observed historical variation. They are statistical estimates, not medically validated predictions. Actual cycle dates may differ due to natural biological variation and other factors. This tracker does not confirm ovulation, measure hormones, diagnose medical conditions, or provide contraception guidance.'
  };
}

/**
 * Master cycle statistics calculator.
 * Strictly calculates metrics from provided records. Does not fabricate statistics when records are insufficient.
 */
export function calculateCycleStats(records: PeriodRecord[], referenceDate: Date | string = new Date()): CycleStats {
  const processed = processPeriodRecords(records);
  const sufficiency = checkDataSufficiency(processed);
  const cycleCount = processed.length;
  const completedCycles = sufficiency.completedCycles;

  const refDateStr = typeof referenceDate === 'string' ? referenceDate : formatDateISO(referenceDate);

  if (cycleCount === 0) {
    return {
      averageCycleLength: 0,
      averagePeriodDuration: 0,
      shortestCycleLength: null,
      longestCycleLength: null,
      variationDays: 0,
      sampleStandardDeviation: null,
      cycleVariationRangeDays: null,
      cycleCount: 0,
      completedCycles: 0,
      currentCycleDay: null,
      currentPhase: null,
      lastPeriod: null,
      nextPeriodEstimatedDate: null,
      nextPeriodWindow: null,
      daysUntilNextPeriod: null,
      sufficiency
    };
  }

  // Durations & cycle lengths
  const avgPeriodDuration = calculateAveragePeriodDuration(processed) ?? 0;
  const avgCycleLength = calculateAverageCycleLength(processed);
  const bounds = calculateCycleLengthBounds(processed);
  const variation = calculateCycleVariation(processed);

  // Most recent period
  const lastPeriod = processed[processed.length - 1];
  const daysSinceStart = daysBetween(lastPeriod.startDate, refDateStr);
  const currentCycleDay = daysSinceStart >= 0 ? daysSinceStart + 1 : 1;

  // Next period estimation
  let nextPeriodEstimatedDate: string | null = null;
  let nextPeriodWindow: EstimatedPeriodWindow | null = null;
  let daysUntilNextPeriod: number | null = null;

  if (lastPeriod && avgCycleLength !== null) {
    nextPeriodEstimatedDate = estimateNextPeriodDate(lastPeriod.startDate, avgCycleLength);
    nextPeriodWindow = estimateNextPeriodWindow(
      lastPeriod.startDate,
      avgCycleLength,
      variation.sampleStandardDeviation,
      completedCycles
    );
    daysUntilNextPeriod = daysBetween(refDateStr, nextPeriodEstimatedDate);
  } else if (lastPeriod) {
    // 1-period provisional estimate
    nextPeriodEstimatedDate = estimateNextPeriodDate(lastPeriod.startDate, 28);
    nextPeriodWindow = estimateNextPeriodWindow(lastPeriod.startDate, 28, null, 0);
    daysUntilNextPeriod = daysBetween(refDateStr, nextPeriodEstimatedDate);
  }

  // Phase classification based on currentCycleDay
  let currentPhase: CyclePhase = 'menstrual';
  if (currentCycleDay <= 5) {
    currentPhase = 'menstrual';
  } else if (currentCycleDay <= 13) {
    currentPhase = 'follicular';
  } else if (currentCycleDay <= 16) {
    currentPhase = 'ovulatory';
  } else {
    currentPhase = 'luteal';
  }

  return {
    averageCycleLength: avgCycleLength !== null ? avgCycleLength : 0,
    averagePeriodDuration: avgPeriodDuration,
    shortestCycleLength: bounds.shortest,
    longestCycleLength: bounds.longest,
    variationDays: variation.sampleStandardDeviation ?? 0,
    sampleStandardDeviation: variation.sampleStandardDeviation,
    cycleVariationRangeDays: variation.rangeDays,
    cycleCount,
    completedCycles,
    currentCycleDay,
    currentPhase,
    lastPeriod,
    nextPeriodEstimatedDate,
    nextPeriodWindow,
    daysUntilNextPeriod,
    sufficiency
  };
}

// ============================================================================
// DATA VALIDATION & CLINICAL INTEGRITY RULES
// ============================================================================

/**
 * Validates a period record against integrity constraints and clinical thresholds.
 *
 * Rules:
 * 1. Start date must be a valid calendar date string.
 * 2. End date (if provided) must be a valid calendar date string.
 * 3. End date cannot be earlier than start date.
 * 4. Duplicate start dates with existing records are rejected.
 * 5. Overlapping date spans with existing records are rejected.
 * 6. Durations > 14 days are rejected as physiologically implausible.
 * 7. Durations < 2 days or > 8 days emit clinical advisory warnings without discarding.
 * 8. Cycles < 21 days or > 35 days emit clinical advisory warnings without discarding.
 */
export function validatePeriodRecord(
  startDate: string,
  endDate: string | undefined,
  existingPeriods: PeriodRecord[],
  excludeId?: string,
  thresholds: CycleThresholds = DEFAULT_CYCLE_THRESHOLDS
): PeriodValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const details: PeriodValidationResult['details'] = {};

  // 1. Start date check
  if (!startDate) {
    errors.push('Start date is required.');
    details.isInvalidDate = true;
  } else if (!isValidISODateString(startDate)) {
    errors.push(`Invalid start date format or nonexistent calendar date (${startDate}).`);
    details.isInvalidDate = true;
  }

  // 2. End date check
  if (endDate) {
    if (!isValidISODateString(endDate)) {
      errors.push(`Invalid end date format or nonexistent calendar date (${endDate}).`);
      details.isInvalidDate = true;
    } else if (startDate && isValidISODateString(startDate)) {
      if (endDate < startDate) {
        errors.push('End date cannot be earlier than start date.');
        details.isInverted = true;
      }
    }
  }

  // Return early on structural/date errors
  if (errors.length > 0) {
    return { isValid: false, errors, warnings, details };
  }

  // 3. Duration evaluation
  if (endDate) {
    const duration = calculatePeriodDuration(startDate, endDate) ?? 0;
    if (duration > thresholds.maxPlausiblePeriodDuration) {
      errors.push(
        `Recorded period length (${duration} days) exceeds maximum plausible duration (max ${thresholds.maxPlausiblePeriodDuration} days).`
      );
      details.isUnusuallyLongPeriod = true;
    } else if (duration > thresholds.maxNormalPeriodDuration) {
      warnings.push(
        `Recorded period duration (${duration} days) is longer than the typical clinical range (2–${thresholds.maxNormalPeriodDuration} days).`
      );
      details.isUnusuallyLongPeriod = true;
    } else if (duration < thresholds.minNormalPeriodDuration) {
      warnings.push(
        `Recorded period duration (${duration} day) is shorter than typical menses (2–${thresholds.maxNormalPeriodDuration} days). Check if this is spotting.`
      );
      details.isUnusuallyShortPeriod = true;
    }
  }

  // 4. Duplicate and Overlap checks
  const effectiveEnd = endDate || startDate;

  for (const existing of existingPeriods) {
    if (excludeId && existing.id === excludeId) continue;
    if (!isValidISODateString(existing.startDate)) continue;

    const existingEnd =
      existing.endDate && isValidISODateString(existing.endDate)
        ? existing.endDate
        : existing.startDate;

    // Duplicate start date or span overlap
    if (existing.startDate === startDate || (startDate <= existingEnd && effectiveEnd >= existing.startDate)) {
      errors.push(
        `Dates overlap with an existing recorded period (${existing.startDate} to ${existingEnd}).`
      );
      details.hasOverlap = true;
      if (existing.startDate === startDate) {
        details.isDuplicate = true;
      }
      break;
    }
  }

  // 5. Contextual Cycle Length Warnings (evaluating relative to adjacent recorded periods)
  if (errors.length === 0) {
    const sorted = [...existingPeriods]
      .filter((p) => (!excludeId || p.id !== excludeId) && isValidISODateString(p.startDate))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    // Find preceding period
    const preceding = sorted.filter((p) => p.startDate < startDate).pop();
    if (preceding) {
      const cycleLen = calculateCycleLength(preceding.startDate, startDate);
      if (cycleLen < thresholds.minNormalCycleDays) {
        warnings.push(
          `Cycle interval (${cycleLen} days from ${preceding.startDate}) is shorter than the typical clinical range (21–${thresholds.maxNormalCycleDays} days).`
        );
        details.isUnusuallyShortCycle = true;
      } else if (cycleLen > thresholds.maxNormalCycleDays) {
        warnings.push(
          `Cycle interval (${cycleLen} days from ${preceding.startDate}) is longer than the typical clinical range (21–${thresholds.maxNormalCycleDays} days).`
        );
        details.isUnusuallyLongCycle = true;
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    details
  };
}

/**
 * Backward-compatible wrapper for modal validation callers.
 */
export function validatePeriodRange(
  startDate: string,
  endDate: string,
  existingPeriods: PeriodRecord[],
  excludeId?: string
): { isValid: boolean; error?: string } {
  const result = validatePeriodRecord(startDate, endDate, existingPeriods, excludeId);
  return {
    isValid: result.isValid,
    error: result.errors[0]
  };
}

// ============================================================================
// SYMPTOM & LOG ANALYSIS
// ============================================================================

/**
 * Analyzes daily symptom frequencies across logs.
 */
export function calculateSymptomFrequencies(
  logs: DailyLog[]
): Record<Symptom, { count: number; percentage: number }> {
  const counts: Record<Symptom, number> = {
    cramps: 0,
    headache: 0,
    bloating: 0,
    acne: 0,
    breast_tenderness: 0,
    back_pain: 0,
    fatigue: 0,
    nausea: 0,
    other: 0
  };

  const totalLogs = logs.length;
  if (totalLogs === 0) {
    return Object.keys(counts).reduce((acc, key) => {
      acc[key as Symptom] = { count: 0, percentage: 0 };
      return acc;
    }, {} as Record<Symptom, { count: number; percentage: number }>);
  }

  logs.forEach((log) => {
    log.symptoms.forEach((s) => {
      if (counts[s] !== undefined) counts[s]++;
    });
  });

  const result = {} as Record<Symptom, { count: number; percentage: number }>;
  for (const key of Object.keys(counts) as Symptom[]) {
    result[key] = {
      count: counts[key],
      percentage: Math.round((counts[key] / totalLogs) * 100)
    };
  }

  return result;
}
