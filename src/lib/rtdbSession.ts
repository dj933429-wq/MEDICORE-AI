import type { Database } from 'firebase-admin/database';

export interface FinalizeSessionOptions {
  targetSessionId?: string | null;
  expectedGeneration?: number | null;
  reason: 'explicit_logout' | 'inactivity_timeout' | 'connection_lost';
  serverTime?: string;
  serverEpoch?: number;
}

export interface FinalizeSessionResult {
  finalized: boolean;
  durationSec: number;
  totalTimeSpentSeconds: number;
  reason: string;
}

export interface SessionCreationDecision {
  isNewSession: boolean;
  reason: 'new_credential_login' | 'offline_resumption' | 'reuse_active_session' | 'inactivity_expiration';
  authTime: number | null;
}

/**
 * Evaluates whether an incoming connection should establish a new logical session
 * or reuse the existing session. Uses verified auth_time recency and prevents
 * client-side forging of login events.
 */
export function evaluateSessionCreation(
  decodedToken: { auth_time?: number; [key: string]: unknown },
  existingActivity: Record<string, unknown>,
  serverEpoch = Date.now()
): SessionCreationDecision {
  const serverEpochSec = Math.floor(serverEpoch / 1000);
  const authTime =
    typeof decodedToken.auth_time === 'number' && Number.isFinite(decodedToken.auth_time)
      ? decodedToken.auth_time
      : null;

  // Authentic credential login occurred within the last 60 seconds (with 5s clock-skew tolerance)
  const isRecentAuth =
    authTime !== null &&
    authTime <= serverEpochSec + 5 &&
    serverEpochSec - authTime <= 60;

  // Has this specific credential authentication event already been consumed for a session?
  const isNewCredentialLogin = isRecentAuth && existingActivity.lastAuthTime !== authTime;

  // Check for an active logical session within the 10-minute inactivity window
  const lastActivityEpoch = existingActivity.lastActivityAt
    ? new Date(existingActivity.lastActivityAt as string).getTime()
    : 0;
  const isWithinInactivityWindow =
    lastActivityEpoch > 0 && serverEpoch - lastActivityEpoch <= 10 * 60 * 1000;
  const hasActiveSession =
    existingActivity.currentStatus === 'online' &&
    Boolean(existingActivity.activeSessionId) &&
    isWithinInactivityWindow;

  if (isNewCredentialLogin) {
    return { isNewSession: true, reason: 'new_credential_login', authTime };
  }

  if (hasActiveSession) {
    return { isNewSession: false, reason: 'reuse_active_session', authTime };
  }

  if (existingActivity.currentStatus === 'online' && !isWithinInactivityWindow) {
    return { isNewSession: true, reason: 'inactivity_expiration', authTime };
  }

  return { isNewSession: true, reason: 'offline_resumption', authTime };
}

export interface PendingActivationRecord {
  activationId: string;
  connectionKey: string;
  sessionId: string;
  connectionGeneration?: number;
  startedAtEpoch: number;
  expiresAtEpoch: number;
  maxRenewEpoch?: number;
}

export interface VerifiedConnectionRecord {
  connectionKey: string;
  activationId: string;
  sessionId: string;
  connectionGeneration: number;
  verifiedAtEpoch: number;
}

/**
 * Checks if an activity node has any active (unexpired) pending activations.
 */
export function hasActivePendingActivation(
  pendingActivations: Record<string, PendingActivationRecord> | undefined | null,
  nowEpoch: number = Date.now()
): boolean {
  if (!pendingActivations || typeof pendingActivations !== 'object') return false;
  for (const k of Object.keys(pendingActivations)) {
    const item = pendingActivations[k];
    if (item && typeof item.expiresAtEpoch === 'number' && item.expiresAtEpoch > nowEpoch) {
      return true;
    }
  }
  return false;
}

export type PresenceStatus = 'online' | 'pending' | 'offline';

export interface ValidatedPresenceResult {
  isOnline: boolean;
  presenceStatus: PresenceStatus;
  validConnectionsCount: number;
  validConnectionKeys: string[];
  staleConnectionKeys: string[];
  hasPendingActivation: boolean;
  verifiedRegistryCount: number;
}

/**
 * Validates presence records against authoritative user activity state.
 * Eliminates raw Object.keys(presence).length trust by enforcing the Authoritative
 * Verified Connection Registry under /activity/{uid}/verifiedConnections:
 * 1. Activity status must be 'online'.
 * 2. Presence sessionId must match activeSessionId.
 * 3. Connection key must exist in the authoritative verified connection registry.
 * 4. Presence activationId must match the registry entry.
 * 5. Presence and registry connectionGeneration must be valid positive integers, match each other,
 *    and not exceed or mismatch the authoritative active activity generation.
 * 6. The presence record itself must exist and be structurally valid.
 *
 * Status Semantics:
 * - 'online': Activity is online and >= 1 verified presence connection is valid.
 * - 'pending': No verified connection exists, but an active pending activation lease exists.
 * - 'offline': Neither a valid verified connection nor an active pending lease exists.
 */
export function validateUserPresence(
  userPresence: Record<string, unknown> | null | undefined,
  userActivity: Record<string, unknown> | null | undefined,
  nowEpoch: number = Date.now()
): ValidatedPresenceResult {
  const activity = userActivity || {};
  const presence = userPresence && typeof userPresence === 'object' ? userPresence : {};
  const activeSessionId = typeof activity.activeSessionId === 'string' ? activity.activeSessionId.trim() : null;
  const isActivityOnline = activity.currentStatus === 'online' && Boolean(activeSessionId);

  const verifiedConnections =
    activity.verifiedConnections && typeof activity.verifiedConnections === 'object'
      ? (activity.verifiedConnections as Record<string, VerifiedConnectionRecord>)
      : {};

  const pendingActivations = activity.pendingActivations as Record<string, PendingActivationRecord> | undefined;
  const hasPendingActivation = hasActivePendingActivation(pendingActivations, nowEpoch);

  const validConnectionKeys: string[] = [];
  const staleConnectionKeys: string[] = [];

  const activityGen = typeof activity.connectionGeneration === 'number' && Number.isInteger(activity.connectionGeneration)
    ? activity.connectionGeneration
    : 0;
  const sessionStartGen = typeof activity.sessionStartGeneration === 'number' && Number.isInteger(activity.sessionStartGeneration)
    ? activity.sessionStartGeneration
    : 1;

  for (const connectionKey of Object.keys(presence)) {
    const conn = presence[connectionKey] as Record<string, unknown> | undefined;
    if (!conn || typeof conn !== 'object') {
      staleConnectionKeys.push(connectionKey);
      continue;
    }

    const connSessionId = typeof conn.sessionId === 'string' ? conn.sessionId.trim() : '';
    const connActivationId = typeof conn.activationId === 'string' ? conn.activationId.trim() : '';

    // Condition 1 & 2: Activity must be online and presence sessionId must match activeSessionId
    if (!isActivityOnline || !activeSessionId || connSessionId !== activeSessionId) {
      staleConnectionKeys.push(connectionKey);
      continue;
    }

    // Condition 3: Connection key must exist in the authoritative verified connection registry
    const registryEntry = verifiedConnections[connectionKey];
    if (!registryEntry || typeof registryEntry !== 'object') {
      // Unverified connection (e.g. failed Phase C, in-flight, or stale presence before rollback)
      staleConnectionKeys.push(connectionKey);
      continue;
    }

    // Condition 4: activationId must match registry entry
    const regActivationId = typeof registryEntry.activationId === 'string' ? registryEntry.activationId.trim() : '';
    if (!connActivationId || !regActivationId || connActivationId !== regActivationId) {
      staleConnectionKeys.push(connectionKey);
      continue;
    }

    // Condition 5: sessionId must match registry entry
    const regSessionId = typeof registryEntry.sessionId === 'string' ? registryEntry.sessionId.trim() : '';
    if (connSessionId !== regSessionId) {
      staleConnectionKeys.push(connectionKey);
      continue;
    }

    // Condition 6: Strict Generation Validation:
    // a. Presence connectionGeneration must be a valid positive integer
    const connGen = conn.connectionGeneration;
    if (typeof connGen !== 'number' || !Number.isInteger(connGen) || connGen <= 0) {
      staleConnectionKeys.push(connectionKey);
      continue;
    }

    // b. Registry connectionGeneration must be a valid positive integer
    const regGen = registryEntry.connectionGeneration;
    if (typeof regGen !== 'number' || !Number.isInteger(regGen) || regGen <= 0) {
      staleConnectionKeys.push(connectionKey);
      continue;
    }

    // c. Presence generation must strictly match verified registry generation
    if (connGen !== regGen) {
      staleConnectionKeys.push(connectionKey);
      continue;
    }

    // d. Registry generation must not exceed activity generation or precede session start generation
    if (regGen > activityGen || regGen < sessionStartGen) {
      staleConnectionKeys.push(connectionKey);
      continue;
    }

    // Condition 7: Connection Liveness (stale if lastSeenAt/connectedAt is older than 2 minutes = 120s)
    const rawSeen = conn.lastSeenAt || conn.connectedAt;
    if (rawSeen && typeof rawSeen === 'string') {
      const seenEpoch = new Date(rawSeen).getTime();
      if (seenEpoch > 0 && nowEpoch - seenEpoch > 120000) {
        staleConnectionKeys.push(connectionKey);
        continue;
      }
    }

    // Verified presence record is structurally valid and passed all checks!
    validConnectionKeys.push(connectionKey);
  }

  // Pure status derivation:
  // - online: Activity online and at least 1 verified connection
  // - pending: No verified connection exists, but an active pending activation lease exists
  // - offline: Neither verified connection nor pending activation lease exists
  const isOnline = isActivityOnline && validConnectionKeys.length > 0;
  let presenceStatus: PresenceStatus = 'offline';
  if (isOnline) {
    presenceStatus = 'online';
  } else if (hasPendingActivation) {
    presenceStatus = 'pending';
  }

  return {
    isOnline,
    presenceStatus,
    validConnectionsCount: validConnectionKeys.length,
    validConnectionKeys,
    staleConnectionKeys,
    hasPendingActivation,
    verifiedRegistryCount: Object.keys(verifiedConnections).length,
  };
}

/**
 * Atomically finalizes an active logical session in /activity/{uid}.
 * Uses an RTDB transaction to ensure strict idempotency:
 * - If user is already offline, no duration is added and transaction aborts.
 * - If targetSessionId is specified and does not match activeSessionId, transaction aborts.
 * - If a pending activation is in flight, transaction aborts.
 * - If expectedGeneration is provided and does not match, transaction aborts.
 * - Duration is computed once from sessionStartEpoch and added to totalTimeSpentSeconds.
 * - activeSessionId and sessionStartEpoch are cleared to prevent double-counting.
 */
export async function finalizeUserSessionAtomic(
  adminRtdb: Database,
  uid: string,
  options: FinalizeSessionOptions
): Promise<FinalizeSessionResult> {
  const serverEpoch = options.serverEpoch || Date.now();
  const serverTime = options.serverTime || new Date(serverEpoch).toISOString();
  const reason = options.reason;
  const targetSessionId = options.targetSessionId || null;

  const activityRef = adminRtdb.ref(`activity/${uid}`);
  let attemptFinalized = false;
  let computedDuration = 0;
  let computedTotal = 0;
  let activityListenerAttached = false;
  let activityHandler: ((snap: unknown) => void) | null = null;

  try {
    if (typeof activityRef.on === 'function') {
      await new Promise((resolve) => {
        activityHandler = (snap: unknown) => resolve(snap);
        activityRef.on('value', activityHandler);
      });
      activityListenerAttached = true;
    }

    const txResult = await activityRef.transaction((current) => {
      // Reset outcome variables at the start of every callback invocation
      attemptFinalized = false;
      computedDuration = 0;
      computedTotal = 0;

      if (!current) {
        return undefined; // Nothing to finalize; abort
      }

      // 1. Idempotency: If already offline, session was already finalized
      if (current.currentStatus === 'offline') {
        return undefined; // Abort cleanly
      }

      // 2. Concurrency Guard A: If there are active, unexpired pending activations,
      // a connection is currently in the middle of activating. DO NOT finalize!
      if (hasActivePendingActivation(current.pendingActivations, serverEpoch)) {
        return undefined; // Abort cleanly
      }

      // 3. Concurrency Guard B: If expectedGeneration is provided, verify generation has not advanced
      if (
        options.expectedGeneration !== undefined &&
        options.expectedGeneration !== null
      ) {
        const currentGen = typeof current.connectionGeneration === 'number' ? current.connectionGeneration : 0;
        if (currentGen !== options.expectedGeneration) {
          return undefined; // Generation advanced; abort
        }
      }

      // 4. Concurrency Guard C: If targetSessionId is provided, ensure we don't finalize a newer session
      if (targetSessionId && current.activeSessionId && current.activeSessionId !== targetSessionId) {
        return undefined; // Newer session active; abort
      }

      // 5. Compute duration exactly once
      const startEpoch = typeof current.sessionStartEpoch === 'number'
        ? current.sessionStartEpoch
        : (current.lastLoginAt ? new Date(current.lastLoginAt).getTime() : serverEpoch);

      const endEpoch = Math.max(startEpoch, serverEpoch);
      computedDuration = Math.max(0, Math.floor((endEpoch - startEpoch) / 1000));
      const priorTotal = typeof current.totalTimeSpentSeconds === 'number' ? current.totalTimeSpentSeconds : 0;
      computedTotal = priorTotal + computedDuration;

      // 6. Mutate to offline and invalidate all verified connections for this session
      current.currentStatus = 'offline';
      current.lastLogoutAt = serverTime;
      current.lastLogoutReason = reason;
      current.totalTimeSpentSeconds = computedTotal;
      current.lastActivityAt = serverTime;
      current.activeSessionId = null;
      current.sessionStartEpoch = null;
      current.verifiedConnections = {};

      attemptFinalized = true;
      return current;
    });

    const isCommitted = Boolean(txResult && txResult.committed && attemptFinalized);
    return {
      finalized: isCommitted,
      durationSec: isCommitted ? computedDuration : 0,
      totalTimeSpentSeconds: isCommitted ? computedTotal : 0,
      reason: isCommitted ? reason : 'not_finalized',
    };
  } catch {
    return {
      finalized: false,
      durationSec: 0,
      totalTimeSpentSeconds: 0,
      reason: 'transaction_failed',
    };
  } finally {
    if (activityListenerAttached && activityHandler && typeof activityRef.off === 'function') {
      activityRef.off('value', activityHandler);
    }
  }
}

/**
 * Handles deletion of a presence connection with session-matching protection.
 * Used by Cloud Functions and background reconciliation to ensure an old connection
 * deletion never terminates a newer logical session.
 */
export async function handleDeletedConnectionReconciliation(
  adminRtdb: Database,
  uid: string,
  deletedSessionId: string | null | undefined,
  serverEpoch = Date.now()
): Promise<{ finalized: boolean; reason: string }> {
  const cleanSessionId = typeof deletedSessionId === 'string' ? deletedSessionId.trim() : '';
  if (!cleanSessionId) {
    return { finalized: false, reason: 'missing_session_id' };
  }

  const presenceSnap = await adminRtdb.ref(`presence/${uid}`).once('value');
  const remaining = presenceSnap.val() || {};
  if (Object.keys(remaining).length > 0) {
    return { finalized: false, reason: 'connections_remaining' };
  }

  const res = await finalizeUserSessionAtomic(adminRtdb, uid, {
    targetSessionId: cleanSessionId,
    reason: 'connection_lost',
    serverEpoch,
  });

  return { finalized: res.finalized, reason: res.finalized ? 'connection_lost' : 'session_mismatch_or_offline' };
}

/**
 * Reconciles an orphaned presence state:
 * If /presence/{uid} has 0 active connections but /activity/{uid} is marked online,
 * automatically finalizes the session with reason 'connection_lost'.
 */
export async function reconcileOrphanedPresence(
  adminRtdb: Database,
  uid: string,
  serverEpoch = Date.now()
): Promise<FinalizeSessionResult | null> {
  const presenceSnap = await adminRtdb.ref(`presence/${uid}`).once('value');
  const presenceVal = presenceSnap.val() || {};
  const activeCount = Object.keys(presenceVal).length;

  if (activeCount > 0) {
    // Still has active connections; do not reconcile
    return null;
  }

  const activitySnap = await adminRtdb.ref(`activity/${uid}`).once('value');
  const act = activitySnap.val() || {};

  if (act.currentStatus !== 'online') {
    // Already offline
    return null;
  }

  // Do not reconcile if there are active, unexpired pending activations in flight
  if (hasActivePendingActivation(act.pendingActivations, serverEpoch)) {
    return null;
  }

  const observedGen = typeof act.connectionGeneration === 'number' ? act.connectionGeneration : 0;

  return await finalizeUserSessionAtomic(adminRtdb, uid, {
    targetSessionId: act.activeSessionId || null,
    expectedGeneration: observedGen,
    reason: 'connection_lost',
    serverEpoch,
  });
}

export interface ReserveConnectionParams {
  uid: string;
  decodedToken: { uid?: string; auth_time?: number; role?: string; [key: string]: unknown };
  serverEpoch?: number;
  role?: string;
  previousConnectionKey?: string;
}

export interface ReserveConnectionResult {
  connectionKey: string;
  sessionId: string;
  isNewSession: boolean;
  expiresAt: number;
}

export interface ActivationHooks {
  beforePresenceWrite?: (context: {
    uid: string;
    connectionKey: string;
    sessionId: string;
    activationId: string;
    expiresAtEpoch: number;
  }) => Promise<void> | void;
  afterPresenceWrite?: (context: {
    uid: string;
    connectionKey: string;
    sessionId: string;
    activationId: string;
  }) => Promise<void> | void;
  beforeRollbackCommit?: (context: {
    uid: string;
    connectionKey: string;
    activationId: string;
  }) => Promise<void> | void;
}

export interface RollbackPresenceParams {
  uid: string;
  connectionKey: string;
  activationId: string;
  beforeRollbackCommit?: (context: {
    uid: string;
    connectionKey: string;
    activationId: string;
  }) => Promise<void> | void;
}

export interface RollbackPresenceResult {
  rolledBack: boolean;
  reason: 'deleted' | 'already_absent' | 'superseded_by_newer' | 'transaction_failed';
}

/**
 * Atomically rolls back a presence record following an activation failure.
 * Executes an atomic RTDB transaction directly on /presence/{uid}/{connectionKey}:
 * - If current node matches activationId, returns null to delete it atomically.
 * - If absent, returns undefined to abort without modifying anything.
 * - If belongs to another/newer activationId, returns undefined to preserve the active connection.
 */
export async function rollbackPresenceRecord(
  adminRtdb: Database,
  params: RollbackPresenceParams
): Promise<RollbackPresenceResult> {
  const { uid, connectionKey, activationId, beforeRollbackCommit } = params;
  const presenceRef = adminRtdb.ref(`presence/${uid}/${connectionKey}`);

  let rollbackOutcome: RollbackPresenceResult['reason'] = 'already_absent';
  let sawNonEmptyState = false;

  try {
    if (beforeRollbackCommit) {
      await beforeRollbackCommit({ uid, connectionKey, activationId });
    }

    const txResult = await presenceRef.transaction((current) => {
      // In Firebase RTDB, initial callback invocation may be null before server data arrives.
      // Proposing null allows the server to compare against actual node state.
      if (!current) {
        rollbackOutcome = 'already_absent';
        return null;
      }

      sawNonEmptyState = true;
      if (current.activationId === activationId) {
        rollbackOutcome = 'deleted';
        return null; // Delete atomically
      }

      // Record belongs to another/newer activation: abort without modification
      rollbackOutcome = 'superseded_by_newer';
      return undefined;
    });

    const isCommitted = Boolean(
      txResult &&
      txResult.committed &&
      sawNonEmptyState &&
      (rollbackOutcome as string) === 'deleted'
    );
    return {
      rolledBack: isCommitted,
      reason: rollbackOutcome,
    };
  } catch {
    return {
      rolledBack: false,
      reason: 'transaction_failed',
    };
  }
}

export interface ActivateConnectionParams {
  uid: string;
  connectionKey: string;
  sessionId: string;
  serverEpoch?: number;
  serverTime?: string;
  role?: string;
  hooks?: ActivationHooks;
}

export interface ActivateConnectionResult {
  activated: boolean;
  alreadyActive?: boolean;
  connectionKey: string;
  sessionId: string;
  connectionGeneration: number;
  activationId?: string;
  reason?: string;
}

/**
 * Phase 1 of connection handshake:
 * Reserves a server-generated connection key and resolves the logical session
 * WITHOUT creating an active record under /presence/{uid}/{connectionKey}.
 * The reservation is stored with a 60-second TTL under /reservations/{uid}/{connectionKey}.
 */
export async function reserveConnection(
  adminRtdb: Database,
  params: ReserveConnectionParams
): Promise<ReserveConnectionResult> {
  const uid = params.uid;
  const serverEpoch = params.serverEpoch || Date.now();

  // If this tab refreshed or reconnected with a previousConnectionKey, prune the old connection
  if (params.previousConnectionKey && typeof params.previousConnectionKey === 'string') {
    const prevKey = params.previousConnectionKey.trim();
    if (prevKey) {
      await Promise.all([
        adminRtdb.ref(`presence/${uid}/${prevKey}`).remove().catch(() => {}),
        adminRtdb.ref(`activity/${uid}/verifiedConnections/${prevKey}`).remove().catch(() => {}),
        adminRtdb.ref(`reservations/${uid}/${prevKey}`).remove().catch(() => {}),
      ]);
    }
  }

  const activitySnap = await adminRtdb.ref(`activity/${uid}`).once('value');
  const existingActivity = activitySnap.val() || {};

  const decision = evaluateSessionCreation(params.decodedToken, existingActivity, serverEpoch);
  const isNewSession = decision.isNewSession;
  const authTime = decision.authTime;

  let sessionId: string;
  if (!isNewSession && existingActivity.activeSessionId) {
    sessionId = existingActivity.activeSessionId as string;
  } else {
    sessionId = `sess_${serverEpoch}_${Math.random().toString(36).substring(2, 9)}`;
    if (existingActivity.currentStatus === 'online' && existingActivity.activeSessionId) {
      await finalizeUserSessionAtomic(adminRtdb, uid, {
        targetSessionId: existingActivity.activeSessionId as string,
        reason: decision.reason === 'new_credential_login' ? 'explicit_logout' : 'inactivity_timeout',
        serverEpoch,
      });
    }
  }

  const connectionKey = `conn_${serverEpoch}_${Math.random().toString(36).substring(2, 9)}`;
  const expiresAt = serverEpoch + 60000; // 60s reservation window

  await adminRtdb.ref(`reservations/${uid}/${connectionKey}`).set({
    sessionId,
    reservedAt: serverEpoch,
    expiresAt,
    role: params.role || (params.decodedToken.role as string) || 'patient',
    isNewSession,
    authTime,
  });

  return {
    connectionKey,
    sessionId,
    isNewSession,
    expiresAt,
  };
}

/**
 * Phase 2 of connection handshake:
 * Called ONLY AFTER the client has successfully registered onDisconnect(ref).remove()
 * on its RTDB socket.
 *
 * Implements atomic 3-step pending-activation protocol:
 * Phase A (Pending Registration): Atomically registers unique activationId under
 *         /activity/{uid}/pendingActivations/{connectionKey} (15s TTL), sets online, and advances generation.
 * Phase B (Presence Creation): Server writes /presence/{uid}/{connectionKey} via Admin SDK.
 * Phase C (Completion): Atomically verifies matching activationId, clears pending entry,
 *         and confirms activation.
 */
export async function activateConnection(
  adminRtdb: Database,
  params: ActivateConnectionParams
): Promise<ActivateConnectionResult> {
  const uid = params.uid;
  const connectionKey = params.connectionKey;
  const sessionId = params.sessionId;
  const serverEpoch = params.serverEpoch || Date.now();
  const serverTime = params.serverTime || new Date(serverEpoch).toISOString();

  if (!connectionKey || !/^conn_[a-zA-Z0-9_-]+$/.test(connectionKey)) {
    return {
      activated: false,
      connectionKey,
      sessionId,
      connectionGeneration: 0,
      reason: 'invalid_connection_key',
    };
  }

  // Idempotency: if already active in presence with matching sessionId, return success
  const existingPresenceSnap = await adminRtdb.ref(`presence/${uid}/${connectionKey}`).once('value');
  if (existingPresenceSnap.exists()) {
    const pVal = existingPresenceSnap.val();
    if (pVal && pVal.sessionId === sessionId) {
      const actSnap = await adminRtdb.ref(`activity/${uid}`).once('value');
      const gen = (actSnap.val()?.connectionGeneration as number) || 1;
      return {
        activated: true,
        alreadyActive: true,
        connectionKey,
        sessionId,
        connectionGeneration: gen,
      };
    }
  }

  // Verify reservation exists and is valid
  const reservationRef = adminRtdb.ref(`reservations/${uid}/${connectionKey}`);
  const reservationSnap = await reservationRef.once('value');
  if (!reservationSnap.exists()) {
    return {
      activated: false,
      connectionKey,
      sessionId,
      connectionGeneration: 0,
      reason: 'reservation_not_found',
    };
  }

  const reservation = reservationSnap.val();
  if (reservation.sessionId !== sessionId) {
    return {
      activated: false,
      connectionKey,
      sessionId,
      connectionGeneration: 0,
      reason: 'session_mismatch',
    };
  }

  if (serverEpoch > reservation.expiresAt) {
    await reservationRef.remove().catch(() => {});
    return {
      activated: false,
      connectionKey,
      sessionId,
      connectionGeneration: 0,
      reason: 'reservation_expired',
    };
  }

  const role = params.role || reservation.role || 'patient';
  const isNewSession = Boolean(reservation.isNewSession);
  const authTime = reservation.authTime;

  // Generate unique activationId with 15-second TTL and 30-second max renewal ceiling
  const activationId = `act_${serverEpoch}_${Math.random().toString(36).substring(2, 9)}`;
  const activationTtlMs = 15000;
  const maxActivationDurationMs = 30000;

  const activityRef = adminRtdb.ref(`activity/${uid}`);
  let newGeneration = 1;
  let resolvedExpiresAtEpoch = serverEpoch + activationTtlMs;
  let activityListenerAttached = false;
  const activityHandler = () => {};

  try {
    // Maintain an active listener so local repo cache stays synced across Phase A, B, and C
    if (typeof activityRef.on === 'function') {
      activityRef.on('value', activityHandler);
      activityListenerAttached = true;
    }

  // Phase A: Register pending activation and advance generation atomically
  await activityRef.transaction((current) => {
    if (!current) {
      current = {
        totalTimeSpentSeconds: 0,
        connectionGeneration: 0,
      };
    }

    if (!current.pendingActivations || typeof current.pendingActivations !== 'object') {
      current.pendingActivations = {};
    }

    // Clean up any pending activations that have exceeded their max renewal ceiling
    for (const k of Object.keys(current.pendingActivations)) {
      const item = current.pendingActivations[k];
      const ceiling = typeof item?.maxRenewEpoch === 'number' ? item.maxRenewEpoch : item?.expiresAtEpoch;
      if (typeof ceiling === 'number' && ceiling <= serverEpoch) {
        delete current.pendingActivations[k];
      }
    }

    // Bounded renewal: preserve initial maxRenewEpoch across retries within the ceiling
    const existingPending = current.pendingActivations[connectionKey];
    const maxRenewEpoch =
      typeof existingPending?.maxRenewEpoch === 'number' && serverEpoch < existingPending.maxRenewEpoch
        ? existingPending.maxRenewEpoch
        : serverEpoch + maxActivationDurationMs;
    const tentativeExpires = serverEpoch + activationTtlMs;
    resolvedExpiresAtEpoch = Math.min(tentativeExpires, maxRenewEpoch);

    const currentGen = typeof current.connectionGeneration === 'number' ? current.connectionGeneration : 0;
    newGeneration = currentGen + 1;

    // Register this connection key's pending activation with authoritative generation
    current.pendingActivations[connectionKey] = {
      activationId,
      connectionKey,
      sessionId,
      connectionGeneration: newGeneration,
      startedAtEpoch: serverEpoch,
      expiresAtEpoch: resolvedExpiresAtEpoch,
      maxRenewEpoch,
    };

    current.connectionGeneration = newGeneration;
    current.currentStatus = 'online';
    current.lastActivityAt = serverTime;
    current.activeRole = role;
    current.lastLogoutReason = null;
    current.activeSessionId = sessionId;

    if (isNewSession || current.activeSessionId !== sessionId || typeof current.sessionStartGeneration !== 'number') {
      current.lastLoginAt = serverTime;
      current.sessionStartEpoch = serverEpoch;
      current.sessionStartGeneration = newGeneration;
      current.verifiedConnections = {};
      if (authTime !== null && authTime !== undefined) {
        current.lastAuthTime = authTime;
      }
      if (typeof current.totalTimeSpentSeconds !== 'number') {
        current.totalTimeSpentSeconds = 0;
      }
    }

    return current;
  });

  // Deterministic testing barrier: invoke beforePresenceWrite hook if provided
  if (params.hooks?.beforePresenceWrite) {
    await params.hooks.beforePresenceWrite({
      uid,
      connectionKey,
      sessionId,
      activationId,
      expiresAtEpoch: resolvedExpiresAtEpoch,
    });

    // Pre-write atomic verification: verify lease not expired, not superseded, session not changed, and still online
    let attemptPreWritePassed = false;
    let preWriteFailReason = '';

    const preWriteRes = await activityRef.transaction((current) => {
      attemptPreWritePassed = false;
      preWriteFailReason = '';

      if (!current) {
        preWriteFailReason = 'activity_missing';
        return current;
      }

      const pending = current.pendingActivations?.[connectionKey];
      if (!pending || pending.activationId !== activationId) {
        preWriteFailReason = 'activation_superseded';
        return current;
      }

      if (Date.now() > pending.expiresAtEpoch) {
        preWriteFailReason = 'activation_lease_expired';
        delete current.pendingActivations[connectionKey];
        return current;
      }

      if (current.activeSessionId !== sessionId) {
        preWriteFailReason = 'session_changed';
        delete current.pendingActivations[connectionKey];
        return current;
      }

      if (current.currentStatus !== 'online') {
        preWriteFailReason = 'session_offline';
        delete current.pendingActivations[connectionKey];
        return current;
      }

      attemptPreWritePassed = true;
      return current;
    });

    const preWriteValid = Boolean(preWriteRes && preWriteRes.committed && attemptPreWritePassed);
    if (!preWriteValid) {
      return {
        activated: false,
        connectionKey,
        sessionId,
        connectionGeneration: newGeneration,
        reason: preWriteFailReason || 'pre_write_failed',
      };
    }
  }

  // Phase B: Create active presence record under /presence/{uid}/{connectionKey}
  const presenceRef = adminRtdb.ref(`presence/${uid}/${connectionKey}`);
  try {
    await presenceRef.set({
      connectedAt: serverTime,
      lastSeenAt: serverTime,
      role,
      sessionId,
      activationId,
      connectionGeneration: newGeneration,
    });
  } catch (presenceErr) {
    // Rollback pending activation on presence creation failure so session is not blocked
    await activityRef.transaction((current) => {
      if (current?.pendingActivations?.[connectionKey]?.activationId === activationId) {
        delete current.pendingActivations[connectionKey];
      }
      return current;
    }).catch(() => {});
    throw presenceErr;
  }

  // Deterministic testing barrier: invoke afterPresenceWrite hook if provided
  if (params.hooks?.afterPresenceWrite) {
    await params.hooks.afterPresenceWrite({
      uid,
      connectionKey,
      sessionId,
      activationId,
    });
  }

  // Phase C: Atomic Post-Write Fencing and Verification Transaction
  let attemptFencePassed = false;
  let fenceFailureReason = '';
  let txCommitted = false;
  let committedGen = newGeneration;

  try {
    const txResult = await activityRef.transaction((current) => {
      // Reset outcome for this callback attempt
      attemptFencePassed = false;
      fenceFailureReason = '';

      if (!current) {
        fenceFailureReason = 'activity_missing';
        return undefined; // Abort cleanly
      }

      // Invariant 1: Pending activation must match our unique activationId (not superseded)
      const pending = current.pendingActivations?.[connectionKey];
      if (!pending || pending.activationId !== activationId) {
        fenceFailureReason = 'activation_superseded';
        return undefined; // Abort cleanly
      }

      // Invariant 2: Pending activation lease must not be expired
      const postWriteNow = Date.now();
      if (postWriteNow > pending.expiresAtEpoch) {
        fenceFailureReason = 'activation_lease_expired';
        delete current.pendingActivations[connectionKey];
        return current;
      }

      // Invariant 3: Active session must still match our sessionId
      if (current.activeSessionId !== sessionId) {
        fenceFailureReason = 'session_changed';
        delete current.pendingActivations[connectionKey];
        return current;
      }

      // Invariant 4: Current status must still be 'online'
      if (current.currentStatus !== 'online') {
        fenceFailureReason = 'session_offline';
        delete current.pendingActivations[connectionKey];
        return current;
      }

      // All 4 invariants verified! Clear pending activation and confirm online
      delete current.pendingActivations[connectionKey];
      current.currentStatus = 'online';
      current.lastActivityAt = serverTime;

      // Authoritative generation: retrieve from pending activation record established in Phase A
      const authoritativeGen = typeof pending.connectionGeneration === 'number'
        ? pending.connectionGeneration
        : newGeneration;
      committedGen = authoritativeGen;

      // Authoritative Verified Connection Registry: atomically register this connection
      if (!current.verifiedConnections || typeof current.verifiedConnections !== 'object') {
        current.verifiedConnections = {};
      }
      current.verifiedConnections[connectionKey] = {
        connectionKey,
        activationId,
        sessionId,
        connectionGeneration: authoritativeGen,
        verifiedAtEpoch: postWriteNow,
      };

      attemptFencePassed = true;
      return current;
    }, undefined, false);

    txCommitted = Boolean(txResult && txResult.committed && attemptFencePassed);
  } catch {
    txCommitted = false;
    fenceFailureReason = 'transaction_failed';
  }

  // Compensating Rollback: If transaction did not commit or fence failed, remove presence record atomically
  if (!txCommitted) {
    await rollbackPresenceRecord(adminRtdb, {
      uid,
      connectionKey,
      activationId,
      beforeRollbackCommit: params.hooks?.beforeRollbackCommit,
    });

    return {
      activated: false,
      connectionKey,
      sessionId,
      connectionGeneration: committedGen,
      reason: fenceFailureReason || 'activation_fence_failed',
    };
  }

  // Phase D: Remove the consumed reservation
  await reservationRef.remove().catch(() => {});

  return {
    activated: true,
    connectionKey,
    sessionId,
    connectionGeneration: committedGen,
    activationId,
  };
  } finally {
    if (activityListenerAttached && activityHandler && typeof activityRef.off === 'function') {
      activityRef.off('value', activityHandler);
    }
  }
}
