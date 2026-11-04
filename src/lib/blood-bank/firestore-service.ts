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

import { db } from '../firebase.js';
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
  event: Omit<BloodBankAuditEvent, 'id' | 'centerId' | 'timestamp'>,
  firestoreInstance = db
) {
  const auditId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const auditRef = doc(firestoreInstance, 'bloodBank', centerId, 'auditLogs', auditId);
  const fullEvent: BloodBankAuditEvent = {
    id: auditId,
    centerId,
    ...event,
    ...(event.actorEmail ? { actorEmail: event.actorEmail } : {}),
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
  actor: { uid: string; email?: string },
  firestoreInstance = db
): Promise<BloodInventoryUnit> {
  validateInventoryUnitPayload(payload);

  // Critical Issue A: New inventory units must strictly start in 'available' status
  if (payload.status !== 'available') {
    throw new BloodBankValidationError(
      `New inventory units must be created with status 'available'. Received status: '${payload.status}'.`
    );
  }

  // Critical Issue A: New inventory units cannot carry injected reservation/fulfillment metadata
  if (payload.reservedForRequestId) {
    throw new BloodBankValidationError(
      'New inventory units cannot be created with an initial reservation (reservedForRequestId must not be set).'
    );
  }

  const centerId = DEFAULT_BLOOD_BANK_CENTER_ID;
  const now = new Date().toISOString();

  const newUnit: BloodInventoryUnit = {
    ...payload,
    centerId,
    createdAt: now,
    updatedAt: now,
  };

  const unitRef = doc(firestoreInstance, 'bloodBank', centerId, 'inventory', newUnit.id);
  const donRef = doc(firestoreInstance, 'bloodBank', centerId, 'donations', newUnit.donationId);
  const { auditRef, fullEvent } = createAuditRefAndEvent(
    centerId,
    {
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
    },
    firestoreInstance
  );

  await runTransaction(firestoreInstance, async (tx) => {
    // 1. Verify originating donation exists
    const donSnap = await tx.get(donRef);
    if (!donSnap.exists()) {
      throw new BloodBankValidationError(`Referenced donation session ${newUnit.donationId} does not exist.`);
    }

    const donData = donSnap.data() as BloodDonation;

    // Critical Issue C: Verify center provenance consistency
    if (donData.centerId !== centerId) {
      throw new BloodBankValidationError(
        `Referenced donation session ${newUnit.donationId} belongs to center '${donData.centerId}', not '${centerId}'.`
      );
    }

    // Critical Issue C: Screening verification - must be 'tested_passed'
    if (donData.screeningStatus !== 'tested_passed') {
      throw new BloodBankValidationError(
        `Cannot create inventory from donation ${newUnit.donationId}: screening status is '${donData.screeningStatus}', but must be 'tested_passed'.`
      );
    }

    // Critical Issue C: Donor ID match
    if (donData.donorId !== newUnit.donorId) {
      throw new BloodBankValidationError(
        `Inventory donor ID '${newUnit.donorId}' does not match donation donor ID '${donData.donorId}'.`
      );
    }

    // Critical Issue C: Blood group match
    if (donData.bloodGroup !== newUnit.bloodGroup) {
      throw new BloodBankValidationError(
        `Inventory blood group '${newUnit.bloodGroup}' does not match donation blood group '${donData.bloodGroup}'.`
      );
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
  centerId = DEFAULT_BLOOD_BANK_CENTER_ID,
  firestoreInstance = db
): Promise<void> {
  const cId = getCenterId(centerId);
  const reqRef = doc(firestoreInstance, 'bloodBank', cId, 'requests', requestId);
  const now = new Date().toISOString();

  // Enforce single delivery path: fulfillment cannot be set manually via generic status updates
  if (newStatus === 'partially_fulfilled' || newStatus === 'fulfilled') {
    throw new BloodBankValidationError(
      `Cannot manually transition request to '${newStatus}'. Fulfillment status must be derived from confirmed clinical deliveries via deliverDistribution().`
    );
  }

  await runTransaction(firestoreInstance, async (tx) => {
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

    // Fix request cancellation with active allocations:
    // A request with non-empty allocatedUnitIds must not be cancelled while its distributions still reserve inventory.
    if (newStatus === 'cancelled') {
      const activeAllocations = currentReq.allocatedUnitIds || [];
      if (activeAllocations.length > 0) {
        throw new BloodBankValidationError(
          `Cannot cancel request ${requestId} with ${activeAllocations.length} active unit allocation(s) (${activeAllocations.join(', ')}). Active distributions must first be cancelled and inventory released before the request can be cancelled.`
        );
      }
    }

    const { auditRef, fullEvent } = createAuditRefAndEvent(
      cId,
      {
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
      },
      firestoreInstance
    );

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
  actor: { uid: string; email?: string },
  firestoreInstance = db
): Promise<BloodDistribution> {
  validateDistributionPayload(payload);

  // Enforce single delivery path: cannot create a distribution directly as delivered
  if (payload.dispatchStatus === 'delivered') {
    throw new BloodBankValidationError(
      'Distributions cannot be created directly with dispatchStatus "delivered". Create a distribution in dispatched/prepared status first, and confirm delivery exclusively via deliverDistribution().'
    );
  }

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

  const distRef = doc(firestoreInstance, 'bloodBank', centerId, 'issues', issueId);
  const reqRef = doc(firestoreInstance, 'bloodBank', centerId, 'requests', payload.requestId);
  const { auditRef, fullEvent } = createAuditRefAndEvent(
    centerId,
    {
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
    },
    firestoreInstance
  );

  await runTransaction(firestoreInstance, async (tx) => {
    // 1. Transactional reads: check request and all units first
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) {
      throw new BloodBankValidationError(`Associated blood request ${payload.requestId} does not exist.`);
    }

    const reqData = reqSnap.data() as BloodRequest;

    // Only 'approved' or 'partially_fulfilled' requests can receive units
    if (reqData.status !== 'approved' && reqData.status !== 'partially_fulfilled') {
      throw new BloodBankValidationError(
        `Cannot issue units against request ${payload.requestId} with status '${reqData.status}'. Requests must be 'approved' or 'partially_fulfilled'.`
      );
    }

    // Ensure selected unit count does not exceed remaining quantity needed
    const previouslyFulfilled = reqData.fulfilledUnitIds || [];
    const previouslyAllocated = reqData.allocatedUnitIds || [];
    const allActiveUnits = new Set([...previouslyFulfilled, ...previouslyAllocated]);
    const remainingNeeded = reqData.quantityUnits - allActiveUnits.size;
    if (payload.issuedUnitIds.length > remainingNeeded) {
      throw new BloodBankValidationError(
        `Cannot issue ${payload.issuedUnitIds.length} units: request only requires ${remainingNeeded} more unit(s) (total ${reqData.quantityUnits}, fulfilled ${previouslyFulfilled.length}, allocated ${previouslyAllocated.length}).`
      );
    }

    // Ensure selected unit IDs are strictly unique within this distribution
    const uniqueUnitIds = new Set(payload.issuedUnitIds);
    if (uniqueUnitIds.size !== payload.issuedUnitIds.length) {
      throw new BloodBankValidationError('Selected unit IDs must be unique within a distribution.');
    }

    // Ensure no selected unit is already in the request's previously issued/allocated units
    for (const uId of payload.issuedUnitIds) {
      if (allActiveUnits.has(uId)) {
        throw new BloodBankValidationError(
          `Unit ${uId} has already been allocated or issued to request ${payload.requestId}.`
        );
      }
    }

    const unitRefs = payload.issuedUnitIds.map((uId) => ({
      ref: doc(firestoreInstance, 'bloodBank', centerId, 'inventory', uId),
      id: uId,
    }));

    const unitSnaps = await Promise.all(unitRefs.map((u) => tx.get(u.ref)));

    for (const uSnap of unitSnaps) {
      if (!uSnap.exists()) {
        throw new BloodBankValidationError(`Selected inventory unit ${uSnap.id} does not exist.`);
      }
      const unitData = uSnap.data() as BloodInventoryUnit;

      // Status check: must be available. Do not create a second distribution for an already-reserved unit.
      if (unitData.status === 'reserved') {
        if (!unitData.reservedForRequestId || unitData.reservedForRequestId !== payload.requestId) {
          throw new BloodBankValidationError(
            `Unit ${uSnap.id} is reserved for another request (${unitData.reservedForRequestId || 'unknown'}) and cannot be issued to request ${payload.requestId}.`
          );
        }
        throw new BloodBankValidationError(
          `Unit ${uSnap.id} is already reserved for request ${payload.requestId}. Cannot create a second distribution for an already reserved unit; confirm delivery via deliverDistribution().`
        );
      }

      if (unitData.status !== 'available') {
        throw new BloodBankValidationError(
          `Unit ${uSnap.id} is currently in '${unitData.status}' status and cannot be issued. New distributions can only be created from available inventory units.`
        );
      }
    }

    // CLINICAL ALLOCATION COMPATIBILITY BOUNDARY:
    // Operational software manages stock reservation and lifecycle transitions.
    // Final immunological compatibility (ABO/Rh typing, crossmatching, antibody screening)
    // and blood component clinical indication verification are clinical laboratory procedures
    // performed physically by authorized laboratory personnel. Authorized staff sign-off
    // (authorizedStaffUid) and mandatory temperature log verification (temperatureLogVerified)
    // certify that staff have verified clinical compatibility and cold chain prior to dispatch.

    // 2. Transactional writes
    tx.set(distRef, newDistribution);

    // If the distribution itself is created with dispatchStatus 'cancelled',
    // units are NOT reserved or transfused, and request fulfillment counts are NOT incremented.
    if (payload.dispatchStatus === 'cancelled') {
      tx.set(auditRef, fullEvent);
      return;
    }

    // Normal dispatch / in_transit / prepared:
    // Units become reserved; request remains approved / partially_fulfilled without adding to fulfilledUnitIds!
    for (const u of unitRefs) {
      tx.update(u.ref, {
        status: 'reserved',
        reservedForRequestId: payload.requestId,
        updatedAt: now,
      });
    }
    const updatedAllocated = Array.from(new Set([...previouslyAllocated, ...payload.issuedUnitIds]));
    tx.update(reqRef, {
      allocatedUnitIds: updatedAllocated,
      updatedAt: now,
    });

    tx.set(auditRef, fullEvent);
  });

  return newDistribution;
}

/**
 * Atomically marks an existing distribution as delivered, transitions reserved inventory
 * units to transfused, and increments request fulfilledUnitIds and status.
 */
export async function deliverDistribution(
  issueId: string,
  actor: { uid: string; email?: string },
  details?: {
    deliveredAt?: string;
    notes?: string;
  },
  firestoreInstance = db,
  centerId = DEFAULT_BLOOD_BANK_CENTER_ID
): Promise<BloodDistribution> {
  const cId = getCenterId(centerId);
  const distRef = doc(firestoreInstance, 'bloodBank', cId, 'issues', issueId);
  const now = new Date().toISOString();
  let updatedDistribution: BloodDistribution | undefined;

  await runTransaction(firestoreInstance, async (tx) => {
    // 1. Read existing distribution record
    const distSnap = await tx.get(distRef);
    if (!distSnap.exists()) {
      throw new BloodBankValidationError(`Distribution record ${issueId} does not exist.`);
    }

    const distData = distSnap.data() as BloodDistribution;
    if (distData.dispatchStatus === 'delivered') {
      throw new BloodBankValidationError(`Distribution ${issueId} has already been marked as delivered.`);
    }
    if (distData.dispatchStatus === 'cancelled') {
      throw new BloodBankValidationError(`Cannot deliver cancelled distribution ${issueId}.`);
    }

    // 2. Read associated request
    const reqRef = doc(firestoreInstance, 'bloodBank', cId, 'requests', distData.requestId);
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) {
      throw new BloodBankValidationError(`Associated blood request ${distData.requestId} does not exist.`);
    }

    const reqData = reqSnap.data() as BloodRequest;
    if (reqData.status === 'rejected' || reqData.status === 'cancelled') {
      throw new BloodBankValidationError(
        `Cannot deliver distribution for request ${distData.requestId} in terminal status '${reqData.status}'.`
      );
    }

    // 3. Read all inventory units
    const unitRefs = distData.issuedUnitIds.map((uId) => ({
      ref: doc(firestoreInstance, 'bloodBank', cId, 'inventory', uId),
      id: uId,
    }));
    const unitSnaps = await Promise.all(unitRefs.map((u) => tx.get(u.ref)));

    for (const uSnap of unitSnaps) {
      if (!uSnap.exists()) {
        throw new BloodBankValidationError(`Inventory unit ${uSnap.id} does not exist.`);
      }
      const uData = uSnap.data() as BloodInventoryUnit;
      if (uData.status !== 'reserved' || uData.reservedForRequestId !== distData.requestId) {
        throw new BloodBankValidationError(
          `Unit ${uSnap.id} is in status '${uData.status}' (reserved for '${uData.reservedForRequestId || 'none'}'); only units reserved for request ${distData.requestId} can be confirmed delivered.`
        );
      }
    }

    // 4. Transactional writes
    const deliveredAt = details?.deliveredAt || now;
    const finalNotes = details?.notes !== undefined ? details.notes : (distData.notes || null);

    updatedDistribution = {
      ...distData,
      dispatchStatus: 'delivered',
      deliveredAt,
      notes: finalNotes || undefined,
      updatedAt: now,
    };

    tx.update(distRef, {
      dispatchStatus: 'delivered',
      deliveredAt,
      notes: finalNotes,
      updatedAt: now,
    });

    for (const u of unitRefs) {
      tx.update(u.ref, {
        status: 'transfused',
        reservedForRequestId: distData.requestId,
        updatedAt: now,
      });
    }

    const previouslyFulfilled = reqData.fulfilledUnitIds || [];
    const previouslyAllocated = reqData.allocatedUnitIds || [];
    const updatedFulfilled = Array.from(new Set([...previouslyFulfilled, ...distData.issuedUnitIds]));
    const updatedAllocated = previouslyAllocated.filter((id) => !distData.issuedUnitIds.includes(id));
    const isFullyFulfilled = updatedFulfilled.length >= reqData.quantityUnits;
    const newRequestStatus: RequestStatus = isFullyFulfilled ? 'fulfilled' : 'partially_fulfilled';

    tx.update(reqRef, {
      status: newRequestStatus,
      fulfilledUnitIds: updatedFulfilled,
      allocatedUnitIds: updatedAllocated,
      updatedAt: now,
    });

    const { auditRef, fullEvent } = createAuditRefAndEvent(
      cId,
      {
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole: 'blood_bank',
        action: 'DISTRIBUTION_DELIVERED',
        entity: 'distribution',
        entityId: issueId,
        statusTransition: {
          from: distData.dispatchStatus,
          to: 'delivered',
        },
        details: {
          requestId: distData.requestId,
          unitsCount: distData.issuedUnitIds.length,
          deliveredUnits: distData.issuedUnitIds,
          requestStatus: newRequestStatus,
        },
      },
      firestoreInstance
    );
    tx.set(auditRef, fullEvent);
  });

  return updatedDistribution!;
}

/**
 * Atomically cancels an in-flight distribution, releases reserved units back to available,
 * removes units from request allocatedUnitIds, and writes an audit event.
 */
export async function cancelDistribution(
  issueId: string,
  actor: { uid: string; email?: string },
  cancellationReason?: string,
  firestoreInstance = db,
  centerId = DEFAULT_BLOOD_BANK_CENTER_ID
): Promise<BloodDistribution> {
  const cId = getCenterId(centerId);
  const distRef = doc(firestoreInstance, 'bloodBank', cId, 'issues', issueId);
  const now = new Date().toISOString();
  let updatedDistribution: BloodDistribution | undefined;

  await runTransaction(firestoreInstance, async (tx) => {
    // 1. Read existing distribution
    const distSnap = await tx.get(distRef);
    if (!distSnap.exists()) {
      throw new BloodBankValidationError(`Distribution record ${issueId} does not exist.`);
    }

    const distData = distSnap.data() as BloodDistribution;
    if (distData.dispatchStatus === 'delivered') {
      throw new BloodBankValidationError(
        `Cannot cancel distribution ${issueId}: units have already been delivered/transfused.`
      );
    }
    if (distData.dispatchStatus === 'cancelled') {
      throw new BloodBankValidationError(`Distribution ${issueId} has already been cancelled.`);
    }

    // 2. Read associated request
    const reqRef = doc(firestoreInstance, 'bloodBank', cId, 'requests', distData.requestId);
    const reqSnap = await tx.get(reqRef);

    // 3. Read inventory units
    const unitRefs = distData.issuedUnitIds.map((uId) => ({
      ref: doc(firestoreInstance, 'bloodBank', cId, 'inventory', uId),
      id: uId,
    }));
    const unitSnaps = await Promise.all(unitRefs.map((u) => tx.get(u.ref)));

    // 4. Writes
    const finalNotes = cancellationReason
      ? (distData.notes ? `${distData.notes} | Cancelled: ${cancellationReason}` : `Cancelled: ${cancellationReason}`)
      : (distData.notes || null);

    updatedDistribution = {
      ...distData,
      dispatchStatus: 'cancelled',
      notes: finalNotes || undefined,
      updatedAt: now,
    };

    tx.update(distRef, {
      dispatchStatus: 'cancelled',
      notes: finalNotes,
      updatedAt: now,
    });

    for (const uSnap of unitSnaps) {
      if (uSnap.exists()) {
        const uData = uSnap.data() as BloodInventoryUnit;
        if (uData.status === 'reserved' && uData.reservedForRequestId === distData.requestId) {
          tx.update(uSnap.ref, {
            status: 'available',
            reservedForRequestId: null,
            updatedAt: now,
          });
        }
      }
    }

    if (reqSnap.exists()) {
      const reqData = reqSnap.data() as BloodRequest;
      const previouslyAllocated = reqData.allocatedUnitIds || [];
      const updatedAllocated = previouslyAllocated.filter((id) => !distData.issuedUnitIds.includes(id));
      tx.update(reqRef, {
        allocatedUnitIds: updatedAllocated,
        updatedAt: now,
      });
    }

    const { auditRef, fullEvent } = createAuditRefAndEvent(
      cId,
      {
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole: 'blood_bank',
        action: 'DISTRIBUTION_CANCELLED',
        entity: 'distribution',
        entityId: issueId,
        statusTransition: {
          from: distData.dispatchStatus,
          to: 'cancelled',
        },
        details: {
          requestId: distData.requestId,
          reason: cancellationReason || 'Cancelled by staff',
          releasedUnits: distData.issuedUnitIds,
        },
      },
      firestoreInstance
    );
    tx.set(auditRef, fullEvent);
  });

  return updatedDistribution!;
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
