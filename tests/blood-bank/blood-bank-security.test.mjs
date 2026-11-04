/**
 * MEDICORE-AI — Isolated Blood Bank Firestore Security Rules Suite
 * FILE: tests/blood-bank/blood-bank-security.test.mjs
 * (Phase 4A.1 Hardened Security Assertions)
 *
 * Verifies role enforcement, claims-only authorization, cross-role denial,
 * patient privacy isolation, document/center ID consistency, strict field whitelisting,
 * relational existence checks, in-rules inventory state transitions,
 * and immutable audit trail guarantees against local Firestore Emulator.
 *
 * NOTE: Constructs a temporary in-memory combined rules fixture.
 * The production firestore.rules on disk is NEVER modified.
 */

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';

const PROJECT_ID = 'medicore-blood-bank-security-test';

// Read root rules and the proposed blood bank fragment
const rootRules = readFileSync('firestore.rules', 'utf8');
const bbFragment = readFileSync('docs/phase-4/blood-bank-firestore-rules.fragment', 'utf8');

// Combine in memory: inject fragment inside match /databases/{database}/documents block
const lastBraceIndex = rootRules.lastIndexOf('}');
const secondLastBraceIndex = rootRules.lastIndexOf('}', lastBraceIndex - 1);
const combinedRules = 
  rootRules.slice(0, secondLastBraceIndex) + 
  '\n' + bbFragment + '\n' + 
  rootRules.slice(secondLastBraceIndex);

async function runBloodBankSecuritySuite() {
  console.log('================================================================');
  console.log('MEDICORE-AI: Blood Bank Isolated Security Rules Test Suite (Hardened)');
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

  // Clear emulator state for repeatable test runs
  await testEnv.clearFirestore();

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
      donorReferenceId: 'DON-2026-0001',
      fullName: 'John Existing Donor',
      nationalIdOrPassport: 'NAT-001',
      dateOfBirth: '1990-01-01',
      gender: 'male',
      bloodGroup: 'O+',
      contact: { phone: '+1 555-0001', email: 'john@example.com' },
      eligibilityStatus: 'eligible',
      donationCount: 0,
      verifiedByStaffUid: 'staff_bloodbank_1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    await setDoc(doc(db, 'bloodBank', 'center-primary', 'donations', 'donation_existing'), {
      id: 'donation_existing',
      centerId: 'center-primary',
      donorId: 'donor_existing',
      donorReferenceId: 'DON-2026-0001',
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

    await setDoc(doc(db, 'bloodBank', 'center-primary', 'inventory', 'unit_quarantined'), {
      id: 'unit_quarantined',
      centerId: 'center-primary',
      donationId: 'donation_existing',
      donorId: 'donor_existing',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      collectionDate: '2026-01-01',
      expiryDate: '2026-02-05',
      volumeMl: 450,
      storageLocation: 'Quarantine Bay',
      status: 'quarantine',
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

  await test('A5: Blood bank staff allowed create donor with data minimization (donorReferenceId)', async () => {
    await assertSucceeds(setDoc(doc(staff, 'bloodBank', 'center-primary', 'donors', 'donor_new'), {
      id: 'donor_new',
      centerId: 'center-primary',
      donorReferenceId: 'DON-2026-0042',
      fullName: 'Sarah Connor',
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
  // Category D: Hardened Schema & Invariant Constraints
  // =========================================================================
  console.log('\n--- Category D: Hardened Invariants & Strict Whitelisting ---');

  await test('D1: Rejects donor create with document ID mismatch (id != docId)', async () => {
    await assertFails(setDoc(doc(staff, 'bloodBank', 'center-primary', 'donors', 'donor_mismatch'), {
      id: 'DIFFERENT_ID',
      centerId: 'center-primary',
      donorReferenceId: 'DON-2026-9999',
      fullName: 'Valid Name',
      dateOfBirth: '1990-01-01',
      gender: 'male',
      bloodGroup: 'O+',
      contact: { phone: '555', email: 'test@example.com' },
      eligibilityStatus: 'eligible',
      donationCount: 0,
      verifiedByStaffUid: 'staff_bloodbank_1',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    }));
  });

  await test('D2: Rejects donor create with centerId mismatch', async () => {
    await assertFails(setDoc(doc(staff, 'bloodBank', 'center-primary', 'donors', 'donor_bad_center'), {
      id: 'donor_bad_center',
      centerId: 'wrong-center-id',
      donorReferenceId: 'DON-2026-9998',
      fullName: 'Valid Name',
      dateOfBirth: '1990-01-01',
      gender: 'male',
      bloodGroup: 'O+',
      contact: { phone: '555', email: 'test@example.com' },
      eligibilityStatus: 'eligible',
      donationCount: 0,
      verifiedByStaffUid: 'staff_bloodbank_1',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    }));
  });

  await test('D3: Rejects donor create with unexpected extra field (strict hasOnly)', async () => {
    await assertFails(setDoc(doc(staff, 'bloodBank', 'center-primary', 'donors', 'donor_extra_field'), {
      id: 'donor_extra_field',
      centerId: 'center-primary',
      donorReferenceId: 'DON-2026-9997',
      fullName: 'Valid Name',
      dateOfBirth: '1990-01-01',
      gender: 'male',
      bloodGroup: 'O+',
      contact: { phone: '555', email: 'test@example.com' },
      eligibilityStatus: 'eligible',
      donationCount: 0,
      verifiedByStaffUid: 'staff_bloodbank_1',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
      unauthorizedField: 'MALICIOUS_PAYLOAD',
    }));
  });

  await test('D4: Rejects donor update attempting to alter immutable donorReferenceId', async () => {
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'donors', 'donor_existing'), {
      donorReferenceId: 'ALTERED_REF_ID',
      updatedAt: '2026-03-01T12:00:00Z',
    }));
  });

  await test('D4b: Rejects unauthorized modification of protected donor fields (e.g. bloodGroup, dateOfBirth)', async () => {
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'donors', 'donor_existing'), {
      bloodGroup: 'AB-',
      updatedAt: '2026-03-01T12:00:00Z',
    }));
  });

  await test('D4c: Rejects unauthorized modification of protected donation fields (e.g. donorId, volumeMl)', async () => {
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'donations', 'donation_existing'), {
      volumeMl: 600,
      updatedAt: '2026-03-01T12:00:00Z',
    }));
  });

  await test('D4d: Rejects unauthorized modification of protected inventory fields (e.g. bloodGroup, donationId)', async () => {
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_existing'), {
      bloodGroup: 'B-',
      updatedAt: '2026-03-01T12:00:00Z',
    }));
  });

  await test('D4e: Rejects unauthorized modification of protected request fields (e.g. quantityUnits, bloodGroup)', async () => {
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_existing'), {
      quantityUnits: 20,
      updatedAt: '2026-03-01T12:00:00Z',
    }));
  });

  await test('D4f: Rejects unauthorized modification of protected issue fields (e.g. issuedUnitIds, authorizedStaffUid)', async () => {
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', 'dist_existing'), {
      authorizedStaffUid: 'other_staff_uid',
      updatedAt: '2026-03-01T12:00:00Z',
    }));
  });

  await test('D5: Rejects donation create referencing nonexistent donorId', async () => {
    await assertFails(setDoc(doc(staff, 'bloodBank', 'center-primary', 'donations', 'don_missing_donor'), {
      id: 'don_missing_donor',
      centerId: 'center-primary',
      donorId: 'NONEXISTENT_DONOR_ID',
      donorName: 'Ghost',
      bloodGroup: 'O+',
      donationDate: '2026-03-01T10:00:00Z',
      volumeMl: 450,
      collectionStatus: 'completed',
      screeningStatus: 'pending',
      collectionStaffUid: 'staff_bloodbank_1',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    }));
  });

  await test('D6: Rejects inventory unit create referencing nonexistent donationId', async () => {
    await assertFails(setDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_missing_don'), {
      id: 'unit_missing_don',
      centerId: 'center-primary',
      donationId: 'NONEXISTENT_DONATION_ID',
      donorId: 'donor_existing',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      collectionDate: '2026-03-01',
      expiryDate: '2026-04-05',
      volumeMl: 450,
      storageLocation: 'Cold Room 1',
      status: 'available',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    }));
  });

  await test('D7: Rejects distribution create referencing nonexistent requestId', async () => {
    await assertFails(setDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', 'dist_missing_req'), {
      id: 'dist_missing_req',
      centerId: 'center-primary',
      requestId: 'NONEXISTENT_REQ_ID',
      destinationOrganization: 'City Hospital',
      issuedUnitIds: ['unit_existing'],
      authorizedStaffUid: 'staff_bloodbank_1',
      dispatchStatus: 'dispatched',
      temperatureLogVerified: true,
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    }));
  });

  // =========================================================================
  // Category E: In-Rules Inventory State Transitions
  // =========================================================================
  console.log('\n--- Category E: In-Rules State Transitions ---');

  await test('E1: Permitted state transition: quarantine -> available', async () => {
    await assertSucceeds(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_quarantined'), {
      status: 'available',
      updatedAt: '2026-03-01T12:00:00Z',
    }));
  });

  await test('E2: Permitted state transition: available -> reserved', async () => {
    await assertSucceeds(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_existing'), {
      status: 'reserved',
      reservedForRequestId: 'req_existing',
      updatedAt: '2026-03-01T12:00:00Z',
    }));
  });

  await test('E3: Prohibited state transition enforced in rules: available -> transfused (must be reserved first)', async () => {
    // Seed fresh available unit to test illegal direct jump
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'bloodBank', 'center-primary', 'inventory', 'unit_direct_jump'), {
        id: 'unit_direct_jump',
        centerId: 'center-primary',
        donationId: 'donation_existing',
        donorId: 'donor_existing',
        bloodGroup: 'O+',
        componentType: 'whole_blood',
        collectionDate: '2026-01-01',
        expiryDate: '2026-02-05',
        volumeMl: 450,
        storageLocation: 'Cold Room 1',
        status: 'available',
        createdAt: '2026-01-01T10:00:00Z',
        updatedAt: '2026-01-01T10:00:00Z',
      });
    });

    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_direct_jump'), {
      status: 'transfused', // ILLEGAL transition directly from available
      updatedAt: '2026-03-01T12:00:00Z',
    }));
  });

  await test('E4: Permitted request state transition: submitted -> approved', async () => {
    await assertSucceeds(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_existing'), {
      status: 'approved',
      reviewerStaffUid: 'staff_bloodbank_1',
      decisionNotes: 'Approved for OR',
      updatedAt: '2026-03-01T12:00:00Z',
    }));
  });

  await test('E5: Prohibited request state transition: terminal state cannot be reopened', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'bloodBank', 'center-primary', 'requests', 'req_terminal_fulfilled'), {
        id: 'req_terminal_fulfilled',
        centerId: 'center-primary',
        requestingOrganization: 'City Hospital',
        bloodGroup: 'O+',
        componentType: 'whole_blood',
        quantityUnits: 2,
        urgency: 'routine',
        requiredByDate: '2026-03-01T10:00:00Z',
        status: 'fulfilled',
        fulfilledUnitIds: ['unit_1', 'unit_2'],
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:00:00Z',
      });
    });

    // Attempt to reopen fulfilled request to submitted or approved
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_terminal_fulfilled'), {
      status: 'approved',
      updatedAt: '2026-03-01T12:00:00Z',
    }));
  });

  // =========================================================================
  // Category F: Audit Log Immutability & Append-Only Guarantees
  // =========================================================================
  console.log('\n--- Category F: Audit Trail Immutability ---');

  await test('F1: Blood Bank staff allowed create valid audit log matching auth.uid', async () => {
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

  await test('F2: Blood Bank staff denied creating audit log with spoofed actorUid', async () => {
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

  await test('F3: Blood Bank staff strictly denied UPDATE on existing audit log', async () => {
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'auditLogs', 'audit_existing'), {
      action: 'TAMPERED_ACTION',
    }));
  });

  await test('F4: Blood Bank staff strictly denied DELETE on existing audit log', async () => {
    await assertFails(deleteDoc(doc(staff, 'bloodBank', 'center-primary', 'auditLogs', 'audit_existing')));
  });

  await test('F5: Admin strictly denied UPDATE on audit log', async () => {
    await assertFails(updateDoc(doc(admin, 'bloodBank', 'center-primary', 'auditLogs', 'audit_existing'), {
      action: 'ADMIN_OVERWRITE',
    }));
  });

  await test('F6: Admin strictly denied DELETE on audit log', async () => {
    await assertFails(deleteDoc(doc(admin, 'bloodBank', 'center-primary', 'auditLogs', 'audit_existing')));
  });

  // =========================================================================
  // Category G: Deletion Prevention on Core Clinical Entities
  // =========================================================================
  console.log('\n--- Category G: Deletion Prevention on Core Entities ---');

  await test('G1: Blood Bank staff denied delete on donor record', async () => {
    await assertFails(deleteDoc(doc(staff, 'bloodBank', 'center-primary', 'donors', 'donor_existing')));
  });

  await test('G2: Blood Bank staff denied delete on donation record', async () => {
    await assertFails(deleteDoc(doc(staff, 'bloodBank', 'center-primary', 'donations', 'donation_existing')));
  });

  await test('G3: Blood Bank staff denied delete on inventory unit', async () => {
    await assertFails(deleteDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_existing')));
  });

  await test('G4: Blood Bank staff denied delete on blood request', async () => {
    await assertFails(deleteDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_existing')));
  });

  await test('G5: Blood Bank staff denied delete on issue/distribution record', async () => {
    await assertFails(deleteDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', 'dist_existing')));
  });

  await test('G6: Admin denied delete on donor record', async () => {
    await assertFails(deleteDoc(doc(admin, 'bloodBank', 'center-primary', 'donors', 'donor_existing')));
  });

  await test('G7: Admin denied delete on inventory unit', async () => {
    await assertFails(deleteDoc(doc(admin, 'bloodBank', 'center-primary', 'inventory', 'unit_existing')));
  });

  // =========================================================================
  // Category H: Direct Security Rules Bypass Prevention (Phase 4A.4)
  // Direct client writes attempting to bypass service-level lifecycle validation
  // =========================================================================
  console.log('\n--- Category H: Direct Security Rules Bypass Prevention ---');

  // Bypass H1: Deny direct request update to fulfilled while inventory remains reserved
  await test('H1: Deny direct request update to fulfilled while inventory remains reserved', async () => {
    // Seed approved request and reserved unit
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'bloodBank', 'center-primary', 'requests', 'req_bypass_h1'), {
        id: 'req_bypass_h1',
        centerId: 'center-primary',
        requestingOrganization: 'County General',
        bloodGroup: 'O+',
        componentType: 'whole_blood',
        quantityUnits: 1,
        urgency: 'urgent',
        requiredByDate: '2026-03-01T10:00:00Z',
        status: 'approved',
        allocatedUnitIds: ['unit_bypass_h1'],
        fulfilledUnitIds: [],
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:00:00Z',
      });
      await setDoc(doc(adminDb, 'bloodBank', 'center-primary', 'inventory', 'unit_bypass_h1'), {
        id: 'unit_bypass_h1',
        centerId: 'center-primary',
        donationId: 'don_base',
        donorId: 'donor_base',
        bloodGroup: 'O+',
        componentType: 'whole_blood',
        collectionDate: '2026-02-01',
        expiryDate: '2026-03-15',
        volumeMl: 450,
        storageLocation: 'Shelf A',
        status: 'reserved',
        reservedForRequestId: 'req_bypass_h1',
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:00:00Z',
      });
    });

    // Direct write attempting to mark request fulfilled while unit remains reserved in inventory
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_bypass_h1'), {
      status: 'fulfilled',
      fulfilledUnitIds: ['unit_bypass_h1'],
      allocatedUnitIds: [],
      updatedAt: '2026-03-01T11:00:00Z',
    }));
  });

  // Bypass H2: Deny injecting arbitrary fake IDs into fulfilledUnitIds
  await test('H2: Deny injecting arbitrary fake IDs into fulfilledUnitIds without delivery', async () => {
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_bypass_h1'), {
      status: 'fulfilled',
      fulfilledUnitIds: ['unit_FAKE_NONEXISTENT'],
      updatedAt: '2026-03-01T11:00:00Z',
    }));
  });

  // Bypass H3: Deny removing/clearing allocatedUnitIds on a request without releasing inventory
  await test('H3: Deny removing or replacing allocated IDs without releasing inventory', async () => {
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_bypass_h1'), {
      allocatedUnitIds: [], // Unit still reserved in inventory!
      updatedAt: '2026-03-01T11:00:00Z',
    }));
  });

  // Bypass H4: Deny direct creation of an issue document with dispatchStatus: 'delivered'
  await test('H4: Deny direct creation of an issue document with dispatchStatus: delivered', async () => {
    await assertFails(setDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', 'issue_bypass_h4'), {
      id: 'issue_bypass_h4',
      centerId: 'center-primary',
      requestId: 'req_bypass_h1',
      destinationOrganization: 'County General',
      issuedUnitIds: ['unit_bypass_h1'],
      authorizedStaffUid: 'staff_bloodbank_1',
      dispatchStatus: 'delivered', // Prohibited on creation
      temperatureLogVerified: true,
      deliveredAt: '2026-03-01T11:00:00Z',
      createdAt: '2026-03-01T11:00:00Z',
      updatedAt: '2026-03-01T11:00:00Z',
    }));
  });

  // Bypass H5: Deny updating a dispatched issue to delivered in isolation without changing request & inventory
  await test('H5: Deny updating a dispatched issue to delivered in isolation without atomic request and inventory updates', async () => {
    // Seed an issue in dispatched status
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'bloodBank', 'center-primary', 'issues', 'issue_bypass_h5'), {
        id: 'issue_bypass_h5',
        centerId: 'center-primary',
        requestId: 'req_bypass_h1',
        destinationOrganization: 'County General',
        issuedUnitIds: ['unit_bypass_h1'],
        authorizedStaffUid: 'staff_bloodbank_1',
        dispatchStatus: 'dispatched',
        temperatureLogVerified: true,
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:00:00Z',
      });
    });

    // Attempt direct isolated update of issue to delivered
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', 'issue_bypass_h5'), {
      dispatchStatus: 'delivered',
      deliveredAt: '2026-03-01T11:00:00Z',
      updatedAt: '2026-03-01T11:00:00Z',
    }));
  });

  // Bypass H6: Deny updating an inventory unit from reserved to transfused in isolation
  await test('H6: Deny marking a reserved inventory unit transfused without a valid delivery transaction', async () => {
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_bypass_h1'), {
      status: 'transfused',
      updatedAt: '2026-03-01T11:00:00Z',
    }));
  });

  // Bypass H7: Deny reversing terminal dispatchStatus (from delivered or cancelled back to active)
  await test('H7: Deny changing a cancelled or delivered issue back to an active status', async () => {
    // Seed a delivered issue and a cancelled issue
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'bloodBank', 'center-primary', 'issues', 'issue_term_delivered'), {
        id: 'issue_term_delivered',
        centerId: 'center-primary',
        requestId: 'req_bypass_h1',
        destinationOrganization: 'County General',
        issuedUnitIds: ['unit_bypass_h1'],
        authorizedStaffUid: 'staff_bloodbank_1',
        dispatchStatus: 'delivered',
        temperatureLogVerified: true,
        deliveredAt: '2026-03-01T11:00:00Z',
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T11:00:00Z',
      });
      await setDoc(doc(adminDb, 'bloodBank', 'center-primary', 'issues', 'issue_term_cancelled'), {
        id: 'issue_term_cancelled',
        centerId: 'center-primary',
        requestId: 'req_bypass_h1',
        destinationOrganization: 'County General',
        issuedUnitIds: ['unit_bypass_h1'],
        authorizedStaffUid: 'staff_bloodbank_1',
        dispatchStatus: 'cancelled',
        temperatureLogVerified: true,
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T11:00:00Z',
      });
    });

    // Reopen delivered issue to dispatched -> must fail
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', 'issue_term_delivered'), {
      dispatchStatus: 'dispatched',
      updatedAt: '2026-03-01T12:00:00Z',
    }));

    // Reopen cancelled issue to dispatched -> must fail
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', 'issue_term_cancelled'), {
      dispatchStatus: 'dispatched',
      updatedAt: '2026-03-01T12:00:00Z',
    }));
  });

  // Bypass H8: Deny updating a request to cancelled when active allocations exist
  await test('H8: Deny updating a request to cancelled when active allocations exist', async () => {
    await assertFails(updateDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_bypass_h1'), {
      status: 'cancelled',
      updatedAt: '2026-03-01T11:00:00Z',
    }));
  });

  // =========================================================================
  // Category I: Multi-Unit Security Closure & Adversarial Bypass Denial
  // (Phase 4A.5 Hardened Rules Enforcement)
  // =========================================================================
  console.log('\n--- Category I: Multi-Unit Security Closure & Adversarial Bypass Denial ---');

  // Pre-seed adversarial multi-unit test documents with security rules disabled
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    const cId = 'center-primary';

    // 1. Setup for I1: 2 units, delivery where only first unit is transfused
    await setDoc(doc(adminDb, 'bloodBank', cId, 'requests', 'req_adv_i1'), {
      id: 'req_adv_i1',
      centerId: cId,
      requestingOrganization: 'County General',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      quantityUnits: 2,
      urgency: 'urgent',
      requiredByDate: '2026-04-01',
      status: 'approved',
      allocatedUnitIds: ['unit_i1_a', 'unit_i1_b'],
      fulfilledUnitIds: [],
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });
    await setDoc(doc(adminDb, 'bloodBank', cId, 'inventory', 'unit_i1_a'), {
      id: 'unit_i1_a',
      centerId: cId,
      donationId: 'donation_existing',
      donorId: 'donor_existing',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      collectionDate: '2026-03-01',
      expiryDate: '2026-04-05',
      volumeMl: 450,
      storageLocation: 'Cold Room 1',
      status: 'reserved',
      reservedForRequestId: 'req_adv_i1',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });
    await setDoc(doc(adminDb, 'bloodBank', cId, 'inventory', 'unit_i1_b'), {
      id: 'unit_i1_b',
      centerId: cId,
      donationId: 'donation_existing',
      donorId: 'donor_existing',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      collectionDate: '2026-03-01',
      expiryDate: '2026-04-05',
      volumeMl: 450,
      storageLocation: 'Cold Room 1',
      status: 'reserved',
      reservedForRequestId: 'req_adv_i1',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });
    await setDoc(doc(adminDb, 'bloodBank', cId, 'issues', 'issue_adv_i1'), {
      id: 'issue_adv_i1',
      centerId: cId,
      requestId: 'req_adv_i1',
      destinationOrganization: 'County General',
      issuedUnitIds: ['unit_i1_a', 'unit_i1_b'],
      authorizedStaffUid: 'staff_bloodbank_1',
      dispatchStatus: 'dispatched',
      temperatureLogVerified: true,
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });

    // 2. Setup for I2: 3 units, delivery where one unit remains reserved
    await setDoc(doc(adminDb, 'bloodBank', cId, 'requests', 'req_adv_i2'), {
      id: 'req_adv_i2',
      centerId: cId,
      requestingOrganization: 'County General',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      quantityUnits: 3,
      urgency: 'urgent',
      requiredByDate: '2026-04-01',
      status: 'approved',
      allocatedUnitIds: ['unit_i2_a', 'unit_i2_b', 'unit_i2_c'],
      fulfilledUnitIds: [],
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });
    for (const uid of ['unit_i2_a', 'unit_i2_b', 'unit_i2_c']) {
      await setDoc(doc(adminDb, 'bloodBank', cId, 'inventory', uid), {
        id: uid,
        centerId: cId,
        donationId: 'donation_existing',
        donorId: 'donor_existing',
        bloodGroup: 'O+',
        componentType: 'whole_blood',
        collectionDate: '2026-03-01',
        expiryDate: '2026-04-05',
        volumeMl: 450,
        storageLocation: 'Cold Room 1',
        status: 'reserved',
        reservedForRequestId: 'req_adv_i2',
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:00:00Z',
      });
    }
    await setDoc(doc(adminDb, 'bloodBank', cId, 'issues', 'issue_adv_i2'), {
      id: 'issue_adv_i2',
      centerId: cId,
      requestId: 'req_adv_i2',
      destinationOrganization: 'County General',
      issuedUnitIds: ['unit_i2_a', 'unit_i2_b', 'unit_i2_c'],
      authorizedStaffUid: 'staff_bloodbank_1',
      dispatchStatus: 'in_transit',
      temperatureLogVerified: true,
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });

    // 3. Setup for I3: Request fulfilled update with fake/non-transfused IDs
    await setDoc(doc(adminDb, 'bloodBank', cId, 'requests', 'req_adv_i3'), {
      id: 'req_adv_i3',
      centerId: cId,
      requestingOrganization: 'County General',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      quantityUnits: 2,
      urgency: 'urgent',
      requiredByDate: '2026-04-01',
      status: 'approved',
      allocatedUnitIds: ['unit_i3_a'],
      fulfilledUnitIds: [],
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });
    await setDoc(doc(adminDb, 'bloodBank', cId, 'inventory', 'unit_i3_a'), {
      id: 'unit_i3_a',
      centerId: cId,
      donationId: 'donation_existing',
      donorId: 'donor_existing',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      collectionDate: '2026-03-01',
      expiryDate: '2026-04-05',
      volumeMl: 450,
      storageLocation: 'Cold Room 1',
      status: 'reserved',
      reservedForRequestId: 'req_adv_i3',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });

    // 4. Setup for I4: Multi-unit allocation removal where only first unit is released
    await setDoc(doc(adminDb, 'bloodBank', cId, 'requests', 'req_adv_i4'), {
      id: 'req_adv_i4',
      centerId: cId,
      requestingOrganization: 'County General',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      quantityUnits: 2,
      urgency: 'urgent',
      requiredByDate: '2026-04-01',
      status: 'approved',
      allocatedUnitIds: ['unit_i4_a', 'unit_i4_b'],
      fulfilledUnitIds: [],
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });
    await setDoc(doc(adminDb, 'bloodBank', cId, 'inventory', 'unit_i4_a'), {
      id: 'unit_i4_a',
      centerId: cId,
      donationId: 'donation_existing',
      donorId: 'donor_existing',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      collectionDate: '2026-03-01',
      expiryDate: '2026-04-05',
      volumeMl: 450,
      storageLocation: 'Cold Room 1',
      status: 'reserved',
      reservedForRequestId: 'req_adv_i4',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });
    await setDoc(doc(adminDb, 'bloodBank', cId, 'inventory', 'unit_i4_b'), {
      id: 'unit_i4_b',
      centerId: cId,
      donationId: 'donation_existing',
      donorId: 'donor_existing',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      collectionDate: '2026-03-01',
      expiryDate: '2026-04-05',
      volumeMl: 450,
      storageLocation: 'Cold Room 1',
      status: 'reserved',
      reservedForRequestId: 'req_adv_i4',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });

    // 5. Setup for I5: Multi-unit issue marked delivered while unit remains reserved
    await setDoc(doc(adminDb, 'bloodBank', cId, 'requests', 'req_adv_i5'), {
      id: 'req_adv_i5',
      centerId: cId,
      requestingOrganization: 'County General',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      quantityUnits: 2,
      urgency: 'urgent',
      requiredByDate: '2026-04-01',
      status: 'approved',
      allocatedUnitIds: ['unit_i5_a', 'unit_i5_b'],
      fulfilledUnitIds: ['unit_i5_a'],
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });
    await setDoc(doc(adminDb, 'bloodBank', cId, 'inventory', 'unit_i5_a'), {
      id: 'unit_i5_a',
      centerId: cId,
      donationId: 'donation_existing',
      donorId: 'donor_existing',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      collectionDate: '2026-03-01',
      expiryDate: '2026-04-05',
      volumeMl: 450,
      storageLocation: 'Cold Room 1',
      status: 'transfused',
      reservedForRequestId: 'req_adv_i5',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });
    await setDoc(doc(adminDb, 'bloodBank', cId, 'inventory', 'unit_i5_b'), {
      id: 'unit_i5_b',
      centerId: cId,
      donationId: 'donation_existing',
      donorId: 'donor_existing',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      collectionDate: '2026-03-01',
      expiryDate: '2026-04-05',
      volumeMl: 450,
      storageLocation: 'Cold Room 1',
      status: 'reserved',
      reservedForRequestId: 'req_adv_i5',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });
    await setDoc(doc(adminDb, 'bloodBank', cId, 'issues', 'issue_adv_i5'), {
      id: 'issue_adv_i5',
      centerId: cId,
      requestId: 'req_adv_i5',
      destinationOrganization: 'County General',
      issuedUnitIds: ['unit_i5_a', 'unit_i5_b'],
      authorizedStaffUid: 'staff_bloodbank_1',
      dispatchStatus: 'dispatched',
      temperatureLogVerified: true,
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });

    // 6. Setup for I6: Legitimate 2-unit delivery transaction
    await setDoc(doc(adminDb, 'bloodBank', cId, 'requests', 'req_adv_i6'), {
      id: 'req_adv_i6',
      centerId: cId,
      requestingOrganization: 'County General',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      quantityUnits: 2,
      urgency: 'urgent',
      requiredByDate: '2026-04-01',
      status: 'approved',
      allocatedUnitIds: ['unit_i6_a', 'unit_i6_b'],
      fulfilledUnitIds: [],
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });
    await setDoc(doc(adminDb, 'bloodBank', cId, 'inventory', 'unit_i6_a'), {
      id: 'unit_i6_a',
      centerId: cId,
      donationId: 'donation_existing',
      donorId: 'donor_existing',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      collectionDate: '2026-03-01',
      expiryDate: '2026-04-05',
      volumeMl: 450,
      storageLocation: 'Cold Room 1',
      status: 'reserved',
      reservedForRequestId: 'req_adv_i6',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });
    await setDoc(doc(adminDb, 'bloodBank', cId, 'inventory', 'unit_i6_b'), {
      id: 'unit_i6_b',
      centerId: cId,
      donationId: 'donation_existing',
      donorId: 'donor_existing',
      bloodGroup: 'O+',
      componentType: 'whole_blood',
      collectionDate: '2026-03-01',
      expiryDate: '2026-04-05',
      volumeMl: 450,
      storageLocation: 'Cold Room 1',
      status: 'reserved',
      reservedForRequestId: 'req_adv_i6',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });
    await setDoc(doc(adminDb, 'bloodBank', cId, 'issues', 'issue_adv_i6'), {
      id: 'issue_adv_i6',
      centerId: cId,
      requestId: 'req_adv_i6',
      destinationOrganization: 'County General',
      issuedUnitIds: ['unit_i6_a', 'unit_i6_b'],
      authorizedStaffUid: 'staff_bloodbank_1',
      dispatchStatus: 'dispatched',
      temperatureLogVerified: true,
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });
  });

  // Test I1: Two-unit delivery where only the first unit becomes transfused -> must be DENIED
  await test('I1: Deny 2-unit delivery where only the first unit becomes transfused', async () => {
    const cId = 'center-primary';
    const batch = writeBatch(staff);
    // Unit A becomes transfused
    batch.update(doc(staff, 'bloodBank', cId, 'inventory', 'unit_i1_a'), {
      status: 'transfused',
      updatedAt: '2026-03-01T11:00:00Z',
    });
    // Unit B is NOT updated (remains reserved)
    // Request claims both units are fulfilled
    batch.update(doc(staff, 'bloodBank', cId, 'requests', 'req_adv_i1'), {
      status: 'fulfilled',
      fulfilledUnitIds: ['unit_i1_a', 'unit_i1_b'],
      updatedAt: '2026-03-01T11:00:00Z',
    });
    // Issue claims delivery
    batch.update(doc(staff, 'bloodBank', cId, 'issues', 'issue_adv_i1'), {
      dispatchStatus: 'delivered',
      deliveredAt: '2026-03-01T11:00:00Z',
      updatedAt: '2026-03-01T11:00:00Z',
    });
    await assertFails(batch.commit());
  });

  // Test I2: Multi-unit delivery (3 units) where one unit remains reserved -> must be DENIED
  await test('I2: Deny multi-unit delivery (3 units) where one unit remains reserved', async () => {
    const cId = 'center-primary';
    const batch = writeBatch(staff);
    // Unit A and B become transfused
    batch.update(doc(staff, 'bloodBank', cId, 'inventory', 'unit_i2_a'), {
      status: 'transfused',
      updatedAt: '2026-03-01T11:00:00Z',
    });
    batch.update(doc(staff, 'bloodBank', cId, 'inventory', 'unit_i2_b'), {
      status: 'transfused',
      updatedAt: '2026-03-01T11:00:00Z',
    });
    // Unit C is NOT updated (remains reserved)
    batch.update(doc(staff, 'bloodBank', cId, 'requests', 'req_adv_i2'), {
      status: 'fulfilled',
      fulfilledUnitIds: ['unit_i2_a', 'unit_i2_b', 'unit_i2_c'],
      updatedAt: '2026-03-01T11:00:00Z',
    });
    batch.update(doc(staff, 'bloodBank', cId, 'issues', 'issue_adv_i2'), {
      dispatchStatus: 'delivered',
      deliveredAt: '2026-03-01T11:00:00Z',
      updatedAt: '2026-03-01T11:00:00Z',
    });
    await assertFails(batch.commit());
  });

  // Test I3: Request fulfilled-list update containing IDs that do not correspond to transfused inventory -> must be DENIED
  await test('I3: Deny request fulfilled-list update containing IDs not corresponding to transfused inventory', async () => {
    const cId = 'center-primary';
    await assertFails(updateDoc(doc(staff, 'bloodBank', cId, 'requests', 'req_adv_i3'), {
      status: 'fulfilled',
      fulfilledUnitIds: ['unit_i3_a', 'fake_nonexistent_unit_id_99'],
      updatedAt: '2026-03-01T11:00:00Z',
    }));
  });

  // Test I4: Multi-unit allocation removal where only the first unit is released -> must be DENIED
  await test('I4: Deny multi-unit allocation removal where only the first unit is released', async () => {
    const cId = 'center-primary';
    const batch = writeBatch(staff);
    // Drops allocatedUnitIds on request
    batch.update(doc(staff, 'bloodBank', cId, 'requests', 'req_adv_i4'), {
      allocatedUnitIds: [],
      updatedAt: '2026-03-01T11:00:00Z',
    });
    // Only releases unit A to available
    batch.update(doc(staff, 'bloodBank', cId, 'inventory', 'unit_i4_a'), {
      status: 'available',
      reservedForRequestId: null,
      updatedAt: '2026-03-01T11:00:00Z',
    });
    // Leaves unit B as reserved!
    await assertFails(batch.commit());
  });

  // Test I5: Multi-unit issue marked delivered while one or more units remain reserved -> must be DENIED
  await test('I5: Deny multi-unit issue marked delivered while one or more units remain reserved', async () => {
    const cId = 'center-primary';
    await assertFails(updateDoc(doc(staff, 'bloodBank', cId, 'issues', 'issue_adv_i5'), {
      dispatchStatus: 'delivered',
      deliveredAt: '2026-03-01T11:00:00Z',
      updatedAt: '2026-03-01T11:00:00Z',
    }));
  });

  // Test I6: Legitimate multi-unit delivery transaction where ALL units are transfused -> SUCCEEDS
  await test('I6: Legitimate multi-unit delivery transaction where all units are transfused succeeds', async () => {
    const cId = 'center-primary';
    const batch = writeBatch(staff);
    batch.update(doc(staff, 'bloodBank', cId, 'inventory', 'unit_i6_a'), {
      status: 'transfused',
      updatedAt: '2026-03-01T11:00:00Z',
    });
    batch.update(doc(staff, 'bloodBank', cId, 'inventory', 'unit_i6_b'), {
      status: 'transfused',
      updatedAt: '2026-03-01T11:00:00Z',
    });
    batch.update(doc(staff, 'bloodBank', cId, 'requests', 'req_adv_i6'), {
      status: 'fulfilled',
      fulfilledUnitIds: ['unit_i6_a', 'unit_i6_b'],
      updatedAt: '2026-03-01T11:00:00Z',
    });
    batch.update(doc(staff, 'bloodBank', cId, 'issues', 'issue_adv_i6'), {
      dispatchStatus: 'delivered',
      deliveredAt: '2026-03-01T11:00:00Z',
      updatedAt: '2026-03-01T11:00:00Z',
    });
    await assertSucceeds(batch.commit());
  });

  // Test I7: Direct client write exceeding bounded limit (> 4 units) fails-closed
  await test('I7: Direct client write exceeding bounded limit (> 4 units) fails-closed', async () => {
    const cId = 'center-primary';
    await assertFails(updateDoc(doc(staff, 'bloodBank', cId, 'requests', 'req_adv_i3'), {
      status: 'fulfilled',
      fulfilledUnitIds: ['u1', 'u2', 'u3', 'u4', 'u5'],
      updatedAt: '2026-03-01T11:00:00Z',
    }));
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
