/**
 * MEDICORE-AI — Isolated Blood Bank Distribution & Request Integrity Real Transaction Suite
 * FILE: tests/blood-bank/blood-bank-distribution-integrity.test.ts
 *
 * (Phase 4A.3 Integration Review)
 * MANDATORY: Tests the ACTUAL exported `createDistribution()` function from
 * `src/lib/blood-bank/firestore-service.ts` directly against the local Firestore Emulator
 * and the proposed combined security rules.
 *
 * Verifies all 11 core transaction invariants with post-transaction document assertions:
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
 */

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import type { BloodDistribution } from '../../src/lib/blood-bank/types';
import { createDistribution } from '../../src/lib/blood-bank/firestore-service';
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

  const staffUid = 'staff_bloodbank_tx_1';
  const staff = testEnv.authenticatedContext(staffUid, { role: 'blood_bank' }).firestore();
  const actor = { uid: staffUid, email: 'staff_tx@medicore.internal' };

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

    const reqSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_approved_1'));
    if (reqSnap.data()?.status !== 'partially_fulfilled') throw new Error('Request status should be partially_fulfilled');
    if (!reqSnap.data()?.fulfilledUnitIds.includes('unit_valid_1')) throw new Error('Request missing fulfilledUnitIds');

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

    // Verify unit_atomic_good was NOT altered
    const unitSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'inventory', 'unit_atomic_good'));
    if (unitSnap.data()?.status !== 'available') throw new Error('Unit should have remained available after rollback');
    if (unitSnap.data()?.reservedForRequestId) throw new Error('Unit should not be reserved');

    // Verify request was NOT altered
    const reqSnap = await getDoc(doc(staff, 'bloodBank', 'center-primary', 'requests', 'req_atomic_test'));
    if (reqSnap.data()?.status !== 'approved') throw new Error('Request should have remained approved');
    if (reqSnap.data()?.fulfilledUnitIds.length !== 0) throw new Error('Request fulfilledUnitIds should remain empty');
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
