import assert from 'node:assert';
import {
  reserveConnection,
  activateConnection,
  finalizeUserSessionAtomic,
  reconcileOrphanedPresence,
  rollbackPresenceRecord,
  validateUserPresence,
} from '../src/lib/rtdbSession.ts';

/**
 * Isolated In-Memory RTDB Database Emulator
 * Faithfully implements the exact Firebase Database, Reference, DataSnapshot,
 * and Transaction semantics for unit and concurrency tests without external network access.
 */
class InMemoryRTDB {
  constructor() {
    this.root = {};
    this._txInterceptors = {};
  }

  _getNested(obj, pathParts) {
    let curr = obj;
    for (const part of pathParts) {
      if (!curr || typeof curr !== 'object') return undefined;
      curr = curr[part];
    }
    return curr;
  }

  _setNested(obj, pathParts, value) {
    let curr = obj;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!curr[part] || typeof curr[part] !== 'object') {
        if (value === null || value === undefined) return;
        curr[part] = {};
      }
      curr = curr[part];
    }
    const last = pathParts[pathParts.length - 1];
    if (value === null || value === undefined) {
      if (curr && typeof curr === 'object') {
        delete curr[last];
      }
    } else {
      curr[last] = JSON.parse(JSON.stringify(value));
    }
  }

  ref(path = '') {
    const cleanPath = path.replace(/^\/+|\/+$/g, '');
    const parts = cleanPath ? cleanPath.split('/') : [];

    return {
      once: async () => {
        const val = this._getNested(this.root, parts);
        const cloned = val !== undefined ? JSON.parse(JSON.stringify(val)) : null;
        return {
          val: () => cloned,
          exists: () => cloned !== null && cloned !== undefined,
        };
      },

      set: async (value) => {
        this._setNested(this.root, parts, value);
      },

      update: async (values) => {
        const existing = this._getNested(this.root, parts) || {};
        const merged = { ...existing, ...JSON.parse(JSON.stringify(values)) };
        this._setNested(this.root, parts, merged);
      },

      remove: async () => {
        this._setNested(this.root, parts, null);
      },

      transaction: async (updateFn) => {
        const interceptor = this._txInterceptors?.[cleanPath];
        let attempts = 0;
        let result;
        let committed = false;
        let cloned;

        do {
          attempts++;
          const existing = this._getNested(this.root, parts);
          cloned = existing !== undefined ? JSON.parse(JSON.stringify(existing)) : null;

          if (interceptor && attempts === 1) {
            // First attempt evaluates callback
            result = updateFn(cloned);
            // Interceptor executes concurrent mutation and forces conflict retry
            await interceptor({ attempt: attempts, firstResult: result, db: this });
            delete this._txInterceptors[cleanPath]; // Fire once
            continue; // Re-run callback against modified state (Retry)
          }

          result = updateFn(cloned);
          committed = result !== undefined;
          if (committed) {
            this._setNested(this.root, parts, result);
          }
          break;
        } while (attempts < 5);

        return {
          committed,
          snapshot: {
            val: () => (committed ? (result !== null ? JSON.parse(JSON.stringify(result)) : null) : cloned),
          },
        };
      },
    };
  }
}

// Time control helpers for deterministic testing without sleeps
let mockedNow = null;
const realDateNow = Date.now;
function setMockTime(epoch) {
  mockedNow = epoch;
  Date.now = () => (mockedNow !== null ? mockedNow : realDateNow());
}
function restoreTime() {
  mockedNow = null;
  Date.now = realDateNow;
}

async function runPendingActivationSuite() {
  console.log('================================================================');
  console.log('MEDICORE-AI: RTDB Fenced Activation Concurrency & Race Suite');
  console.log('Isolated Local Environment — No External RTDB Calls');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`[PASS] ${total}. ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${total}. ${name}`);
      console.error('       Error:', err.message);
      console.error(err.stack);
    } finally {
      restoreTime();
    }
  }

  const baseEpoch = 1750000000000;

  // -------------------------------------------------------------------------
  // Test 1: Activation expires before presence creation (Pre-write expiry check)
  // -------------------------------------------------------------------------
  await test('Race Condition 1: Activation expires during pause before presence creation', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_prewrite_expiry';
    setMockTime(baseEpoch);

    const reserve = await reserveConnection(mockDb, {
      uid,
      decodedToken: { uid },
      serverEpoch: baseEpoch,
    });

    const actResult = await activateConnection(mockDb, {
      uid,
      connectionKey: reserve.connectionKey,
      sessionId: reserve.sessionId,
      serverEpoch: baseEpoch,
      hooks: {
        async beforePresenceWrite() {
          // Deterministic barrier: advance time past 15s TTL before presence write
          setMockTime(baseEpoch + 16000);
        },
      },
    });

    assert.strictEqual(actResult.activated, false, 'Activation must fail if lease expired before write');
    assert.strictEqual(actResult.reason, 'activation_lease_expired');

    const presSnap = (await mockDb.ref(`presence/${uid}/${reserve.connectionKey}`).once('value')).val();
    assert.strictEqual(presSnap, null, 'Presence node must not be created on pre-write expiration');

    const actSnap = (await mockDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(actSnap.pendingActivations?.[reserve.connectionKey], undefined, 'Pending record must be pruned');
  });

  // -------------------------------------------------------------------------
  // Test 2: Finalization happens while activation is paused (Post-write fence catches offline)
  // -------------------------------------------------------------------------
  await test('Race Condition 2: Finalization happens during activation pause (Compensating rollback)', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_finalized_during_pause';
    setMockTime(baseEpoch);

    await mockDb.ref(`activity/${uid}`).set({
      currentStatus: 'online',
      activeSessionId: 'sess_initial',
      sessionStartEpoch: baseEpoch - 60000,
      totalTimeSpentSeconds: 100,
      connectionGeneration: 1,
    });

    const reserve = await reserveConnection(mockDb, {
      uid,
      decodedToken: { uid },
      serverEpoch: baseEpoch,
    });

    const actResult = await activateConnection(mockDb, {
      uid,
      connectionKey: reserve.connectionKey,
      sessionId: reserve.sessionId,
      serverEpoch: baseEpoch,
      hooks: {
        async beforePresenceWrite({ expiresAtEpoch }) {
          // Pause and advance time past the activation lease
          setMockTime(expiresAtEpoch + 1000);
          // Admin reconciliation observes no active presence and expired lease -> finalizes offline
          const finResult = await finalizeUserSessionAtomic(mockDb, uid, {
            targetSessionId: reserve.sessionId,
            reason: 'connection_lost',
            serverEpoch: expiresAtEpoch + 1000,
          });
          assert.strictEqual(finResult.finalized, true, 'Admin reconciliation finalized expired session');
        },
      },
    });

    assert.strictEqual(actResult.activated, false, 'Delayed activation must be rejected by fence');
    assert.ok(
      actResult.reason === 'session_offline' || actResult.reason === 'activation_lease_expired',
      `Reason must indicate offline or lease expired, got: ${actResult.reason}`
    );

    // Compensating rollback verification: presence node MUST be removed
    const presSnap = (await mockDb.ref(`presence/${uid}/${reserve.connectionKey}`).once('value')).val();
    assert.strictEqual(presSnap, null, 'Presence node must be rolled back and deleted');

    const finalAct = (await mockDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(finalAct.currentStatus, 'offline', 'User must remain offline');
  });

  // -------------------------------------------------------------------------
  // Test 3: Two concurrent activations for the same connection key (Superseded activation)
  // -------------------------------------------------------------------------
  await test('Race Condition 3: Two concurrent activations for the same key (Superseded A rolled back)', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_concurrent_same_key';
    setMockTime(baseEpoch);

    const reserve = await reserveConnection(mockDb, {
      uid,
      decodedToken: { uid },
      serverEpoch: baseEpoch,
    });

    let actBResult = null;

    const actAResult = await activateConnection(mockDb, {
      uid,
      connectionKey: reserve.connectionKey,
      sessionId: reserve.sessionId,
      serverEpoch: baseEpoch,
      hooks: {
        async beforePresenceWrite() {
          // While Activation A is paused before presence write, Activation B runs
          setMockTime(baseEpoch + 100);
          actBResult = await activateConnection(mockDb, {
            uid,
            connectionKey: reserve.connectionKey,
            sessionId: reserve.sessionId,
            serverEpoch: baseEpoch + 100,
          });
        },
      },
    });

    assert.strictEqual(actBResult?.activated, true, 'Activation B must succeed');
    assert.strictEqual(actAResult.activated, false, 'Activation A must fail because it was superseded');
    assert.strictEqual(actAResult.reason, 'activation_superseded');

    // Compensating rollback on A must NOT delete B's active presence!
    const presSnap = (await mockDb.ref(`presence/${uid}/${reserve.connectionKey}`).once('value')).val();
    assert.ok(presSnap !== null, 'Presence record must remain present for Activation B');
    assert.strictEqual(presSnap.activationId, actBResult.activationId, 'Presence must belong to Activation B');
  });

  // -------------------------------------------------------------------------
  // Test 4: Older activation resumes after newer activation completes
  // -------------------------------------------------------------------------
  await test('Race Condition 4: Delayed older activation cannot clobber newer completed activation', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_older_delayed';
    setMockTime(baseEpoch);

    const reserveA = await reserveConnection(mockDb, {
      uid,
      decodedToken: { uid },
      serverEpoch: baseEpoch,
    });

    let actBResult = null;
    let reserveB = null;

    const actAResult = await activateConnection(mockDb, {
      uid,
      connectionKey: reserveA.connectionKey,
      sessionId: reserveA.sessionId,
      serverEpoch: baseEpoch,
      hooks: {
        async afterPresenceWrite() {
          // B starts with a new credential login / new session while A is paused after writing
          reserveB = await reserveConnection(mockDb, {
            uid,
            decodedToken: { uid, auth_time: Math.floor((baseEpoch + 200) / 1000) },
            serverEpoch: baseEpoch + 200,
          });
          actBResult = await activateConnection(mockDb, {
            uid,
            connectionKey: reserveB.connectionKey,
            sessionId: reserveB.sessionId,
            serverEpoch: baseEpoch + 200,
          });
        },
      },
    });

    assert.strictEqual(actBResult?.activated, true, 'Activation B must succeed');
    assert.strictEqual(actAResult.activated, false, 'Activation A must fail post-write fence');
    assert.strictEqual(actAResult.reason, 'session_changed');

    const presSnapB = (await mockDb.ref(`presence/${uid}/${reserveB.connectionKey}`).once('value')).val();
    assert.ok(presSnapB !== null, 'Presence for B must exist');
    assert.strictEqual(presSnapB.activationId, actBResult.activationId, 'Presence must remain owned by Activation B');

    const presSnapA = (await mockDb.ref(`presence/${uid}/${reserveA.connectionKey}`).once('value')).val();
    assert.strictEqual(presSnapA, null, 'Presence for delayed A must be rolled back');
  });

  // -------------------------------------------------------------------------
  // Test 5: Active session changes from Session A to Session B before presence creation
  // -------------------------------------------------------------------------
  await test('Race Condition 5: Session changed during in-flight activation (Rolled back)', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_session_changed';
    setMockTime(baseEpoch);

    const reserve = await reserveConnection(mockDb, {
      uid,
      decodedToken: { uid },
      serverEpoch: baseEpoch,
    });

    const actResult = await activateConnection(mockDb, {
      uid,
      connectionKey: reserve.connectionKey,
      sessionId: reserve.sessionId,
      serverEpoch: baseEpoch,
      hooks: {
        async beforePresenceWrite() {
          // New login creates Session B while Activation A is in-flight
          await mockDb.ref(`activity/${uid}`).update({
            activeSessionId: 'sess_new_B_777',
            sessionStartEpoch: baseEpoch + 50,
          });
        },
      },
    });

    assert.strictEqual(actResult.activated, false, 'Activation A must fail due to session change');
    assert.strictEqual(actResult.reason, 'session_changed');

    // Compensating rollback verification
    const presSnap = (await mockDb.ref(`presence/${uid}/${reserve.connectionKey}`).once('value')).val();
    assert.strictEqual(presSnap, null, 'Presence node for Session A must be rolled back');

    const actSnap = (await mockDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(actSnap.activeSessionId, 'sess_new_B_777', 'Session B must remain active');
  });

  // -------------------------------------------------------------------------
  // Test 6: Presence creation throws network failure (Pending rollback)
  // -------------------------------------------------------------------------
  await test('Failure Recovery: RTDB failure on presence write rolls back pending activation', async () => {
    const baseDb = new InMemoryRTDB();
    const uid = 'user_test_presence_fail';
    setMockTime(baseEpoch);

    const reserve = await reserveConnection(baseDb, {
      uid,
      decodedToken: { uid },
      serverEpoch: baseEpoch,
    });

    // Failing DB wrapper
    const failingDb = {
      ref(path) {
        if (path.startsWith('presence/')) {
          return {
            async once() { return { exists: () => false, val: () => null }; },
            async set() { throw new Error('Simulated RTDB Write Failure'); },
            async remove() {},
          };
        }
        return baseDb.ref(path);
      },
    };

    let caughtErr = null;
    try {
      await activateConnection(failingDb, {
        uid,
        connectionKey: reserve.connectionKey,
        sessionId: reserve.sessionId,
        serverEpoch: baseEpoch,
      });
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr !== null, 'Activation must reject when write throws');
    assert.strictEqual(caughtErr.message, 'Simulated RTDB Write Failure');

    const actSnap = (await baseDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(
      actSnap?.pendingActivations?.[reserve.connectionKey],
      undefined,
      'Pending activation must be rolled back on write error'
    );
  });

  // -------------------------------------------------------------------------
  // Test 7: Pending activation expires during administrative reconciliation attempt
  // -------------------------------------------------------------------------
  await test('Reconciliation Fence: Admin reconciliation blocked during lease, succeeds after expiration', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_admin_fence';
    setMockTime(baseEpoch);

    await mockDb.ref(`activity/${uid}`).set({
      currentStatus: 'online',
      activeSessionId: 'sess_admin_fence',
      sessionStartEpoch: baseEpoch - 30000,
      connectionGeneration: 4,
      totalTimeSpentSeconds: 50,
      pendingActivations: {
        conn_fence_1: {
          activationId: 'act_fence_1',
          connectionKey: 'conn_fence_1',
          sessionId: 'sess_admin_fence',
          startedAtEpoch: baseEpoch,
          expiresAtEpoch: baseEpoch + 15000,
        },
      },
    });

    // Reconciliation during valid lease (t = +1000) -> returns null (blocked)
    const recBlocked = await reconcileOrphanedPresence(mockDb, uid, baseEpoch + 1000);
    assert.strictEqual(recBlocked, null, 'Reconciliation must be blocked during valid lease');

    // Time advances past lease expiration (t = +16000) -> reconciliation succeeds
    const recSucceeds = await reconcileOrphanedPresence(mockDb, uid, baseEpoch + 16000);
    assert.ok(recSucceeds !== null, 'Reconciliation must succeed after lease expires');
    assert.strictEqual(recSucceeds.finalized, true);

    const actSnap = (await mockDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(actSnap.currentStatus, 'offline', 'User now offline');
  });

  // -------------------------------------------------------------------------
  // Test 8: Multiple tabs activate concurrently
  // -------------------------------------------------------------------------
  await test('Multi-Tab Concurrency: Multiple tabs activate concurrently on separate keys', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_multitab_3';
    setMockTime(baseEpoch);

    await mockDb.ref(`activity/${uid}`).set({
      currentStatus: 'online',
      activeSessionId: 'sess_tab_shared_888',
      lastActivityAt: new Date(baseEpoch - 1000).toISOString(),
      connectionGeneration: 1,
      totalTimeSpentSeconds: 0,
    });

    const [r1, r2, r3] = await Promise.all([
      reserveConnection(mockDb, { uid, decodedToken: { uid }, serverEpoch: baseEpoch }),
      reserveConnection(mockDb, { uid, decodedToken: { uid }, serverEpoch: baseEpoch + 10 }),
      reserveConnection(mockDb, { uid, decodedToken: { uid }, serverEpoch: baseEpoch + 20 }),
    ]);

    const [a1, a2, a3] = await Promise.all([
      activateConnection(mockDb, { uid, connectionKey: r1.connectionKey, sessionId: r1.sessionId, serverEpoch: baseEpoch + 30 }),
      activateConnection(mockDb, { uid, connectionKey: r2.connectionKey, sessionId: r2.sessionId, serverEpoch: baseEpoch + 30 }),
      activateConnection(mockDb, { uid, connectionKey: r3.connectionKey, sessionId: r3.sessionId, serverEpoch: baseEpoch + 30 }),
    ]);

    assert.strictEqual(a1.activated, true);
    assert.strictEqual(a2.activated, true);
    assert.strictEqual(a3.activated, true);

    const presSnap = (await mockDb.ref(`presence/${uid}`).once('value')).val();
    assert.strictEqual(Object.keys(presSnap).length, 3, 'All 3 tabs have active presence');

    const actSnap = (await mockDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(actSnap.connectionGeneration, 4, 'Generation advanced 3 times');
    assert.strictEqual(Object.keys(actSnap.pendingActivations || {}).length, 0, 'All pending records cleared');
  });

  // -------------------------------------------------------------------------
  // Test 9: Browser disconnect occurs after reservation before activation
  // -------------------------------------------------------------------------
  await test('Handshake Stage Safety: Disconnect after reservation leaves zero presence records', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_disconnect_early';
    setMockTime(baseEpoch);

    const reserve = await reserveConnection(mockDb, {
      uid,
      decodedToken: { uid },
      serverEpoch: baseEpoch,
    });

    // Browser disconnects before onDisconnect or activation:
    const presSnap = (await mockDb.ref(`presence/${uid}/${reserve.connectionKey}`).once('value')).val();
    assert.strictEqual(presSnap, null, 'No presence record created by reservation');

    // Reservation exists with 60s TTL
    const resSnap = (await mockDb.ref(`reservations/${uid}/${reserve.connectionKey}`).once('value')).val();
    assert.ok(resSnap !== null, 'Reservation exists');
    assert.strictEqual(resSnap.expiresAt, baseEpoch + 60000);

    // After 61s, activation attempt is rejected
    const expiredAct = await activateConnection(mockDb, {
      uid,
      connectionKey: reserve.connectionKey,
      sessionId: reserve.sessionId,
      serverEpoch: baseEpoch + 61000,
    });
    assert.strictEqual(expiredAct.activated, false);
    assert.strictEqual(expiredAct.reason, 'reservation_expired');
  });

  // -------------------------------------------------------------------------
  // Test 10: Repeated retries cannot extend lease indefinitely (maxRenewEpoch)
  // -------------------------------------------------------------------------
  await test('Lease Bounding: Repeated retries cannot extend lease past maxRenewEpoch', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_lease_bounding';
    setMockTime(baseEpoch);

    const reserve = await reserveConnection(mockDb, {
      uid,
      decodedToken: { uid },
      serverEpoch: baseEpoch,
    });

    // First attempt at t = 0
    let recordedMaxRenew = 0;
    let recordedExpiresAt = 0;

    await activateConnection(mockDb, {
      uid,
      connectionKey: reserve.connectionKey,
      sessionId: reserve.sessionId,
      serverEpoch: baseEpoch,
      hooks: {
        async beforePresenceWrite({ expiresAtEpoch }) {
          recordedExpiresAt = expiresAtEpoch;
          const act = (await mockDb.ref(`activity/${uid}`).once('value')).val();
          recordedMaxRenew = act.pendingActivations[reserve.connectionKey].maxRenewEpoch;
        },
      },
    });

    assert.strictEqual(recordedExpiresAt, baseEpoch + 15000, 'Initial lease is +15s');
    assert.strictEqual(recordedMaxRenew, baseEpoch + 30000, 'Max renewal ceiling is +30s');

    // Simulate retry at t = +20s
    let retryExpiresAt = 0;
    // Clear presence so retry enters Phase A and is not bypassed by idempotency
    await mockDb.ref(`presence/${uid}/${reserve.connectionKey}`).remove();

    // Set pending record back to test retry bounding logic directly
    await mockDb.ref(`activity/${uid}`).transaction((curr) => {
      curr.pendingActivations = {
        [reserve.connectionKey]: {
          activationId: 'act_prev',
          connectionKey: reserve.connectionKey,
          sessionId: reserve.sessionId,
          startedAtEpoch: baseEpoch,
          expiresAtEpoch: baseEpoch + 15000,
          maxRenewEpoch: baseEpoch + 30000,
        },
      };
      return curr;
    });

    // Re-create reservation so activation doesn't fail on reservation_not_found
    await mockDb.ref(`reservations/${uid}/${reserve.connectionKey}`).set({
      sessionId: reserve.sessionId,
      expiresAt: baseEpoch + 60000,
    });

    await activateConnection(mockDb, {
      uid,
      connectionKey: reserve.connectionKey,
      sessionId: reserve.sessionId,
      serverEpoch: baseEpoch + 20000,
      hooks: {
        async beforePresenceWrite({ expiresAtEpoch }) {
          retryExpiresAt = expiresAtEpoch;
        },
      },
    });

    // Bounded check: 20000 + 15000 = 35000, but maxRenewEpoch is 30000 -> clamped to 30000!
    assert.strictEqual(retryExpiresAt, baseEpoch + 30000, 'Lease must be strictly clamped to maxRenewEpoch');
  });

  // -------------------------------------------------------------------------
  // Test 11: Atomic Rollback Test 1 — TOCTOU Race Prevention via Atomic Transaction
  // A writes activationId A; B replaces with B before A's rollback commits; A's tx preserves B
  // -------------------------------------------------------------------------
  await test('Atomic Rollback 1: Replacement before rollback commit aborts transaction and preserves B', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_rollback_toctou';
    const connKey = 'conn_rollback_toctou_1';

    // A writes its presence record with activationId A
    await mockDb.ref(`presence/${uid}/${connKey}`).set({
      connectedAt: new Date(baseEpoch).toISOString(),
      role: 'patient',
      sessionId: 'sess_A',
      activationId: 'act_A',
    });

    // A initiates rollback, but B replaces the record before A's transaction commits
    const rollbackRes = await rollbackPresenceRecord(mockDb, {
      uid,
      connectionKey: connKey,
      activationId: 'act_A',
      beforeRollbackCommit: async () => {
        // B replaces the presence record with activationId B in the gap
        await mockDb.ref(`presence/${uid}/${connKey}`).set({
          connectedAt: new Date(baseEpoch + 50).toISOString(),
          role: 'patient',
          sessionId: 'sess_B',
          activationId: 'act_B',
        });
      },
    });

    assert.strictEqual(rollbackRes.rolledBack, false, 'Rollback must not delete replaced record');
    assert.strictEqual(rollbackRes.reason, 'superseded_by_newer');

    const presSnap = (await mockDb.ref(`presence/${uid}/${connKey}`).once('value')).val();
    assert.ok(presSnap !== null, 'B presence record must remain intact');
    assert.strictEqual(presSnap.activationId, 'act_B', 'Presence must still belong to B');
    assert.strictEqual(presSnap.sessionId, 'sess_B');
  });

  // -------------------------------------------------------------------------
  // Test 12: Atomic Rollback Test 2 — Superseded Rollback Protection
  // B writes activationId B; A attempts rollback; B remains untouched
  // -------------------------------------------------------------------------
  await test('Atomic Rollback 2: Stale activation rollback against newer activation preserves B', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_rollback_superseded';
    const connKey = 'conn_rollback_superseded_2';

    // B has already written presence record with activationId B
    await mockDb.ref(`presence/${uid}/${connKey}`).set({
      connectedAt: new Date(baseEpoch).toISOString(),
      role: 'doctor',
      sessionId: 'sess_B',
      activationId: 'act_B',
    });

    // A attempts rollback with its own older activationId A
    const rollbackRes = await rollbackPresenceRecord(mockDb, {
      uid,
      connectionKey: connKey,
      activationId: 'act_A',
    });

    assert.strictEqual(rollbackRes.rolledBack, false, 'Stale rollback must abort without deleting');
    assert.strictEqual(rollbackRes.reason, 'superseded_by_newer');

    const presSnap = (await mockDb.ref(`presence/${uid}/${connKey}`).once('value')).val();
    assert.ok(presSnap !== null, 'Presence record must remain intact');
    assert.strictEqual(presSnap.activationId, 'act_B', 'Presence must remain owned by B');
  });

  // -------------------------------------------------------------------------
  // Test 13: Atomic Rollback Test 3 — Clean Rollback on Failed Activation
  // A writes activationId A; no replacement occurs; A's rollback atomically deletes its own record
  // -------------------------------------------------------------------------
  await test('Atomic Rollback 3: Rollback successfully and atomically deletes its own record', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_rollback_clean';
    const connKey = 'conn_rollback_clean_3';

    // A writes presence record with activationId A
    await mockDb.ref(`presence/${uid}/${connKey}`).set({
      connectedAt: new Date(baseEpoch).toISOString(),
      role: 'patient',
      sessionId: 'sess_A',
      activationId: 'act_A',
    });

    const rollbackRes = await rollbackPresenceRecord(mockDb, {
      uid,
      connectionKey: connKey,
      activationId: 'act_A',
    });

    assert.strictEqual(rollbackRes.rolledBack, true, 'Own record must be deleted');
    assert.strictEqual(rollbackRes.reason, 'deleted');

    const presSnap = (await mockDb.ref(`presence/${uid}/${connKey}`).once('value')).val();
    assert.strictEqual(presSnap, null, 'Presence record must be completely removed');
  });

  // -------------------------------------------------------------------------
  // Test 14: Atomic Rollback Test 4 — Concurrent Rollback Safety
  // Two rollback attempts execute concurrently; no newer activation is deleted
  // -------------------------------------------------------------------------
  await test('Atomic Rollback 4: Concurrent rollback attempts never delete newer active connection', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_rollback_concurrent';
    const connKey = 'conn_rollback_concurrent_4';

    // Record currently belongs to B
    await mockDb.ref(`presence/${uid}/${connKey}`).set({
      connectedAt: new Date(baseEpoch).toISOString(),
      role: 'patient',
      sessionId: 'sess_B',
      activationId: 'act_B',
    });

    // Two stale rollback attempts for older activation A run concurrently
    const [res1, res2] = await Promise.all([
      rollbackPresenceRecord(mockDb, { uid, connectionKey: connKey, activationId: 'act_A' }),
      rollbackPresenceRecord(mockDb, { uid, connectionKey: connKey, activationId: 'act_A' }),
    ]);

    assert.strictEqual(res1.rolledBack, false);
    assert.strictEqual(res2.rolledBack, false);
    assert.strictEqual(res1.reason, 'superseded_by_newer');
    assert.strictEqual(res2.reason, 'superseded_by_newer');

    const presSnap = (await mockDb.ref(`presence/${uid}/${connKey}`).once('value')).val();
    assert.ok(presSnap !== null, 'B record must survive concurrent stale rollbacks');
    assert.strictEqual(presSnap.activationId, 'act_B');
  });

  // -------------------------------------------------------------------------
  // Test 15: Unverified Presence Record Treatment by Admin Reconciliation
  // Presence record exists but lease expires -> reconciliation handles properly
  // -------------------------------------------------------------------------
  await test('Admin Reconciliation: Unverified presence record with expired lease is finalized after rollback', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_unverified_recon';
    const connKey = 'conn_unverified_15';
    setMockTime(baseEpoch);

    await mockDb.ref(`activity/${uid}`).set({
      currentStatus: 'online',
      activeSessionId: 'sess_unverified_15',
      sessionStartEpoch: baseEpoch - 40000,
      connectionGeneration: 2,
      totalTimeSpentSeconds: 120,
      pendingActivations: {
        [connKey]: {
          activationId: 'act_unverified_15',
          connectionKey: connKey,
          sessionId: 'sess_unverified_15',
          startedAtEpoch: baseEpoch,
          expiresAtEpoch: baseEpoch + 15000,
        },
      },
    });

    // Phase B presence was written
    await mockDb.ref(`presence/${uid}/${connKey}`).set({
      connectedAt: new Date(baseEpoch).toISOString(),
      role: 'patient',
      sessionId: 'sess_unverified_15',
      activationId: 'act_unverified_15',
    });

    // 1. During valid lease (t = +5s): reconciliation blocked
    const blockedRecon = await reconcileOrphanedPresence(mockDb, uid, baseEpoch + 5000);
    assert.strictEqual(blockedRecon, null, 'Reconciliation must not finalize while lease is active');

    // 2. Post-write verification fails (e.g. lease expired or session changed) -> atomic rollback executes
    setMockTime(baseEpoch + 16000);
    const rollbackRes = await rollbackPresenceRecord(mockDb, {
      uid,
      connectionKey: connKey,
      activationId: 'act_unverified_15',
    });
    assert.strictEqual(rollbackRes.rolledBack, true, 'Unverified presence atomically rolled back');

    // 3. Admin reconciliation runs now that presence is removed and lease expired:
    const finalizedRecon = await reconcileOrphanedPresence(mockDb, uid, baseEpoch + 16000);
    assert.ok(finalizedRecon !== null, 'Reconciliation must now finalize orphaned session');
    assert.strictEqual(finalizedRecon.finalized, true);

    const actSnap = (await mockDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(actSnap.currentStatus, 'offline', 'User marked offline');
    assert.strictEqual(actSnap.activeSessionId, null, 'Active session cleared');
    assert.strictEqual(actSnap.totalTimeSpentSeconds, 120 + 56, 'Duration accurately accrued');
  });

  // -------------------------------------------------------------------------
  // Test 16: Finalize Transaction Retry — Attempt 1 passes, Attempt 2 aborts
  // Verifies that a retry aborting does NOT return finalized: true from attempt 1
  // -------------------------------------------------------------------------
  await test('Transaction Retry 1: finalizeUserSessionAtomic aborts cleanly when retry detects offline', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_tx_retry_16';
    setMockTime(baseEpoch);

    await mockDb.ref(`activity/${uid}`).set({
      currentStatus: 'online',
      activeSessionId: 'sess_16',
      sessionStartEpoch: baseEpoch - 10000,
      totalTimeSpentSeconds: 50,
      connectionGeneration: 2,
    });

    // Interceptor: After attempt 1 passes, simulate concurrent process setting user offline
    mockDb._txInterceptors[`activity/${uid}`] = async ({ db }) => {
      await db.ref(`activity/${uid}`).update({ currentStatus: 'offline' });
    };

    const finalRes = await finalizeUserSessionAtomic(mockDb, uid, {
      targetSessionId: 'sess_16',
      reason: 'explicit_logout',
      serverEpoch: baseEpoch,
    });

    assert.strictEqual(finalRes.finalized, false, 'Finalization must report false when retry aborts');
    assert.strictEqual(finalRes.reason, 'not_finalized');
  });

  // -------------------------------------------------------------------------
  // Test 17: Phase C Transaction Retry — Attempt 1 passes, Attempt 2 discovers changed session
  // Verifies that Phase C retry discovering conflict triggers compensating rollback
  // -------------------------------------------------------------------------
  await test('Transaction Retry 2: activateConnection Phase C retry triggers compensating rollback', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_tx_retry_17';
    setMockTime(baseEpoch);

    const reserve = await reserveConnection(mockDb, {
      uid,
      decodedToken: { uid },
      serverEpoch: baseEpoch,
    });

    const actResult = await activateConnection(mockDb, {
      uid,
      connectionKey: reserve.connectionKey,
      sessionId: reserve.sessionId,
      serverEpoch: baseEpoch,
      hooks: {
        afterPresenceWrite() {
          // Set interceptor for Phase C transaction on activity node
          mockDb._txInterceptors[`activity/${uid}`] = async ({ db }) => {
            await db.ref(`activity/${uid}`).update({ activeSessionId: 'sess_new_replaced_17' });
          };
        },
      },
    });

    assert.strictEqual(actResult.activated, false, 'Activation must fail when Phase C retry aborts');
    assert.strictEqual(actResult.reason, 'session_changed');

    // Compensating rollback verification: presence node must be removed
    const presSnap = (await mockDb.ref(`presence/${uid}/${reserve.connectionKey}`).once('value')).val();
    assert.strictEqual(presSnap, null, 'Presence node must be rolled back atomically');
  });

  // -------------------------------------------------------------------------
  // Test 18: Transaction aborts without committing
  // -------------------------------------------------------------------------
  await test('Transaction Abort: Aborting transaction leaves database completely unmodified', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_tx_abort_18';
    setMockTime(baseEpoch);

    await mockDb.ref(`activity/${uid}`).set({
      currentStatus: 'online',
      activeSessionId: 'sess_18',
      connectionGeneration: 5,
    });

    // Call finalize with wrong targetSessionId -> aborts
    const res = await finalizeUserSessionAtomic(mockDb, uid, {
      targetSessionId: 'sess_mismatch',
      reason: 'explicit_logout',
      serverEpoch: baseEpoch,
    });

    assert.strictEqual(res.finalized, false);
    const actSnap = (await mockDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(actSnap.currentStatus, 'online', 'Current status untouched');
    assert.strictEqual(actSnap.activeSessionId, 'sess_18', 'Active session untouched');
  });

  // -------------------------------------------------------------------------
  // Test 19: Transaction rejects with an error
  // -------------------------------------------------------------------------
  await test('Transaction Error: Exception during transaction is safely caught and returns false', async () => {
    const failingDb = {
      ref() {
        return {
          async transaction() {
            throw new Error('Simulated RTDB Cluster Timeout');
          },
        };
      },
    };

    const res = await finalizeUserSessionAtomic(failingDb, 'user_test_err_19', {
      reason: 'explicit_logout',
    });

    assert.strictEqual(res.finalized, false);
    assert.strictEqual(res.reason, 'transaction_failed');
  });

  // -------------------------------------------------------------------------
  // Test 20: Transaction succeeds after a retry
  // -------------------------------------------------------------------------
  await test('Transaction Retry 3: Transaction succeeds cleanly when retry succeeds', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_tx_retry_20';
    setMockTime(baseEpoch);

    await mockDb.ref(`activity/${uid}`).set({
      currentStatus: 'online',
      activeSessionId: 'sess_20',
      sessionStartEpoch: baseEpoch - 10000,
      totalTimeSpentSeconds: 10,
      connectionGeneration: 1,
    });

    // Interceptor: updates unrelated field on attempt 1 to simulate concurrent write, but preserves session
    mockDb._txInterceptors[`activity/${uid}`] = async ({ db }) => {
      await db.ref(`activity/${uid}`).update({ lastActivityAt: new Date(baseEpoch - 100).toISOString() });
    };

    const res = await finalizeUserSessionAtomic(mockDb, uid, {
      targetSessionId: 'sess_20',
      reason: 'explicit_logout',
      serverEpoch: baseEpoch,
    });

    assert.strictEqual(res.finalized, true, 'Transaction must succeed on retry');
    const actSnap = (await mockDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(actSnap.currentStatus, 'offline');
  });

  // -------------------------------------------------------------------------
  // Test 21: Admin Validation — Offline activity with stale presence
  // -------------------------------------------------------------------------
  await test('Admin Validation 1: Offline activity with leftover presence evaluates to offline', async () => {
    const userActivity = {
      currentStatus: 'offline',
      activeSessionId: null,
      connectionGeneration: 3,
    };
    const userPresence = {
      conn_stale: { sessionId: 'sess_old', connectedAt: new Date(baseEpoch - 50000).toISOString() },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, false, 'Offline activity cannot be online via stale presence');
    assert.strictEqual(validation.validConnectionsCount, 0);
    assert.strictEqual(validation.staleConnectionKeys.length, 1);
  });

  // -------------------------------------------------------------------------
  // Test 22: Admin Validation — Online activity with valid presence
  // -------------------------------------------------------------------------
  await test('Admin Validation 2: Online activity with matching session presence evaluates to online', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_active_22',
      connectionGeneration: 2,
      verifiedConnections: {
        conn_valid: {
          connectionKey: 'conn_valid',
          activationId: 'act_valid_22',
          sessionId: 'sess_active_22',
          connectionGeneration: 2,
          verifiedAtEpoch: baseEpoch,
        },
      },
    };
    const userPresence = {
      conn_valid: {
        sessionId: 'sess_active_22',
        activationId: 'act_valid_22',
        connectionGeneration: 2,
        connectedAt: new Date(baseEpoch).toISOString(),
      },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, true);
    assert.strictEqual(validation.validConnectionsCount, 1);
    assert.strictEqual(validation.validConnectionKeys[0], 'conn_valid');
  });

  // -------------------------------------------------------------------------
  // Test 23: Admin Validation — Presence belonging to an old session
  // -------------------------------------------------------------------------
  await test('Admin Validation 3: Presence with mismatched sessionId does not count as online', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_new_23',
      connectionGeneration: 4,
    };
    const userPresence = {
      conn_old: { sessionId: 'sess_prior_login_23' },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, false, 'Mismatched session presence must not be counted');
    assert.strictEqual(validation.validConnectionsCount, 0);
    assert.strictEqual(validation.staleConnectionKeys[0], 'conn_old');
  });

  // -------------------------------------------------------------------------
  // Test 24: Admin Validation — Presence with a mismatched activationId
  // -------------------------------------------------------------------------
  await test('Admin Validation 4: In-flight presence with mismatched activationId is marked stale', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_24',
      pendingActivations: {
        conn_24: {
          activationId: 'act_new_24',
          sessionId: 'sess_24',
          expiresAtEpoch: baseEpoch + 15000,
        },
      },
    };
    const userPresence = {
      conn_24: { sessionId: 'sess_24', activationId: 'act_stale_mismatched' },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.validConnectionsCount, 0, 'Mismatched activationId presence is rejected');
  });

  // -------------------------------------------------------------------------
  // Test 25: Admin Validation — Expired pending activation
  // -------------------------------------------------------------------------
  await test('Admin Validation 5: Expired pending activation is not treated as online', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_25',
      pendingActivations: {
        conn_25: {
          activationId: 'act_25',
          sessionId: 'sess_25',
          expiresAtEpoch: baseEpoch - 1000, // Expired 1 second ago
        },
      },
    };

    const validation = validateUserPresence(null, userActivity, baseEpoch);
    assert.strictEqual(validation.hasPendingActivation, false);
    assert.strictEqual(validation.isOnline, false);
  });

  // -------------------------------------------------------------------------
  // Test 26: Admin Validation — Valid pending activation without a presence node yet
  // -------------------------------------------------------------------------
  await test('Admin Validation 6: Valid pending activation without presence node preserves online', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_26',
      pendingActivations: {
        conn_26: {
          activationId: 'act_26',
          sessionId: 'sess_26',
          expiresAtEpoch: baseEpoch + 10000,
        },
      },
    };

    const validation = validateUserPresence(null, userActivity, baseEpoch);
    assert.strictEqual(validation.hasPendingActivation, true);
    assert.strictEqual(validation.isOnline, false, 'Pending-only activation must not be reported as confirmed online');
    assert.strictEqual(validation.presenceStatus, 'pending');
  });

  // -------------------------------------------------------------------------
  // Test 27: Admin Validation — Two valid tabs with one disconnecting
  // -------------------------------------------------------------------------
  await test('Admin Validation 7: Two valid tabs remain online when one disconnects', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_shared_27',
      connectionGeneration: 2,
      verifiedConnections: {
        conn_tab1: {
          connectionKey: 'conn_tab1',
          activationId: 'act_tab1',
          sessionId: 'sess_shared_27',
          connectionGeneration: 2,
          verifiedAtEpoch: baseEpoch,
        },
        conn_tab2: {
          connectionKey: 'conn_tab2',
          activationId: 'act_tab2',
          sessionId: 'sess_shared_27',
          connectionGeneration: 2,
          verifiedAtEpoch: baseEpoch,
        },
      },
    };
    // Tab 1 disconnected (removed from presence), Tab 2 remains in presence
    const userPresence = {
      conn_tab2: { sessionId: 'sess_shared_27', activationId: 'act_tab2', connectionGeneration: 2 },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, true);
    assert.strictEqual(validation.validConnectionsCount, 1);
    assert.strictEqual(validation.validConnectionKeys[0], 'conn_tab2');
  });

  // -------------------------------------------------------------------------
  // Test 28: Admin Validation — One stale tab and one valid tab
  // -------------------------------------------------------------------------
  await test('Admin Validation 8: One stale tab does not corrupt active tab status', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_active_28',
      connectionGeneration: 2,
      verifiedConnections: {
        conn_valid: {
          connectionKey: 'conn_valid',
          activationId: 'act_valid_28',
          sessionId: 'sess_active_28',
          connectionGeneration: 2,
          verifiedAtEpoch: baseEpoch,
        },
      },
    };
    const userPresence = {
      conn_stale: { sessionId: 'sess_old_28', activationId: 'act_old', connectionGeneration: 1 },
      conn_valid: { sessionId: 'sess_active_28', activationId: 'act_valid_28', connectionGeneration: 2 },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, true);
    assert.strictEqual(validation.validConnectionsCount, 1);
    assert.strictEqual(validation.staleConnectionKeys.length, 1);
    assert.strictEqual(validation.validConnectionKeys[0], 'conn_valid');
  });

  // -------------------------------------------------------------------------
  // Test 29: Admin Validation — Admin reconciliation racing with new activation
  // -------------------------------------------------------------------------
  await test('Admin Validation 9: Admin reconciliation blocked during new activation handshake', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_recon_race_29';
    setMockTime(baseEpoch);

    await mockDb.ref(`activity/${uid}`).set({
      currentStatus: 'online',
      activeSessionId: 'sess_29',
      connectionGeneration: 5,
      pendingActivations: {
        conn_new: {
          activationId: 'act_29',
          sessionId: 'sess_29',
          expiresAtEpoch: baseEpoch + 15000,
        },
      },
    });

    const validation = validateUserPresence(null, (await mockDb.ref(`activity/${uid}`).once('value')).val(), baseEpoch);
    assert.strictEqual(validation.hasPendingActivation, true);

    // reconcileOrphanedPresence must refuse to finalize
    const recRes = await reconcileOrphanedPresence(mockDb, uid, baseEpoch);
    assert.strictEqual(recRes, null, 'Reconciliation must be blocked by active lease');
  });

  // -------------------------------------------------------------------------
  // Test 30: The Exact Scenario — A fails Phase C, rollback delayed, B succeeds for same session
  // -------------------------------------------------------------------------
  await test('Verified Registry 1: Activation A fails Phase C with delayed rollback; B succeeds -> Only B is counted', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_scenario_30';
    setMockTime(baseEpoch);

    // Initial state: User logged in with active session S
    const sessionId = 'sess_shared_30';
    await mockDb.ref(`activity/${uid}`).set({
      currentStatus: 'online',
      activeSessionId: sessionId,
      connectionGeneration: 1,
      totalTimeSpentSeconds: 100,
      verifiedConnections: {},
    });

    // 1. Activation A reserves connection conn_A
    await mockDb.ref(`reservations/${uid}/conn_A`).set({
      sessionId,
      expiresAt: baseEpoch + 60000,
    });

    // 2. Activation A executes, writes presence, but fails Phase C (we simulate lease expiring during write)
    const actAResult = await activateConnection(mockDb, {
      uid,
      connectionKey: 'conn_A',
      sessionId,
      serverEpoch: baseEpoch,
      hooks: {
        afterPresenceWrite: async () => {
          // Advance time beyond lease before Phase C runs
          setMockTime(baseEpoch + 20000);
        },
        beforeRollbackCommit: async () => {
          // Compensating rollback for A is delayed / paused
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
      },
    });

    assert.strictEqual(actAResult.activated, false, 'Activation A must fail Phase C');
    assert.strictEqual(actAResult.reason, 'activation_lease_expired');

    // 3. Activation B reserves and activates on conn_B for the SAME session S
    setMockTime(baseEpoch + 20001);
    await mockDb.ref(`reservations/${uid}/conn_B`).set({
      sessionId,
      expiresAt: baseEpoch + 80000,
    });

    const actBResult = await activateConnection(mockDb, {
      uid,
      connectionKey: 'conn_B',
      sessionId,
      serverEpoch: baseEpoch + 20001,
    });

    assert.strictEqual(actBResult.activated, true, 'Activation B must succeed');

    // 4. Manually re-insert A's presence record to simulate delayed rollback state in RTDB
    await mockDb.ref(`presence/${uid}/conn_A`).set({
      sessionId,
      activationId: actAResult.activationId || 'act_A',
      connectedAt: new Date(baseEpoch).toISOString(),
    });

    // 5. Admin reads both presence and activity
    const presenceSnap = (await mockDb.ref(`presence/${uid}`).once('value')).val();
    const activitySnap = (await mockDb.ref(`activity/${uid}`).once('value')).val();

    assert.ok(presenceSnap.conn_A, 'A presence record exists');
    assert.ok(presenceSnap.conn_B, 'B presence record exists');

    // 6. Admin runs validateUserPresence
    const validation = validateUserPresence(presenceSnap, activitySnap, baseEpoch + 20002);

    // CRITICAL ASSERTION: ONLY B is counted!
    assert.strictEqual(validation.isOnline, true);
    assert.strictEqual(validation.validConnectionsCount, 1, 'ONLY verified activation B must be counted');
    assert.strictEqual(validation.validConnectionKeys[0], 'conn_B');
    assert.ok(validation.staleConnectionKeys.includes('conn_A'), 'Unverified activation A must be marked stale');
  });

  // -------------------------------------------------------------------------
  // Test 31: Multi-Tab Concurrency — Both tabs successfully activate
  // -------------------------------------------------------------------------
  await test('Verified Registry 2: Tabs A and B both successfully activate in separate tabs', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_multitab_31';
    setMockTime(baseEpoch);
    const sessionId = 'sess_multitab_31';

    await mockDb.ref(`activity/${uid}`).set({
      currentStatus: 'online',
      activeSessionId: sessionId,
      connectionGeneration: 1,
    });

    // Tab 1 activates
    await mockDb.ref(`reservations/${uid}/conn_tab1`).set({ sessionId, expiresAt: baseEpoch + 60000 });
    const res1 = await activateConnection(mockDb, { uid, connectionKey: 'conn_tab1', sessionId, serverEpoch: baseEpoch });
    assert.strictEqual(res1.activated, true);

    // Tab 2 activates
    await mockDb.ref(`reservations/${uid}/conn_tab2`).set({ sessionId, expiresAt: baseEpoch + 60000 });
    const res2 = await activateConnection(mockDb, { uid, connectionKey: 'conn_tab2', sessionId, serverEpoch: baseEpoch });
    assert.strictEqual(res2.activated, true);

    const presenceSnap = (await mockDb.ref(`presence/${uid}`).once('value')).val();
    const activitySnap = (await mockDb.ref(`activity/${uid}`).once('value')).val();

    const validation = validateUserPresence(presenceSnap, activitySnap, baseEpoch);
    assert.strictEqual(validation.isOnline, true);
    assert.strictEqual(validation.validConnectionsCount, 2, 'Both tabs must be counted in verified registry');
    assert.ok(validation.validConnectionKeys.includes('conn_tab1'));
    assert.ok(validation.validConnectionKeys.includes('conn_tab2'));
  });

  // -------------------------------------------------------------------------
  // Test 32: One valid tab disconnects, remaining tab stays online
  // -------------------------------------------------------------------------
  await test('Verified Registry 3: One valid tab disconnects, remaining tab stays online', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_disconnect_32';
    setMockTime(baseEpoch);
    const sessionId = 'sess_disc_32';

    await mockDb.ref(`activity/${uid}`).set({ currentStatus: 'online', activeSessionId: sessionId });

    await mockDb.ref(`reservations/${uid}/conn_t1`).set({ sessionId, expiresAt: baseEpoch + 60000 });
    await mockDb.ref(`reservations/${uid}/conn_t2`).set({ sessionId, expiresAt: baseEpoch + 60000 });
    await activateConnection(mockDb, { uid, connectionKey: 'conn_t1', sessionId, serverEpoch: baseEpoch });
    await activateConnection(mockDb, { uid, connectionKey: 'conn_t2', sessionId, serverEpoch: baseEpoch });

    // Tab 1 disconnects (socket onDisconnect removes presence)
    await mockDb.ref(`presence/${uid}/conn_t1`).remove();

    const presenceSnap = (await mockDb.ref(`presence/${uid}`).once('value')).val();
    const activitySnap = (await mockDb.ref(`activity/${uid}`).once('value')).val();

    const validation = validateUserPresence(presenceSnap, activitySnap, baseEpoch);
    assert.strictEqual(validation.isOnline, true);
    assert.strictEqual(validation.validConnectionsCount, 1);
    assert.strictEqual(validation.validConnectionKeys[0], 'conn_t2');
  });

  // -------------------------------------------------------------------------
  // Test 33: An expired activation cannot enter verified registry
  // -------------------------------------------------------------------------
  await test('Verified Registry 4: Expired activation cannot enter verified registry', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_expired_33';
    setMockTime(baseEpoch);
    const sessionId = 'sess_33';

    await mockDb.ref(`reservations/${uid}/conn_exp`).set({ sessionId, expiresAt: baseEpoch + 60000 });
    const res = await activateConnection(mockDb, {
      uid,
      connectionKey: 'conn_exp',
      sessionId,
      serverEpoch: baseEpoch,
      hooks: {
        afterPresenceWrite: async () => {
          setMockTime(baseEpoch + 16000); // Exceed 15s TTL
        },
      },
    });

    assert.strictEqual(res.activated, false);
    const act = (await mockDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(act?.verifiedConnections?.conn_exp, undefined, 'Expired activation must NOT be in verified registry');
  });

  // -------------------------------------------------------------------------
  // Test 34: A superseded activation cannot enter verified registry
  // -------------------------------------------------------------------------
  await test('Verified Registry 5: Superseded activation cannot enter verified registry', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_superseded_34';
    setMockTime(baseEpoch);
    const sessionId = 'sess_34';

    await mockDb.ref(`reservations/${uid}/conn_super`).set({ sessionId, expiresAt: baseEpoch + 60000 });

    const resA = await activateConnection(mockDb, {
      uid,
      connectionKey: 'conn_super',
      sessionId,
      serverEpoch: baseEpoch,
      hooks: {
        afterPresenceWrite: async () => {
          // B overwrites pending activation with a newer activationId
          const act = (await mockDb.ref(`activity/${uid}`).once('value')).val();
          act.pendingActivations.conn_super = {
            activationId: 'act_newer_34',
            connectionKey: 'conn_super',
            sessionId,
            expiresAtEpoch: baseEpoch + 15000,
          };
          await mockDb.ref(`activity/${uid}`).set(act);
        },
      },
    });

    assert.strictEqual(resA.activated, false);
    const act = (await mockDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(act?.verifiedConnections?.conn_super, undefined, 'Superseded activation must not be in verifiedConnections');
  });

  // -------------------------------------------------------------------------
  // Test 35: Old-session activation cannot enter new session's registry
  // -------------------------------------------------------------------------
  await test('Verified Registry 6: Old-session activation cannot enter new session registry', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_oldsess_35';
    setMockTime(baseEpoch);

    await mockDb.ref(`reservations/${uid}/conn_old`).set({ sessionId: 'sess_old_35', expiresAt: baseEpoch + 60000 });

    const res = await activateConnection(mockDb, {
      uid,
      connectionKey: 'conn_old',
      sessionId: 'sess_old_35',
      serverEpoch: baseEpoch,
      hooks: {
        afterPresenceWrite: async () => {
          // Session changed to sess_new_35
          const act = (await mockDb.ref(`activity/${uid}`).once('value')).val();
          act.activeSessionId = 'sess_new_35';
          await mockDb.ref(`activity/${uid}`).set(act);
        },
      },
    });

    assert.strictEqual(res.activated, false);
    const act = (await mockDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(act?.verifiedConnections?.conn_old, undefined);
  });

  // -------------------------------------------------------------------------
  // Test 36: Stale registry entry without presence is not counted
  // -------------------------------------------------------------------------
  await test('Verified Registry 7: Stale registry entry without presence is not counted', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_36',
      connectionGeneration: 1,
      verifiedConnections: {
        conn_ghost: {
          connectionKey: 'conn_ghost',
          activationId: 'act_ghost',
          sessionId: 'sess_36',
          connectionGeneration: 1,
          verifiedAtEpoch: baseEpoch,
        },
      },
    };
    const userPresence = {}; // No presence records in RTDB

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, false);
    assert.strictEqual(validation.validConnectionsCount, 0);
  });

  // -------------------------------------------------------------------------
  // Test 37: Mismatched activationId is not counted
  // -------------------------------------------------------------------------
  await test('Verified Registry 8: Mismatched activationId is marked stale', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_37',
      connectionGeneration: 1,
      verifiedConnections: {
        conn_37: {
          connectionKey: 'conn_37',
          activationId: 'act_verified_37',
          sessionId: 'sess_37',
          connectionGeneration: 1,
          verifiedAtEpoch: baseEpoch,
        },
      },
    };
    const userPresence = {
      conn_37: {
        sessionId: 'sess_37',
        activationId: 'act_tampered_or_stale',
        connectionGeneration: 1,
      },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, false);
    assert.strictEqual(validation.validConnectionsCount, 0);
    assert.strictEqual(validation.staleConnectionKeys[0], 'conn_37');
  });

  // -------------------------------------------------------------------------
  // Test 38: Session finalization clears verified registry
  // -------------------------------------------------------------------------
  await test('Verified Registry 9: Session finalization invalidates previous registry', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_fin_reg_38';
    setMockTime(baseEpoch);
    const sessionId = 'sess_38';

    await mockDb.ref(`activity/${uid}`).set({
      currentStatus: 'online',
      activeSessionId: sessionId,
      sessionStartEpoch: baseEpoch,
      totalTimeSpentSeconds: 0,
      verifiedConnections: {
        conn_1: { connectionKey: 'conn_1', activationId: 'act_1', sessionId, verifiedAtEpoch: baseEpoch },
      },
    });

    const finRes = await finalizeUserSessionAtomic(mockDb, uid, {
      targetSessionId: sessionId,
      reason: 'explicit_logout',
      serverEpoch: baseEpoch + 5000,
    });

    assert.strictEqual(finRes.finalized, true);
    const actAfter = (await mockDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(actAfter.currentStatus, 'offline');
    assert.deepStrictEqual(actAfter.verifiedConnections, {}, 'verifiedConnections must be emptied on finalization');
  });

  // -------------------------------------------------------------------------
  // Test 39: Concurrent activation and Admin reconciliation preserve newer valid session
  // -------------------------------------------------------------------------
  await test('Verified Registry 10: Reconciliation blocked during active lease preserves newer valid session', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_preserve_39';
    setMockTime(baseEpoch);
    const sessionId = 'sess_39';

    await mockDb.ref(`activity/${uid}`).set({
      currentStatus: 'online',
      activeSessionId: sessionId,
      connectionGeneration: 10,
      pendingActivations: {
        conn_39: {
          activationId: 'act_39',
          connectionKey: 'conn_39',
          sessionId,
          expiresAtEpoch: baseEpoch + 15000,
        },
      },
    });

    // Admin attempts reconciliation
    const recRes = await reconcileOrphanedPresence(mockDb, uid, baseEpoch);
    assert.strictEqual(recRes, null, 'Reconciliation must be refused while lease is active');

    const act = (await mockDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(act.currentStatus, 'online');
    assert.strictEqual(act.activeSessionId, sessionId);
  });

  // -------------------------------------------------------------------------
  // Test 40: Strict Generation 1: Missing presence generation is rejected as stale
  // -------------------------------------------------------------------------
  await test('Strict Generation 1: Missing presence generation is rejected as stale', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_gen_40',
      connectionGeneration: 2,
      verifiedConnections: {
        conn_40: {
          connectionKey: 'conn_40',
          activationId: 'act_40',
          sessionId: 'sess_gen_40',
          connectionGeneration: 2,
          verifiedAtEpoch: baseEpoch,
        },
      },
    };
    // Presence record missing connectionGeneration
    const userPresence = {
      conn_40: {
        sessionId: 'sess_gen_40',
        activationId: 'act_40',
      },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, false);
    assert.strictEqual(validation.validConnectionsCount, 0);
    assert.strictEqual(validation.staleConnectionKeys.length, 1);
    assert.strictEqual(validation.staleConnectionKeys[0], 'conn_40');
  });

  // -------------------------------------------------------------------------
  // Test 41: Strict Generation 2: Malformed presence generation is rejected as stale
  // -------------------------------------------------------------------------
  await test('Strict Generation 2: Malformed presence generation is rejected as stale', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_gen_41',
      connectionGeneration: 2,
      verifiedConnections: {
        conn_41: {
          connectionKey: 'conn_41',
          activationId: 'act_41',
          sessionId: 'sess_gen_41',
          connectionGeneration: 2,
          verifiedAtEpoch: baseEpoch,
        },
      },
    };
    // Presence record has malformed (non-integer or negative) connectionGeneration
    const userPresence = {
      conn_41: {
        sessionId: 'sess_gen_41',
        activationId: 'act_41',
        connectionGeneration: -1,
      },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, false);
    assert.strictEqual(validation.validConnectionsCount, 0);
    assert.strictEqual(validation.staleConnectionKeys[0], 'conn_41');
  });

  // -------------------------------------------------------------------------
  // Test 42: Strict Generation 3: Presence/registry generation mismatch is rejected as stale
  // -------------------------------------------------------------------------
  await test('Strict Generation 3: Presence/registry generation mismatch is rejected as stale', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_gen_42',
      connectionGeneration: 3,
      verifiedConnections: {
        conn_42: {
          connectionKey: 'conn_42',
          activationId: 'act_42',
          sessionId: 'sess_gen_42',
          connectionGeneration: 2,
          verifiedAtEpoch: baseEpoch,
        },
      },
    };
    // Presence record generation (3) differs from verified registry generation (2)
    const userPresence = {
      conn_42: {
        sessionId: 'sess_gen_42',
        activationId: 'act_42',
        connectionGeneration: 3,
      },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, false);
    assert.strictEqual(validation.validConnectionsCount, 0);
    assert.strictEqual(validation.staleConnectionKeys[0], 'conn_42');
  });

  // -------------------------------------------------------------------------
  // Test 43: Strict Generation 4: Registry/activity generation mismatch is rejected as stale
  // -------------------------------------------------------------------------
  await test('Strict Generation 4: Registry/activity generation mismatch (exceeds activity generation) is rejected as stale', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_gen_43',
      connectionGeneration: 2,
      verifiedConnections: {
        conn_43: {
          connectionKey: 'conn_43',
          activationId: 'act_43',
          sessionId: 'sess_gen_43',
          connectionGeneration: 5, // Exceeds activity generation (2)
          verifiedAtEpoch: baseEpoch,
        },
      },
    };
    const userPresence = {
      conn_43: {
        sessionId: 'sess_gen_43',
        activationId: 'act_43',
        connectionGeneration: 5,
      },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, false);
    assert.strictEqual(validation.validConnectionsCount, 0);
    assert.strictEqual(validation.staleConnectionKeys[0], 'conn_43');
  });

  // -------------------------------------------------------------------------
  // Test 44: Strict Generation 5: Multiple valid tabs sharing appropriate active generation
  // -------------------------------------------------------------------------
  await test('Strict Generation 5: Multiple valid tabs sharing the appropriate active generation', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_gen_44',
      connectionGeneration: 2,
      sessionStartGeneration: 2,
      verifiedConnections: {
        conn_tab_a: {
          connectionKey: 'conn_tab_a',
          activationId: 'act_tab_a',
          sessionId: 'sess_gen_44',
          connectionGeneration: 2,
          verifiedAtEpoch: baseEpoch,
        },
        conn_tab_b: {
          connectionKey: 'conn_tab_b',
          activationId: 'act_tab_b',
          sessionId: 'sess_gen_44',
          connectionGeneration: 2,
          verifiedAtEpoch: baseEpoch,
        },
      },
    };
    const userPresence = {
      conn_tab_a: { sessionId: 'sess_gen_44', activationId: 'act_tab_a', connectionGeneration: 2 },
      conn_tab_b: { sessionId: 'sess_gen_44', activationId: 'act_tab_b', connectionGeneration: 2 },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, true);
    assert.strictEqual(validation.presenceStatus, 'online');
    assert.strictEqual(validation.validConnectionsCount, 2);
    assert.ok(validation.validConnectionKeys.includes('conn_tab_a'));
    assert.ok(validation.validConnectionKeys.includes('conn_tab_b'));
  });

  // -------------------------------------------------------------------------
  // Test 45: Strict Generation 6: Old-generation presence rejected after a new session begins
  // -------------------------------------------------------------------------
  await test('Strict Generation 6: Old-generation presence rejected after a new session begins', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_new_45',
      connectionGeneration: 5,
      sessionStartGeneration: 4, // Current session started at generation 4
      verifiedConnections: {
        conn_old: {
          connectionKey: 'conn_old',
          activationId: 'act_old',
          sessionId: 'sess_new_45',
          connectionGeneration: 2, // Belongs to generation 2 (before sessionStartGeneration 4)
          verifiedAtEpoch: baseEpoch,
        },
      },
    };
    const userPresence = {
      conn_old: {
        sessionId: 'sess_new_45',
        activationId: 'act_old',
        connectionGeneration: 2,
      },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, false);
    assert.strictEqual(validation.validConnectionsCount, 0);
    assert.strictEqual(validation.staleConnectionKeys[0], 'conn_old');
  });

  // -------------------------------------------------------------------------
  // Test 46: Status Semantics 1: Pending-only activity is not reported as confirmed online
  // -------------------------------------------------------------------------
  await test('Status Semantics 1: Pending-only activity is not reported as confirmed online', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_pending_46',
      connectionGeneration: 1,
      pendingActivations: {
        conn_pend_46: {
          activationId: 'act_pend_46',
          sessionId: 'sess_pending_46',
          connectionGeneration: 1,
          expiresAtEpoch: baseEpoch + 15000,
        },
      },
      verifiedConnections: {},
    };
    const userPresence = {};

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, false, 'isOnline must be false when zero verified connections exist');
    assert.strictEqual(validation.validConnectionsCount, 0);
  });

  // -------------------------------------------------------------------------
  // Test 47: Status Semantics 2: Pending-only activity evaluates to presenceStatus: pending
  // -------------------------------------------------------------------------
  await test('Status Semantics 2: Pending-only activity evaluates to presenceStatus: pending', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_pending_47',
      connectionGeneration: 1,
      pendingActivations: {
        conn_pend_47: {
          activationId: 'act_pend_47',
          sessionId: 'sess_pending_47',
          connectionGeneration: 1,
          expiresAtEpoch: baseEpoch + 15000,
        },
      },
    };
    const userPresence = {};

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.presenceStatus, 'pending');
    assert.strictEqual(validation.hasPendingActivation, true);
    assert.strictEqual(validation.validConnectionsCount, 0);
  });

  // -------------------------------------------------------------------------
  // Test 48: Status Semantics 3: Pending activation still blocks premature reconciliation/finalization
  // -------------------------------------------------------------------------
  await test('Status Semantics 3: Pending activation still blocks premature reconciliation and finalization', async () => {
    const mockDb = new InMemoryRTDB();
    const uid = 'user_test_semantics_48';
    setMockTime(baseEpoch);
    const sessionId = 'sess_48';

    await mockDb.ref(`activity/${uid}`).set({
      currentStatus: 'online',
      activeSessionId: sessionId,
      connectionGeneration: 3,
      pendingActivations: {
        conn_in_flight: {
          activationId: 'act_48',
          sessionId,
          expiresAtEpoch: baseEpoch + 15000,
        },
      },
    });

    // 1. Reconcile attempt while pending lease is active
    const recRes = await reconcileOrphanedPresence(mockDb, uid, baseEpoch);
    assert.strictEqual(recRes, null, 'Reconciliation must be blocked by active lease');

    // 2. Direct atomic finalization attempt while pending lease is active
    const finRes = await finalizeUserSessionAtomic(mockDb, uid, {
      targetSessionId: sessionId,
      reason: 'connection_lost',
      serverEpoch: baseEpoch,
    });
    assert.strictEqual(finRes.finalized, false, 'finalizeUserSessionAtomic must abort cleanly when lease is active');

    const actCheck = (await mockDb.ref(`activity/${uid}`).once('value')).val();
    assert.strictEqual(actCheck.currentStatus, 'online', 'User must remain online in activity during pending handshake');
  });

  // -------------------------------------------------------------------------
  // Test 49: Status Semantics 4: One verified connection evaluates to ONLINE
  // -------------------------------------------------------------------------
  await test('Status Semantics 4: One verified connection evaluates to ONLINE with count 1', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_one_49',
      connectionGeneration: 1,
      verifiedConnections: {
        conn_49: {
          connectionKey: 'conn_49',
          activationId: 'act_49',
          sessionId: 'sess_one_49',
          connectionGeneration: 1,
          verifiedAtEpoch: baseEpoch,
        },
      },
    };
    const userPresence = {
      conn_49: { sessionId: 'sess_one_49', activationId: 'act_49', connectionGeneration: 1 },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, true);
    assert.strictEqual(validation.presenceStatus, 'online');
    assert.strictEqual(validation.validConnectionsCount, 1);
  });

  // -------------------------------------------------------------------------
  // Test 50: Status Semantics 5: Two verified connections show the correct count
  // -------------------------------------------------------------------------
  await test('Status Semantics 5: Two verified connections show the correct count of 2', async () => {
    const userActivity = {
      currentStatus: 'online',
      activeSessionId: 'sess_two_50',
      connectionGeneration: 2,
      sessionStartGeneration: 1,
      verifiedConnections: {
        conn_t1: {
          connectionKey: 'conn_t1',
          activationId: 'act_t1',
          sessionId: 'sess_two_50',
          connectionGeneration: 1,
          verifiedAtEpoch: baseEpoch,
        },
        conn_t2: {
          connectionKey: 'conn_t2',
          activationId: 'act_t2',
          sessionId: 'sess_two_50',
          connectionGeneration: 2,
          verifiedAtEpoch: baseEpoch,
        },
      },
    };
    const userPresence = {
      conn_t1: { sessionId: 'sess_two_50', activationId: 'act_t1', connectionGeneration: 1 },
      conn_t2: { sessionId: 'sess_two_50', activationId: 'act_t2', connectionGeneration: 2 },
    };

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, true);
    assert.strictEqual(validation.presenceStatus, 'online');
    assert.strictEqual(validation.validConnectionsCount, 2);
  });

  // -------------------------------------------------------------------------
  // Test 51: Status Semantics 6: No valid connection and no pending lease is OFFLINE
  // -------------------------------------------------------------------------
  await test('Status Semantics 6: No valid connection and no pending lease evaluates to OFFLINE', async () => {
    const userActivity = {
      currentStatus: 'offline',
      activeSessionId: null,
      verifiedConnections: {},
    };
    const userPresence = {};

    const validation = validateUserPresence(userPresence, userActivity, baseEpoch);
    assert.strictEqual(validation.isOnline, false);
    assert.strictEqual(validation.presenceStatus, 'offline');
    assert.strictEqual(validation.validConnectionsCount, 0);
  });

  console.log('\n================================================================');
  console.log(`SUMMARY: ${passed}/${total} Fenced Activation Protocol Tests Passed`);
  console.log(`STATUS: ${passed === total ? `ALL ${total} CONCURRENCY CHECKS PASSED` : 'FAILURES DETECTED'}`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPendingActivationSuite();
