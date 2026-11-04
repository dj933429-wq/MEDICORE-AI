/**
 * MEDICORE-AI — Isolated Blood Bank Firestore Service
 * Namespaced client operations under `bloodBank/{centerId}/...`
 * (Phase 4A.1 Hardened: All multi-entity and audit writes are strictly ATOMIC)
 *
 * All operations require authenticated staff with role 'blood_bank'.
 * Audit logs and operational mutations are committed atomically via Firestore
 * transactions (`runTransaction`) and write batches (`writeBatch`), ensuring
 * partial failures can never desynchronize inventory, donor metrics, or audit logs.
 */

import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDocs,
  query,
  orderBy,
  limit,
  writeBatch,
  runTransaction,
} from 'firebase/firestore';
import {
  BloodDonor,
  BloodDonation,
  BloodInventoryUnit,
  BloodRequest,
  BloodDistribution,
  BloodBankAuditEvent,
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
  isValidRequestTransition,
  BloodBankValidationError,
} from './validation';

function getCenterId(centerId?: string): string {
  return centerId || DEFAULT_BLOOD_BANK_CENTER_ID;
}

/**
 * Helper to build an audit event object and its DocumentReference
 */
function createAuditRefAndEvent(
  centerId: string,
  event: Omit<BloodBankAuditEvent, 'id' | 'centerId' | 'timestamp'>
) {
  const auditId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const auditRef = doc(db, 'bloodBank', centerId, 'auditLogs', auditId);
  const fullEvent: BloodBankAuditEvent = {
    id: auditId,
    centerId,
    ...event,
    timestamp: new Date().toISOString(),
  };
  return { auditRef, fullEvent };
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

/**
 * Atomically creates a donor record and its immutable audit log
 */
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
  const { auditRef, fullEvent } = createAuditRefAndEvent(centerId, {
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'blood_bank',
    action: 'DONOR_REGISTERED',
    entity: 'donor',
    entityId: donorId,
    details: {
      donorReferenceId: newDonor.donorReferenceId,
      fullName: newDonor.fullName,
      bloodGroup: newDonor.bloodGroup,
    },
  });

  // Atomic batch write: donor + audit record
  const batch = writeBatch(db);
  batch.set(donorRef, newDonor);
  batch.set(auditRef, fullEvent);
  await batch.commit();

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

/**
 * Atomically records a donation, increments donor donationCount (if completed),
 * updates donor lastDonationDate, and writes audit event in a single transaction.
 */
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
  const donorRef = doc(db, 'bloodBank', centerId, 'donors', payload.donorId);
  const { auditRef, fullEvent } = createAuditRefAndEvent(centerId, {
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
      screeningStatus: newDonation.screeningStatus,
    },
  });

  await runTransaction(db, async (tx) => {
    // 1. Transactional reads must precede writes
    const donorSnap = await tx.get(donorRef);
    if (!donorSnap.exists()) {
      throw new BloodBankValidationError(`Referenced donor ID ${payload.donorId} does not exist.`);
    }

    const currentCount = donorSnap.data().donationCount || 0;

    // 2. Transactional writes
    tx.set(donationRef, newDonation);

    if (payload.collectionStatus === 'completed') {
      tx.update(donorRef, {
        donationCount: currentCount + 1,
        lastDonationDate: payload.donationDate.split('T')[0],
        updatedAt: now,
      });
    }

    tx.set(auditRef, fullEvent);
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

/**
 * Atomically verifies originating donation session, creates inventory unit,
 * and records immutable audit log.
 */
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
  const donRef = doc(db, 'bloodBank', centerId, 'donations', newUnit.donationId);
  const { auditRef, fullEvent } = createAuditRefAndEvent(centerId, {
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

  await runTransaction(db, async (tx) => {
    // Verify originating donation exists
    const donSnap = await tx.get(donRef);
    if (!donSnap.exists()) {
      throw new BloodBankValidationError(`Referenced donation session ${newUnit.donationId} does not exist.`);
    }

    const unitExistingSnap = await tx.get(unitRef);
    if (unitExistingSnap.exists()) {
      throw new BloodBankValidationError(`Inventory unit with Barcode ID ${newUnit.id} already exists.`);
    }

    tx.set(unitRef, newUnit);
    tx.set(auditRef, fullEvent);
  });

  return newUnit;
}

/**
 * Atomically checks current unit status, verifies transition legality,
 * updates inventory unit, and appends audit log in a single transaction.
 */
export async function updateInventoryStatus(
  unitId: string,
  newStatus: InventoryUnitStatus,
  reason: string | undefined,
  actor: { uid: string; email?: string },
  centerId = DEFAULT_BLOOD_BANK_CENTER_ID
): Promise<void> {
  const cId = getCenterId(centerId);
  const unitRef = doc(db, 'bloodBank', cId, 'inventory', unitId);
  const now = new Date().toISOString();

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(unitRef);
    if (!snap.exists()) {
      throw new BloodBankValidationError(`Inventory unit with ID ${unitId} does not exist.`);
    }

    const currentUnit = snap.data() as BloodInventoryUnit;

    if (!isValidInventoryTransition(currentUnit.status, newStatus)) {
      throw new BloodBankValidationError(
        `Illegal status transition: cannot change unit status from '${currentUnit.status}' to '${newStatus}'.`
      );
    }

    const { auditRef, fullEvent } = createAuditRefAndEvent(cId, {
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

    tx.update(unitRef, {
      status: newStatus,
      statusReason: reason || null,
      updatedAt: now,
    });

    tx.set(auditRef, fullEvent);
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

/**
 * Atomically submits a blood request and records its audit log
 */
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
  const { auditRef, fullEvent } = createAuditRefAndEvent(centerId, {
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

  const batch = writeBatch(db);
  batch.set(reqRef, newRequest);
  batch.set(auditRef, fullEvent);
  await batch.commit();

  return newRequest;
}

/**
 * Atomically updates blood request status and appends audit log
 */
export async function updateRequestStatus(
  requestId: string,
  newStatus: RequestStatus,
  decisionNotes: string | undefined,
  actor: { uid: string; email?: string },
  centerId = DEFAULT_BLOOD_BANK_CENTER_ID
): Promise<void> {
  const cId = getCenterId(centerId);
  const reqRef = doc(db, 'bloodBank', cId, 'requests', requestId);
  const now = new Date().toISOString();

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists()) {
      throw new BloodBankValidationError(`Blood request with ID ${requestId} does not exist.`);
    }

    const currentReq = snap.data() as BloodRequest;
    if (!isValidRequestTransition(currentReq.status, newStatus)) {
      throw new BloodBankValidationError(
        `Invalid request status transition: cannot transition from '${currentReq.status}' to '${newStatus}'.`
      );
    }

    const { auditRef, fullEvent } = createAuditRefAndEvent(cId, {
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

    tx.update(reqRef, {
      status: newStatus,
      reviewerStaffUid: actor.uid,
      decisionNotes: decisionNotes || null,
      updatedAt: now,
    });

    tx.set(auditRef, fullEvent);
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

/**
 * Atomically validates inventory units, creates distribution record,
 * transitions inventory units, updates request fulfillment status, and appends audit log.
 */
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
  const reqRef = doc(db, 'bloodBank', centerId, 'requests', payload.requestId);
  const { auditRef, fullEvent } = createAuditRefAndEvent(centerId, {
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

  await runTransaction(db, async (tx) => {
    // 1. Transactional reads: check request and all units first
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) {
      throw new BloodBankValidationError(`Associated blood request ${payload.requestId} does not exist.`);
    }

    const reqData = reqSnap.data() as BloodRequest;

    // Terminal statuses cannot accept additional units
    if (['fulfilled', 'rejected', 'cancelled'].includes(reqData.status)) {
      throw new BloodBankValidationError(
        `Cannot issue units against request ${payload.requestId} with terminal status '${reqData.status}'.`
      );
    }

    // Ensure selected unit count does not exceed remaining quantity needed
    const previouslyFulfilled = reqData.fulfilledUnitIds || [];
    const remainingNeeded = reqData.quantityUnits - previouslyFulfilled.length;
    if (payload.issuedUnitIds.length > remainingNeeded) {
      throw new BloodBankValidationError(
        `Cannot issue ${payload.issuedUnitIds.length} units: request only requires ${remainingNeeded} more unit(s) (total ${reqData.quantityUnits}, fulfilled ${previouslyFulfilled.length}).`
      );
    }

    // Ensure selected unit IDs are strictly unique within this distribution
    const uniqueUnitIds = new Set(payload.issuedUnitIds);
    if (uniqueUnitIds.size !== payload.issuedUnitIds.length) {
      throw new BloodBankValidationError('Selected unit IDs must be unique within a distribution.');
    }

    const unitRefs = payload.issuedUnitIds.map((uId) => ({
      ref: doc(db, 'bloodBank', centerId, 'inventory', uId),
      id: uId,
    }));

    const unitSnaps = await Promise.all(unitRefs.map((u) => tx.get(u.ref)));

    for (const uSnap of unitSnaps) {
      if (!uSnap.exists()) {
        throw new BloodBankValidationError(`Selected inventory unit ${uSnap.id} does not exist.`);
      }
      const unitData = uSnap.data() as BloodInventoryUnit;

      // Status check: must be 'available' or 'reserved'
      if (unitData.status !== 'available' && unitData.status !== 'reserved') {
        throw new BloodBankValidationError(
          `Unit ${uSnap.id} is currently in '${unitData.status}' status and cannot be issued.`
        );
      }

      // Unit reserved for another request must be rejected
      if (unitData.status === 'reserved') {
        if (!unitData.reservedForRequestId || unitData.reservedForRequestId !== payload.requestId) {
          throw new BloodBankValidationError(
            `Unit ${uSnap.id} is reserved for another request (${unitData.reservedForRequestId || 'unknown'}) and cannot be issued to request ${payload.requestId}.`
          );
        }
      }
    }

    // 2. Transactional writes
    tx.set(distRef, newDistribution);

    for (const u of unitRefs) {
      tx.update(u.ref, {
        status: payload.dispatchStatus === 'delivered' ? 'transfused' : 'reserved',
        reservedForRequestId: payload.requestId,
        updatedAt: now,
      });
    }

    // Update request status based on fulfillment
    const updatedFulfilled = Array.from(new Set([...previouslyFulfilled, ...payload.issuedUnitIds]));
    const isFullyFulfilled = updatedFulfilled.length >= reqData.quantityUnits;

    tx.update(reqRef, {
      status: isFullyFulfilled ? 'fulfilled' : 'partially_fulfilled',
      fulfilledUnitIds: updatedFulfilled,
      updatedAt: now,
    });

    tx.set(auditRef, fullEvent);
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
// Aggregated Metrics (Exported from pure validation module)
// =============================================================================

export { calculateMetrics } from './validation';
