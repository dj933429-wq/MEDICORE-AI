/**
 * MEDICORE-AI — Isolated Blood Bank Firestore Security Rules Suite
 * FILE: tests/blood-bank/blood-bank-security.test.mjs
 *
 * Verifies role enforcement, claims-only authorization, cross-role denial,
 * patient privacy isolation, schema integrity, and audit trail immutability
 * against local Firestore Emulator.
 *
 * NOTE: Constructs a temporary in-memory combined rules fixture.
 * The production firestore.rules on disk is NEVER modified.
 */

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'medicore-blood-bank-security-test';

// Read root rules and the proposed blood bank fragment
const rootRules = readFileSync('firestore.rules', 'utf8');
const bbFragment = readFileSync('docs/phase-4/blood-bank-firestore-rules.fragment', 'utf8');

// Combine in memory: inject fragment inside match /databases/{database}/documents block
// Find the last closing brace of the root rules
const lastBraceIndex = rootRules.lastIndexOf('}');
const secondLastBraceIndex = rootRules.lastIndexOf('}', lastBraceIndex - 1);
const combinedRules = 
  rootRules.slice(0, secondLastBraceIndex) + 
  '\n' + bbFragment + '\n' + 
  rootRules.slice(secondLastBraceIndex);

async function runBloodBankSecuritySuite() {
  console.log('================================================================');
  console.log('MEDICORE-AI: Blood Bank Isolated Security Rules Test Suite');
  console.log('================================================================\n');

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: combinedRules,
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

  // Pre-seed test data across existing domains and blood bank namespace
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // 1. Patient Alice clinical and menstrual records
    await setDoc(doc(db, 'users', 'patient_alice'), {
      name: 'Alice Patient',
      email: 'alice@example.com',
      role: 'patient',
    });
    await setDoc(doc(db, 'patients', 'patient_alice'), {
      fullName: 'Alice Patient',
      userId: 'patient_alice',
      doctorId: 'doctor_bob',
    });
    await setDoc(doc(db, 'patients', 'patient_alice', 'medicalRecords', 'rec1'), {
      diagnosis: 'Iron deficiency anemia',
      doctorId: 'doctor_bob',
      createdAt: new Date(),
    });
    await setDoc(doc(db, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01'), {
      startDate: '2026-01-01',
      endDate: '2026-01-05',
      flow: 'medium',
      source: 'user',
    });
    await setDoc(doc(db, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-01'), {
      date: '2026-01-01',
      symptoms: ['cramps'],
    });

    // 2. Pharmacist Inventory
    await setDoc(doc(db, 'inventory', 'pharm_1', 'medicines', 'med_1'), {
      name: 'Amoxicillin 500mg',
      stock: 100,
    });

    // 3. Blood Bank seeded records under center-primary
    await setDoc(doc(db, 'bloodBank', 'center-primary', 'donors', 'donor_existing'), {
      id: 'donor_existing',
      centerId: 'center-primary',
      fullName: 'John Existing Donor',
      nationalIdOrPassport: 'NAT-001',
      dateOfBirth: '1990-01-01',
      gender: 'male',
      bloodGroup: 'O+',
      contact: { phone: '+1 555-0001', email: 'john@example.com' },
      eligibilityStatus: 'eligible',
      donationCount: 3,
      verifiedByStaffUid: 'staff_bloodbank_1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    await setDoc(doc(db, 'bloodBank', 'center-primary', 'donations', 'donation_existing'), {
      id: 'donation_existing',
      centerId: 'center-primary',
      donorId: 'donor_existing',
      donorName: 'John Existing Donor',
      bloodGroup: 'O+',
      donationDate: '2026-01-01T10:00:00Z',
      volumeMl: 450,
      collectionStatus: 'completed',
      screeningStatus: 'tested_passed',
      collectionStaffUid: 'staff_bloodbank_1',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    });

    await setDoc(doc(db, 'bloodBank', 'center-primary', 'inventory', 'unit_existing'), {
      id: 'unit_existing',
      centerId: 'center-primary',
      donationId: 'donation_existing',
      donorId: 'donor_existing',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      collectionDate: '2026-01-01',
      expiryDate: '2026-02-05',
      volumeMl: 450,
      storageLocation: 'Cold Room 1, Shelf A-1',
      status: 'available',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    });

    await setDoc(doc(db, 'bloodBank', 'center-primary', 'requests', 'req_existing'), {
      id: 'req_existing',
      centerId: 'center-primary',
      requestingOrganization: 'City General Trauma ICU',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      quantityUnits: 2,
      urgency: 'routine',
      requiredByDate: '2026-01-02T10:00:00Z',
      status: 'submitted',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    });

    await setDoc(doc(db, 'bloodBank', 'center-primary', 'issues', 'dist_existing'), {
      id: 'dist_existing',
      centerId: 'center-primary',
      requestId: 'req_existing',
      destinationOrganization: 'City General Trauma ICU',
      issuedUnitIds: ['unit_existing'],
      authorizedStaffUid: 'staff_bloodbank_1',
      dispatchStatus: 'dispatched',
      temperatureLogVerified: true,
      createdAt: '2026-01-01T12:00:00Z',
      updatedAt: '2026-01-01T12:00:00Z',
    });

    await setDoc(doc(db, 'bloodBank', 'center-primary', 'auditLogs', 'audit_existing'), {
      id: 'audit_existing',
      centerId: 'center-primary',
      actorUid: 'staff_bloodbank_1',
      actorRole: 'blood_bank',
      action: 'DONOR_REGISTERED',
      entity: 'donor',
      entityId: 'donor_existing',
      timestamp: '2026-01-01T00:00:00Z',
    });
  });

  // Test Contexts
  const unauth = testEnv.unauthenticatedContext().firestore();
  const staff = testEnv.authenticatedContext('staff_bloodbank_1', { role: 'blood_bank' }).firestore();
  const staff2 = testEnv.authenticatedContext('staff_bloodbank_2', { role: 'blood_bank' }).firestore();
  const claimless = testEnv.authenticatedContext('claimless_user').firestore();
  const admin = testEnv.authenticatedContext('admin_user', { role: 'admin' }).firestore();
  const doctor = testEnv.authenticatedContext('doctor_bob', { role: 'doctor' }).firestore();
  const pharmacist = testEnv.authenticatedContext('pharm_1', { role: 'pharmacist' }).firestore();
  const patient = testEnv.authenticatedContext('patient_alice', { role: 'patient' }).firestore();

  // =========================================================================
  // Category A: Role & Authentication Access Control
  // =========================================================================
  console.log('\n--- Category A: Role & Authentication Access Control ---');

  await test('A1: Unauthenticated user denied read on blood bank donors', async () => {
    await assertFails(getDoc(doc(unauth, 'bloodBank', 'center-primary', 'donors', 'donor_existing')));
  });

  await test('A2: Unauthenticated user denied write on blood bank donors', async () => {
    await assertFails(setDoc(doc(unauth, 'bloodBank', 'center-primary', 'donors', 'd_unauth'), {
      fullName: 'Hacker',
    }));
  });

  await test('A3: Claimless authenticated user denied read on blood bank donors', async () => {
    await assertFails(getDoc(doc(claimless, 'bloodBank', 'center-primary', 'donors', 'donor_existing')));
  });

  await test('A4: Authenticated user with role "blood_bank" allowed read on donors', async () => {
    await assertSucceeds(getDoc(doc(staff, 'bloodBank', 'center-primary', 'donors', 'donor_existing')));
  });

  await test('A5: Blood bank staff allowed create donor with complete valid schema', async () => {
    await assertSucceeds(setDoc(doc(staff, 'bloodBank', 'center-primary', 'donors', 'donor_new'), {
      id: 'donor_new',
      centerId: 'center-primary',
      fullName: 'Sarah Connor',
      nationalIdOrPassport: 'PASSPORT-7712',
      dateOfBirth: '1988-04-12',
      gender: 'female',
      bloodGroup: 'A-',
      contact: { phone: '+1 555-8888', email: 'sarah@example.com' },
      eligibilityStatus: 'eligible',
      donationCount: 0,
      verifiedByStaffUid: 'staff_bloodbank_1',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    }));
  });

  await test('A6: Blood bank staff allowed update donor eligibility', async () => {
    await assertSucceeds(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'donors', 'donor_existing'), {
      eligibilityStatus: 'temporarily_deferred',
      deferralReason: 'Recent dental work',
      updatedAt: '2026-03-01T12:00:00Z',
    }));
  });

  // =========================================================================
  // Category B: Strict Cross-Role Denial (Staff & Patient Isolation)
  // =========================================================================
  console.log('\n--- Category B: Strict Cross-Role Denial ---');

  await test('B1: Admin denied read on blood bank donors', async () => {
    await assertFails(getDoc(doc(admin, 'bloodBank', 'center-primary', 'donors', 'donor_existing')));
  });

  await test('B2: Admin denied create on blood bank donors', async () => {
    await assertFails(setDoc(doc(admin, 'bloodBank', 'center-primary', 'donors', 'donor_admin_fail'), {
      id: 'donor_admin_fail',
      centerId: 'center-primary',
      fullName: 'Illegal Donor',
      bloodGroup: 'O+',
    }));
  });

  await test('B3: Doctor denied read on blood bank donors', async () => {
    await assertFails(getDoc(doc(doctor, 'bloodBank', 'center-primary', 'donors', 'donor_existing')));
  });

  await test('B4: Doctor denied read on blood bank inventory units', async () => {
    await assertFails(getDoc(doc(doctor, 'bloodBank', 'center-primary', 'inventory', 'unit_existing')));
  });

  await test('B5: Pharmacist denied read on blood bank donors', async () => {
    await assertFails(getDoc(doc(pharmacist, 'bloodBank', 'center-primary', 'donors', 'donor_existing')));
  });

  await test('B6: Pharmacist denied read on blood bank inventory units', async () => {
    await assertFails(getDoc(doc(pharmacist, 'bloodBank', 'center-primary', 'inventory', 'unit_existing')));
  });

  await test('B7: Patient denied read on blood bank donors', async () => {
    await assertFails(getDoc(doc(patient, 'bloodBank', 'center-primary', 'donors', 'donor_existing')));
  });

  await test('B8: Patient denied read on blood bank inventory units', async () => {
    await assertFails(getDoc(doc(patient, 'bloodBank', 'center-primary', 'inventory', 'unit_existing')));
  });

  await test('B9: Admin denied read on blood bank inventory units', async () => {
    await assertFails(getDoc(doc(admin, 'bloodBank', 'center-primary', 'inventory', 'unit_existing')));
  });

  // =========================================================================
  // Category C: Blood Bank Staff Restricted from Patient & Pharmacy Data
  // =========================================================================
  console.log('\n--- Category C: Blood Bank Staff Privacy Restrictions ---');

  await test('C1: Blood Bank staff denied read on patient demographic profile', async () => {
    await assertFails(getDoc(doc(staff, 'patients', 'patient_alice')));
  });

  await test('C2: Blood Bank staff denied read on patient medical records', async () => {
    await assertFails(getDoc(doc(staff, 'patients', 'patient_alice', 'medicalRecords', 'rec1')));
  });

  await test('C3: Blood Bank staff denied write on patient medical records', async () => {
    await assertFails(setDoc(doc(staff, 'patients', 'patient_alice', 'medicalRecords', 'rec_illegal'), {
      diagnosis: 'Unauthorized entry',
    }));
  });

  await test('C4: Blood Bank staff denied read on patient menstrual records', async () => {
    await assertFails(getDoc(doc(staff, 'users', 'patient_alice', 'menstrualRecords', 'period_2026-01-01')));
  });

  await test('C5: Blood Bank staff denied read on patient menstrual logs', async () => {
    await assertFails(getDoc(doc(staff, 'users', 'patient_alice', 'menstrualLogs', 'log_2026-01-01')));
  });

  await test('C6: Blood Bank staff denied read on pharmacy inventory', async () => {
    await assertFails(getDoc(doc(staff, 'inventory', 'pharm_1', 'medicines', 'med_1')));
  });

  await test('C7: Blood Bank staff denied write on pharmacy inventory', async () => {
    await assertFails(setDoc(doc(staff, 'inventory', 'pharm_1', 'medicines', 'med_illegal'), {
      name: 'Illegal medicine',
    }));
  });

  // =========================================================================
  // Category D: Schema Validation & Field-Level Integrity
  // =========================================================================
  console.log('\n--- Category D: Schema & Integrity Constraints ---');

  await test('D1: Rejects donor create with invalid blood group ("Z+") ', async () => {
    await assertFails(setDoc(doc(staff, 'bloodBank', 'center-primary', 'donors', 'd_bad_bg'), {
      id: 'd_bad_bg',
      centerId: 'center-primary',
      fullName: 'Bad Blood Donor',
      nationalIdOrPassport: 'NAT-999',
      dateOfBirth: '1990-01-01',
      gender: 'male',
      bloodGroup: 'Z+', // Invalid
      contact: { phone: '555', email: 'test@example.com' },
      eligibilityStatus: 'eligible',
      donationCount: 0,
      verifiedByStaffUid: 'staff_bloodbank_1',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    }));
  });

  await test('D2: Rejects donor create where verifiedByStaffUid does not match caller auth.uid', async () => {
    await assertFails(setDoc(doc(staff, 'bloodBank', 'center-primary', 'donors', 'd_spoof_staff'), {
      id: 'd_spoof_staff',
      centerId: 'center-primary',
      fullName: 'Spoofed Verification',
      nationalIdOrPassport: 'NAT-888',
      dateOfBirth: '1990-01-01',
      gender: 'male',
      bloodGroup: 'A+',
      contact: { phone: '555', email: 'test@example.com' },
      eligibilityStatus: 'eligible',
      donationCount: 0,
      verifiedByStaffUid: 'other_staff_uid', // Spoofed
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    }));
  });

  await test('D3: Rejects donation create with volume outside 100-600ml range (750ml)', async () => {
    await assertFails(setDoc(doc(staff, 'bloodBank', 'center-primary', 'donations', 'don_overvolume'), {
      id: 'don_overvolume',
      centerId: 'center-primary',
      donorId: 'donor_existing',
      donorName: 'John Donor',
      bloodGroup: 'O+',
      donationDate: '2026-03-01T10:00:00Z',
      volumeMl: 750, // Exceeds 600ml
      collectionStatus: 'completed',
      screeningStatus: 'pending',
      collectionStaffUid: 'staff_bloodbank_1',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    }));
  });

  await test('D4: Rejects blood request with zero quantity units', async () => {
    await assertFails(setDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_zero_qty'), {
      id: 'req_zero_qty',
      centerId: 'center-primary',
      requestingOrganization: 'Memorial Hospital',
      bloodGroup: 'B+',
      componentType: 'whole_blood',
      quantityUnits: 0, // Invalid: must be >= 1
      urgency: 'routine',
      requiredByDate: '2026-03-05T00:00:00Z',
      status: 'submitted',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    }));
  });

  await test('D5: Rejects blood issue/distribution without temperatureLogVerified == true', async () => {
    await assertFails(setDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', 'dist_unverified_temp'), {
      id: 'dist_unverified_temp',
      centerId: 'center-primary',
      requestId: 'req_existing',
      destinationOrganization: 'Memorial Hospital',
      issuedUnitIds: ['unit_existing'],
      authorizedStaffUid: 'staff_bloodbank_1',
      dispatchStatus: 'dispatched',
      temperatureLogVerified: false, // Must be true
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    }));
  });

  // =========================================================================
  // Category E: Immutable Audit Logs Protection
  // =========================================================================
  console.log('\n--- Category E: Audit Trail Immutability ---');

  await test('E1: Blood Bank staff allowed create valid audit log', async () => {
    await assertSucceeds(setDoc(doc(staff, 'bloodBank', 'center-primary', 'auditLogs', 'audit_new'), {
      id: 'audit_new',
      centerId: 'center-primary',
      actorUid: 'staff_bloodbank_1',
      actorRole: 'blood_bank',
      action: 'INVENTORY_QC_PASS',
      entity: 'inventory',
      entityId: 'unit_existing',
      timestamp: '2026-03-01T15:00:00Z',
    }));
  });

  await test('E2: Blood Bank staff denied creating audit log with spoofed actorUid', async () => {
    await assertFails(setDoc(doc(staff, 'bloodBank', 'center-primary', 'auditLogs', 'audit_spoof'), {
      id: 'audit_spoof',
      centerId: 'center-primary',
      actorUid: 'other_staff_uid', // Spoofed
      actorRole: 'blood_bank',
      action: 'INVENTORY_QC_PASS',
      entity: 'inventory',
      entityId: 'unit_existing',
      timestamp: '2026-03-01T15:00:00Z',
    }));
  });

  await test('E3: Blood Bank staff strictly denied UPDATE on existing audit log', async () => {
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'auditLogs', 'audit_existing'), {
      action: 'TAMPERED_ACTION',
    }));
  });

  await test('E4: Blood Bank staff strictly denied DELETE on existing audit log', async () => {
    await assertFails(deleteDoc(doc(staff, 'bloodBank', 'center-primary', 'auditLogs', 'audit_existing')));
  });

  await test('E5: Admin strictly denied UPDATE on audit log', async () => {
    await assertFails(updateDoc(doc(admin, 'bloodBank', 'center-primary', 'auditLogs', 'audit_existing'), {
      action: 'ADMIN_OVERWRITE',
    }));
  });

  await test('E6: Admin strictly denied DELETE on audit log', async () => {
    await assertFails(deleteDoc(doc(admin, 'bloodBank', 'center-primary', 'auditLogs', 'audit_existing')));
  });

  // =========================================================================
  // Category F: Deletion Prevention on Core Clinical Entities
  // =========================================================================
  console.log('\n--- Category F: Deletion Prevention on Core Entities ---');

  await test('F1: Blood Bank staff denied delete on donor record', async () => {
    await assertFails(deleteDoc(doc(staff, 'bloodBank', 'center-primary', 'donors', 'donor_existing')));
  });

  await test('F2: Blood Bank staff denied delete on donation record', async () => {
    await assertFails(deleteDoc(doc(staff, 'bloodBank', 'center-primary', 'donations', 'donation_existing')));
  });

  await test('F3: Blood Bank staff denied delete on inventory unit', async () => {
    await assertFails(deleteDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_existing')));
  });

  await test('F4: Blood Bank staff denied delete on blood request', async () => {
    await assertFails(deleteDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_existing')));
  });

  await test('F5: Blood Bank staff denied delete on issue/distribution record', async () => {
    await assertFails(deleteDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', 'dist_existing')));
  });

  await test('F6: Admin denied delete on donor record', async () => {
    await assertFails(deleteDoc(doc(admin, 'bloodBank', 'center-primary', 'donors', 'donor_existing')));
  });

  await test('F7: Admin denied delete on inventory unit', async () => {
    await assertFails(deleteDoc(doc(admin, 'bloodBank', 'center-primary', 'inventory', 'unit_existing')));
  });

  // Summary
  console.log('\n================================================================');
  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  console.log(`TOTAL ASSERTIONS: ${results.length} | PASS: ${passCount} | FAIL: ${failCount}`);
  console.log('================================================================');

  await testEnv.cleanup();

  if (failCount > 0) {
    process.exit(1);
  }
}

runBloodBankSecuritySuite().catch((err) => {
  console.error('Test Suite encountered fatal error:', err);
  process.exit(1);
});
