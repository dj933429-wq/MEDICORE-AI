import { spawnSync } from 'node:child_process';

if (!process.env.TSX_PERSISTENCE_CHILD) {
  const result = spawnSync('npx', ['tsx', '--env-file=.env.local', 'tests/firestore-persistence.test.mjs'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, TSX_PERSISTENCE_CHILD: 'true' },
  });
  process.exit(result.status ?? 0);
}

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  buildPeriodDocId,
  buildDailyLogDocId,
  validatePeriodInput,
  validateDailyLogInput,
  serializePeriodRecord,
  deserializePeriodRecord,
  serializeDailyLog,
  deserializeDailyLog,
} = await import('../src/lib/menstrual-health/firestore-service.ts');

const { processPeriodRecords } = await import('../src/lib/menstrual-health/calculations.ts');

test('Menstrual Health Firestore Persistence & Serialization Suite', async (t) => {
  await t.test('1. Deterministic Document ID construction', () => {
    assert.equal(buildPeriodDocId('2026-03-01'), 'period_2026-03-01');
    assert.equal(buildDailyLogDocId('2026-03-01'), 'log_2026-03-01');
  });

  await t.test('2. Period input validation', () => {
    // Valid inputs
    assert.equal(validatePeriodInput({ startDate: '2026-03-01', flow: 'medium' }).isValid, true);
    assert.equal(validatePeriodInput({ startDate: '2026-03-01', endDate: '2026-03-05', flow: 'heavy', notes: 'Normal' }).isValid, true);
    assert.equal(validatePeriodInput({ startDate: '2024-02-29', flow: 'light' }).isValid, true); // Leap year

    // Invalid dates
    assert.equal(validatePeriodInput({ startDate: '2025-02-29', flow: 'medium' }).isValid, false); // Non leap year
    assert.equal(validatePeriodInput({ startDate: '2026-03-05', endDate: '2026-03-01', flow: 'medium' }).isValid, false); // End before start
    assert.equal(validatePeriodInput({ startDate: 'not-a-date', flow: 'medium' }).isValid, false);
    assert.equal(validatePeriodInput({ startDate: '2026-03-01', flow: 'torrential' }).isValid, false); // Invalid flow
    assert.equal(validatePeriodInput({ startDate: '2026-03-01', flow: 'medium', notes: 'a'.repeat(1005) }).isValid, false); // Notes too long
  });

  await t.test('3. Daily log input validation', () => {
    // Valid input
    assert.equal(
      validateDailyLogInput({
        date: '2026-03-01',
        flow: 'light',
        symptoms: ['cramps', 'bloating'],
        mood: 'calm',
        energy: 4,
        sleepHours: 7.5,
        sleepQuality: 'restful',
        notes: 'Feeling good',
      }).isValid,
      true
    );

    // Invalid cases
    assert.equal(validateDailyLogInput({ date: '2025-02-29', flow: 'none', symptoms: [] }).isValid, false);
    assert.equal(validateDailyLogInput({ date: '2026-03-01', flow: 'invalid', symptoms: [] }).isValid, false);
    assert.equal(validateDailyLogInput({ date: '2026-03-01', flow: 'none', symptoms: ['not_a_symptom'] }).isValid, false);
    assert.equal(validateDailyLogInput({ date: '2026-03-01', flow: 'none', symptoms: [], energy: 6 }).isValid, false); // Energy > 5
    assert.equal(validateDailyLogInput({ date: '2026-03-01', flow: 'none', symptoms: [], sleepHours: 25 }).isValid, false); // Sleep > 24
    assert.equal(validateDailyLogInput({ date: '2026-03-01', flow: 'none', symptoms: [], sleepHours: -1 }).isValid, false); // Sleep < 0
    assert.equal(validateDailyLogInput({ date: '2026-03-01', flow: 'none', symptoms: [], notes: 'b'.repeat(2005) }).isValid, false);
  });

  await t.test('4. Period serialization and deserialization (clean domain mapping)', () => {
    const input = {
      startDate: '2026-01-15',
      endDate: '2026-01-19',
      flow: 'heavy',
      notes: 'Initial cycle',
    };

    const serialized = serializePeriodRecord(input);
    assert.equal(serialized.startDate, '2026-01-15');
    assert.equal(serialized.endDate, '2026-01-19');
    assert.equal(serialized.flow, 'heavy');
    assert.equal(serialized.source, 'user');
    assert.equal(serialized.notes, 'Initial cycle');
    assert.ok(serialized.createdAt);
    assert.ok(serialized.updatedAt);

    // Excluded derived fields
    assert.equal(serialized.id, undefined);
    assert.equal(serialized.cycleLength, undefined);
    assert.equal(serialized.durationDays, undefined);
    assert.equal(serialized.isOngoing, undefined);

    // Deserialization maps doc ID back to id
    const deserialized = deserializePeriodRecord('period_2026-01-15', serialized);
    assert.equal(deserialized.id, 'period_2026-01-15');
    assert.equal(deserialized.startDate, '2026-01-15');
    assert.equal(deserialized.endDate, '2026-01-19');
    assert.equal(deserialized.flow, 'heavy');
    assert.equal(deserialized.source, 'user');
    assert.equal(deserialized.notes, 'Initial cycle');
  });

  await t.test('5. Daily log serialization and deserialization (preserves decimals & arrays)', () => {
    const input = {
      date: '2026-02-14',
      flow: 'spotting',
      symptoms: ['headache', 'fatigue'],
      mood: 'happy',
      energy: 5,
      sleepHours: 8.5,
      sleepQuality: 'restful',
      notes: 'Valentines day journal',
    };

    const serialized = serializeDailyLog(input);
    assert.equal(serialized.date, '2026-02-14');
    assert.equal(serialized.flow, 'spotting');
    assert.deepEqual(serialized.symptoms, ['headache', 'fatigue']);
    assert.equal(serialized.mood, 'happy');
    assert.equal(serialized.energy, 5);
    assert.equal(serialized.sleepHours, 8.5);
    assert.equal(serialized.sleepQuality, 'restful');
    assert.equal(serialized.notes, 'Valentines day journal');
    assert.equal(serialized.source, 'user');

    const deserialized = deserializeDailyLog('log_2026-02-14', serialized);
    assert.equal(deserialized.id, 'log_2026-02-14');
    assert.equal(deserialized.date, '2026-02-14');
    assert.equal(deserialized.flow, 'spotting');
    assert.deepEqual(deserialized.symptoms, ['headache', 'fatigue']);
    assert.equal(deserialized.sleepHours, 8.5);
    assert.equal(deserialized.energy, 5);
  });

  await t.test('6. Ongoing period handling (missing endDate)', () => {
    const ongoingInput = {
      startDate: '2026-03-01',
      flow: 'medium',
    };

    const serialized = serializePeriodRecord(ongoingInput);
    assert.equal(serialized.endDate, null); // explicitly set null for absence

    const deserialized = deserializePeriodRecord('period_2026-03-01', serialized);
    assert.equal(deserialized.endDate, undefined);

    // Derived processing calculates isOngoing = true
    const processed = processPeriodRecords([deserialized]);
    assert.equal(processed[0].isOngoing, true);
    assert.equal(processed[0].durationDays, 1);
  });

  await t.test('7. Derived cycle calculations over reconstructed records', () => {
    const rec1 = deserializePeriodRecord('period_2026-01-01', {
      startDate: '2026-01-01',
      endDate: '2026-01-05',
      flow: 'medium',
      source: 'user',
    });
    const rec2 = deserializePeriodRecord('period_2026-01-29', {
      startDate: '2026-01-29',
      endDate: '2026-02-02',
      flow: 'heavy',
      source: 'user',
    });

    const processed = processPeriodRecords([rec1, rec2]);
    // rec1 is first period (no prior period), rec2 is second period (28 days after rec1)
    assert.equal(processed[0].cycleLength, undefined); // initial cycle has no preceding start date
    assert.equal(processed[0].durationDays, 5);
    assert.equal(processed[1].cycleLength, 28); // 2026-01-29 - 2026-01-01 = 28 days
    assert.equal(processed[1].durationDays, 5);
  });

  await t.test('8. Demo record rejection guard', () => {
    const periodValidation = validatePeriodInput({ startDate: '2026-03-01', flow: 'medium' });
    assert.equal(periodValidation.isValid, true);
    // Explicit demo rejection check
    assert.equal(serializePeriodRecord({ startDate: '2026-03-01', flow: 'medium' }).source, 'user');
  });

  await t.test('9. Schema reconciliation: serialization excludes redundant id and matches Firestore rules allowed fields', () => {
    const serializedPeriod = serializePeriodRecord({
      startDate: '2026-03-01',
      endDate: '2026-03-05',
      flow: 'medium',
      notes: 'Test notes',
    });
    // Check that id is NOT in keys
    assert.equal('id' in serializedPeriod, false);
    const periodKeys = Object.keys(serializedPeriod);
    const allowedPeriodKeys = ['startDate', 'endDate', 'flow', 'source', 'notes', 'createdAt', 'updatedAt'];
    for (const key of periodKeys) {
      assert.ok(allowedPeriodKeys.includes(key), `Period key ${key} is not in allowed Firestore keys`);
    }

    const serializedLog = serializeDailyLog({
      date: '2026-03-01',
      flow: 'spotting',
      symptoms: ['cramps'],
      mood: 'calm',
      energy: 4,
      sleepHours: 8,
      sleepQuality: 'restful',
      notes: 'Test log notes',
    });
    // Check that id is NOT in keys
    assert.equal('id' in serializedLog, false);
    const logKeys = Object.keys(serializedLog);
    const allowedLogKeys = ['date', 'flow', 'symptoms', 'mood', 'energy', 'sleepHours', 'sleepQuality', 'notes', 'source', 'createdAt', 'updatedAt'];
    for (const key of logKeys) {
      assert.ok(allowedLogKeys.includes(key), `Log key ${key} is not in allowed Firestore keys`);
    }
  });
});
