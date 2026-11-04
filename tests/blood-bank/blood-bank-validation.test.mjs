/**
 * MEDICORE-AI — Isolated Blood Bank Domain & Validation Unit Tests
 * FILE: tests/blood-bank/blood-bank-validation.test.mjs
 *
 * Verifies domain rules, schema constraints, inventory transition matrices,
 * and clinical safety guardrails.
 */

import {
  isValidBloodGroup,
  isValidComponentType,
  isValidDateString,
  calculateAge,
  validateDonorPayload,
  validateDonationPayload,
  isValidInventoryTransition,
  isValidRequestTransition,
  validateInventoryUnitPayload,
  validateBloodRequestPayload,
  validateDistributionPayload,
  validateNetworkRequestPayload,
  validateBloodBankCenterSummary,
  calculateMetrics,
} from '../../src/lib/blood-bank/validation.ts';

import {
  CLINICAL_SAFETY_DISCLAIMER,
  BLOOD_GROUPS,
  BLOOD_COMPONENTS,
} from '../../src/lib/blood-bank/constants.ts';

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

function assertThrows(fn, message) {
  try {
    fn();
    console.error(`  FAIL (expected error, none thrown): ${message}`);
    failed++;
  } catch (err) {
    console.log(`  PASS: ${message} (Threw ${err.name})`);
    passed++;
  }
}

console.log('================================================================');
console.log('MEDICORE-AI: Blood Bank Domain & Validation Unit Tests');
console.log('================================================================\n');

// 1. Blood Group & Component Validators
console.log('--- Suite 1: Types & Enumerations ---');
assert(isValidBloodGroup('A+'), 'Validates A+ blood group');
assert(isValidBloodGroup('O-'), 'Validates O- blood group');
assert(isValidBloodGroup('AB+'), 'Validates AB+ blood group');
assert(!isValidBloodGroup('C+'), 'Rejects non-existent blood group C+');
assert(!isValidBloodGroup(null), 'Rejects null blood group');
assert(!isValidBloodGroup(''), 'Rejects empty blood group');

assert(isValidComponentType('whole_blood'), 'Validates whole_blood component');
assert(isValidComponentType('platelets'), 'Validates platelets component');
assert(!isValidComponentType('synthetic_plasma'), 'Rejects unknown component type');
assert(BLOOD_GROUPS.length === 8, '8 recognized clinical blood groups');
assert(BLOOD_COMPONENTS.length === 5, '5 recognized blood components with distinct shelf lives');

// 2. Date and Age Calculations
console.log('\n--- Suite 2: Date & Age Calculations ---');
assert(isValidDateString('2026-03-01'), 'Validates standard date format YYYY-MM-DD');
assert(!isValidDateString('01-03-2026'), 'Rejects inverted date format');
assert(!isValidDateString('2026-02-30'), 'Rejects impossible February date 2026-02-30');
assert(calculateAge('2000-01-01') >= 26, 'Calculates donor age correctly');

// 3. Donor Payload Validation
console.log('\n--- Suite 3: Donor Validation ---');
const validDonor = {
  donorReferenceId: 'DON-2026-0001',
  fullName: 'Jane Smith',
  nationalIdOrPassport: 'NAT-998234',
  dateOfBirth: '1995-06-15',
  gender: 'female',
  bloodGroup: 'O+',
  contact: {
    phone: '+1 555-123-4567',
    email: 'jane.smith@example.org',
    address: '100 Medical Plaza',
  },
  eligibilityStatus: 'eligible',
  verifiedByStaffUid: 'staff_123',
};

assertThrows(() => validateDonorPayload({ ...validDonor, donorReferenceId: '' }), 'Rejects missing donorReferenceId');
assertThrows(() => validateDonorPayload({ ...validDonor, fullName: 'J' }), 'Rejects single-character donor name');
assertThrows(() => validateDonorPayload({ ...validDonor, dateOfBirth: '2020-01-01' }), 'Rejects minor donor under clerical sanity check');
assertThrows(() => validateDonorPayload({ ...validDonor, dateOfBirth: '1910-01-01' }), 'Rejects donor over clerical sanity threshold');
assertThrows(() => validateDonorPayload({ ...validDonor, bloodGroup: 'X+' }), 'Rejects invalid blood group');
assertThrows(() => validateDonorPayload({ ...validDonor, contact: { phone: '123', email: 'notanemail' } }), 'Rejects invalid email format');
assertThrows(() => validateDonorPayload({ ...validDonor, eligibilityStatus: 'temporarily_deferred', deferralUntil: undefined }), 'Requires deferralUntil for temporary deferral');
assertThrows(() => validateDonorPayload({ ...validDonor, verifiedByStaffUid: '' }), 'Requires staff verification UID');

// Valid donor passes
validateDonorPayload(validDonor);
assert(true, 'Accepts valid donor registration payload');

// Data minimization: accepts donor without nationalIdOrPassport
validateDonorPayload({ ...validDonor, nationalIdOrPassport: undefined });
assert(true, 'Data minimization: accepts donor without nationalIdOrPassport');

// 4. Donation Payload Validation
console.log('\n--- Suite 4: Donation Validation ---');
const validDonation = {
  donorId: 'donor_001',
  donorName: 'Jane Smith',
  bloodGroup: 'O+',
  donationDate: '2026-03-01T10:00:00Z',
  volumeMl: 450,
  collectionStatus: 'completed',
  screeningStatus: 'pending',
  collectionStaffUid: 'staff_123',
};

assertThrows(() => validateDonationPayload({ ...validDonation, volumeMl: 20 }), 'Rejects volume below minimum 50ml');
assertThrows(() => validateDonationPayload({ ...validDonation, volumeMl: 900 }), 'Rejects volume above maximum 700ml');
assertThrows(() => validateDonationPayload({ ...validDonation, collectionStatus: 'unknown' }), 'Rejects invalid collection status');
assertThrows(() => validateDonationPayload({ ...validDonation, screeningStatus: 'safe' }), 'Rejects invalid screening status enum');
assertThrows(() => validateDonationPayload({ ...validDonation, collectionStaffUid: '' }), 'Requires collection staff UID');

validateDonationPayload(validDonation);
assert(true, 'Accepts valid blood collection payload');

// 5. Inventory State Transitions & Traceability
console.log('\n--- Suite 5: Inventory State Transitions ---');
assert(isValidInventoryTransition('quarantine', 'available'), 'Quarantine -> Available permitted after passing tests');
assert(isValidInventoryTransition('quarantine', 'discarded'), 'Quarantine -> Discarded permitted after failed tests');
assert(isValidInventoryTransition('available', 'reserved'), 'Available -> Reserved permitted for cross-match');
assert(isValidInventoryTransition('available', 'quarantine'), 'Available -> Quarantine permitted if recall/investigation');
assert(isValidInventoryTransition('reserved', 'transfused'), 'Reserved -> Transfused permitted upon issue');
assert(isValidInventoryTransition('reserved', 'available'), 'Reserved -> Available permitted if surgery cancelled');
assert(isValidInventoryTransition('expired', 'discarded'), 'Expired -> Discarded permitted for biological disposal');

// Prohibited transitions
assert(!isValidInventoryTransition('transfused', 'available'), 'PROHIBITED: Transfused cannot transition back to Available');
assert(!isValidInventoryTransition('transfused', 'reserved'), 'PROHIBITED: Transfused cannot transition back to Reserved');
assert(!isValidInventoryTransition('discarded', 'available'), 'PROHIBITED: Discarded cannot transition back to Available');
assert(!isValidInventoryTransition('expired', 'available'), 'PROHIBITED: Expired cannot transition back to Available');

// Inventory Unit Validation
const validUnit = {
  id: 'UNIT-OP-100293',
  donationId: 'don_001',
  donorId: 'donor_001',
  bloodGroup: 'O+',
  componentType: 'whole_blood',
  collectionDate: '2026-03-01',
  expiryDate: '2026-04-05',
  volumeMl: 450,
  storageLocation: 'Cold Room 1, Shelf B-2',
  status: 'available',
};

assertThrows(() => validateInventoryUnitPayload({ ...validUnit, id: '' }), 'Requires unit barcode identifier');
assertThrows(() => validateInventoryUnitPayload({ ...validUnit, expiryDate: '2026-02-01' }), 'Rejects expiry date preceding collection date');
assertThrows(() => validateInventoryUnitPayload({ ...validUnit, volumeMl: -10 }), 'Rejects negative volume');
assertThrows(() => validateInventoryUnitPayload({ ...validUnit, status: 'invalid_status' }), 'Rejects invalid inventory unit status');

validateInventoryUnitPayload(validUnit);
assert(true, 'Accepts valid inventory unit payload');

// 6. Blood Request & Distribution Validation
console.log('\n--- Suite 6: Requests & Distribution Validation ---');
const validRequest = {
  requestingOrganization: 'City General Trauma ICU',
  bloodGroup: 'O-',
  componentType: 'red_blood_cells',
  quantityUnits: 4,
  urgency: 'emergency_stat',
  requiredByDate: '2026-03-01T14:00:00Z',
  status: 'submitted',
};

assertThrows(() => validateBloodRequestPayload({ ...validRequest, requestingOrganization: '' }), 'Requires requesting facility name');
assertThrows(() => validateBloodRequestPayload({ ...validRequest, quantityUnits: 0 }), 'Rejects zero quantity units');
assertThrows(() => validateBloodRequestPayload({ ...validRequest, quantityUnits: 100 }), 'Rejects excessive single request quantity (> 50)');
assertThrows(() => validateBloodRequestPayload({ ...validRequest, urgency: 'immediate' }), 'Rejects unknown urgency enum');

validateBloodRequestPayload(validRequest);
assert(true, 'Accepts valid blood request payload');

const validDistribution = {
  requestId: 'req_001',
  destinationOrganization: 'City General Trauma ICU',
  issuedUnitIds: ['UNIT-OP-100293', 'UNIT-OP-100294'],
  authorizedStaffUid: 'staff_123',
  dispatchStatus: 'dispatched',
};

assertThrows(() => validateDistributionPayload({ ...validDistribution, issuedUnitIds: [] }), 'Rejects dispatch with empty unit list');
assertThrows(() => validateDistributionPayload({ ...validDistribution, issuedUnitIds: ['UNIT-1', 'UNIT-1'] }), 'Rejects duplicate unit IDs in single distribution');
assertThrows(() => validateDistributionPayload({ ...validDistribution, destinationOrganization: '' }), 'Requires destination facility');
assertThrows(() => validateDistributionPayload({ ...validDistribution, authorizedStaffUid: '' }), 'Requires authorized staff UID');

validateDistributionPayload(validDistribution);
assert(true, 'Accepts valid distribution dispatch payload');

// 6b. Request State Transition Matrix
console.log('\n--- Suite 6b: Request State Transitions & Terminal Immutability ---');
assert(isValidRequestTransition('submitted', 'under_review'), 'submitted -> under_review permitted');
assert(isValidRequestTransition('submitted', 'approved'), 'submitted -> approved permitted');
assert(isValidRequestTransition('submitted', 'rejected'), 'submitted -> rejected permitted');
assert(isValidRequestTransition('submitted', 'cancelled'), 'submitted -> cancelled permitted');
assert(isValidRequestTransition('under_review', 'approved'), 'under_review -> approved permitted');
assert(isValidRequestTransition('approved', 'partially_fulfilled'), 'approved -> partially_fulfilled permitted');
assert(isValidRequestTransition('approved', 'fulfilled'), 'approved -> fulfilled permitted');
assert(isValidRequestTransition('partially_fulfilled', 'fulfilled'), 'partially_fulfilled -> fulfilled permitted');

// Terminal states rejection
assert(!isValidRequestTransition('fulfilled', 'submitted'), 'PROHIBITED: fulfilled cannot be reopened to submitted');
assert(!isValidRequestTransition('fulfilled', 'approved'), 'PROHIBITED: fulfilled cannot transition back to approved');
assert(!isValidRequestTransition('rejected', 'approved'), 'PROHIBITED: rejected cannot be reopened to approved');
assert(!isValidRequestTransition('rejected', 'submitted'), 'PROHIBITED: rejected cannot be reopened to submitted');
assert(!isValidRequestTransition('cancelled', 'approved'), 'PROHIBITED: cancelled cannot be reopened to approved');
assert(!isValidRequestTransition('cancelled', 'submitted'), 'PROHIBITED: cancelled cannot be reopened to submitted');

// 7. Clinical Guardrail Verification
console.log('\n--- Suite 7: Non-Automated Clinical Guardrail ---');
assert(
  typeof CLINICAL_SAFETY_DISCLAIMER === 'string' && CLINICAL_SAFETY_DISCLAIMER.includes('does NOT compute automated clinical eligibility'),
  'Mandatory clinical disclaimer explicitly states software does NOT make clinical decisions'
);

// 8. Metrics Aggregation Math
console.log('\n--- Suite 8: Metrics Calculation ---');
const metrics = calculateMetrics(
  [validDonor, { ...validDonor, eligibilityStatus: 'temporarily_deferred' }],
  [validDonation],
  [validUnit, { ...validUnit, id: 'UNIT-OP-2', status: 'quarantine' }],
  [validRequest],
  [validDistribution]
);

assert(metrics.totalDonors === 2, 'Counts total donors: 2');
assert(metrics.eligibleDonors === 1, 'Counts eligible donors: 1');
assert(metrics.totalDonations === 1, 'Counts total donations: 1');
assert(metrics.availableUnits === 1, 'Counts available units: 1');
assert(metrics.quarantinedUnits === 1, 'Counts quarantined units: 1');
assert(metrics.urgentRequests === 1, 'Counts urgent/STAT requests: 1');
assert(metrics.totalDistributions === 1, 'Counts total distributions: 1');

// 9. Phase 4B Network Request & Center Stock Summary Validation
console.log('\n--- Suite 9: Phase 4B Network Requests & Stock Summary Validation ---');
const validTargetedReq = {
  id: 'netreq_001',
  requestType: 'targeted',
  targetCenterId: 'center-primary',
  requesterUid: 'doc_user_1',
  requesterRole: 'doctor',
  requesterName: 'Dr. John Smith',
  hospitalOrganization: 'General Hospital',
  bloodGroup: 'O+',
  componentType: 'whole_blood',
  quantityUnits: 2,
  urgency: 'urgent',
  requiredByDate: '2026-03-10T12:00:00Z',
  deliveryAddress: {
    hospitalOrFacilityName: 'General Hospital Trauma Center',
    departmentOrWard: 'ICU Ward 3',
    city: 'Metropolis',
    contactPhone: '555-0199',
  },
  status: 'submitted',
};

const validBroadcastReq = {
  ...validTargetedReq,
  id: 'netreq_002',
  requestType: 'shortage_broadcast',
  targetCenterId: undefined,
};

validateNetworkRequestPayload(validTargetedReq);
assert(true, 'Accepts valid targeted network request payload');

validateNetworkRequestPayload(validBroadcastReq);
assert(true, 'Accepts valid shortage broadcast network request payload');

assertThrows(
  () => validateNetworkRequestPayload({ ...validTargetedReq, id: '' }),
  'Requires unique network request ID'
);
assertThrows(
  () => validateNetworkRequestPayload({ ...validTargetedReq, requestType: 'invalid_type' }),
  'Rejects invalid request type'
);
assertThrows(
  () => validateNetworkRequestPayload({ ...validTargetedReq, requestType: 'targeted', targetCenterId: '' }),
  'Targeted request requires targetCenterId'
);
assertThrows(
  () => validateNetworkRequestPayload({ ...validTargetedReq, bloodGroup: 'Z+' }),
  'Rejects invalid blood group in network request'
);
assertThrows(
  () => validateNetworkRequestPayload({ ...validTargetedReq, componentType: 'plasma_pack' }),
  'Rejects invalid component type in network request'
);
assertThrows(
  () => validateNetworkRequestPayload({ ...validTargetedReq, quantityUnits: 0 }),
  'Rejects quantity < 1'
);
assertThrows(
  () => validateNetworkRequestPayload({ ...validTargetedReq, quantityUnits: 51 }),
  'Rejects quantity > 50'
);
assertThrows(
  () => validateNetworkRequestPayload({ ...validTargetedReq, quantityUnits: 2.5 }),
  'Rejects non-integer quantity'
);
assertThrows(
  () => validateNetworkRequestPayload({ ...validTargetedReq, urgency: 'immediate_stat' }),
  'Rejects invalid urgency enum'
);
assertThrows(
  () => validateNetworkRequestPayload({ ...validTargetedReq, requesterRole: 'admin' }),
  'Rejects unauthorized requester role (e.g. admin or pharmacist)'
);
assertThrows(
  () => validateNetworkRequestPayload({ ...validTargetedReq, deliveryAddress: { city: 'City' } }),
  'Rejects incomplete delivery address'
);

// Stock Summary Validation
const validSummary = {
  'O+_whole_blood': 25,
  'A+_platelets': 10,
  'B-_red_blood_cells': 4,
  'AB+_fresh_frozen_plasma': 0,
};

validateBloodBankCenterSummary(validSummary);
assert(true, 'Accepts valid center available stock summary');

assertThrows(
  () => validateBloodBankCenterSummary({ 'invalid_key': 5 }),
  'Rejects stock summary with invalid key format'
);
assertThrows(
  () => validateBloodBankCenterSummary({ 'O+_unknown_component': 5 }),
  'Rejects stock summary with unknown component type'
);
assertThrows(
  () => validateBloodBankCenterSummary({ 'O+_whole_blood': -1 }),
  'Rejects stock summary with negative stock count'
);
assertThrows(
  () => validateBloodBankCenterSummary({ 'O+_whole_blood': 2.7 }),
  'Rejects stock summary with non-integer stock count'
);

console.log('\n================================================================');
console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
