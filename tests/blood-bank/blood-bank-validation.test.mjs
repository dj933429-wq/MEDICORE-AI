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
  validateInventoryUnitPayload,
  validateBloodRequestPayload,
  validateDistributionPayload,
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
assertThrows(() => validateDistributionPayload({ ...validDistribution, destinationOrganization: '' }), 'Requires destination facility');
assertThrows(() => validateDistributionPayload({ ...validDistribution, authorizedStaffUid: '' }), 'Requires authorized staff UID');

validateDistributionPayload(validDistribution);
assert(true, 'Accepts valid distribution dispatch payload');

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

console.log('\n================================================================');
console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
