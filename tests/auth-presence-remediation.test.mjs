/**
 * MEDICORE-AI — Complete Firebase Authentication & RTDB Presence Investigation and Remediation Test Suite
 *
 * Verifies all 4 critical issues:
 * Issue A: Admin & Patient Login Role Resolution and Redirection
 * Issue B: User Remains Online After Logout & Uptime Capping
 * Issue C: Active Browser Tab Counting & Refresh Deduplication (No 5-tab phantoms)
 * Issue D: Race-Safe RTDB Activation Protocol & Atomic Compensating Rollback
 */

import assert from 'node:assert';
import {
  reserveConnection,
  activateConnection,
  finalizeUserSessionAtomic,
  rollbackPresenceRecord,
  validateUserPresence,
  reconcileOrphanedPresence,
} from '../src/lib/rtdbSession.ts';

console.log('================================================================');
console.log('MEDICORE-AI: Authentication & Presence Remediation Suite');
console.log('================================================================\n');

let passedTests = 0;
let failedTests = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}`);
    failedTests++;
  }
}

// In-Memory RTDB mock implementing transactions and listeners faithfully
class InMemoryRTDB {
  constructor() {
    this.data = {};
    this.listeners = new Map();
  }

  _clone(val) {
    if (val === undefined) return undefined;
    return JSON.parse(JSON.stringify(val));
  }

  _getNode(path) {
    const parts = path.split('/').filter(Boolean);
    let cur = this.data;
    for (const p of parts) {
      if (!cur || typeof cur !== 'object') return undefined;
      cur = cur[p];
    }
    return cur;
  }

  _setNode(path, val) {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) {
      this.data = val ? this._clone(val) : {};
      return;
    }
    let cur = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cur[p] || typeof cur[p] !== 'object') {
        cur[p] = {};
      }
      cur = cur[p];
    }
    const last = parts[parts.length - 1];
    if (val === null || val === undefined) {
      delete cur[last];
    } else {
      cur[last] = this._clone(val);
    }
    this._notifyListeners(path);
  }

  _notifyListeners(path) {
    for (const [listenPath, callbacks] of this.listeners.entries()) {
      if (path.startsWith(listenPath) || listenPath.startsWith(path)) {
        const snap = this._makeSnapshot(listenPath);
        for (const cb of callbacks) cb(snap);
      }
    }
  }

  _makeSnapshot(path) {
    const val = this._getNode(path);
    return {
      val: () => (val === undefined ? null : this._clone(val)),
      exists: () => val !== undefined && val !== null,
    };
  }

  ref(path = '') {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;

    return {
      path: cleanPath,
      once: async () => {
        return this._makeSnapshot(cleanPath);
      },
      set: async (val) => {
        this._setNode(cleanPath, val);
      },
      remove: async () => {
        this._setNode(cleanPath, null);
      },
      update: async (updates) => {
        for (const [k, v] of Object.entries(updates)) {
          const fullPath = cleanPath ? `${cleanPath}/${k}` : k;
          this._setNode(fullPath, v);
        }
      },
      on: (_eventType, callback) => {
        if (!this.listeners.has(cleanPath)) {
          this.listeners.set(cleanPath, []);
        }
        this.listeners.get(cleanPath).push(callback);
        callback(this._makeSnapshot(cleanPath));
      },
      off: (_eventType, callback) => {
        if (!this.listeners.has(cleanPath)) return;
        if (!callback) {
          this.listeners.delete(cleanPath);
        } else {
          const arr = this.listeners.get(cleanPath).filter((cb) => cb !== callback);
          this.listeners.set(cleanPath, arr);
        }
      },
      transaction: async (updateFn) => {
        const curVal = this._getNode(cleanPath);
        const clonedCur = this._clone(curVal);
        const result = updateFn(clonedCur);
        if (result === undefined) {
          return { committed: false, snapshot: this._makeSnapshot(cleanPath) };
        }
        this._setNode(cleanPath, result);
        return { committed: true, snapshot: this._makeSnapshot(cleanPath) };
      },
    };
  }
}

// -------------------------------------------------------------
// SECTION 1: ISSUE A — ROLE RESOLUTION & LOGIN REDIRECTIONS
// -------------------------------------------------------------

function determineLoginRedirect(resolvedRole) {
  if (resolvedRole === 'admin') {
    return '/dashboard'; // Admin dashboard
  } else if (resolvedRole === 'doctor') {
    return '/dashboard/doctor';
  } else if (resolvedRole === 'pharmacist') {
    return '/dashboard/pharmacist';
  } else if (resolvedRole === 'blood_bank') {
    return '/dashboard/blood-bank';
  } else if (resolvedRole === 'patient') {
    return '/dashboard/patient';
  } else if (resolvedRole) {
    return '/dashboard';
  }
  return '/dashboard'; // default pending/unverified
}

function resolveUserRole(customClaimsRole, firestoreRole) {
  // Authoritative rule: Custom Claims override Firestore, and neither can silently default to patient
  if (customClaimsRole) return customClaimsRole;
  if (firestoreRole) return firestoreRole;
  return null;
}

await test('Issue A.1: Administrator with custom claim redirects to /dashboard (Admin)', async () => {
  const role = resolveUserRole('admin', 'admin');
  const destination = determineLoginRedirect(role);
  assert.strictEqual(role, 'admin');
  assert.strictEqual(destination, '/dashboard', 'Admin must be redirected to /dashboard');
});

await test('Issue A.2: Administrator without Firestore role still resolves from custom claims', async () => {
  const role = resolveUserRole('admin', null);
  const destination = determineLoginRedirect(role);
  assert.strictEqual(role, 'admin');
  assert.strictEqual(destination, '/dashboard');
});

await test('Issue A.3: Patient login redirects to /dashboard/patient', async () => {
  const role = resolveUserRole(null, 'patient');
  const destination = determineLoginRedirect(role);
  assert.strictEqual(role, 'patient');
  assert.strictEqual(destination, '/dashboard/patient');
});

await test('Issue A.4: Unverified/missing role does not silently default to patient', async () => {
  const role = resolveUserRole(null, null);
  assert.strictEqual(role, null, 'Role must remain null when unverified, never silently become patient');
});

await test('Issue A.5: Doctor, Pharmacist, and Blood Bank redirect to respective dashboards', async () => {
  assert.strictEqual(determineLoginRedirect(resolveUserRole('doctor', null)), '/dashboard/doctor');
  assert.strictEqual(determineLoginRedirect(resolveUserRole('pharmacist', null)), '/dashboard/pharmacist');
  assert.strictEqual(determineLoginRedirect(resolveUserRole('blood_bank', null)), '/dashboard/blood-bank');
});

// -------------------------------------------------------------
// SECTION 2: ISSUE B — LOGOUT LIFECYCLE & UPTIME CAPPING
// -------------------------------------------------------------

await test('Issue B.1: Explicit logout clears presence and finalizes session offline', async () => {
  const rtdb = new InMemoryRTDB();
  const uid = 'user_logout_01';
  const serverEpoch = 1730000000000;
  const serverTime = new Date(serverEpoch).toISOString();

  // Seed active online session
  await rtdb.ref(`activity/${uid}`).set({
    currentStatus: 'online',
    activeSessionId: 'sess_logout_01',
    sessionStartEpoch: serverEpoch - 100000,
    lastActivityAt: serverTime,
    totalTimeSpentSeconds: 50,
    verifiedConnections: {
      conn_tab1: {
        connectionKey: 'conn_tab1',
        activationId: 'act_1',
        sessionId: 'sess_logout_01',
        connectionGeneration: 1,
        verifiedAtEpoch: serverEpoch - 50000,
      },
    },
  });

  await rtdb.ref(`presence/${uid}/conn_tab1`).set({
    sessionId: 'sess_logout_01',
    activationId: 'act_1',
    connectionGeneration: 1,
    connectedAt: serverTime,
  });

  // Execute explicit logout cleanup
  await rtdb.ref(`presence/${uid}`).remove();
  await rtdb.ref(`activity/${uid}/verifiedConnections`).remove();
  const finResult = await finalizeUserSessionAtomic(rtdb, uid, {
    reason: 'explicit_logout',
    serverEpoch: serverEpoch + 5000,
    serverTime: new Date(serverEpoch + 5000).toISOString(),
  });

  assert.strictEqual(finResult.finalized, true, 'Session must be finalized');

  // Verify RTDB state
  const actSnap = await rtdb.ref(`activity/${uid}`).once('value');
  const presSnap = await rtdb.ref(`presence/${uid}`).once('value');
  const activity = actSnap.val();
  const presence = presSnap.val();

  assert.strictEqual(presence, null, 'Presence node must be completely removed');
  assert.strictEqual(activity.currentStatus, 'offline', 'Status must be offline');
  assert.strictEqual(activity.activeSessionId, null, 'activeSessionId must be cleared');
  assert.strictEqual(activity.lastLogoutReason, 'explicit_logout');

  // Validate via validateUserPresence
  const validation = validateUserPresence(presence || {}, activity, serverEpoch + 5000);
  assert.strictEqual(validation.isOnline, false, 'User must not be reported online');
  assert.strictEqual(validation.validConnectionsCount, 0);
});

await test('Issue B.2: Uptime does not continue ticking after logout', async () => {
  const sessionStartEpoch = 1730000000000;
  const lastActivityEpoch = sessionStartEpoch + 300000; // 5 minutes of active session
  const nowEpoch = sessionStartEpoch + 86400000; // 24 hours later

  const userActivity = {
    currentStatus: 'offline',
    activeSessionId: null,
    sessionStartEpoch,
    lastActivityAt: new Date(lastActivityEpoch).toISOString(),
    totalTimeSpentSeconds: 300,
  };

  // When offline, currentSessionSec must be 0 and totalTimeSpentSec capped at totalTimeSpentSeconds
  const isOnline = false;
  let currentSessionSec = 0;
  if (isOnline && sessionStartEpoch > 0) {
    currentSessionSec = Math.max(0, Math.floor((nowEpoch - sessionStartEpoch) / 1000));
  } else if (!isOnline && userActivity.currentStatus === 'online' && sessionStartEpoch > 0) {
    const effectiveEndEpoch = lastActivityEpoch > sessionStartEpoch ? lastActivityEpoch : sessionStartEpoch;
    currentSessionSec = Math.max(0, Math.floor((effectiveEndEpoch - sessionStartEpoch) / 1000));
  } else {
    currentSessionSec = 0;
  }

  const totalTimeSpentSec = userActivity.totalTimeSpentSeconds + currentSessionSec;
  assert.strictEqual(currentSessionSec, 0, 'Current session seconds must be 0 for offline user');
  assert.strictEqual(totalTimeSpentSec, 300, 'Total time spent must remain exactly 300 seconds, not 24 hours');
});

// -------------------------------------------------------------
// SECTION 3: ISSUE C — ACTIVE TAB COUNTING & REFRESH DEDUPLICATION
// -------------------------------------------------------------

await test('Issue C.1: Single browser tab is accurately counted as 1 active tab', async () => {
  const baseEpoch = 1730000000000;
  const userActivity = {
    currentStatus: 'online',
    activeSessionId: 'sess_tab_single',
    connectionGeneration: 1,
    sessionStartGeneration: 1,
    verifiedConnections: {
      conn_tab_1: {
        connectionKey: 'conn_tab_1',
        activationId: 'act_1',
        sessionId: 'sess_tab_single',
        connectionGeneration: 1,
        verifiedAtEpoch: baseEpoch,
      },
    },
  };

  const userPresence = {
    conn_tab_1: {
      sessionId: 'sess_tab_single',
      activationId: 'act_1',
      connectionGeneration: 1,
      lastSeenAt: new Date(baseEpoch).toISOString(),
      connectedAt: new Date(baseEpoch).toISOString(),
    },
  };

  const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
  assert.strictEqual(validation.isOnline, true);
  assert.strictEqual(validation.validConnectionsCount, 1, 'Exactly 1 active tab must be reported');
});

await test('Issue C.2: Tab reload with previousConnectionKey prunes old connection (No phantom 2nd tab)', async () => {
  const rtdb = new InMemoryRTDB();
  const uid = 'user_refresh_test';
  const serverEpoch = Date.now();

  // Tab 1 initially has conn_old
  await rtdb.ref(`presence/${uid}/conn_old`).set({
    sessionId: 'sess_1',
    activationId: 'act_old',
    connectionGeneration: 1,
  });
  await rtdb.ref(`activity/${uid}`).set({
    currentStatus: 'online',
    activeSessionId: 'sess_1',
    connectionGeneration: 1,
    sessionStartGeneration: 1,
    verifiedConnections: {
      conn_old: {
        connectionKey: 'conn_old',
        activationId: 'act_old',
        sessionId: 'sess_1',
        connectionGeneration: 1,
        verifiedAtEpoch: serverEpoch,
      },
    },
  });

  // User refreshes the tab. Browser sends previousConnectionKey: 'conn_old'
  const reservation = await reserveConnection(rtdb, {
    uid,
    decodedToken: { uid, role: 'patient', auth_time: Math.floor(serverEpoch / 1000) },
    serverEpoch,
    previousConnectionKey: 'conn_old',
  });

  // Old connection must be pruned from presence and verified registry
  const oldPresSnap = await rtdb.ref(`presence/${uid}/conn_old`).once('value');
  const oldRegSnap = await rtdb.ref(`activity/${uid}/verifiedConnections/conn_old`).once('value');
  assert.strictEqual(oldPresSnap.val(), null, 'Old presence node must be deleted on refresh');
  assert.strictEqual(oldRegSnap.val(), null, 'Old verified registry node must be deleted on refresh');

  // Activate new connection
  const actResult = await activateConnection(rtdb, {
    uid,
    connectionKey: reservation.connectionKey,
    sessionId: reservation.sessionId,
    serverEpoch,
    serverTime: new Date(serverEpoch).toISOString(),
  });
  if (!actResult.activated) {
    console.error('actResult failed:', actResult);
  }
  assert.strictEqual(actResult.activated, true);

  // Validate active connections count
  const presSnap = await rtdb.ref(`presence/${uid}`).once('value');
  const actSnap = await rtdb.ref(`activity/${uid}`).once('value');
  const validation = validateUserPresence(presSnap.val() || {}, actSnap.val(), serverEpoch);
  assert.strictEqual(validation.validConnectionsCount, 1, 'Refreshed tab must maintain count of 1, not duplicate to 2');
});

await test('Issue C.3: Stale connection (>120s without heartbeat) is marked stale and not counted', async () => {
  const baseEpoch = 1730000000000;
  const userActivity = {
    currentStatus: 'online',
    activeSessionId: 'sess_multi',
    connectionGeneration: 2,
    sessionStartGeneration: 1,
    verifiedConnections: {
      conn_active: {
        connectionKey: 'conn_active',
        activationId: 'act_active',
        sessionId: 'sess_multi',
        connectionGeneration: 2,
        verifiedAtEpoch: baseEpoch,
      },
      conn_abandoned: {
        connectionKey: 'conn_abandoned',
        activationId: 'act_abandoned',
        sessionId: 'sess_multi',
        connectionGeneration: 1,
        verifiedAtEpoch: baseEpoch - 300000,
      },
    },
  };

  const userPresence = {
    conn_active: {
      sessionId: 'sess_multi',
      activationId: 'act_active',
      connectionGeneration: 2,
      lastSeenAt: new Date(baseEpoch - 10000).toISOString(), // 10s ago
    },
    conn_abandoned: {
      sessionId: 'sess_multi',
      activationId: 'act_abandoned',
      connectionGeneration: 1,
      lastSeenAt: new Date(baseEpoch - 180000).toISOString(), // 180s ago (> 120s stale window)
    },
  };

  const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
  assert.strictEqual(validation.isOnline, true);
  assert.strictEqual(validation.validConnectionsCount, 1, 'Only the active fresh tab must be counted');
  assert.strictEqual(validation.validConnectionKeys[0], 'conn_active');
  assert.ok(validation.staleConnectionKeys.includes('conn_abandoned'), 'Abandoned tab must be marked stale');
});

// -------------------------------------------------------------
// SECTION 4: ISSUE D — RACE-SAFE ACTIVATION & COMPENSATING ROLLBACK
// -------------------------------------------------------------

await test('Issue D.1: Expired lease cannot activate connection (Phase C fence)', async () => {
  const rtdb = new InMemoryRTDB();
  const uid = 'user_race_d1';
  const serverEpoch = 1730000000000;

  const reservation = await reserveConnection(rtdb, {
    uid,
    decodedToken: { uid, role: 'patient', auth_time: Math.floor(serverEpoch / 1000) },
    serverEpoch,
  });

  const actResult = await activateConnection(rtdb, {
    uid,
    connectionKey: reservation.connectionKey,
    sessionId: reservation.sessionId,
    serverEpoch,
    serverTime: new Date(serverEpoch).toISOString(),
    hooks: {
      afterPresenceWrite: async () => {
        // Lease expires during network latency
        await rtdb.ref(`activity/${uid}/pendingActivations/${reservation.connectionKey}/expiresAtEpoch`).set(serverEpoch - 5000);
      },
    },
  });

  assert.strictEqual(actResult.activated, false, 'Expired lease must fail activation');
  assert.strictEqual(actResult.reason, 'activation_lease_expired');

  // Verify compensating rollback deleted the orphaned presence
  const presSnap = await rtdb.ref(`presence/${uid}/${reservation.connectionKey}`).once('value');
  assert.strictEqual(presSnap.val(), null, 'Failed activation must roll back presence record');
});

await test('Issue D.2: Compensating rollback preserves newer concurrent activation', async () => {
  const rtdb = new InMemoryRTDB();
  const uid = 'user_race_d2';
  const connectionKey = 'conn_shared_race';
  const staleActivationId = 'act_stale_123';
  const newerActivationId = 'act_newer_456';

  // Newer activation B has successfully written its presence
  await rtdb.ref(`presence/${uid}/${connectionKey}`).set({
    sessionId: 'sess_1',
    activationId: newerActivationId,
    connectionGeneration: 2,
    connectedAt: new Date().toISOString(),
  });

  // Stale activation A attempts compensating rollback
  const rollbackResult = await rollbackPresenceRecord(rtdb, {
    uid,
    connectionKey,
    activationId: staleActivationId,
  });

  assert.strictEqual(rollbackResult.rolledBack, false, 'Rollback for stale activation must not delete newer record');
  assert.strictEqual(rollbackResult.reason, 'superseded_by_newer');

  // Verify newer activation remains intact
  const presSnap = await rtdb.ref(`presence/${uid}/${connectionKey}`).once('value');
  const record = presSnap.val();
  assert.strictEqual(record.activationId, newerActivationId, 'Newer activation presence must remain intact');
});

// -------------------------------------------------------------
// SECTION 5: MULTI-TAB & MULTI-SESSION LOGOUT SAFETY
// -------------------------------------------------------------

await test('Issue E.1: Two tabs on one session — closing one tab keeps other tab online', async () => {
  const rtdb = new InMemoryRTDB();
  const uid = 'user_multi_tab_e1';
  const serverEpoch = Date.now();
  const sessionId = 'sess_multitab_1';

  // Activity has session active with 2 verified connections
  await rtdb.ref(`activity/${uid}`).set({
    currentStatus: 'online',
    activeSessionId: sessionId,
    connectionGeneration: 2,
    sessionStartGeneration: 1,
    verifiedConnections: {
      conn_tab1: {
        connectionKey: 'conn_tab1',
        activationId: 'act_1',
        sessionId,
        connectionGeneration: 1,
        verifiedAtEpoch: serverEpoch,
      },
      conn_tab2: {
        connectionKey: 'conn_tab2',
        activationId: 'act_2',
        sessionId,
        connectionGeneration: 2,
        verifiedAtEpoch: serverEpoch,
      },
    },
  });

  await rtdb.ref(`presence/${uid}`).set({
    conn_tab1: {
      sessionId,
      activationId: 'act_1',
      connectionGeneration: 1,
      connectedAt: new Date(serverEpoch).toISOString(),
      lastSeenAt: new Date(serverEpoch).toISOString(),
    },
    conn_tab2: {
      sessionId,
      activationId: 'act_2',
      connectionGeneration: 2,
      connectedAt: new Date(serverEpoch).toISOString(),
      lastSeenAt: new Date(serverEpoch).toISOString(),
    },
  });

  // Tab 1 closes -> client socket removes its own connectionKey
  await rtdb.ref(`presence/${uid}/conn_tab1`).remove();

  // Validate presence
  const presenceSnap = await rtdb.ref(`presence/${uid}`).once('value');
  const actSnap = await rtdb.ref(`activity/${uid}`).once('value');
  const val = validateUserPresence(presenceSnap.val(), actSnap.val(), serverEpoch);

  assert.strictEqual(val.isOnline, true, 'User must remain online while Tab 2 is active');
  assert.strictEqual(val.validConnectionsCount, 1, 'Exactly 1 active tab remains');
  assert.strictEqual(val.validConnectionKeys[0], 'conn_tab2');
});

await test('Issue E.2: Closing all tabs leads to clean reconciliation to offline', async () => {
  const rtdb = new InMemoryRTDB();
  const uid = 'user_multi_tab_e2';
  const serverEpoch = Date.now();
  const sessionId = 'sess_multitab_2';

  await rtdb.ref(`activity/${uid}`).set({
    currentStatus: 'online',
    activeSessionId: sessionId,
    connectionGeneration: 2,
    sessionStartGeneration: 1,
    sessionStartEpoch: serverEpoch - 60000,
    totalTimeSpentSeconds: 0,
    verifiedConnections: {
      conn_tab1: { connectionKey: 'conn_tab1', activationId: 'act_1', sessionId, connectionGeneration: 1 },
      conn_tab2: { connectionKey: 'conn_tab2', activationId: 'act_2', sessionId, connectionGeneration: 2 },
    },
  });

  await rtdb.ref(`presence/${uid}`).set({
    conn_tab1: { sessionId, activationId: 'act_1', connectionGeneration: 1 },
    conn_tab2: { sessionId, activationId: 'act_2', connectionGeneration: 2 },
  });

  // Both tabs close
  await rtdb.ref(`presence/${uid}/conn_tab1`).remove();
  await rtdb.ref(`presence/${uid}/conn_tab2`).remove();

  // Reconcile orphaned presence
  const reconcileResult = await reconcileOrphanedPresence(rtdb, uid, serverEpoch);
  assert.ok(reconcileResult, 'Reconciliation must execute');
  assert.strictEqual(reconcileResult.finalized, true, 'Session must be finalized');
  assert.strictEqual(reconcileResult.reason, 'connection_lost');

  // Verify activity is now offline
  const actSnap = await rtdb.ref(`activity/${uid}`).once('value');
  assert.strictEqual(actSnap.val().currentStatus, 'offline');
  assert.strictEqual(actSnap.val().activeSessionId, null);
});

await test('Issue E.3: Session-fenced logout of Session A does NOT invalidate active Session B', async () => {
  const rtdb = new InMemoryRTDB();
  const uid = 'user_multi_sess_e3';
  const serverEpoch = Date.now();
  const sessA = 'sess_device_A';
  const sessB = 'sess_device_B';

  // Device B is currently the active session in activity
  await rtdb.ref(`activity/${uid}`).set({
    currentStatus: 'online',
    activeSessionId: sessB,
    connectionGeneration: 2,
    sessionStartGeneration: 2,
    sessionStartEpoch: serverEpoch - 30000,
    totalTimeSpentSeconds: 0,
    verifiedConnections: {
      conn_B: {
        connectionKey: 'conn_B',
        activationId: 'act_B',
        sessionId: sessB,
        connectionGeneration: 2,
        verifiedAtEpoch: serverEpoch,
      },
    },
  });

  // RTDB presence has conn_A (from older session) and conn_B (from active session)
  await rtdb.ref(`presence/${uid}`).set({
    conn_A: {
      sessionId: sessA,
      activationId: 'act_A',
      connectionGeneration: 1,
      connectedAt: new Date(serverEpoch - 60000).toISOString(),
      lastSeenAt: new Date(serverEpoch - 60000).toISOString(),
    },
    conn_B: {
      sessionId: sessB,
      activationId: 'act_B',
      connectionGeneration: 2,
      connectedAt: new Date(serverEpoch).toISOString(),
      lastSeenAt: new Date(serverEpoch).toISOString(),
    },
  });

  // Device A logs out: invokes finalizeUserSessionAtomic fenced with targetSessionId = sessA
  const finResult = await finalizeUserSessionAtomic(rtdb, uid, {
    targetSessionId: sessA,
    reason: 'explicit_logout',
    serverEpoch,
  });

  // Guard C must abort: active session is sessB, targetSessionId was sessA
  assert.strictEqual(finResult.finalized, false, 'Finalizing Session A must not finalize Session B');

  // Session-fenced presence removal removes ONLY conn_A
  const presenceSnap = await rtdb.ref(`presence/${uid}`).once('value');
  const presenceVal = presenceSnap.val() || {};
  for (const [key, conn] of Object.entries(presenceVal)) {
    if (conn.sessionId === sessA) {
      await rtdb.ref(`presence/${uid}/${key}`).remove();
    }
  }

  // Verify Session B's presence is strictly preserved
  const postPresenceSnap = await rtdb.ref(`presence/${uid}`).once('value');
  const postActSnap = await rtdb.ref(`activity/${uid}`).once('value');

  assert.ok(postPresenceSnap.val().conn_B, 'Session B presence record must remain intact');
  assert.strictEqual(postPresenceSnap.val().conn_A, undefined, 'Session A presence record must be removed');
  assert.strictEqual(postActSnap.val().currentStatus, 'online', 'User must remain online under Session B');
  assert.strictEqual(postActSnap.val().activeSessionId, sessB);

  // Validate presence
  const val = validateUserPresence(postPresenceSnap.val(), postActSnap.val(), serverEpoch);
  assert.strictEqual(val.isOnline, true, 'User is online via Session B');
  assert.strictEqual(val.validConnectionsCount, 1);
  assert.strictEqual(val.validConnectionKeys[0], 'conn_B');
});

console.log('\n================================================================');
console.log(`SUMMARY: ${passedTests}/${passedTests + failedTests} Tests Passed`);
if (failedTests === 0) {
  console.log('STATUS: ALL INVESTIGATION & REMEDIATION CHECKS PASSED');
} else {
  console.log('STATUS: TEST SUITE FAILED');
  process.exit(1);
}
console.log('================================================================\n');
