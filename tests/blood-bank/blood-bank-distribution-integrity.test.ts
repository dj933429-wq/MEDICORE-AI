/**
 * MEDICORE-AI — Isolated Blood Bank Distribution & Request Integrity Real Transaction Suite
 * FILE: tests/blood-bank/blood-bank-distribution-integrity.test.ts
 *
 * (Phase 4A.3 Integration Review)
 * MANDATORY: Tests the ACTUAL exported `createDistribution()` function from
 * `src/lib/blood-bank/firestore-service.ts` directly against the local Firestore Emulator
 * and the proposed combined security rules.
 *
 * Verifies all 13 core transaction invariants with post-transaction document assertions:
 * 1. Approved requests can receive valid inventory units.
 * 2. Submitted and under-review requests cannot receive units.
 * 3. Duplicate unit IDs are rejected.
 * 4. Previously allocated units cannot be reused.
 * 5. Units reserved for another request are rejected.
 * 6. Request quantity limits are strictly enforced.
 * 7. Fulfilled, rejected, and cancelled requests cannot receive additional units.
 * 8. Invalid inventory transitions are rejected.
 * 9. Cancelled distributions do not incorrectly reserve inventory or increase fulfillment.
 * 10. Failed transactions do not leave partial issue, inventory, request, or audit changes (atomicity).
 * 11. Concurrent attempts cannot allocate the same inventory unit twice.
 * 12. Delivered dispatch rejects unreserved (available) inventory units.
 * 13. Delivered dispatch succeeds for correctly reserved units and transitions them to transfused.
 */

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, collection, getDocs, type Firestore } from 'firebase/firestore';
import type { BloodDistribution, AvailableStockSummary } from '../../src/lib/blood-bank/types';
import {
  createDistribution,
  deliverDistribution,
  cancelDistribution,
  updateRequestStatus,
  createNetworkBloodRequest,
  acceptNetworkBloodRequest,
  rejectNetworkBloodRequest,
  cancelNetworkBloodRequest,
  convertRejectedToBroadcast,
  updateBloodBankCenterStockSummary,
} from '../../src/lib/blood-bank/firestore-service';
import { BloodBankValidationError } from '../../src/lib/blood-bank/validation';

const PROJECT_ID = 'medicore-distribution-tx-test';

// Read and combine root rules with the blood bank fragment in memory
const rootRules = readFileSync('firestore.rules', 'utf8');
const bbFragment = readFileSync('docs/phase-4/blood-bank-firestore-rules.fragment', 'utf8');
const lastBraceIndex = rootRules.lastIndexOf('}');
const secondLastBraceIndex = rootRules.lastIndexOf('}', lastBraceIndex - 1);
const combinedRules =
  rootRules.slice(0, secondLastBraceIndex) +
  '\n' +
  bbFragment +
  '\n' +
  rootRules.slice(secondLastBraceIndex);

async function runRealDistributionTransactionSuite() {
  console.log('================================================================');
  console.log('MEDICORE-AI: Blood Bank Real Transaction Integration Test Suite');
  console.log('================================================================\n');

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: combinedRules,
      host: '127.0.0.1',
      port: 8080,
    },
  });

  // Clear emulator state for repeatable test runs
  await testEnv.clearFirestore();

  const staffUid = 'staff_bloodbank_tx_1';
  const staff = testEnv.authenticatedContext(staffUid, { role: 'blood_bank' }).firestore();
  const actor = { uid: staffUid, email: 'staff_tx@medicore.internal' };

  const patientUid = 'patient_tx_network_1';
  const patient = testEnv.authenticatedContext(patientUid, { role: 'patient' }).firestore();
  const patientActor = { uid: patientUid, email: 'patient_net@medicore.internal', role: 'patient' as const };

  const doctorUid = 'doctor_tx_network_1';
  const doctor = testEnv.authenticatedContext(doctorUid, { role: 'doctor' }).firestore();
  const doctorActor = { uid: doctorUid, email: 'dr_net@medicore.internal', role: 'doctor' as const };

  const center2StaffUid = 'staff_center2_tx';
  const center2Staff = testEnv.authenticatedContext(center2StaffUid, { role: 'blood_bank' }).firestore();
  const center2Actor = { uid: center2StaffUid, email: 'staff2_tx@medicore.internal' };

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`[FAIL] ${name}:`, error.message);
      if (error.stack) console.error(error.stack);
      failed++;
    }
  }

  // Pre-seed baseline test data using admin bypass
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();

    // Seed center directories
    await setDoc(doc(adminDb, 'bloodBank', 'center-primary'), {
      id: 'center-primary',
      name: 'Metropolis Blood Center',
      licenseNumber: 'LIC-BB-001',
      verificationStatus: 'verified',
      location: { latitude: 40.7128, longitude: -74.006, geohash: 'dr5reg' },
      address: { street: '100 Health Ave', city: 'Metropolis', postalCode: '10001', state: 'NY', country: 'US' },
      contact: { phone: '+1 555-0100', emergencyPhone: '+1 555-0199', email: 'bb1@example.com', operatingHours: '24/7' },
      availableStockSummary: { 'O+_whole_blood': 10 },
      isExhibitionCenter: false,
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    });

    await setDoc(doc(adminDb, 'bloodBank', 'center-secondary'), {
      id: 'center-secondary',
      name: 'St. Jude Regional Blood Bank',
      licenseNumber: 'LIC-BB-002',
      verificationStatus: 'verified',
      location: { latitude: 40.7306, longitude: -73.9352, geohash: 'dr5ru2' },
      address: { street: '200 Mercy Blvd', city: 'Metropolis', postalCode: '10002', state: 'NY', country: 'US' },
      contact: { phone: '+1 555-0200', emergencyPhone: '+1 555-0299', email: 'bb2@example.com', operatingHours: '24/7' },
      availableStockSummary: { 'A+_packed_red_cells': 5 },
      isExhibitionCenter: false,
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    });

    // Seed donor and donation
    await setDoc(doc(adminDb, 'bloodBank', 'center-primary', 'donors', 'donor_base'), {
      id: 'donor_base',
      centerId: 'center-primary',
      donorReferenceId: 'DON-TX-001',
      fullName: 'Alice Donor',
      nationalIdOrPassport: 'NAT-TX-001',
      dateOfBirth: '1992-05-10',
      gender: 'female',
      bloodGroup: 'O+',
      contact: { phone: '+1 555-0199', email: 'alice@example.com' },
      eligibilityStatus: 'eligible',
      donationCount: 1,
      verifiedByStaffUid: staffUid,
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    });

    await setDoc(doc(adminDb, 'bloodBank', 'center-primary', 'donations', 'don_base'), {
      id: 'don_base',
      centerId: 'center-primary',
      donorId: 'donor_base',
      donorReferenceId: 'DON-TX-001',
      donorName: 'Alice Donor',
      bloodGroup: 'O+',
      donationDate: '2026-02-01T10:00:00Z',
      volumeMl: 450,
      collectionStatus: 'completed',
      screeningStatus: 'tested_passed',
      collectionStaffUid: staffUid,
      createdAt: '2026-02-01T10:00:00Z',
      updatedAt: '2026-02-01T10:00:00Z',
    });
  });

  // Helper to seed requests and inventory units for tests
  async function seedTestRecords(records: [string, string, Record<string, unknown>][]) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      for (const [col, id, data] of records) {
        await setDoc(doc(adminDb, 'bloodBank', 'center-primary', col, id), data);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // TEST 1: Approved requests can receive valid inventory units
  // ---------------------------------------------------------------------------
  await test('1. Approved requests can receive valid inventory units and update atomically', async () => {
    await seedTestRecords([
      [
        'requests',
        'req_approved_1',
        {
          id: 'req_approved_1',
          centerId: 'center-primary',
          requestingOrganization: 'City Emergency Ward',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 2,
          urgency: 'urgent',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'approved',
          fulfilledUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_valid_1',
        {
          id: 'unit_valid_1',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf A',
          status: 'available',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    const dist = await createDistribution(
      {
        requestId: 'req_approved_1',
        destinationOrganization: 'City Emergency Ward',
        issuedUnitIds: ['unit_valid_1'],
        authorizedStaffUid: staffUid,
        dispatchStatus: 'dispatched',
        temperatureLogVerified: true,
      },
      actor,
      staff as unknown as Firestore
    );

    // Verify actual documents in Firestore
    const issueSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', dist.id));
    if (!issueSnap.exists()) throw new Error('Issue doc was not created');
    if (issueSnap.data()?.dispatchStatus !== 'dispatched') throw new Error('Issue dispatchStatus should be dispatched');

    const reqSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_approved_1'));
    // Merely dispatched units are reserved/allocated, NOT clinically fulfilled yet!
    if (reqSnap.data()?.status !== 'approved') throw new Error('Request status should remain approved upon dispatch');
    if (reqSnap.data()?.fulfilledUnitIds?.length !== 0) throw new Error('Request fulfilledUnitIds should remain empty upon dispatch');
    if (!reqSnap.data()?.allocatedUnitIds?.includes('unit_valid_1')) throw new Error('Request missing allocatedUnitIds');

    const unitSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_valid_1'));
    if (unitSnap.data()?.status !== 'reserved') throw new Error('Unit status should be reserved');
    if (unitSnap.data()?.reservedForRequestId !== 'req_approved_1') throw new Error('Unit missing reservedForRequestId');
  });

  // ---------------------------------------------------------------------------
  // TEST 2: Submitted and under-review requests cannot receive units
  // ---------------------------------------------------------------------------
  await test('2. Submitted and under-review requests cannot receive units', async () => {
    await seedTestRecords([
      [
        'requests',
        'req_submitted_1',
        {
          id: 'req_submitted_1',
          centerId: 'center-primary',
          requestingOrganization: 'County Clinic',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 1,
          urgency: 'routine',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'submitted',
          fulfilledUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'requests',
        'req_review_1',
        {
          id: 'req_review_1',
          centerId: 'center-primary',
          requestingOrganization: 'County Clinic',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 1,
          urgency: 'routine',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'under_review',
          fulfilledUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_unapp_1',
        {
          id: 'unit_unapp_1',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf A',
          status: 'available',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    let threw1 = false;
    try {
      await createDistribution(
        {
          requestId: 'req_submitted_1',
          destinationOrganization: 'County Clinic',
          issuedUnitIds: ['unit_unapp_1'],
          authorizedStaffUid: staffUid,
          dispatchStatus: 'dispatched',
          temperatureLogVerified: true,
        },
        actor,
        staff as unknown as Firestore
      );
    } catch (e) {
      threw1 = e instanceof BloodBankValidationError;
    }
    if (!threw1) throw new Error('Should have rejected submitted request');

    let threw2 = false;
    try {
      await createDistribution(
        {
          requestId: 'req_review_1',
          destinationOrganization: 'County Clinic',
          issuedUnitIds: ['unit_unapp_1'],
          authorizedStaffUid: staffUid,
          dispatchStatus: 'dispatched',
          temperatureLogVerified: true,
        },
        actor,
        staff as unknown as Firestore
      );
    } catch (e) {
      threw2 = e instanceof BloodBankValidationError;
    }
    if (!threw2) throw new Error('Should have rejected under_review request');
  });

  // ---------------------------------------------------------------------------
  // TEST 3: Duplicate unit IDs are rejected
  // ---------------------------------------------------------------------------
  await test('3. Duplicate unit IDs within single distribution are rejected', async () => {
    let threw = false;
    try {
      await createDistribution(
        {
          requestId: 'req_approved_1',
          destinationOrganization: 'City Hospital',
          issuedUnitIds: ['unit_unapp_1', 'unit_unapp_1'],
          authorizedStaffUid: staffUid,
          dispatchStatus: 'dispatched',
          temperatureLogVerified: true,
        },
        actor,
        staff as unknown as Firestore
      );
    } catch (e) {
      threw = e instanceof BloodBankValidationError;
    }
    if (!threw) throw new Error('Should have rejected duplicate unit IDs');
  });

  // ---------------------------------------------------------------------------
  // TEST 4: Previously allocated units cannot be reused
  // ---------------------------------------------------------------------------
  await test('4. Previously allocated units cannot be reused for the same request', async () => {
    let threw = false;
    try {
      await createDistribution(
        {
          requestId: 'req_approved_1',
          destinationOrganization: 'City Emergency Ward',
          issuedUnitIds: ['unit_valid_1'], // Already fulfilled in Test 1
          authorizedStaffUid: staffUid,
          dispatchStatus: 'dispatched',
          temperatureLogVerified: true,
        },
        actor,
        staff as unknown as Firestore
      );
    } catch (e) {
      threw = e instanceof BloodBankValidationError && e.message.includes('already been allocated');
    }
    if (!threw) throw new Error('Should have rejected previously allocated unit');
  });

  // ---------------------------------------------------------------------------
  // TEST 5: Units reserved for another request are rejected
  // ---------------------------------------------------------------------------
  await test('5. Units reserved for another request are rejected', async () => {
    await seedTestRecords([
      [
        'requests',
        'req_other_owner',
        {
          id: 'req_other_owner',
          centerId: 'center-primary',
          requestingOrganization: 'General Hospital',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 2,
          urgency: 'urgent',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'approved',
          fulfilledUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_reserved_other',
        {
          id: 'unit_reserved_other',
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
          reservedForRequestId: 'req_SOMEONE_ELSE',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    let threw = false;
    try {
      await createDistribution(
        {
          requestId: 'req_other_owner',
          destinationOrganization: 'General Hospital',
          issuedUnitIds: ['unit_reserved_other'],
          authorizedStaffUid: staffUid,
          dispatchStatus: 'dispatched',
          temperatureLogVerified: true,
        },
        actor,
        staff as unknown as Firestore
      );
    } catch (e) {
      threw = e instanceof BloodBankValidationError && e.message.includes('reserved for another request');
    }
    if (!threw) throw new Error('Should have rejected unit reserved for another request');
  });

  // ---------------------------------------------------------------------------
  // TEST 6: Request quantity limits are strictly enforced
  // ---------------------------------------------------------------------------
  await test('6. Request quantity limits are strictly enforced', async () => {
    await seedTestRecords([
      [
        'inventory',
        'unit_over_1',
        {
          id: 'unit_over_1',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf A',
          status: 'available',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_over_2',
        {
          id: 'unit_over_2',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf A',
          status: 'available',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    // req_approved_1 has quantityUnits: 2 and currently has 1 fulfilledUnitId.
    // Issuing 2 units should exceed remaining capacity (1).
    let threw = false;
    try {
      await createDistribution(
        {
          requestId: 'req_approved_1',
          destinationOrganization: 'City Emergency Ward',
          issuedUnitIds: ['unit_over_1', 'unit_over_2'],
          authorizedStaffUid: staffUid,
          dispatchStatus: 'dispatched',
          temperatureLogVerified: true,
        },
        actor,
        staff as unknown as Firestore
      );
    } catch (e) {
      threw = e instanceof BloodBankValidationError && e.message.includes('more unit(s)');
    }
    if (!threw) throw new Error('Should have rejected exceeding remaining quantity');
  });

  // ---------------------------------------------------------------------------
  // TEST 7: Fulfilled, rejected and cancelled requests cannot receive units
  // ---------------------------------------------------------------------------
  await test('7. Fulfilled, rejected and cancelled requests cannot receive units', async () => {
    await seedTestRecords([
      [
        'requests',
        'req_term_fulfilled',
        {
          id: 'req_term_fulfilled',
          centerId: 'center-primary',
          requestingOrganization: 'Facility',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 1,
          urgency: 'routine',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'fulfilled',
          fulfilledUnitIds: ['unit_done_1'],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'requests',
        'req_term_rejected',
        {
          id: 'req_term_rejected',
          centerId: 'center-primary',
          requestingOrganization: 'Facility',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 1,
          urgency: 'routine',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'rejected',
          fulfilledUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'requests',
        'req_term_cancelled',
        {
          id: 'req_term_cancelled',
          centerId: 'center-primary',
          requestingOrganization: 'Facility',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 1,
          urgency: 'routine',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'cancelled',
          fulfilledUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    for (const reqId of ['req_term_fulfilled', 'req_term_rejected', 'req_term_cancelled']) {
      let threw = false;
      try {
        await createDistribution(
          {
            requestId: reqId,
            destinationOrganization: 'Facility',
            issuedUnitIds: ['unit_over_1'],
            authorizedStaffUid: staffUid,
            dispatchStatus: 'dispatched',
            temperatureLogVerified: true,
          },
          actor,
          staff as unknown as Firestore
        );
      } catch (e) {
        threw = e instanceof BloodBankValidationError;
      }
      if (!threw) throw new Error(`Should have rejected terminal status on request ${reqId}`);
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 8: Units in non-available/non-reserved statuses are rejected
  // ---------------------------------------------------------------------------
  await test('8. Units in non-available/non-reserved statuses are rejected', async () => {
    await seedTestRecords([
      [
        'inventory',
        'unit_quarantine_bad',
        {
          id: 'unit_quarantine_bad',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Quarantine',
          status: 'quarantine',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    let threw = false;
    try {
      await createDistribution(
        {
          requestId: 'req_other_owner',
          destinationOrganization: 'General Hospital',
          issuedUnitIds: ['unit_quarantine_bad'],
          authorizedStaffUid: staffUid,
          dispatchStatus: 'dispatched',
          temperatureLogVerified: true,
        },
        actor,
        staff as unknown as Firestore
      );
    } catch (e) {
      threw = e instanceof BloodBankValidationError && e.message.includes('quarantine');
    }
    if (!threw) throw new Error('Should have rejected quarantined unit');
  });

  // ---------------------------------------------------------------------------
  // TEST 9: Cancelled distributions do not reserve inventory or increase fulfillment
  // ---------------------------------------------------------------------------
  await test('9. Cancelled distributions do not incorrectly reserve inventory or increase fulfillment', async () => {
    await seedTestRecords([
      [
        'requests',
        'req_cancel_test',
        {
          id: 'req_cancel_test',
          centerId: 'center-primary',
          requestingOrganization: 'Rural Hospital',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 2,
          urgency: 'routine',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'approved',
          fulfilledUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_cancel_test',
        {
          id: 'unit_cancel_test',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf C',
          status: 'available',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    const dist = await createDistribution(
      {
        requestId: 'req_cancel_test',
        destinationOrganization: 'Rural Hospital',
        issuedUnitIds: ['unit_cancel_test'],
        authorizedStaffUid: staffUid,
        dispatchStatus: 'cancelled', // Explicit cancellation
        temperatureLogVerified: true,
      },
      actor,
      staff as unknown as Firestore
    );

    // Verify issue record exists with cancelled status
    const issueSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', dist.id));
    if (issueSnap.data()?.dispatchStatus !== 'cancelled') throw new Error('Issue dispatchStatus should be cancelled');

    // Request should still be approved with 0 fulfilledUnitIds
    const reqSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_cancel_test'));
    if (reqSnap.data()?.status !== 'approved') throw new Error('Request status should remain approved');
    if (reqSnap.data()?.fulfilledUnitIds.length !== 0) throw new Error('Request fulfilledUnitIds should remain empty');

    // Inventory unit must remain available without reservedForRequestId
    const unitSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_cancel_test'));
    if (unitSnap.data()?.status !== 'available') throw new Error('Unit status should remain available');
    if (unitSnap.data()?.reservedForRequestId) throw new Error('Unit should not have reservedForRequestId');
  });

  // ---------------------------------------------------------------------------
  // TEST 10: Failed transactions do not leave partial changes (Atomicity)
  // ---------------------------------------------------------------------------
  await test('10. Failed transactions leave no partial issue, inventory, request or audit changes', async () => {
    // Record baseline state of issues and auditLogs before attempting the failing transaction
    const issuesColl = collection(staff, 'bloodBank', 'center-primary', 'issues');
    const auditColl = collection(staff, 'bloodBank', 'center-primary', 'auditLogs');
    const preIssuesSnap = await getDocs(issuesColl);
    const preAuditSnap = await getDocs(auditColl);

    await seedTestRecords([
      [
        'requests',
        'req_atomic_test',
        {
          id: 'req_atomic_test',
          centerId: 'center-primary',
          requestingOrganization: 'Trauma Unit',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 2,
          urgency: 'urgent',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'approved',
          fulfilledUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_atomic_good',
        {
          id: 'unit_atomic_good',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf D',
          status: 'available',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    // Transaction will read unit_atomic_good (valid) and unit_NONEXISTENT (invalid) -> must rollback all
    let threw = false;
    try {
      await createDistribution(
        {
          requestId: 'req_atomic_test',
          destinationOrganization: 'Trauma Unit',
          issuedUnitIds: ['unit_atomic_good', 'unit_NONEXISTENT'],
          authorizedStaffUid: staffUid,
          dispatchStatus: 'dispatched',
          temperatureLogVerified: true,
        },
        actor,
        staff as unknown as Firestore
      );
    } catch (e) {
      threw = e instanceof BloodBankValidationError;
    }
    if (!threw) throw new Error('Transaction should have failed on nonexistent unit');

    // 1. Verify unit_atomic_good was NOT altered in inventory
    const unitSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_atomic_good'));
    if (unitSnap.data()?.status !== 'available') throw new Error('Unit should have remained available after rollback');
    if (unitSnap.data()?.reservedForRequestId) throw new Error('Unit should not be reserved');

    // 2. Verify request was NOT altered in requests
    const reqSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_atomic_test'));
    if (reqSnap.data()?.status !== 'approved') throw new Error('Request should have remained approved');
    if (reqSnap.data()?.fulfilledUnitIds.length !== 0) throw new Error('Request fulfilledUnitIds should remain empty');

    // 3. Verify NO issue document was created in issues
    const postIssuesSnap = await getDocs(issuesColl);
    if (postIssuesSnap.size !== preIssuesSnap.size) {
      throw new Error(`Expected issues count to remain ${preIssuesSnap.size}, but got ${postIssuesSnap.size}`);
    }
    const matchingIssues = postIssuesSnap.docs.filter((d) => d.data()?.requestId === 'req_atomic_test');
    if (matchingIssues.length !== 0) {
      throw new Error(`Expected 0 issue documents for failed request, found ${matchingIssues.length}`);
    }

    // 4. Verify NO audit document was created for the failed distribution
    const postAuditSnap = await getDocs(auditColl);
    if (postAuditSnap.size !== preAuditSnap.size) {
      throw new Error(`Expected audit count to remain ${preAuditSnap.size}, but got ${postAuditSnap.size}`);
    }
    const matchingAudits = postAuditSnap.docs.filter(
      (d) => (d.data()?.details as Record<string, unknown> | undefined)?.requestId === 'req_atomic_test'
    );
    if (matchingAudits.length !== 0) {
      throw new Error(`Expected 0 audit log documents for failed request, found ${matchingAudits.length}`);
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 11: Concurrent attempts cannot allocate the same unit twice
  // ---------------------------------------------------------------------------
  await test('11. Concurrent attempts cannot allocate the same inventory unit twice', async () => {
    await seedTestRecords([
      [
        'requests',
        'req_concurrent_A',
        {
          id: 'req_concurrent_A',
          centerId: 'center-primary',
          requestingOrganization: 'Hospital A',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 1,
          urgency: 'urgent',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'approved',
          fulfilledUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'requests',
        'req_concurrent_B',
        {
          id: 'req_concurrent_B',
          centerId: 'center-primary',
          requestingOrganization: 'Hospital B',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 1,
          urgency: 'urgent',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'approved',
          fulfilledUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_concurrent_race',
        {
          id: 'unit_concurrent_race',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf E',
          status: 'available',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    // Launch both simultaneously
    const p1 = createDistribution(
      {
        requestId: 'req_concurrent_A',
        destinationOrganization: 'Hospital A',
        issuedUnitIds: ['unit_concurrent_race'],
        authorizedStaffUid: staffUid,
        dispatchStatus: 'dispatched',
        temperatureLogVerified: true,
      },
      actor,
      staff as unknown as Firestore
    );

    const p2 = createDistribution(
      {
        requestId: 'req_concurrent_B',
        destinationOrganization: 'Hospital B',
        issuedUnitIds: ['unit_concurrent_race'],
        authorizedStaffUid: staffUid,
        dispatchStatus: 'dispatched',
        temperatureLogVerified: true,
      },
      actor,
      staff as unknown as Firestore
    );

    const results = await Promise.allSettled([p1, p2]);
    const succeeded = results.filter(
      (r): r is PromiseFulfilledResult<BloodDistribution> => r.status === 'fulfilled'
    );
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected'
    );

    if (succeeded.length !== 1 || rejected.length !== 1) {
      throw new Error(`Expected exactly 1 success and 1 rejection in race condition, got ${succeeded.length} successes and ${rejected.length} rejections.`);
    }

    // Verify unit status is owned exclusively by the winning request
    const unitSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_concurrent_race'));
    const winnerRequestId = succeeded[0].value.requestId;
    if (unitSnap.data()?.reservedForRequestId !== winnerRequestId) {
      throw new Error(`Unit reserved for unexpected request: ${unitSnap.data()?.reservedForRequestId}`);
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 12: Delivered dispatch rejects unreserved (available) inventory unit
  // ---------------------------------------------------------------------------
  await test('12. Delivered dispatch rejects unreserved (available) inventory unit', async () => {
    await seedTestRecords([
      [
        'requests',
        'req_deliver_avail',
        {
          id: 'req_deliver_avail',
          centerId: 'center-primary',
          requestingOrganization: 'Metro Surgical Center',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 1,
          urgency: 'urgent',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'approved',
          fulfilledUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_deliver_avail',
        {
          id: 'unit_deliver_avail',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf F',
          status: 'available',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    let threw = false;
    try {
      await createDistribution(
        {
          requestId: 'req_deliver_avail',
          destinationOrganization: 'Metro Surgical Center',
          issuedUnitIds: ['unit_deliver_avail'],
          authorizedStaffUid: staffUid,
          dispatchStatus: 'delivered', // Direct available -> delivered/transfused attempt
          temperatureLogVerified: true,
        },
        actor,
        staff as unknown as Firestore
      );
    } catch (e: unknown) {
      const err = e as Error;
      threw = err instanceof BloodBankValidationError && (err.message.includes('cannot be created directly') || err.message.includes('delivered'));
    }
    if (!threw) throw new Error('Should have rejected delivering an unreserved available unit directly');

    // Verify unit remains available and unreserved in Firestore
    const unitSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_deliver_avail'));
    if (unitSnap.data()?.status !== 'available') throw new Error('Unit status should have remained available');
    if (unitSnap.data()?.reservedForRequestId) throw new Error('Unit should not have reservedForRequestId');

    // Verify request remains approved with empty fulfilledUnitIds
    const reqSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_deliver_avail'));
    if (reqSnap.data()?.status !== 'approved') throw new Error('Request status should remain approved');
    if (reqSnap.data()?.fulfilledUnitIds.length !== 0) throw new Error('Request fulfilledUnitIds should remain empty');
  });

  // ---------------------------------------------------------------------------
  // TEST 13: Full lifecycle dispatch-to-delivery real sequence
  // ---------------------------------------------------------------------------
  await test('13. Full lifecycle dispatch-to-delivery updates distribution, transfuses units, and fulfills request', async () => {
    await seedTestRecords([
      [
        'requests',
        'req_lifecycle_seq',
        {
          id: 'req_lifecycle_seq',
          centerId: 'center-primary',
          requestingOrganization: 'Metro Surgical Center',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 1,
          urgency: 'urgent',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'approved',
          fulfilledUnitIds: [],
          allocatedUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_lifecycle_seq',
        {
          id: 'unit_lifecycle_seq',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf F',
          status: 'available', // Available unit to start
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    // Step 1: Dispatch distribution
    const dist = await createDistribution(
      {
        requestId: 'req_lifecycle_seq',
        destinationOrganization: 'Metro Surgical Center',
        issuedUnitIds: ['unit_lifecycle_seq'],
        authorizedStaffUid: staffUid,
        dispatchStatus: 'dispatched',
        temperatureLogVerified: true,
      },
      actor,
      staff as unknown as Firestore
    );

    // Assert dispatch state in Firestore
    const postDispatchIssue = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', dist.id));
    if (!postDispatchIssue.exists() || postDispatchIssue.data()?.dispatchStatus !== 'dispatched') {
      throw new Error('Distribution should exist with dispatched status');
    }

    const postDispatchUnit = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_lifecycle_seq'));
    if (postDispatchUnit.data()?.status !== 'reserved' || postDispatchUnit.data()?.reservedForRequestId !== 'req_lifecycle_seq') {
      throw new Error('Unit should be reserved for request');
    }

    const postDispatchReq = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_lifecycle_seq'));
    if (postDispatchReq.data()?.status !== 'approved') throw new Error('Request status should remain approved upon dispatch');
    if (postDispatchReq.data()?.fulfilledUnitIds?.length !== 0) throw new Error('Request fulfilledUnitIds should remain empty');
    if (!postDispatchReq.data()?.allocatedUnitIds?.includes('unit_lifecycle_seq')) throw new Error('Request allocatedUnitIds missing unit');

    // Step 2: Deliver the EXACT same distribution record
    const deliveryNotes = 'Delivered to ICU charge nurse. Verified cold chain intact.';
    const deliveredDist = await deliverDistribution(
      dist.id,
      actor,
      { notes: deliveryNotes },
      staff as unknown as Firestore
    );

    if (deliveredDist.id !== dist.id) throw new Error('Delivery must update existing distribution, not generate new ID');
    if (deliveredDist.dispatchStatus !== 'delivered') throw new Error('Delivered distribution should have delivered status');

    // Assert delivery state in Firestore
    const postDeliverIssue = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', dist.id));
    if (postDeliverIssue.data()?.dispatchStatus !== 'delivered') throw new Error('Issue doc should have delivered status');
    if (!postDeliverIssue.data()?.deliveredAt) throw new Error('Issue doc should have deliveredAt timestamp');
    if (postDeliverIssue.data()?.notes !== deliveryNotes) throw new Error('Issue doc should have updated delivery notes');

    const postDeliverUnit = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_lifecycle_seq'));
    if (postDeliverUnit.data()?.status !== 'transfused') throw new Error('Unit status should be transfused');

    const postDeliverReq = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_lifecycle_seq'));
    if (postDeliverReq.data()?.status !== 'fulfilled') throw new Error('Request status should now be fulfilled');
    if (!postDeliverReq.data()?.fulfilledUnitIds?.includes('unit_lifecycle_seq')) throw new Error('Request missing fulfilledUnitIds');
    if (postDeliverReq.data()?.allocatedUnitIds?.includes('unit_lifecycle_seq')) throw new Error('Delivered unit should be removed from allocatedUnitIds');
  });

  // ---------------------------------------------------------------------------
  // TEST 14: Duplicate delivery rejection test
  // ---------------------------------------------------------------------------
  await test('14. Duplicate delivery attempts on already delivered distribution are rejected', async () => {
    let threw = false;
    try {
      // Re-deliver the distribution that was already delivered in Test 13
      const dists = await getDocs(collection(staff, 'bloodBank', 'center-primary', 'issues'));
      const deliveredIssue = dists.docs.find((d) => d.data()?.requestId === 'req_lifecycle_seq');
      if (!deliveredIssue) throw new Error('Could not find previously delivered issue');

      await deliverDistribution(
        deliveredIssue.id,
        actor,
        { notes: 'Second delivery attempt' },
        staff as unknown as Firestore
      );
    } catch (e: unknown) {
      const err = e as Error;
      threw = err instanceof BloodBankValidationError && err.message.includes('already been marked as delivered');
    }
    if (!threw) throw new Error('Should have rejected duplicate delivery');
  });

  // ---------------------------------------------------------------------------
  // TEST 15: Cancelled distribution releases reserved inventory and restores capacity
  // ---------------------------------------------------------------------------
  await test('15. Cancelled distribution releases reserved inventory back to available and clears allocation', async () => {
    await seedTestRecords([
      [
        'requests',
        'req_cancel_lifecycle',
        {
          id: 'req_cancel_lifecycle',
          centerId: 'center-primary',
          requestingOrganization: 'Valley Health Clinic',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 1,
          urgency: 'routine',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'approved',
          fulfilledUnitIds: [],
          allocatedUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_cancel_lifecycle',
        {
          id: 'unit_cancel_lifecycle',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf G',
          status: 'available',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    // Dispatch
    const dist = await createDistribution(
      {
        requestId: 'req_cancel_lifecycle',
        destinationOrganization: 'Valley Health Clinic',
        issuedUnitIds: ['unit_cancel_lifecycle'],
        authorizedStaffUid: staffUid,
        dispatchStatus: 'dispatched',
        temperatureLogVerified: true,
      },
      actor,
      staff as unknown as Firestore
    );

    // Cancel in-flight distribution
    const cancelReason = 'Ambulance rerouted due to emergency road closure';
    await cancelDistribution(
      dist.id,
      actor,
      cancelReason,
      staff as unknown as Firestore
    );

    // Assert Firestore records
    const issueSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', dist.id));
    if (issueSnap.data()?.dispatchStatus !== 'cancelled') throw new Error('Issue should be cancelled');
    if (!issueSnap.data()?.notes?.includes(cancelReason)) throw new Error('Issue notes missing cancel reason');

    const unitSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_cancel_lifecycle'));
    if (unitSnap.data()?.status !== 'available') throw new Error('Unit should be released back to available');
    if (unitSnap.data()?.reservedForRequestId !== null) throw new Error('Unit reservedForRequestId should be cleared to null');

    const reqSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_cancel_lifecycle'));
    if (reqSnap.data()?.status !== 'approved') throw new Error('Request status should remain approved');
    if (reqSnap.data()?.fulfilledUnitIds?.length !== 0) throw new Error('Request fulfilledUnitIds should remain empty');
    if (reqSnap.data()?.allocatedUnitIds?.length !== 0) throw new Error('Request allocatedUnitIds should be empty');
  });

  // ---------------------------------------------------------------------------
  // TEST 16: Failed delivery preserves atomicity and rolls back all changes
  // ---------------------------------------------------------------------------
  await test('16. Failed delivery preserves atomicity without partial mutation or phantom audit records', async () => {
    await seedTestRecords([
      [
        'requests',
        'req_fail_delivery',
        {
          id: 'req_fail_delivery',
          centerId: 'center-primary',
          requestingOrganization: 'County General',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 2,
          urgency: 'routine',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'approved',
          fulfilledUnitIds: [],
          allocatedUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_fail_good',
        {
          id: 'unit_fail_good',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf H',
          status: 'available',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_fail_bad',
        {
          id: 'unit_fail_bad',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf H',
          status: 'available',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    // Dispatch both units
    const dist = await createDistribution(
      {
        requestId: 'req_fail_delivery',
        destinationOrganization: 'County General',
        issuedUnitIds: ['unit_fail_good', 'unit_fail_bad'],
        authorizedStaffUid: staffUid,
        dispatchStatus: 'dispatched',
        temperatureLogVerified: true,
      },
      actor,
      staff as unknown as Firestore
    );

    // Tamper unit_fail_bad: set status to expired (invalid for delivery!)
    await seedTestRecords([
      [
        'inventory',
        'unit_fail_bad',
        {
          id: 'unit_fail_bad',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Quarantine',
          status: 'expired',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    // Baseline audit count
    const auditColl = collection(staff, 'bloodBank', 'center-primary', 'auditLogs');
    const preAuditSnap = await getDocs(auditColl);

    let threw = false;
    try {
      await deliverDistribution(
        dist.id,
        actor,
        { notes: 'Attempt delivery with corrupted unit' },
        staff as unknown as Firestore
      );
    } catch (e: unknown) {
      const err = e as Error;
      threw = err instanceof BloodBankValidationError && err.message.includes('only units reserved');
    }
    if (!threw) throw new Error('Delivery should have been rejected due to non-reserved unit');

    // Assert atomicity: unit_fail_good must NOT be transfused (remains reserved)
    const goodUnitSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_fail_good'));
    if (goodUnitSnap.data()?.status !== 'reserved') throw new Error('Valid unit should remain reserved after failed delivery');

    // Assert issue was NOT marked delivered
    const issueSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', dist.id));
    if (issueSnap.data()?.dispatchStatus !== 'dispatched') throw new Error('Issue status should remain dispatched');

    // Assert request was NOT modified
    const reqSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_fail_delivery'));
    if (reqSnap.data()?.status !== 'approved') throw new Error('Request status should remain approved');
    if (reqSnap.data()?.fulfilledUnitIds?.length !== 0) throw new Error('Request fulfilledUnitIds should remain empty');

    // Assert NO audit log created
    const postAuditSnap = await getDocs(auditColl);
    if (postAuditSnap.size !== preAuditSnap.size) {
      throw new Error(`Audit log count changed: expected ${preAuditSnap.size}, got ${postAuditSnap.size}`);
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 17: Concurrent delivery race condition test
  // ---------------------------------------------------------------------------
  await test('17. Concurrent delivery attempts on the same distribution resolve cleanly with exactly 1 winner', async () => {
    await seedTestRecords([
      [
        'requests',
        'req_race_deliver',
        {
          id: 'req_race_deliver',
          centerId: 'center-primary',
          requestingOrganization: 'Memorial Hospital',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 1,
          urgency: 'urgent',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'approved',
          fulfilledUnitIds: [],
          allocatedUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_race_deliver',
        {
          id: 'unit_race_deliver',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf I',
          status: 'available',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    const dist = await createDistribution(
      {
        requestId: 'req_race_deliver',
        destinationOrganization: 'Memorial Hospital',
        issuedUnitIds: ['unit_race_deliver'],
        authorizedStaffUid: staffUid,
        dispatchStatus: 'dispatched',
        temperatureLogVerified: true,
      },
      actor,
      staff as unknown as Firestore
    );

    // Launch two concurrent deliver calls
    const d1 = deliverDistribution(
      dist.id,
      actor,
      { notes: 'Staff A delivery' },
      staff as unknown as Firestore
    );
    const d2 = deliverDistribution(
      dist.id,
      actor,
      { notes: 'Staff B delivery' },
      staff as unknown as Firestore
    );

    const results = await Promise.allSettled([d1, d2]);
    const succeeded = results.filter(
      (r): r is PromiseFulfilledResult<BloodDistribution> => r.status === 'fulfilled'
    );
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected'
    );

    if (succeeded.length !== 1 || rejected.length !== 1) {
      throw new Error(`Expected exactly 1 winner and 1 rejection in race condition, got ${succeeded.length} successes and ${rejected.length} rejections.`);
    }

    // Verify final state
    const issueSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'issues', dist.id));
    if (issueSnap.data()?.dispatchStatus !== 'delivered') throw new Error('Issue should be delivered');

    const unitSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_race_deliver'));
    if (unitSnap.data()?.status !== 'transfused') throw new Error('Unit should be transfused');

    const reqSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_race_deliver'));
    if (reqSnap.data()?.status !== 'fulfilled') throw new Error('Request should be fulfilled');
    if (!reqSnap.data()?.fulfilledUnitIds?.includes('unit_race_deliver')) throw new Error('Request missing fulfilledUnitIds');
  });

  // ---------------------------------------------------------------------------
  // TEST 18: updateRequestStatus rejects setting partially_fulfilled or fulfilled directly
  // ---------------------------------------------------------------------------
  await test('18. updateRequestStatus rejects setting partially_fulfilled or fulfilled directly', async () => {
    await seedTestRecords([
      [
        'requests',
        'req_status_direct',
        {
          id: 'req_status_direct',
          centerId: 'center-primary',
          requestingOrganization: 'St. Jude',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 2,
          urgency: 'routine',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'approved',
          fulfilledUnitIds: [],
          allocatedUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    let threwFulfilled = false;
    try {
      await updateRequestStatus(
        'req_status_direct',
        'fulfilled',
        'Manual completion attempt',
        actor,
        'center-primary',
        staff as unknown as Firestore
      );
    } catch (e: unknown) {
      const err = e as Error;
      threwFulfilled = err instanceof BloodBankValidationError && err.message.includes('deliverDistribution');
    }
    if (!threwFulfilled) throw new Error('Should have rejected manual status transition to fulfilled');

    let threwPartial = false;
    try {
      await updateRequestStatus(
        'req_status_direct',
        'partially_fulfilled',
        'Manual partial attempt',
        actor,
        'center-primary',
        staff as unknown as Firestore
      );
    } catch (e: unknown) {
      const err = e as Error;
      threwPartial = err instanceof BloodBankValidationError && err.message.includes('deliverDistribution');
    }
    if (!threwPartial) throw new Error('Should have rejected manual status transition to partially_fulfilled');
  });

  // ---------------------------------------------------------------------------
  // TEST 19: createDistribution rejects creating a second distribution for an already reserved unit
  // ---------------------------------------------------------------------------
  await test('19. createDistribution rejects creating a second distribution for an already reserved unit', async () => {
    await seedTestRecords([
      [
        'requests',
        'req_second_dist',
        {
          id: 'req_second_dist',
          centerId: 'center-primary',
          requestingOrganization: 'Valley General',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 2,
          urgency: 'routine',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'approved',
          fulfilledUnitIds: [],
          allocatedUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_second_dist',
        {
          id: 'unit_second_dist',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf J',
          status: 'available',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    // Dispatch unit once
    await createDistribution(
      {
        requestId: 'req_second_dist',
        destinationOrganization: 'Valley General',
        issuedUnitIds: ['unit_second_dist'],
        authorizedStaffUid: staffUid,
        dispatchStatus: 'dispatched',
        temperatureLogVerified: true,
      },
      actor,
      staff as unknown as Firestore
    );

    // Attempt to create a second distribution using that same reserved unit
    let threw = false;
    try {
      await createDistribution(
        {
          requestId: 'req_second_dist',
          destinationOrganization: 'Valley General',
          issuedUnitIds: ['unit_second_dist'],
          authorizedStaffUid: staffUid,
          dispatchStatus: 'dispatched',
          temperatureLogVerified: true,
        },
        actor,
        staff as unknown as Firestore
      );
    } catch (e: unknown) {
      const err = e as Error;
      threw = err instanceof BloodBankValidationError && (err.message.includes('already been allocated') || err.message.includes('already reserved'));
    }
    if (!threw) throw new Error('Should have rejected creating a second distribution for an already reserved unit');
  });

  // ---------------------------------------------------------------------------
  // TEST 20: Request cancellation with active allocations lifecycle and rollback
  // ---------------------------------------------------------------------------
  await test('20. Cancelling a request with active allocations is rejected until distribution is cancelled', async () => {
    await seedTestRecords([
      [
        'requests',
        'req_cancel_active_alloc',
        {
          id: 'req_cancel_active_alloc',
          centerId: 'center-primary',
          requestingOrganization: 'Memorial Care',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          quantityUnits: 1,
          urgency: 'routine',
          requiredByDate: '2026-03-01T10:00:00Z',
          status: 'approved',
          fulfilledUnitIds: [],
          allocatedUnitIds: [],
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
      [
        'inventory',
        'unit_cancel_active_alloc',
        {
          id: 'unit_cancel_active_alloc',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01',
          expiryDate: '2026-03-15',
          volumeMl: 450,
          storageLocation: 'Shelf K',
          status: 'available',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    ]);

    // Step 1: Dispatch distribution (allocates unit)
    const dist = await createDistribution(
      {
        requestId: 'req_cancel_active_alloc',
        destinationOrganization: 'Memorial Care',
        issuedUnitIds: ['unit_cancel_active_alloc'],
        authorizedStaffUid: staffUid,
        dispatchStatus: 'dispatched',
        temperatureLogVerified: true,
      },
      actor,
      staff as unknown as Firestore
    );

    // Step 2: Attempt to cancel request directly while active allocation exists -> MUST FAIL
    let threwActive = false;
    try {
      await updateRequestStatus(
        'req_cancel_active_alloc',
        'cancelled',
        'Premature cancellation attempt',
        actor,
        'center-primary',
        staff as unknown as Firestore
      );
    } catch (e: unknown) {
      const err = e as Error;
      threwActive = err instanceof BloodBankValidationError && err.message.includes('active unit allocation');
    }
    if (!threwActive) throw new Error('Cancelling request with active allocations should have been rejected');

    // Verify atomicity after failed cancellation: request remains approved with active allocation, unit remains reserved
    const reqAfterFail = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_cancel_active_alloc'));
    if (reqAfterFail.data()?.status !== 'approved') throw new Error('Request status should remain approved after failed cancellation');
    if (!reqAfterFail.data()?.allocatedUnitIds?.includes('unit_cancel_active_alloc')) throw new Error('Allocations should be intact');

    const unitAfterFail = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_cancel_active_alloc'));
    if (unitAfterFail.data()?.status !== 'reserved') throw new Error('Unit should remain reserved');

    // Step 3: Cancel the active distribution first -> releases reserved units
    await cancelDistribution(
      dist.id,
      actor,
      'Requesting surgeon cancelled procedure',
      staff as unknown as Firestore
    );

    // Verify unit was released back to available
    const unitAfterRelease = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_cancel_active_alloc'));
    if (unitAfterRelease.data()?.status !== 'available') throw new Error('Unit should be available after distribution cancellation');
    if (unitAfterRelease.data()?.reservedForRequestId !== null) throw new Error('Unit reservation should be cleared');

    // Step 4: Now request cancellation succeeds because allocations are cleared!
    await updateRequestStatus(
      'req_cancel_active_alloc',
      'cancelled',
      'Procedure cancelled and inventory released',
      actor,
      'center-primary',
      staff as unknown as Firestore
    );

    // Verify final request status in Firestore
    const reqFinal = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_cancel_active_alloc'));
    if (reqFinal.data()?.status !== 'cancelled') throw new Error('Request should now be cancelled');
  });

  // ---------------------------------------------------------------------------
  // TEST 21: Patient can create targeted network blood request; center accepts atomically
  // ---------------------------------------------------------------------------
  await test('21. Patient creates targeted network request; blood bank accepts it, transitioning inventory unit to reserved and locking request atomically', async () => {
    // 1. Seed inventory unit in center-primary
    await seedTestRecords([
      [
        'inventory',
        'unit_net_tx_21',
        {
          id: 'unit_net_tx_21',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01T10:00:00Z',
          expiryDate: '2026-03-07T10:00:00Z',
          volumeMl: 450,
          storageLocation: 'Shelf-Net-1',
          status: 'available',
          reservedForRequestId: null,
          createdAt: '2026-02-01T10:00:00Z',
          updatedAt: '2026-02-01T10:00:00Z',
        },
      ],
    ]);

    // 2. Patient creates targeted request
    const netReq = await createNetworkBloodRequest(
      {
        requesterUid: patientUid,
        requesterRole: 'patient',
        requesterName: 'Alice Patient',
        requestType: 'targeted',
        targetCenterId: 'center-primary',
        bloodGroup: 'O+',
        componentType: 'whole_blood',
        quantityUnits: 1,
        urgency: 'routine',
        requiredByDate: '2026-03-01T00:00:00Z',
        deliveryAddress: {
          hospitalOrFacilityName: 'General Hospital',
          departmentOrWard: 'ICU',
          city: 'Metropolis',
          contactPhone: '+1 555-1234',
        },
      },
      patientActor,
      'req_net_tx_21',
      patient as unknown as Firestore
    );

    if (netReq.status !== 'submitted') throw new Error('Expected initial status to be submitted');

    // 3. Blood bank accepts request
    const accepted = await acceptNetworkBloodRequest(
      'req_net_tx_21',
      'center-primary',
      ['unit_net_tx_21'],
      actor,
      staff as unknown as Firestore
    );

    if (accepted.status !== 'reserved') throw new Error('Expected accepted status to be reserved');
    if (accepted.acceptedCenterId !== 'center-primary') throw new Error('Expected acceptedCenterId to be center-primary');
    if (!accepted.assignedUnitIds?.includes('unit_net_tx_21')) throw new Error('Expected assignedUnitIds to contain unit');

    // 4. Verify post-transaction state in Firestore
    const unitDoc = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_net_tx_21'));
    if (unitDoc.data()?.status !== 'reserved') throw new Error('Unit status must be reserved in Firestore');
    if (unitDoc.data()?.reservedForRequestId !== 'req_net_tx_21') throw new Error('Unit reservedForRequestId must be req_net_tx_21');

    const reqDoc = await getDoc(doc(patient, 'networkRequests', 'req_net_tx_21'));
    if (reqDoc.data()?.status !== 'reserved') throw new Error('Request status must be reserved in Firestore');
    if (reqDoc.data()?.acceptedCenterId !== 'center-primary') throw new Error('Request acceptedCenterId mismatch');
  });

  // ---------------------------------------------------------------------------
  // TEST 22: Shortage broadcast anti-collision lock with concurrent acceptance
  // ---------------------------------------------------------------------------
  await test('22. Shortage broadcast anti-collision lock: concurrent acceptance by two blood bank centers resolves with exactly 1 winner', async () => {
    // 1. Seed available inventory in center-primary and center-secondary
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'bloodBank', 'center-primary', 'inventory', 'unit_collision_c1'), {
        id: 'unit_collision_c1',
        centerId: 'center-primary',
        donationId: 'don_base',
        donorId: 'donor_base',
        bloodGroup: 'O+',
        componentType: 'whole_blood',
        collectionDate: '2026-02-01T10:00:00Z',
        expiryDate: '2026-03-07T10:00:00Z',
        volumeMl: 450,
        storageLocation: 'Shelf-C1',
        status: 'available',
        reservedForRequestId: null,
        createdAt: '2026-02-01T10:00:00Z',
        updatedAt: '2026-02-01T10:00:00Z',
      });
      await setDoc(doc(adminDb, 'bloodBank', 'center-secondary', 'inventory', 'unit_collision_c2'), {
        id: 'unit_collision_c2',
        centerId: 'center-secondary',
        donationId: 'don_base',
        donorId: 'donor_base',
        bloodGroup: 'O+',
        componentType: 'whole_blood',
        collectionDate: '2026-02-01T10:00:00Z',
        expiryDate: '2026-03-07T10:00:00Z',
        volumeMl: 450,
        storageLocation: 'Shelf-C2',
        status: 'available',
        reservedForRequestId: null,
        createdAt: '2026-02-01T10:00:00Z',
        updatedAt: '2026-02-01T10:00:00Z',
      });
    });

    // 2. Doctor creates a shortage broadcast
    await createNetworkBloodRequest(
      {
        requesterUid: doctorUid,
        requesterRole: 'doctor',
        requesterName: 'Dr. Gregory House',
        requestType: 'shortage_broadcast',
        bloodGroup: 'O+',
        componentType: 'whole_blood',
        quantityUnits: 1,
        urgency: 'urgent',
        requiredByDate: '2026-03-01T00:00:00Z',
        deliveryAddress: {
          hospitalOrFacilityName: 'Metro Trauma Center',
          departmentOrWard: 'OR-1',
          city: 'Metropolis',
          contactPhone: '+1 555-9999',
        },
      },
      doctorActor,
      'req_broadcast_collision_tx',
      doctor as unknown as Firestore
    );

    // 3. Two centers attempt to claim the broadcast concurrently
    const p1 = acceptNetworkBloodRequest(
      'req_broadcast_collision_tx',
      'center-primary',
      ['unit_collision_c1'],
      actor,
      staff as unknown as Firestore
    );

    const p2 = acceptNetworkBloodRequest(
      'req_broadcast_collision_tx',
      'center-secondary',
      ['unit_collision_c2'],
      center2Actor,
      center2Staff as unknown as Firestore
    );

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    if (fulfilled.length !== 1 || rejected.length !== 1) {
      throw new Error(`Expected exactly 1 winner and 1 rejection in race condition, got ${fulfilled.length} fulfilled and ${rejected.length} rejected`);
    }

    // 4. Verify in Firestore: winning center has reserved request, losing center unit remains available
    const reqDoc = await getDoc(doc(doctor, 'networkRequests', 'req_broadcast_collision_tx'));
    const winningCenterId = reqDoc.data()?.acceptedCenterId;
    if (winningCenterId !== 'center-primary' && winningCenterId !== 'center-secondary') {
      throw new Error('Winning center must be center-primary or center-secondary');
    }

    const losingCenterId = winningCenterId === 'center-primary' ? 'center-secondary' : 'center-primary';
    const losingUnitId = winningCenterId === 'center-primary' ? 'unit_collision_c2' : 'unit_collision_c1';

    const losingUnitDoc = await getDoc(doc(staff, 'bloodBank', losingCenterId, 'inventory', losingUnitId));
    if (losingUnitDoc.data()?.status !== 'available') {
      throw new Error('Losing center inventory unit must remain available without reservation lock');
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 23: Rejection of targeted request by target center & conversion to broadcast
  // ---------------------------------------------------------------------------
  await test('23. Target center rejects targeted request; requester converts rejected request to shortage broadcast', async () => {
    // 1. Patient creates targeted request for center-primary
    await createNetworkBloodRequest(
      {
        requesterUid: patientUid,
        requesterRole: 'patient',
        requesterName: 'Alice Patient',
        requestType: 'targeted',
        targetCenterId: 'center-primary',
        bloodGroup: 'O+',
        componentType: 'whole_blood',
        quantityUnits: 1,
        urgency: 'routine',
        requiredByDate: '2026-03-01T00:00:00Z',
        deliveryAddress: {
          hospitalOrFacilityName: 'General Hospital',
          departmentOrWard: 'Outpatient',
          city: 'Metropolis',
          contactPhone: '+1 555-1234',
        },
      },
      patientActor,
      'req_targeted_reject_tx',
      patient as unknown as Firestore
    );

    // 2. Center-primary formally rejects the request
    const rejectedReq = await rejectNetworkBloodRequest(
      'req_targeted_reject_tx',
      'center-primary',
      'Stock depleted by emergency pediatric surgeries',
      actor,
      staff as unknown as Firestore
    );

    if (rejectedReq.status !== 'rejected') throw new Error('Expected status to be rejected');
    if (rejectedReq.rejectionReason !== 'Stock depleted by emergency pediatric surgeries') throw new Error('Rejection reason mismatch');

    // 3. Patient converts rejected request into a shortage broadcast
    const broadcastReq = await convertRejectedToBroadcast(
      'req_targeted_reject_tx',
      patientActor,
      patient as unknown as Firestore
    );

    if (broadcastReq.status !== 'submitted') throw new Error('Expected status to be submitted after broadcast conversion');
    if (broadcastReq.requestType !== 'shortage_broadcast') throw new Error('Expected requestType to be shortage_broadcast');

    // Verify Firestore doc
    const reqDoc = await getDoc(doc(patient, 'networkRequests', 'req_targeted_reject_tx'));
    if (reqDoc.data()?.status !== 'submitted') throw new Error('Firestore status mismatch');
    if (reqDoc.data()?.requestType !== 'shortage_broadcast') throw new Error('Firestore requestType mismatch');
  });

  // ---------------------------------------------------------------------------
  // TEST 24: Requester cancels submitted network request; unauthorized cancellation rejected
  // ---------------------------------------------------------------------------
  await test('24. Original requester cancels submitted network request; unauthorized cancellation rejected', async () => {
    // 1. Patient creates request
    await createNetworkBloodRequest(
      {
        requesterUid: patientUid,
        requesterRole: 'patient',
        requesterName: 'Alice Patient',
        requestType: 'targeted',
        targetCenterId: 'center-primary',
        bloodGroup: 'O+',
        componentType: 'whole_blood',
        quantityUnits: 1,
        urgency: 'routine',
        requiredByDate: '2026-03-01T00:00:00Z',
        deliveryAddress: {
          hospitalOrFacilityName: 'Clinic A',
          departmentOrWard: 'Ward 2',
          city: 'Metropolis',
          contactPhone: '+1 555-1234',
        },
      },
      patientActor,
      'req_cancel_perm_tx',
      patient as unknown as Firestore
    );

    // 2. Doctor attempts to cancel patient request -> must fail
    let doctorCancelFailed = false;
    try {
      await cancelNetworkBloodRequest(
        'req_cancel_perm_tx',
        doctorActor,
        doctor as unknown as Firestore
      );
    } catch {
      doctorCancelFailed = true;
    }
    if (!doctorCancelFailed) throw new Error('Non-requester must not be able to cancel request');

    // 3. Patient cancels own request -> succeeds
    const cancelled = await cancelNetworkBloodRequest(
      'req_cancel_perm_tx',
      patientActor,
      patient as unknown as Firestore
    );
    if (cancelled.status !== 'cancelled') throw new Error('Expected status to be cancelled');

    const reqDoc = await getDoc(doc(patient, 'networkRequests', 'req_cancel_perm_tx'));
    if (reqDoc.data()?.status !== 'cancelled') throw new Error('Status in Firestore must be cancelled');
  });

  // ---------------------------------------------------------------------------
  // TEST 25: Accepting network request with unavailable inventory fails cleanly
  // ---------------------------------------------------------------------------
  await test('25. Accepting network request with un-available inventory fails cleanly with zero side-effects', async () => {
    // 1. Seed quarantined inventory unit
    await seedTestRecords([
      [
        'inventory',
        'unit_quarantine_net_tx',
        {
          id: 'unit_quarantine_net_tx',
          centerId: 'center-primary',
          donationId: 'don_base',
          donorId: 'donor_base',
          bloodGroup: 'O+',
          componentType: 'whole_blood',
          collectionDate: '2026-02-01T10:00:00Z',
          expiryDate: '2026-03-07T10:00:00Z',
          volumeMl: 450,
          storageLocation: 'Quarantine-Net',
          status: 'quarantine',
          reservedForRequestId: null,
          createdAt: '2026-02-01T10:00:00Z',
          updatedAt: '2026-02-01T10:00:00Z',
        },
      ],
    ]);

    // 2. Patient creates targeted request
    await createNetworkBloodRequest(
      {
        requesterUid: patientUid,
        requesterRole: 'patient',
        requesterName: 'Alice Patient',
        requestType: 'targeted',
        targetCenterId: 'center-primary',
        bloodGroup: 'O+',
        componentType: 'whole_blood',
        quantityUnits: 1,
        urgency: 'routine',
        requiredByDate: '2026-03-01T00:00:00Z',
        deliveryAddress: {
          hospitalOrFacilityName: 'General Hospital',
          departmentOrWard: 'ICU',
          city: 'Metropolis',
          contactPhone: '+1 555-1234',
        },
      },
      patientActor,
      'req_fail_quarantine_tx',
      patient as unknown as Firestore
    );

    // 3. Attempting to accept with quarantined unit fails
    let acceptFailed = false;
    try {
      await acceptNetworkBloodRequest(
        'req_fail_quarantine_tx',
        'center-primary',
        ['unit_quarantine_net_tx'],
        actor,
        staff as unknown as Firestore
      );
    } catch {
      acceptFailed = true;
    }
    if (!acceptFailed) throw new Error('Accepting with quarantined unit must fail');

    // 4. Verify request and unit are untouched
    const reqDoc = await getDoc(doc(patient, 'networkRequests', 'req_fail_quarantine_tx'));
    if (reqDoc.data()?.status !== 'submitted') throw new Error('Request status must remain submitted');

    const unitDoc = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_quarantine_net_tx'));
    if (unitDoc.data()?.status !== 'quarantine') throw new Error('Unit status must remain quarantine');
  });

  // ---------------------------------------------------------------------------
  // TEST 26: Center stock summary update preserves center identity
  // ---------------------------------------------------------------------------
  await test('26. updateBloodBankCenterStockSummary updates stock projection while preserving immutable center identity', async () => {
    const summary: AvailableStockSummary = {
      'O+_whole_blood': 12,
      'A+_platelets': 4,
      'B-_red_blood_cells': 2,
    };

    await updateBloodBankCenterStockSummary(
      'center-primary',
      summary,
      actor,
      staff as unknown as Firestore
    );

    const centerDoc = await getDoc(doc(staff, 'bloodBank', 'center-primary'));
    const data = centerDoc.data();
    if (!data) throw new Error('Center doc not found');
    if (data.availableStockSummary?.['O+_whole_blood'] !== 12) throw new Error('Stock summary count mismatch');
    if (data.availableStockSummary?.['A+_platelets'] !== 4) throw new Error('Stock summary platelets mismatch');
    if (data.name !== 'Metropolis Blood Center') throw new Error('Center name was corrupted');
    if (data.licenseNumber !== 'LIC-BB-001') throw new Error('Center license was corrupted');
  });

  // Summary
  console.log('\n================================================================');
  console.log(`TOTAL REAL TRANSACTION INTEGRATION TESTS: ${passed + failed} | PASS: ${passed} | FAIL: ${failed}`);
  console.log('================================================================');

  await testEnv.cleanup();

  if (failed > 0) {
    process.exit(1);
  }
}

runRealDistributionTransactionSuite().catch((err) => {
  console.error('Fatal suite failure:', err);
  process.exit(1);
});
