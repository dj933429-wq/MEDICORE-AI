import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { initializeApp as initAdminApp, getApps as getAdminApps } from 'firebase-admin/app';
import { getDatabase as getAdminDatabase } from 'firebase-admin/database';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  activateConnection,
  finalizeUserSessionAtomic,
  rollbackPresenceRecord,
  validateUserPresence,
  reconcileOrphanedPresence,
} from '../src/lib/rtdbSession.ts';

/**
 * MEDICORE-AI — Official Firebase Realtime Database Local Emulator Verification Suite
 * Executes against local emulator infrastructure ONLY (FIREBASE_DATABASE_EMULATOR_HOST).
 * Exercises actual production functions and authenticated security rules.
 * Never contacts production Firebase or uses production credentials.
 */
async function runEmulatorSuite() {
  console.log('================================================================');
  console.log('MEDICORE-AI: Native Firebase RTDB Emulator Verification Suite');
  console.log('Exercising Production Functions & Authenticated Rules Locally');
  console.log('================================================================\n');

  // 1. Explicitly confirm and enforce emulator host
  const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (!emulatorHost || (!emulatorHost.includes('127.0.0.1') && !emulatorHost.includes('localhost'))) {
    console.error('[FATAL] FIREBASE_DATABASE_EMULATOR_HOST is not set or not localhost:', emulatorHost);
    console.error('Refusing to run tests without verified local emulator environment.');
    process.exit(1);
  }

  console.log(`[CONFIRMED] Emulator Host: ${emulatorHost}`);

  // Use the local project namespace configured with database.rules.json
  const projectId = 'medicore-ai-exhibition';
  const emulatorDbUrl = `http://${emulatorHost}/?ns=${projectId}-default-rtdb`;

  console.log(`[CONFIRMED] Isolated Emulator Namespace: ${projectId}-default-rtdb\n`);

  // Initialize Admin SDK instance 1
  const adminApp = getAdminApps().find((a) => a.name === 'admin-emulator-app')
    || initAdminApp({
        projectId,
        databaseURL: emulatorDbUrl,
      }, 'admin-emulator-app');

  const adminDb = getAdminDatabase(adminApp);

  // Initialize Admin SDK instance 2 to simulate concurrent distinct actors
  const adminApp2 = getAdminApps().find((a) => a.name === 'admin-emulator-app-2')
    || initAdminApp({
        projectId,
        databaseURL: emulatorDbUrl,
      }, 'admin-emulator-app-2');

  const adminDb2 = getAdminDatabase(adminApp2);

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
    }
  }

  const baseEpoch = Date.now();
  const testUid = `emu_user_${baseEpoch}`;

  // -------------------------------------------------------------------------
  // Test 1: Native RTDB Concurrent Transactions (Optimistic Concurrency & Retry)
  // -------------------------------------------------------------------------
  await test('Native RTDB: Concurrent transactions resolve without lost updates', async () => {
    const uid1 = `${testUid}_t1`;
    const testPath = `test_native_retry/${uid1}`;
    await adminDb.ref(testPath).set({ counter: 1, lastWriter: 'init' });
    await adminDb.ref(testPath).once('value');

    // Run two transactions simultaneously from two distinct connections
    const tx1 = adminDb.ref(testPath).transaction((current) => {
      if (!current) return current;
      return { counter: current.counter + 1, lastWriter: 'writer1' };
    });

    const tx2 = adminDb2.ref(testPath).transaction((current) => {
      if (!current) return current;
      return { counter: current.counter + 10, lastWriter: 'writer2' };
    });

    const [res1, res2] = await Promise.all([tx1, tx2]);
    assert.strictEqual(res1.committed, true, 'Tx1 must commit');
    assert.strictEqual(res2.committed, true, 'Tx2 must commit');

    const finalSnap = (await adminDb.ref(testPath).once('value')).val();
    assert.strictEqual(finalSnap.counter, 12, 'Counter must be 1 + 1 + 10 = 12 from atomic serialization');
  });

  // -------------------------------------------------------------------------
  // Test 2: Production rollbackPresenceRecord() Under Emulator
  // -------------------------------------------------------------------------
  await test('Production rollbackPresenceRecord: Aborts transaction when newer activation replaces record', async () => {
    const uid2 = `${testUid}_t2`;
    const connKey = `conn_emu_rollback_${baseEpoch}`;

    // A writes presence with activationId A
    await adminDb.ref(`presence/${uid2}/${connKey}`).set({
      sessionId: 'sess_A',
      activationId: 'act_A',
      connectedAt: new Date().toISOString(),
    });

    // A begins rollback, but B replaces the record before A's transaction commits
    const rollbackRes = await rollbackPresenceRecord(adminDb, {
      uid: uid2,
      connectionKey: connKey,
      activationId: 'act_A',
      beforeRollbackCommit: async () => {
        // Concurrent actor B overwrites presence with activationId B via separate connection
        await adminDb2.ref(`presence/${uid2}/${connKey}`).set({
          sessionId: 'sess_B',
          activationId: 'act_B',
          connectedAt: new Date().toISOString(),
        });
      },
    });

    assert.strictEqual(rollbackRes.rolledBack, false, 'Rollback must abort when activationId changed');
    assert.strictEqual(rollbackRes.reason, 'superseded_by_newer');

    const presSnap = (await adminDb.ref(`presence/${uid2}/${connKey}`).once('value')).val();
    assert.ok(presSnap !== null, 'B record must survive');
    assert.strictEqual(presSnap.activationId, 'act_B', 'Presence must remain owned by B');
  });

  // -------------------------------------------------------------------------
  // Test 3: Production activateConnection() Exercised Against Emulator
  // -------------------------------------------------------------------------
  await test('Production activateConnection: Successfully establishes active session & verified registry in emulator', async () => {
    const now = Date.now();
    const uid3 = `${testUid}_t3_prod`;
    const sess3 = `sess_prod_${now}`;
    const conn3 = `conn_prod_${now}`;

    // Seed reservation in emulator
    await adminDb.ref(`reservations/${uid3}/${conn3}`).set({
      sessionId: sess3,
      expiresAt: now + 60000,
      role: 'patient',
    });

    // Invoke actual production function activateConnection against emulator
    const actResult = await activateConnection(adminDb, {
      uid: uid3,
      connectionKey: conn3,
      sessionId: sess3,
      role: 'patient',
      serverEpoch: now,
    });

    assert.strictEqual(actResult.activated, true, `activateConnection must succeed in emulator: ${actResult.reason}`);
    assert.strictEqual(actResult.connectionKey, conn3);
    assert.strictEqual(actResult.sessionId, sess3);

    // Verify activity state in emulator
    const activitySnap = (await adminDb.ref(`activity/${uid3}`).once('value')).val();
    assert.strictEqual(activitySnap.currentStatus, 'online');
    assert.strictEqual(activitySnap.activeSessionId, sess3);
    assert.ok(activitySnap.verifiedConnections?.[conn3], 'Connection must be registered in verifiedConnections');
    assert.strictEqual(activitySnap.verifiedConnections[conn3].activationId, actResult.activationId);

    // Verify presence record created in emulator
    const presenceSnap = (await adminDb.ref(`presence/${uid3}/${conn3}`).once('value')).val();
    assert.strictEqual(presenceSnap.sessionId, sess3);
    assert.strictEqual(presenceSnap.activationId, actResult.activationId);
  });

  // -------------------------------------------------------------------------
  // Test 4: Production validateUserPresence() and reconcileOrphanedPresence() Against Emulator
  // -------------------------------------------------------------------------
  await test('Production validateUserPresence & reconcileOrphanedPresence: Accurately validates and finalizes emulator state', async () => {
    const now = Date.now();
    const uid4 = `${testUid}_t4_val`;
    const sess4 = `sess_val_${now}`;
    const conn4 = `conn_val_${now}`;

    // 1. Create verified connection via activateConnection
    await adminDb.ref(`reservations/${uid4}/${conn4}`).set({ sessionId: sess4, expiresAt: now + 60000 });
    const actRes = await activateConnection(adminDb, { uid: uid4, connectionKey: conn4, sessionId: sess4, serverEpoch: now });
    assert.strictEqual(actRes.activated, true, `activateConnection must succeed in Test 4: ${actRes.reason}`);

    // Read state from emulator
    let presSnap = (await adminDb.ref(`presence/${uid4}`).once('value')).val();
    let actSnap = (await adminDb.ref(`activity/${uid4}`).once('value')).val();

    // Validate using production validateUserPresence
    const valResult = validateUserPresence(presSnap, actSnap, now);
    assert.strictEqual(valResult.isOnline, true);
    assert.strictEqual(valResult.validConnectionsCount, 1);
    assert.strictEqual(valResult.validConnectionKeys[0], conn4);

    // 2. Disconnect socket (remove presence from emulator)
    await adminDb.ref(`presence/${uid4}/${conn4}`).remove();

    presSnap = (await adminDb.ref(`presence/${uid4}`).once('value')).val();
    actSnap = (await adminDb.ref(`activity/${uid4}`).once('value')).val();

    // Validate again: now offline
    const valAfter = validateUserPresence(presSnap, actSnap, now);
    assert.strictEqual(valAfter.isOnline, false);
    assert.strictEqual(valAfter.validConnectionsCount, 0);

    // 3. Invoke actual production reconcileOrphanedPresence against emulator
    const recResult = await reconcileOrphanedPresence(adminDb, uid4, now + 1000);
    assert.ok(recResult !== null && recResult.finalized, 'reconcileOrphanedPresence must finalize in emulator');

    const actFinal = (await adminDb.ref(`activity/${uid4}`).once('value')).val();
    assert.strictEqual(actFinal.currentStatus, 'offline');
    assert.ok(!actFinal.activeSessionId, 'activeSessionId must be cleared');
    assert.deepStrictEqual(actFinal.verifiedConnections || {}, {});
  });

  // -------------------------------------------------------------------------
  // Test 5: Production finalizeUserSessionAtomic() Exercised Against Emulator
  // -------------------------------------------------------------------------
  await test('Production finalizeUserSessionAtomic: Invalidates session and clears verified registry in emulator', async () => {
    const now = Date.now();
    const uid5 = `${testUid}_t5_fin`;
    const sess5 = `sess_fin_${now}`;
    const conn5 = `conn_fin_${now}`;

    await adminDb.ref(`reservations/${uid5}/${conn5}`).set({ sessionId: sess5, expiresAt: now + 60000 });
    const actRes = await activateConnection(adminDb, { uid: uid5, connectionKey: conn5, sessionId: sess5, serverEpoch: now });
    assert.strictEqual(actRes.activated, true, `activateConnection must succeed in Test 5: ${actRes.reason}`);

    // Call actual production finalizeUserSessionAtomic
    const finRes = await finalizeUserSessionAtomic(adminDb, uid5, {
      targetSessionId: sess5,
      reason: 'explicit_logout',
      serverEpoch: now + 5000,
    });

    assert.strictEqual(finRes.finalized, true, 'finalizeUserSessionAtomic must commit');
    assert.strictEqual(finRes.reason, 'explicit_logout');

    const actSnap = (await adminDb.ref(`activity/${uid5}`).once('value')).val();
    assert.strictEqual(actSnap.currentStatus, 'offline');
    assert.ok(!actSnap.activeSessionId, 'activeSessionId must be cleared');
    assert.deepStrictEqual(actSnap.verifiedConnections || {}, {}, 'verifiedConnections must be emptied');
  });

  // -------------------------------------------------------------------------
  // Test 6: Native RTDB onDisconnect() Teardown
  // -------------------------------------------------------------------------
  await test('Native RTDB: onDisconnect().remove() teardown removes node on client disconnect', async () => {
    const uid6 = `${testUid}_t6_ondisc`;
    const connKey = `conn_emu_ondisconnect_${baseEpoch}`;
    const connRef = adminDb.ref(`presence/${uid6}/${connKey}`);

    await connRef.set({
      sessionId: 'sess_ondisc',
      activationId: 'act_ondisc',
      connectedAt: new Date().toISOString(),
    });

    await connRef.onDisconnect().remove();

    let snap = (await adminDb2.ref(`presence/${uid6}/${connKey}`).once('value')).val();
    assert.ok(snap !== null, 'Presence node exists while connected');

    await adminDb.goOffline();
    await new Promise((resolve) => setTimeout(resolve, 600));

    snap = (await adminDb2.ref(`presence/${uid6}/${connKey}`).once('value')).val();
    assert.strictEqual(snap, null, 'Node must be removed by RTDB emulator on connection disconnect');

    await adminDb.goOnline();
  });

  // -------------------------------------------------------------------------
  // Test 7: Multi-Tab Connection Ownership Under Local Emulator
  // -------------------------------------------------------------------------
  await test('Native RTDB: Multiple connection keys co-exist under emulator', async () => {
    const uid7 = `${testUid}_t7_multi`;
    const k1 = `conn_tab1_${baseEpoch}`;
    const k2 = `conn_tab2_${baseEpoch}`;

    await adminDb.ref(`presence/${uid7}/${k1}`).set({ sessionId: 'sess_multi', activationId: 'act_1' });
    await adminDb.ref(`presence/${uid7}/${k2}`).set({ sessionId: 'sess_multi', activationId: 'act_2' });

    const snap = (await adminDb.ref(`presence/${uid7}`).once('value')).val();
    assert.ok(snap[k1] && snap[k2], 'Both tabs present in emulator');
    assert.strictEqual(Object.keys(snap).length, 2);

    await adminDb.ref(`presence/${uid7}/${k1}`).remove();
    const snapAfter = (await adminDb.ref(`presence/${uid7}`).once('value')).val();
    assert.strictEqual(snapAfter[k1], undefined, 'Tab 1 removed');
    assert.ok(snapAfter[k2], 'Tab 2 remains untouched');
  });

  // -------------------------------------------------------------------------
  // Test 8: Authenticated Security Rules Validation (@firebase/rules-unit-testing)
  // -------------------------------------------------------------------------
  await test('Authenticated Security Rules: User A vs User B presence and activity permissions', async () => {
    const rules = readFileSync('database.rules.json', 'utf8');
    const testEnv = await initializeTestEnvironment({
      projectId: 'medicore-ai-exhibition',
      database: {
        host: '127.0.0.1',
        port: 9000,
        rules: rules,
      },
    });

    const userAContext = testEnv.authenticatedContext('userA');
    const userBContext = testEnv.authenticatedContext('userB');
    const userADb = userAContext.database();
    const userBDb = userBContext.database();

    const connKey = `conn_rules_${baseEpoch}`;

    // Seed User A presence node using Admin SDK (bypasses rules)
    await adminDb.ref(`presence/userA/${connKey}`).set({
      sessionId: 'sess_rules_A',
      activationId: 'act_rules_A',
    });

    // Seed User B presence node using Admin SDK
    await adminDb.ref(`presence/userB/${connKey}`).set({
      sessionId: 'sess_rules_B',
      activationId: 'act_rules_B',
    });

    // 1. User A CAN delete their own presence
    await assertSucceeds(userADb.ref(`presence/userA/${connKey}`).remove());

    // 2. User A CANNOT create presence
    await assertFails(userADb.ref(`presence/userA/${connKey}`).set({ rogue: 'data' }));

    // 3. User A CANNOT update presence
    await assertFails(userADb.ref(`presence/userA/${connKey}`).update({ rogue: 'update' }));

    // 4. User A CANNOT delete User B presence, and User B CANNOT delete User A presence
    await assertFails(userADb.ref(`presence/userB/${connKey}`).remove());
    await assertFails(userBDb.ref(`presence/userA/${connKey}`).remove());

    // 5. User A CANNOT write to /activity
    await assertFails(userADb.ref('activity/userA').set({ status: 'hacked' }));

    // 6. User A CANNOT write to /reservations
    await assertFails(userADb.ref('reservations/userA').set({ key: 'spoofed' }));

    // 7. Server-side Admin SDK operations remain permitted
    await adminDb.ref(`presence/userB/${connKey}`).remove();
    const snapB = (await adminDb.ref(`presence/userB/${connKey}`).once('value')).val();
    assert.strictEqual(snapB, null, 'Admin SDK deletion must succeed');

    await testEnv.cleanup();
  });

  // Cleanup test nodes in emulator
  await adminDb.ref(`presence`).remove().catch(() => {});
  await adminDb.ref(`activity`).remove().catch(() => {});
  await adminDb.ref(`test_native_retry`).remove().catch(() => {});
  await adminDb.ref(`reservations`).remove().catch(() => {});

  console.log('\n================================================================');
  console.log(`SUMMARY: ${passed}/${total} Native RTDB Emulator Checks Passed`);
  console.log(`STATUS: ${passed === total ? 'ALL NATIVE EMULATOR CHECKS PASSED' : 'FAILURES DETECTED'}`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runEmulatorSuite();
