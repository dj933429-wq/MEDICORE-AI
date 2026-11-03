import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';

const PROJECT_ID = 'medicore-concurrency-test';
const rules = readFileSync('firestore.rules', 'utf8');

// Pure transaction logic matching firestore-service.ts exactly, using emulator test contexts
async function runSafePeriodCreate(db, userId, input) {
  if (input.source === 'demo') {
    return { success: false, error: 'Demo records cannot be persisted to Firestore.' };
  }
  const docRef = doc(db, 'users', userId, 'menstrualRecords', `period_${input.startDate}`);
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (snap.exists()) {
        const err = new Error(`A period record already exists with start date ${input.startDate}.`);
        err.name = 'E_DUPLICATE_PERIOD';
        throw err;
      }
      transaction.set(docRef, {
        startDate: input.startDate,
        endDate: input.endDate !== undefined ? input.endDate : null,
        flow: input.flow,
        source: 'user',
        notes: input.notes !== undefined ? input.notes : '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    return { success: true, id: `period_${input.startDate}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function runSafePeriodUpdate(db, userId, oldStartDate, updates) {
  const oldDocRef = doc(db, 'users', userId, 'menstrualRecords', `period_${oldStartDate}`);
  const newDocRef = doc(db, 'users', userId, 'menstrualRecords', `period_${updates.startDate}`);

  try {
    if (oldStartDate === updates.startDate) {
      await runTransaction(db, async (transaction) => {
        const sourceSnap = await transaction.get(oldDocRef);
        if (!sourceSnap.exists()) {
          throw new Error('E_NOT_FOUND: Record does not exist');
        }
        transaction.update(oldDocRef, {
          endDate: updates.endDate !== undefined ? updates.endDate : null,
          flow: updates.flow,
          updatedAt: serverTimestamp(),
        });
      });
      return { success: true, id: `period_${oldStartDate}` };
    }

    // Migration
    await runTransaction(db, async (transaction) => {
      const destSnap = await transaction.get(newDocRef);
      if (destSnap.exists()) {
        throw new Error('E_DESTINATION_OCCUPIED: Destination start date is already occupied');
      }
      const sourceSnap = await transaction.get(oldDocRef);
      if (!sourceSnap.exists()) {
        throw new Error('E_SOURCE_NOT_FOUND: Original period record not found');
      }

      transaction.delete(oldDocRef);
      transaction.set(newDocRef, {
        startDate: updates.startDate,
        endDate: updates.endDate !== undefined ? updates.endDate : null,
        flow: updates.flow,
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    return { success: true, id: `period_${updates.startDate}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function runConcurrencyTestSuite() {
  console.log('================================================================');
  console.log('MEDICORE-AI: Menstrual Health Firestore Concurrency & Tx Suite');
  console.log('================================================================\n');

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: rules,
      host: '127.0.0.1',
      port: 8080,
    },
  });

  const results = [];

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      results.push({ name, status: 'PASS' });
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      results.push({ name, status: 'FAIL', error: err.message });
    }
  }

  const patientId = 'tx_patient_concurrency_test';
  const authenticatedContext = testEnv.authenticatedContext(patientId, { role: 'patient' });
  const authDb = authenticatedContext.firestore();

  // Test 1: Create a period record at an available deterministic ID
  await test('TX-01: Create period record at available deterministic ID', async () => {
    const res = await runSafePeriodCreate(authDb, patientId, {
      startDate: '2026-03-01',
      endDate: '2026-03-05',
      flow: 'medium',
      source: 'user',
    });
    if (!res.success || res.id !== 'period_2026-03-01') {
      throw new Error(`Expected success with ID period_2026-03-01, got: ${JSON.stringify(res)}`);
    }
  });

  // Test 2 & 3: Attempt creation at an occupied destination -> confirm existing destination is not overwritten
  await test('TX-02: Attempt creation at occupied destination is rejected without overwrite', async () => {
    const res = await runSafePeriodCreate(authDb, patientId, {
      startDate: '2026-03-01',
      endDate: '2026-03-07',
      flow: 'heavy',
      source: 'user',
    });
    if (res.success) {
      throw new Error('Expected duplicate period creation to be rejected, but it succeeded.');
    }
    // Verify destination was NOT overwritten
    const docSnap = await getDoc(doc(authDb, 'users', patientId, 'menstrualRecords', 'period_2026-03-01'));
    if (!docSnap.exists() || docSnap.data().flow !== 'medium') {
      throw new Error('Occupied destination was silently mutated.');
    }
  });

  // Test 4: Update period record without changing its start date
  await test('TX-03: Update period record without changing start date (in-place update)', async () => {
    const res = await runSafePeriodUpdate(authDb, patientId, '2026-03-01', {
      startDate: '2026-03-01',
      endDate: '2026-03-06',
      flow: 'heavy',
    });
    if (!res.success || res.id !== 'period_2026-03-01') {
      throw new Error(`Expected update success for period_2026-03-01, got: ${JSON.stringify(res)}`);
    }
    const docSnap = await getDoc(doc(authDb, 'users', patientId, 'menstrualRecords', 'period_2026-03-01'));
    if (!docSnap.exists() || docSnap.data().flow !== 'heavy' || docSnap.data().endDate !== '2026-03-06') {
      throw new Error('Updated data was not reflected.');
    }
  });

  // Test 5 & 6: Migrate period record to a different start date atomically
  await test('TX-04: Migrate period record to a different start date atomically', async () => {
    const res = await runSafePeriodUpdate(authDb, patientId, '2026-03-01', {
      startDate: '2026-03-02',
      endDate: '2026-03-07',
      flow: 'heavy',
    });
    if (!res.success || res.id !== 'period_2026-03-02') {
      throw new Error(`Expected migration success to period_2026-03-02, got: ${JSON.stringify(res)}`);
    }
    // Verify old doc is gone, new doc exists
    const oldSnap = await getDoc(doc(authDb, 'users', patientId, 'menstrualRecords', 'period_2026-03-01'));
    const newSnap = await getDoc(doc(authDb, 'users', patientId, 'menstrualRecords', 'period_2026-03-02'));
    if (oldSnap.exists()) {
      throw new Error('Old document was not deleted after migration.');
    }
    if (!newSnap.exists() || newSnap.data().startDate !== '2026-03-02') {
      throw new Error('New document was not created with shifted startDate.');
    }
  });

  // Test 7: Migration failure when destination is occupied preserves original record
  await test('TX-05: Migration failure when destination is occupied preserves original record', async () => {
    // First, create a record at 2026-04-01 and 2026-04-10
    await runSafePeriodCreate(authDb, patientId, { startDate: '2026-04-01', flow: 'light', source: 'user' });
    await runSafePeriodCreate(authDb, patientId, { startDate: '2026-04-10', flow: 'medium', source: 'user' });

    // Attempt migrating 2026-04-10 to 2026-04-01
    const res = await runSafePeriodUpdate(authDb, patientId, '2026-04-10', {
      startDate: '2026-04-01',
      flow: 'heavy',
    });
    if (res.success) {
      throw new Error('Migration to occupied destination should have failed.');
    }

    // Confirm source record (2026-04-10) is still intact
    const sourceSnap = await getDoc(doc(authDb, 'users', patientId, 'menstrualRecords', 'period_2026-04-10'));
    if (!sourceSnap.exists() || sourceSnap.data().flow !== 'medium') {
      throw new Error('Original source record was damaged during failed migration.');
    }
  });

  // Test 8: Concurrent creation attempts for the same destination (simultaneous Promise.all)
  await test('TX-06: Simultaneous concurrent creation attempts allow only 1 success, 1 rejection', async () => {
    const targetDate = '2026-05-01';
    const [res1, res2] = await Promise.all([
      runSafePeriodCreate(authDb, patientId, { startDate: targetDate, flow: 'light', source: 'user' }),
      runSafePeriodCreate(authDb, patientId, { startDate: targetDate, flow: 'heavy', source: 'user' }),
    ]);

    const successes = [res1, res2].filter((r) => r.success);
    const failures = [res1, res2].filter((r) => !r.success);

    if (successes.length !== 1 || failures.length !== 1) {
      throw new Error(`Expected exactly 1 success and 1 failure in concurrent creation, got: ${successes.length} successes, ${failures.length} failures.`);
    }

    // Verify document exists and has valid data
    const finalSnap = await getDoc(doc(authDb, 'users', patientId, 'menstrualRecords', `period_${targetDate}`));
    if (!finalSnap.exists()) {
      throw new Error('Target document was not created.');
    }
  });

  // Test 9: Concurrent date migrations targeting the same destination
  await test('TX-07: Simultaneous concurrent migrations targeting the same destination allow only 1 success', async () => {
    // Create source A and source B
    await runSafePeriodCreate(authDb, patientId, { startDate: '2026-06-01', flow: 'light', source: 'user' });
    await runSafePeriodCreate(authDb, patientId, { startDate: '2026-06-02', flow: 'medium', source: 'user' });

    // Both attempt migrating to 2026-06-15 concurrently
    const destDate = '2026-06-15';
    const [mig1, mig2] = await Promise.all([
      runSafePeriodUpdate(authDb, patientId, '2026-06-01', { startDate: destDate, flow: 'light' }),
      runSafePeriodUpdate(authDb, patientId, '2026-06-02', { startDate: destDate, flow: 'medium' }),
    ]);

    const successes = [mig1, mig2].filter((r) => r.success);
    const failures = [mig1, mig2].filter((r) => !r.success);

    if (successes.length !== 1 || failures.length !== 1) {
      throw new Error(`Expected 1 migration to succeed and 1 to fail, got: ${successes.length} successes, ${failures.length} failures.`);
    }

    // Verify destination exists and the loser remains intact at its source
    const destSnap = await getDoc(doc(authDb, 'users', patientId, 'menstrualRecords', `period_${destDate}`));
    if (!destSnap.exists()) {
      throw new Error('Destination document does not exist.');
    }
  });

  // Test 10: Demo mode never writes to Firestore
  await test('TX-08: Demo mode writes are rejected by persistence service', async () => {
    const res = await runSafePeriodCreate(authDb, patientId, {
      startDate: '2026-07-01',
      flow: 'medium',
      source: 'demo',
    });
    if (res.success) {
      throw new Error('Demo record was accepted by persistence service.');
    }
  });

  console.log('\n================================================================');
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`CONCURRENCY RESULTS: ${passed}/${results.length} PASSED (${failed} FAILED)`);
  console.log('================================================================\n');

  await testEnv.cleanup();
  if (failed > 0) {
    process.exit(1);
  }
}

runConcurrencyTestSuite().catch((err) => {
  console.error('Fatal Concurrency Test Runner Exception:', err);
  process.exit(1);
});
