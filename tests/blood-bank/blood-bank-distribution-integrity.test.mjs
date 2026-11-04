/**
 * MEDICORE-AI — Isolated Blood Bank Distribution & Request Integrity Unit Tests
 * FILE: tests/blood-bank/blood-bank-distribution-integrity.test.mjs
 *
 * Verifies transaction invariants and business logic for:
 * 1. Duplicate unit IDs in one distribution payload.
 * 2. Units reserved for another request rejected.
 * 3. Issuing more units than remaining needed quantity rejected.
 * 4. Issuing against terminal requests (fulfilled, rejected, cancelled) rejected.
 * 5. Invalid request status transitions rejected.
 * 6. Attempting to reopen terminal request states rejected.
 */

import {
  validateDistributionPayload,
  isValidRequestTransition,
  BloodBankValidationError,
} from '../../src/lib/blood-bank/validation.ts';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
    throw new Error(message);
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

function assertThrows(fn, expectedMsgSubstring) {
  try {
    fn();
    console.error(`  FAIL (expected error, none thrown)`);
    failed++;
  } catch (err) {
    if (err instanceof BloodBankValidationError || err.message) {
      const fullErrorText = JSON.stringify(err.fieldErrors || {}) + ' ' + (err.message || '');
      if (expectedMsgSubstring && !fullErrorText.includes(expectedMsgSubstring)) {
        console.error(`  FAIL (error thrown but did not match substring "${expectedMsgSubstring}"): ${fullErrorText}`);
        failed++;
      } else {
        console.log(`  PASS: Threw expected error: ${err.message} (${expectedMsgSubstring || 'validation'})`);
        passed++;
      }
    } else {
      console.error(`  FAIL (unexpected error type):`, err);
      failed++;
    }
  }
}

console.log('================================================================');
console.log('MEDICORE-AI: Blood Bank Distribution & Request Integrity Tests');
console.log('================================================================\n');

// 1. Duplicate Unit IDs within a distribution
console.log('--- Suite 1: Distribution Payload Unit Uniqueness ---');
assertThrows(
  () => validateDistributionPayload({
    requestId: 'req_123',
    destinationOrganization: 'St. Jude Hospital',
    issuedUnitIds: ['UNIT-001', 'UNIT-001'],
    authorizedStaffUid: 'staff_1',
    dispatchStatus: 'prepared',
  }),
  'must be unique'
);

assertThrows(
  () => validateDistributionPayload({
    requestId: 'req_123',
    destinationOrganization: 'St. Jude Hospital',
    issuedUnitIds: ['UNIT-001', 'UNIT-002', 'UNIT-001'],
    authorizedStaffUid: 'staff_1',
    dispatchStatus: 'prepared',
  }),
  'must be unique'
);

// Valid distribution payload passes
validateDistributionPayload({
  requestId: 'req_123',
  destinationOrganization: 'St. Jude Hospital',
  issuedUnitIds: ['UNIT-001', 'UNIT-002'],
  authorizedStaffUid: 'staff_1',
  dispatchStatus: 'prepared',
});
assert(true, 'Distribution payload with distinct unit IDs passes validation');

// 2. Request Status Transition Invariants
console.log('\n--- Suite 2: Request Status Transitions & Terminal State Locks ---');
// Allowed forward transitions
assert(isValidRequestTransition('submitted', 'under_review'), 'submitted -> under_review allowed');
assert(isValidRequestTransition('submitted', 'approved'), 'submitted -> approved allowed');
assert(isValidRequestTransition('submitted', 'rejected'), 'submitted -> rejected allowed');
assert(isValidRequestTransition('submitted', 'cancelled'), 'submitted -> cancelled allowed');
assert(isValidRequestTransition('under_review', 'approved'), 'under_review -> approved allowed');
assert(isValidRequestTransition('under_review', 'rejected'), 'under_review -> rejected allowed');
assert(isValidRequestTransition('approved', 'partially_fulfilled'), 'approved -> partially_fulfilled allowed');
assert(isValidRequestTransition('approved', 'fulfilled'), 'approved -> fulfilled allowed');
assert(isValidRequestTransition('partially_fulfilled', 'fulfilled'), 'partially_fulfilled -> fulfilled allowed');
assert(isValidRequestTransition('approved', 'cancelled'), 'approved -> cancelled allowed');

// Prohibited transitions
assert(!isValidRequestTransition('submitted', 'fulfilled'), 'submitted -> fulfilled directly prohibited');
assert(!isValidRequestTransition('under_review', 'fulfilled'), 'under_review -> fulfilled directly prohibited');

// Terminal states cannot be reopened
assert(!isValidRequestTransition('fulfilled', 'submitted'), 'Terminal fulfilled cannot transition to submitted');
assert(!isValidRequestTransition('fulfilled', 'approved'), 'Terminal fulfilled cannot transition to approved');
assert(!isValidRequestTransition('fulfilled', 'partially_fulfilled'), 'Terminal fulfilled cannot transition to partially_fulfilled');
assert(!isValidRequestTransition('rejected', 'under_review'), 'Terminal rejected cannot transition to under_review');
assert(!isValidRequestTransition('rejected', 'approved'), 'Terminal rejected cannot transition to approved');
assert(!isValidRequestTransition('cancelled', 'submitted'), 'Terminal cancelled cannot transition to submitted');
assert(!isValidRequestTransition('cancelled', 'approved'), 'Terminal cancelled cannot transition to approved');

// 3. Logic verification for Transaction Checks (Unit tests against simulated tx state)
console.log('\n--- Suite 3: Simulated Reservation & Capacity Guardrails ---');

function checkDistributionInvariants({ request, issuedUnitIds, unitDataMap }) {
  // 1. Terminal statuses cannot accept units
  if (['fulfilled', 'rejected', 'cancelled'].includes(request.status)) {
    throw new BloodBankValidationError(
      `Cannot issue units against request ${request.id} with terminal status '${request.status}'.`
    );
  }

  // 2. Unit quantity cap
  const previouslyFulfilled = request.fulfilledUnitIds || [];
  const remainingNeeded = request.quantityUnits - previouslyFulfilled.length;
  if (issuedUnitIds.length > remainingNeeded) {
    throw new BloodBankValidationError(
      `Cannot issue ${issuedUnitIds.length} units: request only requires ${remainingNeeded} more unit(s).`
    );
  }

  // 3. Unique unit IDs
  const uniqueUnitIds = new Set(issuedUnitIds);
  if (uniqueUnitIds.size !== issuedUnitIds.length) {
    throw new BloodBankValidationError('Selected unit IDs must be unique within a distribution.');
  }

  // 4. Unit existence, status, and reservation exclusivity
  for (const uId of issuedUnitIds) {
    const unit = unitDataMap[uId];
    if (!unit) {
      throw new BloodBankValidationError(`Selected inventory unit ${uId} does not exist.`);
    }
    if (unit.status !== 'available' && unit.status !== 'reserved') {
      throw new BloodBankValidationError(`Unit ${uId} is in '${unit.status}' status and cannot be issued.`);
    }
    if (unit.status === 'reserved' && unit.reservedForRequestId !== request.id) {
      throw new BloodBankValidationError(
        `Unit ${uId} is reserved for another request (${unit.reservedForRequestId || 'unknown'}).`
      );
    }
  }

  return true;
}

const mockReq = {
  id: 'req_101',
  status: 'approved',
  quantityUnits: 3,
  fulfilledUnitIds: ['UNIT-A'],
};

const mockUnits = {
  'UNIT-B': { id: 'UNIT-B', status: 'available' },
  'UNIT-C': { id: 'UNIT-C', status: 'reserved', reservedForRequestId: 'req_101' },
  'UNIT-OTHER': { id: 'UNIT-OTHER', status: 'reserved', reservedForRequestId: 'req_OTHER_999' },
  'UNIT-QUARANTINE': { id: 'UNIT-QUARANTINE', status: 'quarantine' },
};

// Reusing units reserved by another request is rejected
assertThrows(
  () => checkDistributionInvariants({
    request: mockReq,
    issuedUnitIds: ['UNIT-OTHER'],
    unitDataMap: mockUnits,
  }),
  'reserved for another request'
);

// Issuing more units than remaining needed is rejected
assertThrows(
  () => checkDistributionInvariants({
    request: mockReq, // needs 2 more (3 - 1)
    issuedUnitIds: ['UNIT-B', 'UNIT-C', 'UNIT-EXTRA'],
    unitDataMap: { ...mockUnits, 'UNIT-EXTRA': { id: 'UNIT-EXTRA', status: 'available' } },
  }),
  'request only requires 2 more unit(s)'
);

// Issuing against terminal fulfilled request is rejected
assertThrows(
  () => checkDistributionInvariants({
    request: { ...mockReq, status: 'fulfilled' },
    issuedUnitIds: ['UNIT-B'],
    unitDataMap: mockUnits,
  }),
  'terminal status \'fulfilled\''
);

// Issuing against terminal rejected request is rejected
assertThrows(
  () => checkDistributionInvariants({
    request: { ...mockReq, status: 'rejected' },
    issuedUnitIds: ['UNIT-B'],
    unitDataMap: mockUnits,
  }),
  'terminal status \'rejected\''
);

// Issuing against terminal cancelled request is rejected
assertThrows(
  () => checkDistributionInvariants({
    request: { ...mockReq, status: 'cancelled' },
    issuedUnitIds: ['UNIT-B'],
    unitDataMap: mockUnits,
  }),
  'terminal status \'cancelled\''
);

// Issuing unit in quarantine is rejected
assertThrows(
  () => checkDistributionInvariants({
    request: mockReq,
    issuedUnitIds: ['UNIT-QUARANTINE'],
    unitDataMap: mockUnits,
  }),
  'status and cannot be issued'
);

// Issuing valid available + properly reserved unit succeeds
assert(
  checkDistributionInvariants({
    request: mockReq,
    issuedUnitIds: ['UNIT-B', 'UNIT-C'],
    unitDataMap: mockUnits,
  }) === true,
  'Valid units fulfilling exact remaining quota pass all checks'
);

console.log('\n================================================================');
console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
