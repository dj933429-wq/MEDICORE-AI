/**
 * MEDICORE-AI — Cycle Calculation Engine Test Suite
 * Sprint 2B: Rigorous Statistical Validation, Sample Standard Deviation,
 * 4-Level Data Sufficiency, Realistic Cycle Scenarios, and Prediction Refinement
 */

import assert from 'node:assert/strict';
import {
  isValidISODateString,
  parseISODate,
  daysBetween,
  addDaysToDate,
  calculateCycleLength,
  calculatePeriodDuration,
  calculateAverageCycleLength,
  calculateAveragePeriodDuration,
  calculateCycleLengthBounds,
  calculateCycleVariation,
  checkDataSufficiency,
  estimateNextPeriodDate,
  estimateNextPeriodWindow,
  calculateCycleStats,
  validatePeriodRecord,
  validatePeriodRange,
  DEFAULT_CYCLE_THRESHOLDS
} from '../src/lib/menstrual-health/calculations.ts';

console.log('================================================================');
console.log('MEDICORE-AI: SPRINT 2B STATISTICAL VALIDATION & REFINEMENT SUITE');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`[PASS] #${totalTests}: ${name}`);
  } catch (err) {
    console.error(`[FAIL] #${totalTests}: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// ----------------------------------------------------------------------------
// SUITE 1: Calendar Date Arithmetic & Boundary Edge Cases
// ----------------------------------------------------------------------------
console.log('--- SUITE 1: Calendar Date Arithmetic & Boundary Edge Cases ---');

test('Valid ISO dates pass validation and parse into components', () => {
  assert.equal(isValidISODateString('2026-01-15'), true);
  assert.equal(isValidISODateString('2026-12-31'), true);
  assert.equal(isValidISODateString('2000-02-29'), true);
  assert.deepEqual(parseISODate('2026-01-15'), { year: 2026, month: 1, day: 15 });
  assert.equal(parseISODate('invalid'), null);
});

test('Invalid ISO date strings are rejected', () => {
  assert.equal(isValidISODateString('not-a-date'), false);
  assert.equal(isValidISODateString('2026-02-30'), false);
  assert.equal(isValidISODateString('2026-04-31'), false);
  assert.equal(isValidISODateString('2026-13-01'), false);
  assert.equal(isValidISODateString('2026-00-10'), false);
  assert.equal(isValidISODateString(''), false);
});

test('Leap year recognition: 2024 has Feb 29, 2025 does not', () => {
  assert.equal(isValidISODateString('2024-02-29'), true, '2024 is a leap year');
  assert.equal(isValidISODateString('2025-02-29'), false, '2025 is not a leap year');
  assert.equal(isValidISODateString('2023-02-29'), false, '2023 is not a leap year');
});

test('Century leap year rules: 2000 is leap, 1900 is not', () => {
  assert.equal(isValidISODateString('2000-02-29'), true, '2000 is divisible by 400');
  assert.equal(isValidISODateString('1900-02-29'), false, '1900 is not divisible by 400');
});

test('daysBetween correctly handles leap year February', () => {
  // In 2024 (leap): Feb 28 to Mar 1 = 2 days (Feb 28 -> Feb 29 -> Mar 1)
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
  // In 2025 (non-leap): Feb 28 to Mar 1 = 1 day (Feb 28 -> Mar 1)
  assert.equal(daysBetween('2025-02-28', '2025-03-01'), 1);
});

test('daysBetween correctly crosses month boundaries', () => {
  // Oct 31 to Nov 1 = 1 day
  assert.equal(daysBetween('2026-10-31', '2026-11-01'), 1);
  // Apr 30 to May 1 = 1 day
  assert.equal(daysBetween('2026-04-30', '2026-05-01'), 1);
});

test('daysBetween correctly crosses year boundaries', () => {
  // Dec 28, 2026 to Jan 5, 2027 = 8 days
  assert.equal(daysBetween('2026-12-28', '2027-01-05'), 8);
});

test('daysBetween returns negative for inverted order', () => {
  assert.equal(daysBetween('2026-11-10', '2026-11-05'), -5);
});

test('addDaysToDate accurately adds days across month and year boundaries', () => {
  assert.equal(addDaysToDate('2026-10-31', 1), '2026-11-01');
  assert.equal(addDaysToDate('2026-12-25', 10), '2027-01-04');
  assert.equal(addDaysToDate('2024-02-28', 1), '2024-02-29', 'Handles leap day');
  assert.equal(addDaysToDate('2024-02-28', 2), '2024-03-01', 'Crosses leap day');
  assert.equal(addDaysToDate('2026-01-10', -5), '2026-01-05', 'Subtracts days');
});

// ----------------------------------------------------------------------------
// SUITE 2: Core Cycle Length & Period Duration Calculations
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 2: Cycle Length & Period Duration Calculations ---');

test('calculateCycleLength strictly measures difference between consecutive start dates', () => {
  assert.equal(calculateCycleLength('2026-01-01', '2026-01-29'), 28);
  assert.equal(calculateCycleLength('2026-01-29', '2026-02-26'), 28);
  assert.equal(calculateCycleLength('2026-02-26', '2026-03-27'), 29);
});

test('calculatePeriodDuration calculates inclusive days', () => {
  // Jan 1 to Jan 5 inclusive = 5 days
  assert.equal(calculatePeriodDuration('2026-01-01', '2026-01-05'), 5);
  // Single day period: Jan 1 to Jan 1 = 1 day
  assert.equal(calculatePeriodDuration('2026-01-01', '2026-01-01'), 1);
});

test('calculatePeriodDuration returns null for missing or ongoing period', () => {
  assert.equal(calculatePeriodDuration('2026-01-01', undefined), null);
  assert.equal(calculatePeriodDuration('2026-01-01', ''), null);
});

test('calculatePeriodDuration returns null for inverted dates', () => {
  assert.equal(calculatePeriodDuration('2026-01-05', '2026-01-01'), null);
});

// ----------------------------------------------------------------------------
// SUITE 3: Statistical Review: Sample Standard Deviation (N - 1) & Variation
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 3: Statistical Metrics (Sample Std Dev & Descriptive Variation) ---');

const fixtureFourCycles = [
  { id: 'p1', startDate: '2026-01-01', endDate: '2026-01-05', flow: 'medium', source: 'demo' },
  { id: 'p2', startDate: '2026-01-27', endDate: '2026-01-31', flow: 'medium', source: 'demo' }, // Cycle 1: 26d, Dur: 5d
  { id: 'p3', startDate: '2026-02-24', endDate: '2026-02-28', flow: 'heavy', source: 'demo' },  // Cycle 2: 28d, Dur: 5d
  { id: 'p4', startDate: '2026-03-26', endDate: '2026-03-31', flow: 'light', source: 'demo' },  // Cycle 3: 30d, Dur: 6d
  { id: 'p5', startDate: '2026-04-27', endDate: '2026-05-02', flow: 'medium', source: 'demo' }  // Cycle 4: 32d, Dur: 6d
];
// Cycle lengths: [26, 28, 30, 32]
// N = 4 completed cycles.
// Mean = (26 + 28 + 30 + 32) / 4 = 29.0 days
// Squared deviations: (26-29)^2 = 9, (28-29)^2 = 1, (30-29)^2 = 1, (32-29)^2 = 9 -> Sum = 20
// Population Variance (N = 4): 20 / 4 = 5.0 -> Pop StdDev = sqrt(5.0) = 2.236... -> 2.2 days
// Sample Variance (N - 1 = 3, Bessel's correction): 20 / 3 = 6.6666... -> Sample StdDev = sqrt(6.6666...) = 2.5819... -> 2.6 days

test('calculateAverageCycleLength computes exact mathematical mean across completed cycles', () => {
  const avg = calculateAverageCycleLength(fixtureFourCycles);
  assert.equal(avg, 29.0);
});

test('calculateAveragePeriodDuration computes exact mean period duration', () => {
  const avgDuration = calculateAveragePeriodDuration(fixtureFourCycles);
  assert.equal(avgDuration, 5.4);
});

test('calculateCycleLengthBounds identifies shortest and longest cycles', () => {
  const bounds = calculateCycleLengthBounds(fixtureFourCycles);
  assert.deepEqual(bounds, { shortest: 26, longest: 32 });
});

test('calculateCycleVariation computes SAMPLE standard deviation (N - 1, Bessel) rather than population', () => {
  const variation = calculateCycleVariation(fixtureFourCycles);
  assert.equal(variation.standardDeviationType, 'sample');
  // Must be 2.6 (sample standard deviation sqrt(20/3)), NOT 2.2 (population sqrt(20/4))
  assert.equal(variation.sampleStandardDeviation, 2.6);
  assert.equal(variation.rangeDays, 6);
  assert.ok(variation.description.includes('sample standard deviation of ±2.6 days'));
  assert.ok(variation.description.includes('4 completed cycle intervals'));
});

test('calculateCycleVariation returns null sample standard deviation for fewer than 2 completed cycles', () => {
  // 2 periods = 1 completed cycle interval -> N = 1, degrees of freedom = 0 (undefined sample variance)
  const singleCycleFixture = [
    { id: 'p1', startDate: '2026-01-01', endDate: '2026-01-05', flow: 'medium', source: 'demo' },
    { id: 'p2', startDate: '2026-01-29', endDate: '2026-02-02', flow: 'medium', source: 'demo' }
  ];
  const variation = calculateCycleVariation(singleCycleFixture);
  assert.equal(variation.sampleStandardDeviation, null);
  assert.equal(variation.rangeDays, null);
  assert.equal(variation.standardDeviationType, 'sample');
  assert.ok(variation.description.includes('requires at least 2 completed cycle intervals'));
});

test('calculateCycleVariation uses descriptive variation instead of unsupported binary regular/irregular labels', () => {
  const irregularFixture = [
    { id: 'p1', startDate: '2026-01-01', endDate: '2026-01-05', flow: 'medium', source: 'demo' },
    { id: 'p2', startDate: '2026-01-22', endDate: '2026-01-26', flow: 'medium', source: 'demo' }, // Cycle 1: 21d
    { id: 'p3', startDate: '2026-03-08', endDate: '2026-03-12', flow: 'medium', source: 'demo' }, // Cycle 2: 45d
  ];
  // Cycle lengths: 21, 45 -> Mean = 33, diffs = -12, +12 -> sum sq = 144 + 144 = 288
  // Sample variance = 288 / (2 - 1) = 288 -> Sample StdDev = sqrt(288) = 16.97... -> 17.0 days
  const variation = calculateCycleVariation(irregularFixture);
  assert.equal(variation.sampleStandardDeviation, 17.0);
  assert.equal(variation.rangeDays, 24);
  // Verify it does NOT classify with unsupported isRegular boolean
  assert.equal('isRegular' in variation, false);
  assert.ok(variation.description.includes('range from 21 to 45 days (24 days range)'));
});

// ----------------------------------------------------------------------------
// SUITE 4: 4 Distinct Data Sufficiency Levels & Limitations
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 4: 4 Distinct Data Sufficiency Levels & Limitations ---');

test('Level 0 (none): 0 recorded periods communicates empty state and all false capabilities', () => {
  const sufficiency = checkDataSufficiency([]);
  assert.equal(sufficiency.level, 'none');
  assert.equal(sufficiency.periodCount, 0);
  assert.equal(sufficiency.completedCycles, 0);
  assert.equal(sufficiency.canCalculateCycleLength, false);
  assert.equal(sufficiency.canCalculatePeriodDuration, false);
  assert.equal(sufficiency.canCalculateVariation, false);
  assert.ok(sufficiency.limitations.includes('cannot be calculated without recorded period dates'));
});

test('Level 1 (insufficient): 1 recorded period cannot calculate cycle length; bleeding duration depends on endDate', () => {
  // Period without end date
  const ongoing = [{ id: 'p1', startDate: '2026-01-01', flow: 'medium', source: 'user' }];
  const suffOngoing = checkDataSufficiency(ongoing);
  assert.equal(suffOngoing.level, 'insufficient');
  assert.equal(suffOngoing.periodCount, 1);
  assert.equal(suffOngoing.completedCycles, 0);
  assert.equal(suffOngoing.canCalculateCycleLength, false);
  assert.equal(suffOngoing.canCalculatePeriodDuration, false);
  assert.equal(suffOngoing.canCalculateVariation, false);
  assert.ok(suffOngoing.limitations.includes('requires at least 2 consecutive period start dates'));

  // Period WITH end date: bleeding duration CAN be calculated
  const completed = [{ id: 'p1', startDate: '2026-01-01', endDate: '2026-01-05', flow: 'medium', source: 'user' }];
  const suffCompleted = checkDataSufficiency(completed);
  assert.equal(suffCompleted.level, 'insufficient');
  assert.equal(suffCompleted.canCalculateCycleLength, false);
  assert.equal(suffCompleted.canCalculatePeriodDuration, true);
  assert.equal(suffCompleted.canCalculateVariation, false);
});

test('Level 2 (minimal): 2 recorded periods (1 cycle interval) calculates cycle length but NOT variation', () => {
  const twoPeriods = [
    { id: 'p1', startDate: '2026-01-01', endDate: '2026-01-05', flow: 'medium', source: 'user' },
    { id: 'p2', startDate: '2026-01-29', endDate: '2026-02-02', flow: 'medium', source: 'user' }
  ];
  const sufficiency = checkDataSufficiency(twoPeriods);
  assert.equal(sufficiency.level, 'minimal');
  assert.equal(sufficiency.periodCount, 2);
  assert.equal(sufficiency.completedCycles, 1);
  assert.equal(sufficiency.canCalculateCycleLength, true);
  assert.equal(sufficiency.canCalculatePeriodDuration, true);
  assert.equal(sufficiency.canCalculateVariation, false);
  assert.ok(sufficiency.limitations.includes('requires at least 2 completed cycle intervals'));
});

test('Level 3 (sufficient): 2 completed intervals enables variation with preliminary disclaimer', () => {
  // 3 records = 2 completed cycle intervals
  const threePeriods = [
    { id: 'p1', startDate: '2026-01-01', endDate: '2026-01-05', flow: 'medium', source: 'user' },
    { id: 'p2', startDate: '2026-01-29', endDate: '2026-02-02', flow: 'medium', source: 'user' },
    { id: 'p3', startDate: '2026-02-26', endDate: '2026-03-02', flow: 'medium', source: 'user' }
  ];
  const sufficiency = checkDataSufficiency(threePeriods);
  assert.equal(sufficiency.level, 'sufficient');
  assert.equal(sufficiency.periodCount, 3);
  assert.equal(sufficiency.completedCycles, 2);
  assert.equal(sufficiency.canCalculateCycleLength, true);
  assert.equal(sufficiency.canCalculateVariation, true);
  // Verify honest terminology: "Variation calculable", NOT "Sufficient baseline"
  assert.ok(sufficiency.message.includes('Variation calculable'));
  assert.ok(sufficiency.limitations.includes('Preliminary dataset (2 completed intervals)'));
  assert.equal(sufficiency.message.includes('Sufficient baseline available'), false);
});

test('Level 3 (sufficient): 6+ completed intervals communicates more tracking history application reference', () => {
  const sevenPeriods = [
    { id: 'p1', startDate: '2026-01-01', endDate: '2026-01-05', flow: 'medium', source: 'user' },
    { id: 'p2', startDate: '2026-01-29', endDate: '2026-02-02', flow: 'medium', source: 'user' },
    { id: 'p3', startDate: '2026-02-26', endDate: '2026-03-02', flow: 'medium', source: 'user' },
    { id: 'p4', startDate: '2026-03-26', endDate: '2026-03-30', flow: 'medium', source: 'user' },
    { id: 'p5', startDate: '2026-04-23', endDate: '2026-04-27', flow: 'medium', source: 'user' },
    { id: 'p6', startDate: '2026-05-21', endDate: '2026-05-25', flow: 'medium', source: 'user' },
    { id: 'p7', startDate: '2026-06-18', endDate: '2026-06-22', flow: 'medium', source: 'user' }
  ];
  const sufficiency = checkDataSufficiency(sevenPeriods);
  assert.equal(sufficiency.completedCycles, 6);
  assert.ok(sufficiency.message.includes('More tracking history available'));
  assert.ok(sufficiency.limitations.includes('application-level reference'));
});

// ----------------------------------------------------------------------------
// SUITE 5: Prediction Refinement & Uncertainty Communication
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 5: Prediction Refinement & Uncertainty Communication ---');

test('estimateNextPeriodDate strictly adds mean cycle length to last start date', () => {
  const nextDate = estimateNextPeriodDate('2026-04-27', 29);
  assert.equal(nextDate, '2026-05-26');
});

test('estimateNextPeriodWindow derives uncertainty window from sample standard deviation and communicates uncertainty', () => {
  // Last start: 2026-04-27, avgCycle: 29.0, sampleStdDev: 2.6, completedCycles: 4
  const window = estimateNextPeriodWindow('2026-04-27', 29.0, 2.6, 4);
  assert.equal(window.estimatedStartDate, '2026-05-26');
  // Uncertainty margin: round(2.6) = 3 days -> May 23 to May 29
  assert.equal(window.uncertaintyDays, 3);
  assert.equal(window.actualVariationDays, 2.6);
  assert.equal(window.isCapped, false);
  assert.equal(window.windowStart, '2026-05-23');
  assert.equal(window.windowEnd, '2026-05-29');

  // Verify descriptive uncertainty language instead of pseudo-probability labels
  assert.equal('confidence' in window, false);
  assert.ok(window.historyDescription.includes('4 recorded cycle intervals'));
  assert.ok(window.historyDescription.includes('sample standard deviation of ±2.6 days'));
  assert.ok(window.uncertaintyDescription.includes('Window spans ±3 days'));
  assert.ok(window.disclaimer.includes('statistical estimates, not medically validated predictions'));
  assert.ok(window.disclaimer.includes('does not confirm ovulation, measure hormones, diagnose medical conditions, or provide contraception guidance'));
});

test('estimateNextPeriodWindow handles highly variable cycles [21, 45] with explicit presentation cap explanation', () => {
  // Cycles [21, 45]: sample standard deviation s = 17.0 days
  const window = estimateNextPeriodWindow('2026-03-08', 33.0, 17.0, 2);
  assert.equal(window.estimatedStartDate, '2026-04-10');
  // UncertaintyDays capped at +/- 7 days for calendar display
  assert.equal(window.uncertaintyDays, 7);
  assert.equal(window.actualVariationDays, 17.0);
  assert.equal(window.isCapped, true);
  assert.equal(window.windowStart, '2026-04-03');
  assert.equal(window.windowEnd, '2026-04-17');

  // Explicitly discloses that +/- 7 days is a presentation cap and does not capture full historical variation
  assert.ok(window.uncertaintyDescription.includes('capped at ±7 days'));
  assert.ok(window.uncertaintyDescription.includes('observed cycle variation is significantly wider'));
  assert.ok(window.uncertaintyDescription.includes('±17 days'));
});

test('estimateNextPeriodWindow provides honest provisional description when completed cycles = 0 or 1', () => {
  // 0 completed cycles: standard population baseline
  const zeroCycles = estimateNextPeriodWindow('2026-01-01', 28, null, 0);
  assert.ok(zeroCycles.historyDescription.includes('28-day standard population baseline'));

  // 1 completed cycle: preliminary estimate, variation requires 2+
  const oneCycle = estimateNextPeriodWindow('2026-01-29', 28, null, 1);
  assert.ok(oneCycle.historyDescription.includes('Preliminary estimate based on 1 recorded cycle interval'));
  assert.ok(oneCycle.historyDescription.includes('Minimum 2 intervals required'));
});

// ----------------------------------------------------------------------------
// SUITE 6: Period Record Validation (Errors, Overlaps, Inversions, Guardrails)
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 6: Period Validation & Clinical Guardrails ---');

const existingDemoPeriods = [
  { id: 'e1', startDate: '2026-01-01', endDate: '2026-01-05', flow: 'medium', source: 'demo' },
  { id: 'e2', startDate: '2026-01-29', endDate: '2026-02-02', flow: 'medium', source: 'demo' }
];

test('DEFAULT_CYCLE_THRESHOLDS adheres to FIGO clinical parameters', () => {
  assert.equal(DEFAULT_CYCLE_THRESHOLDS.minNormalCycleDays, 21);
  assert.equal(DEFAULT_CYCLE_THRESHOLDS.maxNormalCycleDays, 35);
  assert.equal(DEFAULT_CYCLE_THRESHOLDS.minNormalPeriodDuration, 2);
  assert.equal(DEFAULT_CYCLE_THRESHOLDS.maxNormalPeriodDuration, 8);
  assert.equal(DEFAULT_CYCLE_THRESHOLDS.maxPlausiblePeriodDuration, 14);
  assert.equal(DEFAULT_CYCLE_THRESHOLDS.maxPlausibleCycleDays, 90);
});

test('validatePeriodRecord accepts valid non-overlapping record', () => {
  const result = validatePeriodRecord('2026-02-26', '2026-03-02', existingDemoPeriods);
  assert.equal(result.isValid, true);
  assert.equal(result.errors.length, 0);
});

test('validatePeriodRecord rejects inverted dates (endDate before startDate)', () => {
  const result = validatePeriodRecord('2026-03-10', '2026-03-05', existingDemoPeriods);
  assert.equal(result.isValid, false);
  assert.equal(result.details.isInverted, true);
  assert.ok(result.errors.some(e => e.includes('earlier than start date')));
});

test('validatePeriodRecord rejects duplicate start dates', () => {
  const result = validatePeriodRecord('2026-01-01', '2026-01-06', existingDemoPeriods);
  assert.equal(result.isValid, false);
  assert.equal(result.details.isDuplicate, true);
});

test('validatePeriodRecord rejects overlapping period dates', () => {
  const result = validatePeriodRecord('2026-01-31', '2026-02-04', existingDemoPeriods);
  assert.equal(result.isValid, false);
  assert.equal(result.details.hasOverlap, true);
});

test('validatePeriodRecord allows updating an existing period without self-overlap conflict', () => {
  const result = validatePeriodRecord('2026-01-29', '2026-02-03', existingDemoPeriods, 'e2');
  assert.equal(result.isValid, true);
});

test('validatePeriodRecord rejects physiologically implausible period duration (> 14 days)', () => {
  const result = validatePeriodRecord('2026-03-01', '2026-03-20', existingDemoPeriods);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some(e => e.includes('exceeds maximum plausible duration')));
});

test('validatePeriodRecord accepts ongoing period with missing endDate', () => {
  const result = validatePeriodRecord('2026-03-01', undefined, existingDemoPeriods);
  assert.equal(result.isValid, true);
});

test('validatePeriodRecord generates advisory warnings for unusually short period without rejection', () => {
  const result = validatePeriodRecord('2026-03-01', '2026-03-01', existingDemoPeriods);
  assert.equal(result.isValid, true);
  assert.ok(result.warnings.some(w => w.includes('spotting')));
  assert.equal(result.details.isUnusuallyShortPeriod, true);
});

test('validatePeriodRecord generates advisory warnings for unusually long period without rejection', () => {
  const result = validatePeriodRecord('2026-03-01', '2026-03-10', existingDemoPeriods);
  assert.equal(result.isValid, true);
  assert.ok(result.warnings.some(w => w.includes('longer than the typical clinical range')));
  assert.equal(result.details.isUnusuallyLongPeriod, true);
});

test('validatePeriodRecord generates advisory warnings for unusually short cycle intervals', () => {
  const result = validatePeriodRecord('2026-02-10', '2026-02-14', existingDemoPeriods);
  assert.equal(result.isValid, true);
  assert.ok(result.warnings.some(w => w.includes('shorter than the typical clinical range')));
  assert.equal(result.details.isUnusuallyShortCycle, true);
});

test('validatePeriodRange backward-compatible helper returns single error string on failure', () => {
  const failed = validatePeriodRange('2026-01-01', '2026-01-05', existingDemoPeriods);
  assert.equal(failed.isValid, false);
  assert.ok(failed.error && failed.error.length > 0);

  const passed = validatePeriodRange('2026-03-01', '2026-03-05', existingDemoPeriods);
  assert.equal(passed.isValid, true);
  assert.equal(passed.error, undefined);
});

// ----------------------------------------------------------------------------
// SUITE 7: Realistic Scenarios (Fixed, Variable, Irregular, Boundaries, Leap Years)
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 7: Realistic Clinical Scenarios & Edge Cases ---');

test('Scenario 1: Fixed 28-day cycles produce 0.0 sample standard deviation and 0 range', () => {
  const fixedCycles = [
    { id: 'f1', startDate: '2026-01-01', endDate: '2026-01-05', flow: 'medium', source: 'user' },
    { id: 'f2', startDate: '2026-01-29', endDate: '2026-02-02', flow: 'medium', source: 'user' }, // 28d
    { id: 'f3', startDate: '2026-02-26', endDate: '2026-03-02', flow: 'medium', source: 'user' }, // 28d
    { id: 'f4', startDate: '2026-03-26', endDate: '2026-03-30', flow: 'medium', source: 'user' }, // 28d
    { id: 'f5', startDate: '2026-04-23', endDate: '2026-04-27', flow: 'medium', source: 'user' }, // 28d
  ];
  const stats = calculateCycleStats(fixedCycles, '2026-05-01');
  assert.equal(stats.averageCycleLength, 28.0);
  assert.equal(stats.sampleStandardDeviation, 0.0);
  assert.equal(stats.cycleVariationRangeDays, 0);
  assert.equal(stats.shortestCycleLength, 28);
  assert.equal(stats.longestCycleLength, 28);
  assert.equal(stats.nextPeriodEstimatedDate, '2026-05-21');
  // Uncertainty window clamps to minimum +/- 2 days even with 0.0 std dev
  assert.equal(stats.nextPeriodWindow?.uncertaintyDays, 2);
  assert.equal(stats.nextPeriodWindow?.windowStart, '2026-05-19');
  assert.equal(stats.nextPeriodWindow?.windowEnd, '2026-05-23');
});

test('Scenario 2: Variable cycles [25, 35, 28, 32] calculate exact sample standard deviation', () => {
  // Intervals: 25, 35, 28, 32 -> Mean = 120 / 4 = 30.0
  // Diffs: -5, +5, -2, +2 -> Squared: 25 + 25 + 4 + 4 = 58
  // Sample variance = 58 / (4 - 1) = 58 / 3 = 19.333...
  // Sample std dev = sqrt(19.333...) = 4.3969... -> 4.4 days
  const variablePeriods = [
    { id: 'v1', startDate: '2026-01-01', endDate: '2026-01-05', flow: 'medium', source: 'user' },
    { id: 'v2', startDate: '2026-01-26', endDate: '2026-01-30', flow: 'medium', source: 'user' }, // 25d
    { id: 'v3', startDate: '2026-03-02', endDate: '2026-03-06', flow: 'medium', source: 'user' }, // 35d
    { id: 'v4', startDate: '2026-03-30', endDate: '2026-04-03', flow: 'medium', source: 'user' }, // 28d
    { id: 'v5', startDate: '2026-05-01', endDate: '2026-05-05', flow: 'medium', source: 'user' }, // 32d
  ];
  const stats = calculateCycleStats(variablePeriods, '2026-05-10');
  assert.equal(stats.averageCycleLength, 30.0);
  assert.equal(stats.sampleStandardDeviation, 4.4);
  assert.equal(stats.cycleVariationRangeDays, 10);
  assert.equal(stats.shortestCycleLength, 25);
  assert.equal(stats.longestCycleLength, 35);
  // Next period: 2026-05-01 + 30 days = 2026-05-31
  assert.equal(stats.nextPeriodEstimatedDate, '2026-05-31');
  // Uncertainty: round(4.4) = 4 days -> 2026-05-27 to 2026-06-04
  assert.equal(stats.nextPeriodWindow?.uncertaintyDays, 4);
  assert.equal(stats.nextPeriodWindow?.windowStart, '2026-05-27');
  assert.equal(stats.nextPeriodWindow?.windowEnd, '2026-06-04');
});

test('Scenario 3: Incomplete periods with missing end dates still calculate cycle lengths accurately', () => {
  const ongoingPeriods = [
    { id: 'o1', startDate: '2026-01-01', endDate: '2026-01-05', flow: 'medium', source: 'user' },
    { id: 'o2', startDate: '2026-01-29', flow: 'heavy', source: 'user' }, // Missing endDate (ongoing)
    { id: 'o3', startDate: '2026-02-26', flow: 'medium', source: 'user' }  // Missing endDate (ongoing)
  ];
  const stats = calculateCycleStats(ongoingPeriods, '2026-03-01');
  assert.equal(stats.cycleCount, 3);
  assert.equal(stats.completedCycles, 2);
  assert.equal(stats.averageCycleLength, 28.0);
  // Average period duration only averages completed periods (only o1 is completed = 5 days)
  assert.equal(stats.averagePeriodDuration, 5.0);
  assert.equal(stats.sufficiency.canCalculateCycleLength, true);
  assert.equal(stats.sufficiency.canCalculatePeriodDuration, true);
});

test('Scenario 4: Month boundaries and leap years verify expected dates independently', () => {
  // Period crossing Halloween into November
  const octPeriod = [
    { id: 'm1', startDate: '2026-10-31', endDate: '2026-11-04', flow: 'medium', source: 'user' }, // 5d duration
    { id: 'm2', startDate: '2026-11-28', endDate: '2026-12-02', flow: 'medium', source: 'user' }  // 28d cycle
  ];
  const octStats = calculateCycleStats(octPeriod, '2026-12-05');
  assert.equal(octStats.averageCycleLength, 28.0);
  assert.equal(octStats.averagePeriodDuration, 5.0);
  // Next period from 2026-11-28 + 28 days = 2026-12-26 (Nov has 30 days: 28 + 2 = Nov 30, + 26 = Dec 26)
  assert.equal(octStats.nextPeriodEstimatedDate, '2026-12-26');

  // Year boundary transition
  const yearBoundaryPeriod = [
    { id: 'y1', startDate: '2026-12-28', endDate: '2027-01-01', flow: 'medium', source: 'user' }, // 5d duration
    { id: 'y2', startDate: '2027-01-25', endDate: '2027-01-29', flow: 'medium', source: 'user' }  // 28d cycle
  ];
  const yearStats = calculateCycleStats(yearBoundaryPeriod, '2027-02-01');
  assert.equal(yearStats.averageCycleLength, 28.0);
  // Next period: 2027-01-25 + 28 days = 2027-02-22 (Jan has 31 days: 25 + 6 = Jan 31, + 22 = Feb 22)
  assert.equal(yearStats.nextPeriodEstimatedDate, '2027-02-22');
});

// ----------------------------------------------------------------------------
// SUITE 8: Master calculateCycleStats Integration
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 8: Master calculateCycleStats Integration ---');

test('calculateCycleStats accurately compiles all metrics on 5-period dataset', () => {
  const stats = calculateCycleStats(fixtureFourCycles, '2026-05-10');
  assert.equal(stats.cycleCount, 5);
  assert.equal(stats.completedCycles, 4);
  assert.equal(stats.averageCycleLength, 29.0);
  assert.equal(stats.averagePeriodDuration, 5.4);
  assert.equal(stats.shortestCycleLength, 26);
  assert.equal(stats.longestCycleLength, 32);
  assert.equal(stats.sampleStandardDeviation, 2.6);
  assert.equal(stats.variationDays, 2.6);
  assert.equal(stats.cycleVariationRangeDays, 6);
  assert.equal(stats.sufficiency.level, 'sufficient');
  // Last period started 2026-04-27. Relative to 2026-05-10 (13 days later) -> Day 14
  assert.equal(stats.currentCycleDay, 14);
  assert.equal(stats.currentPhase, 'ovulatory');
  assert.equal(stats.nextPeriodEstimatedDate, '2026-05-26');
  assert.ok(stats.nextPeriodWindow !== null);
  assert.equal(stats.nextPeriodWindow.estimatedStartDate, '2026-05-26');
  assert.equal(stats.nextPeriodWindow.uncertaintyDays, 3);
});

test('calculateCycleStats returns truthful zeroes on empty dataset without fabricating metrics', () => {
  const emptyStats = calculateCycleStats([]);
  assert.equal(emptyStats.cycleCount, 0);
  assert.equal(emptyStats.completedCycles, 0);
  assert.equal(emptyStats.averageCycleLength, 0);
  assert.equal(emptyStats.averagePeriodDuration, 0);
  assert.equal(emptyStats.shortestCycleLength, null);
  assert.equal(emptyStats.longestCycleLength, null);
  assert.equal(emptyStats.sampleStandardDeviation, null);
  assert.equal(emptyStats.cycleVariationRangeDays, null);
  assert.equal(emptyStats.currentCycleDay, null);
  assert.equal(emptyStats.currentPhase, null);
  assert.equal(emptyStats.nextPeriodEstimatedDate, null);
  assert.equal(emptyStats.nextPeriodWindow, null);
  assert.equal(emptyStats.sufficiency.level, 'none');
  assert.ok(emptyStats.sufficiency.limitations.length > 0);
});

console.log('\n================================================================');
console.log(`ALL TESTS COMPLETE: ${passedTests}/${totalTests} PASSED`);
console.log('================================================================');
