import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

const PROJECT_ID = 'medicore-menstrual-security-test';
const rules = readFileSync('firestore.rules', 'utf8');

async function runMenstrualSecuritySuite() {
  console.log('================================================================');
  console.log('MEDICORE-AI: Menstrual Health Tracker Firestore Security Suite');
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

  // Pre-seed an existing period record and daily log for Patient Alice (patient_alice)
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01'), {
      startDate: '2026-01-01',
      endDate: '2026-01-05',
      flow: 'medium',
      source: 'user',
      notes: 'Initial seeded cycle',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await setDoc(doc(db, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-15'), {
      startDate: '2026-01-15',
      flow: 'light',
      source: 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await setDoc(doc(db, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-01'), {
      date: '2026-01-01',
      flow: 'medium',
      symptoms: ['cramps'],
      source: 'user',
      mood: 'calm',
      energy: 3,
      sleepHours: 8,
      sleepQuality: 'restful',
      notes: 'Initial day journal',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await setDoc(doc(db, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-15'), {
      date: '2026-01-15',
      flow: 'none',
      symptoms: [],
      source: 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  // Client contexts
  const unauthDb = testEnv.unauthenticatedContext().firestore();
  const alicePatientDb = testEnv.authenticatedContext('patient_alice', { role: 'patient' }).firestore();
  const aliceClaimlessDb = testEnv.authenticatedContext('patient_alice', {}).firestore();
  const evePatientDb = testEnv.authenticatedContext('patient_eve', { role: 'patient' }).firestore();
  const doctorDb = testEnv.authenticatedContext('doctor_bob', { role: 'doctor' }).firestore();
  const adminDb = testEnv.authenticatedContext('admin_carol', { role: 'admin' }).firestore();
  const pharmaDb = testEnv.authenticatedContext('pharma_dan', { role: 'pharmacist' }).firestore();
  const bloodBankDb = testEnv.authenticatedContext('bb_frank', { role: 'blood_bank' }).firestore();
  const unknownRoleDb = testEnv.authenticatedContext('patient_alice', { role: 'guest' }).firestore();

  // --------------------------------------------------------------------------
  // SUITE 1: Role-Based Access Control (Strict Patient Isolation)
  // --------------------------------------------------------------------------
  await test('SEC-01: Unauthenticated request cannot read period records', async () => {
    await assertFails(getDoc(doc(unauthDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01')));
  });

  await test('SEC-02: Unauthenticated request cannot read daily logs', async () => {
    await assertFails(getDoc(doc(unauthDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-01')));
  });

  await test('SEC-03: Patient owner with explicit role=patient CAN read their own period records', async () => {
    await assertSucceeds(getDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01')));
  });

  await test('SEC-04: Patient owner without role claim (standard public signup) CAN read their own records', async () => {
    await assertSucceeds(getDoc(doc(aliceClaimlessDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01')));
  });

  await test('SEC-04B: Patient owner without role claim (standard public signup) CAN create period records', async () => {
    await assertSucceeds(
      setDoc(doc(aliceClaimlessDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-02-15'), {
        startDate: '2026-02-15',
        flow: 'medium',
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-05: Cross-patient access is DENIED (Eve cannot read Alice periods)', async () => {
    await assertFails(getDoc(doc(evePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01')));
  });

  await test('SEC-06: Cross-patient access is DENIED (Eve cannot read Alice logs)', async () => {
    await assertFails(getDoc(doc(evePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-01')));
  });

  await test('SEC-07: Doctor role is DENIED access to patient menstrual records', async () => {
    await assertFails(getDoc(doc(doctorDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01')));
  });

  await test('SEC-08: Doctor role is DENIED access to their own UID path as menstrual records', async () => {
    await assertFails(getDoc(doc(doctorDb, 'users', 'doctor_bob', 'menstrualRecords', 'period_2026-01-01')));
  });

  await test('SEC-08B: Admin role is DENIED access to their own UID path as menstrual records', async () => {
    await assertFails(getDoc(doc(adminDb, 'users', 'admin_carol', 'menstrualRecords', 'period_2026-01-01')));
  });

  await test('SEC-08C: Pharmacist role is DENIED access to their own UID path as menstrual records', async () => {
    await assertFails(getDoc(doc(pharmaDb, 'users', 'pharma_dan', 'menstrualRecords', 'period_2026-01-01')));
  });

  await test('SEC-08D: Blood bank role is DENIED access to their own UID path as menstrual records', async () => {
    await assertFails(getDoc(doc(bloodBankDb, 'users', 'bb_frank', 'menstrualRecords', 'period_2026-01-01')));
  });

  await test('SEC-09: Admin role is DENIED access to patient menstrual records', async () => {
    await assertFails(getDoc(doc(adminDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01')));
  });

  await test('SEC-10: Pharmacist role is DENIED access to patient menstrual records', async () => {
    await assertFails(getDoc(doc(pharmaDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01')));
  });

  await test('SEC-11: Blood bank role is DENIED access to patient menstrual records', async () => {
    await assertFails(getDoc(doc(bloodBankDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01')));
  });

  await test('SEC-12: Unknown role claim (guest) is DENIED access', async () => {
    await assertFails(getDoc(doc(unknownRoleDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01')));
  });

  // --------------------------------------------------------------------------
  // SUITE 2: Period Records Creation & Schema Validation (Required vs Optional)
  // --------------------------------------------------------------------------
  await test('SEC-13: Valid period creation succeeds with all fields (required + valid optional)', async () => {
    await assertSucceeds(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-02-01'), {
        startDate: '2026-02-01',
        endDate: '2026-02-05',
        flow: 'heavy',
        source: 'user',
        notes: 'Second cycle entry',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-14: Period creation succeeds when optional fields (endDate and notes) are absent', async () => {
    await assertSucceeds(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-02-10'), {
        startDate: '2026-02-10',
        flow: 'light',
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-15: Period creation with null endDate succeeds (ongoing period)', async () => {
    await assertSucceeds(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-03-01'), {
        startDate: '2026-03-01',
        endDate: null,
        flow: 'medium',
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-16: Period creation FAILS when document ID does not match startDate', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-04-99'), {
        startDate: '2026-04-01',
        endDate: '2026-04-05',
        flow: 'light',
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-17: Period creation FAILS when source is "demo"', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-05-01'), {
        startDate: '2026-05-01',
        endDate: '2026-05-05',
        flow: 'light',
        source: 'demo',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-18: Period creation FAILS when endDate < startDate', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-06-05'), {
        startDate: '2026-06-05',
        endDate: '2026-06-01',
        flow: 'medium',
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-19: Period creation FAILS when unwhitelisted derived field (cycleLength) is included', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-07-01'), {
        startDate: '2026-07-01',
        endDate: '2026-07-05',
        flow: 'medium',
        source: 'user',
        cycleLength: 28,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-19B: Period creation FAILS when redundant "id" field is stored in document body', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-07-15'), {
        id: 'period_2026-07-15',
        startDate: '2026-07-15',
        flow: 'medium',
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-20: Period creation FAILS when forged non-server createdAt is supplied', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-08-01'), {
        startDate: '2026-08-01',
        flow: 'medium',
        source: 'user',
        createdAt: new Date('2020-01-01T00:00:00Z'),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-21: Period creation FAILS when notes exceeds 1000 characters', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-08-10'), {
        startDate: '2026-08-10',
        flow: 'medium',
        source: 'user',
        notes: 'x'.repeat(1005),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-22: Period creation FAILS when notes is not a string (invalid optional type)', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-08-11'), {
        startDate: '2026-08-11',
        flow: 'medium',
        source: 'user',
        notes: 12345,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  // --------------------------------------------------------------------------
  // SUITE 3: Period Records Update & Immutability Enforcement
  // --------------------------------------------------------------------------
  await test('SEC-23: Period update succeeds when updating permitted fields and updatedAt', async () => {
    await assertSucceeds(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01'), {
        endDate: '2026-01-06',
        flow: 'heavy',
        notes: 'Updated notes',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-24: Period update succeeds when optional fields remain absent', async () => {
    await assertSucceeds(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-15'), {
        flow: 'medium',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-25: Period update succeeds when valid optional fields are added to previously absent record', async () => {
    await assertSucceeds(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-15'), {
        endDate: '2026-01-19',
        notes: 'Newly added notes on existing period',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-26: Period update FAILS if client attempts to alter immutable startDate', async () => {
    await assertFails(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01'), {
        startDate: '2026-01-02',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-27: Period update FAILS if client attempts to overwrite immutable createdAt', async () => {
    await assertFails(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01'), {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-28: Period update FAILS if client attempts to alter immutable source', async () => {
    await assertFails(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01'), {
        source: 'demo',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-29: Period update FAILS if client introduces an unexpected field', async () => {
    await assertFails(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01'), {
        extraUnapprovedField: true,
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-30: Period update FAILS if client sets invalid flow enum', async () => {
    await assertFails(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01'), {
        flow: 'super_heavy',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-31: Period update FAILS if client sets invalid optional endDate format', async () => {
    await assertFails(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01'), {
        endDate: 'invalid-date-format',
        updatedAt: serverTimestamp(),
      })
    );
  });

  // --------------------------------------------------------------------------
  // SUITE 4: Daily Logs Creation, Optional-Field Auditing & Boundaries
  // --------------------------------------------------------------------------
  await test('SEC-32: Valid daily log creation succeeds with all optional fields supplied', async () => {
    await assertSucceeds(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-02-14'), {
        date: '2026-02-14',
        flow: 'spotting',
        symptoms: ['headache', 'fatigue'],
        mood: 'happy',
        energy: 4,
        sleepHours: 7.5,
        sleepQuality: 'restful',
        notes: 'Valentines log',
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-33: Daily log creation succeeds when ALL optional fields are omitted', async () => {
    await assertSucceeds(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-02-20'), {
        date: '2026-02-20',
        flow: 'none',
        symptoms: ['bloating'],
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-34: Daily log creation FAILS when invalid symptom element is present', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-02-21'), {
        date: '2026-02-21',
        flow: 'none',
        symptoms: ['cramps', 'unsupported_symptom'],
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-35: Daily log creation FAILS when energy is outside [1, 5] range (value=6)', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-02-22'), {
        date: '2026-02-22',
        flow: 'none',
        symptoms: [],
        energy: 6,
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-36: Daily log creation FAILS when energy is non-integer (invalid optional type, value=3.5)', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-02-23'), {
        date: '2026-02-23',
        flow: 'none',
        symptoms: [],
        energy: 3.5,
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-37: Daily log creation FAILS when sleepHours is outside [0, 24] range (value=25)', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-02-24'), {
        date: '2026-02-24',
        flow: 'none',
        symptoms: [],
        sleepHours: 25,
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-38: Daily log creation FAILS when invalid mood enum is provided', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-02-25'), {
        date: '2026-02-25',
        flow: 'none',
        symptoms: [],
        mood: 'ecstatic_unsupported',
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-39: Daily log creation FAILS when invalid sleepQuality enum is provided', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-02-26'), {
        date: '2026-02-26',
        flow: 'none',
        symptoms: [],
        sleepQuality: 'dreamy_unsupported',
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-40: Daily log creation FAILS when notes exceeds 2000 characters', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-02-27'), {
        date: '2026-02-27',
        flow: 'none',
        symptoms: [],
        notes: 'a'.repeat(2005),
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-41: Daily log creation FAILS when document ID does not match date', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-02-99'), {
        date: '2026-02-28',
        flow: 'none',
        symptoms: [],
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-41B: Daily log creation FAILS when redundant "id" field is stored in document body', async () => {
    await assertFails(
      setDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-02-28'), {
        id: 'log_2026-02-28',
        date: '2026-02-28',
        flow: 'none',
        symptoms: [],
        source: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  // --------------------------------------------------------------------------
  // SUITE 5: Daily Logs Update & Negative Update Audits
  // --------------------------------------------------------------------------
  await test('SEC-42: Daily log update succeeds when optional fields remain absent', async () => {
    await assertSucceeds(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-15'), {
        flow: 'light',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-43: Daily log update succeeds when valid optional fields are added', async () => {
    await assertSucceeds(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-15'), {
        mood: 'calm',
        energy: 4,
        sleepHours: 8.0,
        notes: 'Added sleep & mood note',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-44: Daily log update FAILS when attempting to alter immutable date', async () => {
    await assertFails(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-01'), {
        date: '2026-01-02',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-45: Daily log update FAILS when attempting to alter immutable createdAt', async () => {
    await assertFails(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-01'), {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-46: Daily log update FAILS when introducing invalid optional field type (sleepHours="eight")', async () => {
    await assertFails(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-01'), {
        sleepHours: 'eight',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-47: Daily log update FAILS when introducing invalid optional field value (energy=10)', async () => {
    await assertFails(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-01'), {
        energy: 10,
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-48: Daily log update FAILS when introducing an unexpected field', async () => {
    await assertFails(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-01'), {
        arbitraryUnapprovedField: 'hello',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-48A: Valid daily-log update with unchanged source ("user") succeeds', async () => {
    await assertSucceeds(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-01'), {
        source: 'user',
        notes: 'Updated notes with explicit unchanged source',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-48B: Daily-log update FAILS when attempting to change source from "user" to "demo"', async () => {
    await assertFails(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-01'), {
        source: 'demo',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await test('SEC-48C: Daily-log update FAILS when attempting to change source to any other value ("external")', async () => {
    await assertFails(
      updateDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-01'), {
        source: 'external',
        updatedAt: serverTimestamp(),
      })
    );
  });

  // --------------------------------------------------------------------------
  // SUITE 6: Deletion Permissions
  // --------------------------------------------------------------------------
  await test('SEC-49: Patient owner CAN delete their own period record', async () => {
    await assertSucceeds(deleteDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-02-01')));
  });

  await test('SEC-50: Patient owner CAN delete their own daily log', async () => {
    await assertSucceeds(deleteDoc(doc(alicePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-02-14')));
  });

  await test('SEC-51: Cross-patient deletion is DENIED (Eve cannot delete Alice period)', async () => {
    await assertFails(deleteDoc(doc(evePatientDb, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01')));
  });

  await test('SEC-52: Cross-patient deletion is DENIED (Eve cannot delete Alice log)', async () => {
    await assertFails(deleteDoc(doc(evePatientDb, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-01')));
  });

  // --------------------------------------------------------------------------
  // Final Results Compilation
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`MENSTRUAL SECURITY RESULTS: ${passed}/${results.length} PASSED (${failed} FAILED)`);
  console.log('================================================================\n');

  await testEnv.cleanup();
  if (failed > 0) {
    process.exit(1);
  }
}

runMenstrualSecuritySuite().catch((err) => {
  console.error('Fatal Test Runner Exception:', err);
  process.exit(1);
});
