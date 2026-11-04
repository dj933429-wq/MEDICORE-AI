/**
 * MEDICORE-AI — Isolated Blood Bank Domain Types
 * Strict domain models for Blood Bank Management System (Phase 4A / 4A.1 Hardening)
 *
 * NOTE: Clinical eligibility, screening validity, and transfusion compatibility
 * must be verified by licensed medical staff and laboratory testing.
 * The system records staff-verified outcomes and does NOT make clinical decisions automatically.
 *
 * DATA MINIMIZATION:
 * Personal identifying information is minimized. Donors are primarily identified via
 * facility-scoped `donorReferenceId` (e.g. "DON-2026-0042"). Government identity documents
 * (national ID/passport) are optional and minimized.
 */

export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';

export type DonorGender = 'male' | 'female' | 'other';

export type DonorEligibilityStatus = 
  | 'eligible'
  | 'temporarily_deferred'
  | 'permanently_deferred'
  | 'pending_screening';

export type DonationCollectionStatus = 
  | 'completed'
  | 'partial'
  | 'adverse_reaction'
  | 'cancelled';

export type ScreeningStatus = 
  | 'pending'
  | 'tested_passed'
  | 'tested_failed'
  | 'quarantined';

export type BloodComponentType = 
  | 'whole_blood'
  | 'red_blood_cells'
  | 'platelets'
  | 'fresh_frozen_plasma'
  | 'cryoprecipitate';

export type InventoryUnitStatus = 
  | 'available'
  | 'reserved'
  | 'quarantine'
  | 'transfused'
  | 'expired'
  | 'discarded';

export type RequestUrgency = 
  | 'routine'
  | 'urgent'
  | 'emergency_stat';

export type RequestStatus = 
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'partially_fulfilled'
  | 'fulfilled'
  | 'rejected'
  | 'cancelled';

export type DispatchStatus = 
  | 'prepared'
  | 'dispatched'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';

export type AuditEntity = 
  | 'donor'
  | 'donation'
  | 'inventory'
  | 'request'
  | 'distribution'
  | 'system';

/**
 * Donor Record
 * Identity, contact details, blood group, staff-verified eligibility status,
 * donation history references, and timestamps.
 * 
 * Uses `donorReferenceId` for data minimization.
 */
export interface BloodDonor {
  id: string;
  centerId: string;
  donorReferenceId: string; // Minimized facility-scoped donor ID (e.g. DON-2026-0001)
  fullName: string;
  nationalIdOrPassport?: string; // Optional masked/tokenized government identifier
  dateOfBirth: string; // YYYY-MM-DD
  gender: DonorGender;
  bloodGroup: BloodGroup;
  contact: {
    phone: string;
    email: string;
    address?: string;
  };
  eligibilityStatus: DonorEligibilityStatus;
  deferralReason?: string;
  deferralUntil?: string; // YYYY-MM-DD
  lastDonationDate?: string; // YYYY-MM-DD
  donationCount: number;
  weightKg?: number;
  verifiedByStaffUid: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Donation Event
 * Donor reference, collection volume, collection status, laboratory screening status,
 * recording staff, and timestamps.
 */
export interface BloodDonation {
  id: string;
  centerId: string;
  donorId: string;
  donorReferenceId?: string;
  donorName: string;
  bloodGroup: BloodGroup;
  donationDate: string; // ISO 8601 string
  volumeMl: number;
  collectionStatus: DonationCollectionStatus;
  screeningStatus: ScreeningStatus;
  screeningStaffUid?: string;
  screeningNotes?: string;
  collectionStaffUid: string;
  adverseEventNotes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Inventory Unit
 * Donation reference, blood group, component type, collection and approved expiry dates,
 * volume, storage location, and status.
 */
export interface BloodInventoryUnit {
  id: string; // Unique Unit Number / Barcode (e.g., MED-BB-2026-0001)
  centerId: string;
  donationId: string;
  donorId: string;
  bloodGroup: BloodGroup;
  componentType: BloodComponentType;
  collectionDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD (Staff-approved)
  volumeMl: number;
  storageLocation: string; // e.g. "Cold Room 1, Shelf B-3"
  status: InventoryUnitStatus;
  statusReason?: string;
  reservedForRequestId?: string;
  isExhibitionData?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Blood Request
 * Requesting organization, requested blood group, component, quantity, urgency,
 * and processing status.
 */
export interface BloodRequest {
  id: string;
  centerId: string;
  requestingOrganization: string;
  departmentOrWard?: string;
  patientIdentifier?: string; // e.g. "HOSP-REQ-9821" (clinical tracking reference)
  bloodGroup: BloodGroup;
  componentType: BloodComponentType;
  quantityUnits: number;
  urgency: RequestUrgency;
  requiredByDate: string; // ISO 8601 string
  status: RequestStatus;
  clinicalIndication?: string;
  reviewerStaffUid?: string;
  decisionNotes?: string;
  fulfilledUnitIds?: string[];
  allocatedUnitIds?: string[]; // Dispatched or in-transit units not yet confirmed delivered
  createdAt: string;
  updatedAt: string;
}

/**
 * Distribution (Issue & Dispatch Record)
 * Issued unit references, authorized staff, destination organization, and dispatch status.
 */
export interface BloodDistribution {
  id: string;
  centerId: string;
  requestId: string;
  destinationOrganization: string;
  departmentOrWard?: string;
  issuedUnitIds: string[];
  authorizedStaffUid: string;
  dispatchStatus: DispatchStatus;
  transportReference?: string; // Courier or internal transport log number
  temperatureLogVerified: boolean;
  dispatchedAt?: string; // ISO 8601 string
  deliveredAt?: string; // ISO 8601 string
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Audit Event
 * Append-only immutable log: Actor, action, entity, entity ID, timestamp,
 * and status transition.
 */
export interface BloodBankAuditEvent {
  id: string;
  centerId: string;
  actorUid: string;
  actorEmail?: string;
  actorRole: string; // strictly 'blood_bank'
  action: string;
  entity: AuditEntity;
  entityId: string;
  statusTransition?: {
    from: string;
    to: string;
  };
  details?: Record<string, unknown>;
  timestamp: string; // ISO 8601 string
}

/**
 * Aggregated Blood Bank Metrics (for Overview and Reports)
 */
export interface BloodBankMetrics {
  totalDonors: number;
  eligibleDonors: number;
  totalDonations: number;
  availableUnits: number;
  quarantinedUnits: number;
  expiredUnits: number;
  pendingRequests: number;
  urgentRequests: number;
  totalDistributions: number;
}

// =========================================================================
// Phase 4B: Shared Blood Bank Network Types
// =========================================================================

export type StockSummaryKey = `${BloodGroup}_${BloodComponentType}`;
export type AvailableStockSummary = Record<string, number>;

export type CenterVerificationStatus = 'verified' | 'pending' | 'suspended';

export interface CenterLocation {
  latitude: number;
  longitude: number;
  geohash: string;
}

export interface CenterAddress {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface CenterContact {
  phone: string;
  emergencyPhone: string;
  email: string;
  operatingHours: string;
}

/**
 * Blood Bank Center (Public Directory Metadata & Aggregate Stock Summary)
 * Stored at bloodBank/{centerId}
 */
export interface BloodBankCenter {
  id: string; // centerId
  name: string;
  licenseNumber: string;
  verificationStatus: CenterVerificationStatus;
  address: CenterAddress;
  location: CenterLocation;
  contact: CenterContact;
  availableStockSummary: AvailableStockSummary;
  isExhibitionCenter: boolean;
  createdAt: string;
  updatedAt: string;
}

export type NetworkRequestType = 'targeted' | 'shortage_broadcast';
export type RequesterRole = 'patient' | 'doctor';
export type NetworkRequestStatus = 
  | 'submitted'
  | 'accepted'
  | 'reserved'
  | 'dispatched'
  | 'fulfilled'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export interface NetworkDeliveryAddress {
  hospitalOrFacilityName: string;
  departmentOrWard?: string;
  city: string;
  contactPhone: string;
}

/**
 * Root-level Network Blood Request
 * Stored at /networkRequests/{requestId}
 */
export interface NetworkBloodRequest {
  id: string;
  requestType: NetworkRequestType;
  requesterUid: string;
  requesterRole: RequesterRole;
  requesterName: string;
  hospitalOrganization?: string;
  patientIdentifier?: string;
  targetCenterId?: string;
  acceptedCenterId?: string;
  bloodGroup: BloodGroup;
  componentType: BloodComponentType;
  quantityUnits: number;
  urgency: RequestUrgency;
  requiredByDate: string; // ISO 8601
  deliveryAddress: NetworkDeliveryAddress;
  status: NetworkRequestStatus;
  clinicalIndication?: string;
  rejectionReason?: string;
  assignedUnitIds?: string[];
  fulfilledUnitIds?: string[];
  authorizedStaffUid?: string;
  isExhibitionData?: boolean;
  createdAt: string;
  updatedAt: string;
}
