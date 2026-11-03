/**
 * MEDICORE-AI — Isolated Blood Bank Firestore Service
 * Namespaced client operations under `bloodBank/{centerId}/...`
 *
 * All operations require authenticated staff with role 'blood_bank'.
 * Audit logs are written on every state-altering mutation.
 */

import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import {
  BloodDonor,
  BloodDonation,
  BloodInventoryUnit,
  BloodRequest,
  BloodDistribution,
  BloodBankAuditEvent,
  BloodBankMetrics,
  InventoryUnitStatus,
  RequestStatus,
} from './types';
import { DEFAULT_BLOOD_BANK_CENTER_ID } from './constants';
import {
  validateDonorPayload,
  validateDonationPayload,
  validateInventoryUnitPayload,
  validateBloodRequestPayload,
  validateDistributionPayload,
  isValidInventoryTransition,
  BloodBankValidationError,
} from './validation';

function getCenterId(centerId?: string): string {
  return centerId || DEFAULT_BLOOD_BANK_CENTER_ID;
}

/**
 * Generate a unique audit event and append to auditLogs
 */
async function appendAuditLog(
  centerId: string,
  event: Omit<BloodBankAuditEvent, 'id' | 'centerId' | 'timestamp'>
): Promise<void> {
  const auditId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const auditRef = doc(db, 'bloodBank', centerId, 'auditLogs', auditId);
  const fullEvent: BloodBankAuditEvent = {
    id: auditId,
    centerId,
    ...event,
    timestamp: new Date().toISOString(),
  };
  await setDoc(auditRef, fullEvent);
}

// =============================================================================
// Donors
// =============================================================================

export async function fetchDonors(centerId = DEFAULT_BLOOD_BANK_CENTER_ID): Promise<BloodDonor[]> {
  const donorsRef = collection(db, 'bloodBank', getCenterId(centerId), 'donors');
  const q = query(donorsRef, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as BloodDonor);
}

export async function createDonor(
  payload: Omit<BloodDonor, 'id' | 'centerId' | 'createdAt' | 'updatedAt' | 'donationCount'>,
  actor: { uid: string; email?: string }
): Promise<BloodDonor> {
  validateDonorPayload(payload);

  const centerId = DEFAULT_BLOOD_BANK_CENTER_ID;
  const donorId = `donor_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const newDonor: BloodDonor = {
    id: donorId,
    centerId,
    ...payload,
    donationCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const donorRef = doc(db, 'bloodBank', centerId, 'donors', donorId);
  await setDoc(donorRef, newDonor);

  await appendAuditLog(centerId, {
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'blood_bank',
    action: 'DONOR_REGISTERED',
    entity: 'donor',
    entityId: donorId,
    details: { fullName: newDonor.fullName, bloodGroup: newDonor.bloodGroup },
  });

  return newDonor;
}

// =============================================================================
// Donations
// =============================================================================

export async function fetchDonations(centerId = DEFAULT_BLOOD_BANK_CENTER_ID): Promise<BloodDonation[]> {
  const donationsRef = collection(db, 'bloodBank', getCenterId(centerId), 'donations');
  const q = query(donationsRef, orderBy('donationDate', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as BloodDonation);
}

export async function createDonation(
  payload: Omit<BloodDonation, 'id' | 'centerId' | 'createdAt' | 'updatedAt'>,
  actor: { uid: string; email?: string }
): Promise<BloodDonation> {
  validateDonationPayload(payload);

  const centerId = DEFAULT_BLOOD_BANK_CENTER_ID;
  const donationId = `don_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const newDonation: BloodDonation = {
    id: donationId,
    centerId,
    ...payload,
    createdAt: now,
    updatedAt: now,
  };

  const donationRef = doc(db, 'bloodBank', centerId, 'donations', donationId);
  await setDoc(donationRef, newDonation);

  // Update donor total donation count & last donation date if completed
  if (payload.collectionStatus === 'completed') {
    const donorRef = doc(db, 'bloodBank', centerId, 'donors', payload.donorId);
    const donorSnap = await getDoc(donorRef);
    if (donorSnap.exists()) {
      const currentCount = donorSnap.data().donationCount || 0;
      await updateDoc(donorRef, {
        donationCount: currentCount + 1,
        lastDonationDate: payload.donationDate.split('T')[0],
        updatedAt: now,
      });
    }
  }

  await appendAuditLog(centerId, {
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'blood_bank',
    action: 'DONATION_RECORDED',
    entity: 'donation',
    entityId: donationId,
    details: {
      donorId: newDonation.donorId,
      volumeMl: newDonation.volumeMl,
      collectionStatus: newDonation.collectionStatus,
    },
  });

  return newDonation;
}

// =============================================================================
// Inventory Units
// =============================================================================

export async function fetchInventory(centerId = DEFAULT_BLOOD_BANK_CENTER_ID): Promise<BloodInventoryUnit[]> {
  const invRef = collection(db, 'bloodBank', getCenterId(centerId), 'inventory');
  const q = query(invRef, orderBy('expiryDate', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as BloodInventoryUnit);
}

export async function createInventoryUnit(
  payload: Omit<BloodInventoryUnit, 'centerId' | 'createdAt' | 'updatedAt'>,
  actor: { uid: string; email?: string }
): Promise<BloodInventoryUnit> {
  validateInventoryUnitPayload(payload);

  const centerId = DEFAULT_BLOOD_BANK_CENTER_ID;
  const now = new Date().toISOString();

  const newUnit: BloodInventoryUnit = {
    ...payload,
    centerId,
    createdAt: now,
    updatedAt: now,
  };

  const unitRef = doc(db, 'bloodBank', centerId, 'inventory', newUnit.id);
  await setDoc(unitRef, newUnit);

  await appendAuditLog(centerId, {
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'blood_bank',
    action: 'INVENTORY_UNIT_CREATED',
    entity: 'inventory',
    entityId: newUnit.id,
    details: {
      bloodGroup: newUnit.bloodGroup,
      componentType: newUnit.componentType,
      expiryDate: newUnit.expiryDate,
      status: newUnit.status,
    },
  });

  return newUnit;
}

export async function updateInventoryStatus(
  unitId: string,
  newStatus: InventoryUnitStatus,
  reason: string | undefined,
  actor: { uid: string; email?: string },
  centerId = DEFAULT_BLOOD_BANK_CENTER_ID
): Promise<void> {
  const cId = getCenterId(centerId);
  const unitRef = doc(db, 'bloodBank', cId, 'inventory', unitId);
  const snap = await getDoc(unitRef);

  if (!snap.exists()) {
    throw new BloodBankValidationError(`Inventory unit with ID ${unitId} does not exist.`);
  }

  const currentUnit = snap.data() as BloodInventoryUnit;

  if (!isValidInventoryTransition(currentUnit.status, newStatus)) {
    throw new BloodBankValidationError(
      `Illegal status transition: cannot change unit status from '${currentUnit.status}' to '${newStatus}'.`
    );
  }

  const now = new Date().toISOString();
  await updateDoc(unitRef, {
    status: newStatus,
    statusReason: reason || null,
    updatedAt: now,
  });

  await appendAuditLog(cId, {
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'blood_bank',
    action: 'INVENTORY_STATUS_UPDATED',
    entity: 'inventory',
    entityId: unitId,
    statusTransition: {
      from: currentUnit.status,
      to: newStatus,
    },
    details: { reason },
  });
}

// =============================================================================
// Blood Requests
// =============================================================================

export async function fetchRequests(centerId = DEFAULT_BLOOD_BANK_CENTER_ID): Promise<BloodRequest[]> {
  const reqRef = collection(db, 'bloodBank', getCenterId(centerId), 'requests');
  const q = query(reqRef, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as BloodRequest);
}

export async function createBloodRequest(
  payload: Omit<BloodRequest, 'id' | 'centerId' | 'status' | 'createdAt' | 'updatedAt'>,
  actor: { uid: string; email?: string }
): Promise<BloodRequest> {
  validateBloodRequestPayload({ ...payload, status: 'submitted' });

  const centerId = DEFAULT_BLOOD_BANK_CENTER_ID;
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const newRequest: BloodRequest = {
    id: requestId,
    centerId,
    ...payload,
    status: 'submitted',
    createdAt: now,
    updatedAt: now,
  };

  const reqRef = doc(db, 'bloodBank', centerId, 'requests', requestId);
  await setDoc(reqRef, newRequest);

  await appendAuditLog(centerId, {
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'blood_bank',
    action: 'REQUEST_SUBMITTED',
    entity: 'request',
    entityId: requestId,
    details: {
      organization: newRequest.requestingOrganization,
      bloodGroup: newRequest.bloodGroup,
      quantityUnits: newRequest.quantityUnits,
      urgency: newRequest.urgency,
    },
  });

  return newRequest;
}

export async function updateRequestStatus(
  requestId: string,
  newStatus: RequestStatus,
  decisionNotes: string | undefined,
  actor: { uid: string; email?: string },
  centerId = DEFAULT_BLOOD_BANK_CENTER_ID
): Promise<void> {
  const cId = getCenterId(centerId);
  const reqRef = doc(db, 'bloodBank', cId, 'requests', requestId);
  const snap = await getDoc(reqRef);

  if (!snap.exists()) {
    throw new BloodBankValidationError(`Blood request with ID ${requestId} does not exist.`);
  }

  const currentReq = snap.data() as BloodRequest;
  const now = new Date().toISOString();

  await updateDoc(reqRef, {
    status: newStatus,
    reviewerStaffUid: actor.uid,
    decisionNotes: decisionNotes || null,
    updatedAt: now,
  });

  await appendAuditLog(cId, {
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'blood_bank',
    action: 'REQUEST_STATUS_UPDATED',
    entity: 'request',
    entityId: requestId,
    statusTransition: {
      from: currentReq.status,
      to: newStatus,
    },
    details: { decisionNotes },
  });
}

// =============================================================================
// Distribution / Issues
// =============================================================================

export async function fetchDistributions(centerId = DEFAULT_BLOOD_BANK_CENTER_ID): Promise<BloodDistribution[]> {
  const distRef = collection(db, 'bloodBank', getCenterId(centerId), 'issues');
  const q = query(distRef, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as BloodDistribution);
}

export async function createDistribution(
  payload: Omit<BloodDistribution, 'id' | 'centerId' | 'createdAt' | 'updatedAt'>,
  actor: { uid: string; email?: string }
): Promise<BloodDistribution> {
  validateDistributionPayload(payload);

  const centerId = DEFAULT_BLOOD_BANK_CENTER_ID;
  const issueId = `dist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const newDistribution: BloodDistribution = {
    id: issueId,
    centerId,
    ...payload,
    createdAt: now,
    updatedAt: now,
  };

  const distRef = doc(db, 'bloodBank', centerId, 'issues', issueId);
  await setDoc(distRef, newDistribution);

  // Mark all issued units as 'reserved' or 'transfused' according to dispatch
  for (const unitId of payload.issuedUnitIds) {
    const unitRef = doc(db, 'bloodBank', centerId, 'inventory', unitId);
    const unitSnap = await getDoc(unitRef);
    if (unitSnap.exists()) {
      await updateDoc(unitRef, {
        status: payload.dispatchStatus === 'delivered' ? 'transfused' : 'reserved',
        reservedForRequestId: payload.requestId,
        updatedAt: now,
      });
    }
  }

  await appendAuditLog(centerId, {
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'blood_bank',
    action: 'UNITS_DISPATCHED',
    entity: 'distribution',
    entityId: issueId,
    details: {
      requestId: newDistribution.requestId,
      destination: newDistribution.destinationOrganization,
      unitsCount: newDistribution.issuedUnitIds.length,
    },
  });

  return newDistribution;
}

// =============================================================================
// Audit Logs
// =============================================================================

export async function fetchAuditLogs(
  centerId = DEFAULT_BLOOD_BANK_CENTER_ID,
  maxLogs = 50
): Promise<BloodBankAuditEvent[]> {
  const logsRef = collection(db, 'bloodBank', getCenterId(centerId), 'auditLogs');
  const q = query(logsRef, orderBy('timestamp', 'desc'), limit(maxLogs));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as BloodBankAuditEvent);
}

// =============================================================================
// Aggregated Metrics (Exported from validation)
// =============================================================================

export { calculateMetrics } from './validation';
