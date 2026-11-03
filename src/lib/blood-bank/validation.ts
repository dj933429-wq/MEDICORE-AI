/**
 * MEDICORE-AI — Isolated Blood Bank Validation & Business Rules
 * Runtime validation for domain entities, status transitions, and safety constraints.
 */

import {
  BloodGroup,
  BloodComponentType,
  DonorEligibilityStatus,
  DonationCollectionStatus,
  ScreeningStatus,
  InventoryUnitStatus,
  RequestUrgency,
  RequestStatus,
  DispatchStatus,
  BloodDonor,
  BloodDonation,
  BloodInventoryUnit,
  BloodRequest,
  BloodDistribution,
} from './types';
import { BLOOD_GROUPS, BLOOD_COMPONENTS } from './constants';

export class BloodBankValidationError extends Error {
  public readonly fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'BloodBankValidationError';
    this.fieldErrors = fieldErrors;
  }
}

/**
 * Blood group validation
 */
export function isValidBloodGroup(bg: unknown): bg is BloodGroup {
  return typeof bg === 'string' && (BLOOD_GROUPS as readonly string[]).includes(bg);
}

/**
 * Component type validation
 */
export function isValidComponentType(comp: unknown): comp is BloodComponentType {
  return typeof comp === 'string' && BLOOD_COMPONENTS.some(c => c.type === comp);
}

/**
 * Strict date string (YYYY-MM-DD) validation
 */
export function isValidDateString(dateStr: unknown): boolean {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Calculate age from YYYY-MM-DD
 */
export function calculateAge(dobStr: string): number {
  const [year, month, day] = dobStr.split('-').map(Number);
  const birth = new Date(year, month - 1, day);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

/**
 * Validate Donor Registration / Update Payload
 */
export function validateDonorPayload(data: Partial<BloodDonor>): void {
  const errors: Record<string, string> = {};

  if (!data.fullName || typeof data.fullName !== 'string' || data.fullName.trim().length < 2) {
    errors.fullName = 'Full name is required (minimum 2 characters).';
  }

  if (!data.nationalIdOrPassport || typeof data.nationalIdOrPassport !== 'string' || data.nationalIdOrPassport.trim().length < 3) {
    errors.nationalIdOrPassport = 'National ID, Passport, or Donor Identification is required.';
  }

  if (!data.dateOfBirth || !isValidDateString(data.dateOfBirth)) {
    errors.dateOfBirth = 'Date of birth must be a valid date in YYYY-MM-DD format.';
  } else {
    const age = calculateAge(data.dateOfBirth);
    if (age < 18) {
      errors.dateOfBirth = 'Donor must be at least 18 years old.';
    } else if (age > 75) {
      errors.dateOfBirth = 'Donor age exceeds standard maximum eligibility limit (75 years).';
    }
  }

  if (!data.gender || !['male', 'female', 'other'].includes(data.gender)) {
    errors.gender = 'Valid gender selection is required.';
  }

  if (!isValidBloodGroup(data.bloodGroup)) {
    errors.bloodGroup = `Invalid blood group. Must be one of: ${BLOOD_GROUPS.join(', ')}`;
  }

  if (!data.contact || typeof data.contact !== 'object') {
    errors.contact = 'Contact information is required.';
  } else {
    if (!data.contact.phone || typeof data.contact.phone !== 'string' || data.contact.phone.trim().length < 7) {
      errors['contact.phone'] = 'Valid contact phone number is required.';
    }
    if (!data.contact.email || typeof data.contact.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contact.email.trim())) {
      errors['contact.email'] = 'Valid email address is required.';
    }
  }

  const validStatuses: DonorEligibilityStatus[] = [
    'eligible',
    'temporarily_deferred',
    'permanently_deferred',
    'pending_screening',
  ];
  if (!data.eligibilityStatus || !validStatuses.includes(data.eligibilityStatus)) {
    errors.eligibilityStatus = 'Valid eligibility status is required.';
  }

  if (data.eligibilityStatus === 'temporarily_deferred' && !data.deferralUntil) {
    errors.deferralUntil = 'Deferred-until date is required for temporary deferral.';
  }

  if (!data.verifiedByStaffUid || typeof data.verifiedByStaffUid !== 'string' || data.verifiedByStaffUid.trim().length === 0) {
    errors.verifiedByStaffUid = 'Authorizing staff UID is required for verification audit.';
  }

  if (Object.keys(errors).length > 0) {
    throw new BloodBankValidationError('Donor validation failed', errors);
  }
}

/**
 * Validate Blood Donation Payload
 */
export function validateDonationPayload(data: Partial<BloodDonation>): void {
  const errors: Record<string, string> = {};

  if (!data.donorId || typeof data.donorId !== 'string') {
    errors.donorId = 'Donor ID reference is required.';
  }

  if (!isValidBloodGroup(data.bloodGroup)) {
    errors.bloodGroup = 'Valid blood group is required.';
  }

  if (typeof data.volumeMl !== 'number' || data.volumeMl < 100 || data.volumeMl > 600) {
    errors.volumeMl = 'Collection volume must be between 100 ml and 600 ml.';
  }

  const validCollectionStatuses: DonationCollectionStatus[] = [
    'completed',
    'partial',
    'adverse_reaction',
    'cancelled',
  ];
  if (!data.collectionStatus || !validCollectionStatuses.includes(data.collectionStatus)) {
    errors.collectionStatus = 'Valid collection status is required.';
  }

  const validScreeningStatuses: ScreeningStatus[] = [
    'pending',
    'tested_passed',
    'tested_failed',
    'quarantined',
  ];
  if (!data.screeningStatus || !validScreeningStatuses.includes(data.screeningStatus)) {
    errors.screeningStatus = 'Valid screening status is required.';
  }

  if (!data.collectionStaffUid || typeof data.collectionStaffUid !== 'string' || data.collectionStaffUid.trim().length === 0) {
    errors.collectionStaffUid = 'Staff collector UID is required.';
  }

  if (Object.keys(errors).length > 0) {
    throw new BloodBankValidationError('Donation validation failed', errors);
  }
}

/**
 * Valid Inventory State Transition Matrix
 * Enforces strict regulatory traceability: units cannot transition backward from final states.
 */
const VALID_INVENTORY_TRANSITIONS: Record<InventoryUnitStatus, InventoryUnitStatus[]> = {
  quarantine: ['available', 'discarded', 'expired'],
  available: ['reserved', 'quarantine', 'expired', 'discarded'],
  reserved: ['transfused', 'available', 'quarantine', 'expired', 'discarded'],
  transfused: [], // Terminal state
  expired: ['discarded'], // Terminal / discard only
  discarded: [], // Terminal state
};

export function isValidInventoryTransition(
  currentStatus: InventoryUnitStatus,
  newStatus: InventoryUnitStatus
): boolean {
  if (currentStatus === newStatus) return true;
  const allowed = VALID_INVENTORY_TRANSITIONS[currentStatus];
  return Boolean(allowed && allowed.includes(newStatus));
}

/**
 * Validate Inventory Unit Payload
 */
export function validateInventoryUnitPayload(data: Partial<BloodInventoryUnit>): void {
  const errors: Record<string, string> = {};

  if (!data.id || typeof data.id !== 'string' || data.id.trim().length < 3) {
    errors.id = 'Unique unit barcode or identification number is required.';
  }

  if (!data.donationId || typeof data.donationId !== 'string') {
    errors.donationId = 'Originating donation reference ID is required.';
  }

  if (!isValidBloodGroup(data.bloodGroup)) {
    errors.bloodGroup = 'Valid blood group is required.';
  }

  if (!isValidComponentType(data.componentType)) {
    errors.componentType = 'Valid blood component type is required.';
  }

  if (!data.collectionDate || !isValidDateString(data.collectionDate)) {
    errors.collectionDate = 'Valid collection date (YYYY-MM-DD) is required.';
  }

  if (!data.expiryDate || !isValidDateString(data.expiryDate)) {
    errors.expiryDate = 'Valid expiry date (YYYY-MM-DD) is required.';
  } else if (data.collectionDate && data.expiryDate < data.collectionDate) {
    errors.expiryDate = 'Expiry date cannot precede collection date.';
  }

  if (typeof data.volumeMl !== 'number' || data.volumeMl <= 0) {
    errors.volumeMl = 'Valid positive volume in milliliters is required.';
  }

  if (!data.storageLocation || typeof data.storageLocation !== 'string' || data.storageLocation.trim().length === 0) {
    errors.storageLocation = 'Storage location (e.g. Cold Room 1, Shelf B-2) is required.';
  }

  const validStatuses: InventoryUnitStatus[] = [
    'available',
    'reserved',
    'quarantine',
    'transfused',
    'expired',
    'discarded',
  ];
  if (!data.status || !validStatuses.includes(data.status)) {
    errors.status = 'Valid unit status is required.';
  }

  if (Object.keys(errors).length > 0) {
    throw new BloodBankValidationError('Inventory unit validation failed', errors);
  }
}

/**
 * Validate Blood Request Payload
 */
export function validateBloodRequestPayload(data: Partial<BloodRequest>): void {
  const errors: Record<string, string> = {};

  if (!data.requestingOrganization || typeof data.requestingOrganization !== 'string' || data.requestingOrganization.trim().length < 2) {
    errors.requestingOrganization = 'Requesting healthcare facility or department name is required.';
  }

  if (!isValidBloodGroup(data.bloodGroup)) {
    errors.bloodGroup = 'Requested blood group is required.';
  }

  if (!isValidComponentType(data.componentType)) {
    errors.componentType = 'Requested component type is required.';
  }

  if (typeof data.quantityUnits !== 'number' || !Number.isInteger(data.quantityUnits) || data.quantityUnits < 1 || data.quantityUnits > 50) {
    errors.quantityUnits = 'Quantity must be an integer between 1 and 50 units.';
  }

  const validUrgencies: RequestUrgency[] = ['routine', 'urgent', 'emergency_stat'];
  if (!data.urgency || !validUrgencies.includes(data.urgency)) {
    errors.urgency = 'Valid urgency classification is required.';
  }

  if (!data.requiredByDate || typeof data.requiredByDate !== 'string') {
    errors.requiredByDate = 'Required-by date/time is required.';
  }

  const validStatuses: RequestStatus[] = [
    'submitted',
    'under_review',
    'approved',
    'partially_fulfilled',
    'fulfilled',
    'rejected',
    'cancelled',
  ];
  if (data.status && !validStatuses.includes(data.status)) {
    errors.status = 'Valid request status is required.';
  }

  if (Object.keys(errors).length > 0) {
    throw new BloodBankValidationError('Blood request validation failed', errors);
  }
}

/**
 * Validate Blood Distribution Payload
 */
export function validateDistributionPayload(data: Partial<BloodDistribution>): void {
  const errors: Record<string, string> = {};

  if (!data.requestId || typeof data.requestId !== 'string') {
    errors.requestId = 'Associated blood request ID is required.';
  }

  if (!data.destinationOrganization || typeof data.destinationOrganization !== 'string' || data.destinationOrganization.trim().length < 2) {
    errors.destinationOrganization = 'Destination hospital or healthcare facility is required.';
  }

  if (!Array.isArray(data.issuedUnitIds) || data.issuedUnitIds.length === 0) {
    errors.issuedUnitIds = 'At least one blood unit identifier must be selected for issue.';
  }

  if (!data.authorizedStaffUid || typeof data.authorizedStaffUid !== 'string' || data.authorizedStaffUid.trim().length === 0) {
    errors.authorizedStaffUid = 'Authorizing blood bank staff UID is required.';
  }

  const validDispatchStatuses: DispatchStatus[] = [
    'prepared',
    'dispatched',
    'in_transit',
    'delivered',
    'cancelled',
  ];
  if (!data.dispatchStatus || !validDispatchStatuses.includes(data.dispatchStatus)) {
    errors.dispatchStatus = 'Valid dispatch status is required.';
  }

  if (Object.keys(errors).length > 0) {
    throw new BloodBankValidationError('Distribution validation failed', errors);
  }
}

/**
 * Aggregated Blood Bank Metrics Calculation (Pure Domain Logic)
 */
export function calculateMetrics(
  donors: BloodDonor[],
  donations: BloodDonation[],
  inventory: BloodInventoryUnit[],
  requests: BloodRequest[],
  distributions: BloodDistribution[]
): import('./types').BloodBankMetrics {
  const eligibleDonors = donors.filter((d) => d.eligibilityStatus === 'eligible').length;
  const availableUnits = inventory.filter((u) => u.status === 'available').length;
  const quarantinedUnits = inventory.filter((u) => u.status === 'quarantine').length;
  const expiredUnits = inventory.filter((u) => u.status === 'expired').length;
  const pendingRequests = requests.filter((r) => ['submitted', 'under_review'].includes(r.status)).length;
  const urgentRequests = requests.filter(
    (r) => ['urgent', 'emergency_stat'].includes(r.urgency) && !['fulfilled', 'cancelled', 'rejected'].includes(r.status)
  ).length;

  return {
    totalDonors: donors.length,
    eligibleDonors,
    totalDonations: donations.length,
    availableUnits,
    quarantinedUnits,
    expiredUnits,
    pendingRequests,
    urgentRequests,
    totalDistributions: distributions.length,
  };
}
