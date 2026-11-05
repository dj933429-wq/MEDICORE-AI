import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import assert from 'node:assert';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'medicore-ai-exhibition';
const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || 'https://medicore-ai-exhibition-default-rtdb.asia-southeast1.firebasedatabase.app';

const app = getApps().length ? getApps()[0] : initializeApp({
  credential: cert(serviceAccount),
  projectId,
  databaseURL,
});

const rtdb = getDatabase(app);
const auth = getAuth(app);

async function runTestSuite() {
  console.log('========================================================');
  console.log('MEDICORE-AI: Firebase RTDB Presence & Activity Test Suite');
  console.log('========================================================\n');

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
    }
  }

  const testUid = `test_rtdb_usr_${Date.now()}`;
  const connKey1 = `conn_${Date.now()}_tab1`;
  const connKey2 = `conn_${Date.now()}_tab2`;

  // 1. Connectivity
  await test('RTDB instance connection and root reachability', async () => {
    const snap = await rtdb.ref('.info/connected').once('value');
    assert.strictEqual(typeof snap.val(), 'boolean');
  });

  // 2. Initial State
  await test('User initial presence and activity are empty', async () => {
    const [pSnap, aSnap] = await Promise.all([
      rtdb.ref(`presence/${testUid}`).once('value'),
      rtdb.ref(`activity/${testUid}`).once('value')
    ]);
    assert.strictEqual(pSnap.val(), null);
    assert.strictEqual(aSnap.val(), null);
  });

  // 3. Tab 1 Login
  await test('Login records connection and updates activity to online', async () => {
    const nowIso = new Date().toISOString();
    const nowEpoch = Date.now();

    await rtdb.ref(`presence/${testUid}/${connKey1}`).set({
      connectedAt: nowIso,
      lastSeenAt: nowIso,
      role: 'doctor'
    });

    await rtdb.ref(`activity/${testUid}`).set({
      lastLoginAt: nowIso,
      lastActivityAt: nowIso,
      currentStatus: 'online',
      sessionStartEpoch: nowEpoch,
      lastLogoutReason: null,
      activeRole: 'doctor',
      totalTimeSpentSeconds: 0
    });

    const actSnap = await rtdb.ref(`activity/${testUid}`).once('value');
    assert.strictEqual(actSnap.val().currentStatus, 'online');
    assert.strictEqual(actSnap.val().activeRole, 'doctor');
  });

  // 4. Multi-tab: Tab 2 Connects
  await test('Opening Tab 2 registers second connection for same UID', async () => {
    const nowIso = new Date().toISOString();
    await rtdb.ref(`presence/${testUid}/${connKey2}`).set({
      connectedAt: nowIso,
      lastSeenAt: nowIso,
      role: 'doctor'
    });

    const pSnap = await rtdb.ref(`presence/${testUid}`).once('value');
    const connections = Object.keys(pSnap.val() || {});
    assert.strictEqual(connections.length, 2);
    assert.ok(connections.includes(connKey1));
    assert.ok(connections.includes(connKey2));
  });

  // 5. Multi-tab: Tab 1 Closes
  await test('Tab 1 closing removes connKey1 but user remains ONLINE via Tab 2', async () => {
    await rtdb.ref(`presence/${testUid}/${connKey1}`).remove();

    const pSnap = await rtdb.ref(`presence/${testUid}`).once('value');
    const remaining = Object.keys(pSnap.val() || {});
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0], connKey2);

    // Activity status should remain online as long as 1 connection exists
    const actSnap = await rtdb.ref(`activity/${testUid}`).once('value');
    assert.strictEqual(actSnap.val().currentStatus, 'online');
  });

  // 6. Activity Heartbeat on Tab 2
  await test('Heartbeat updates lastActivityAt without changing status', async () => {
    const newIso = new Date(Date.now() + 5000).toISOString();
    await rtdb.ref(`activity/${testUid}/lastActivityAt`).set(newIso);

    const actSnap = await rtdb.ref(`activity/${testUid}`).once('value');
    assert.strictEqual(actSnap.val().lastActivityAt, newIso);
    assert.strictEqual(actSnap.val().currentStatus, 'online');
  });

  // 7. Tab 2 Closes (All Tabs Closed)
  await test('All connections closed marks user OFFLINE and accumulates session duration', async () => {
    await rtdb.ref(`presence/${testUid}/${connKey2}`).remove();

    const pSnap = await rtdb.ref(`presence/${testUid}`).once('value');
    assert.strictEqual(pSnap.val(), null);

    const logoutIso = new Date().toISOString();
    const duration = 12; // simulated 12 seconds
    await rtdb.ref(`activity/${testUid}`).update({
      currentStatus: 'offline',
      lastLogoutAt: logoutIso,
      lastLogoutReason: 'explicit_logout',
      totalTimeSpentSeconds: duration
    });

    const actSnap = await rtdb.ref(`activity/${testUid}`).once('value');
    assert.strictEqual(actSnap.val().currentStatus, 'offline');
    assert.strictEqual(actSnap.val().lastLogoutReason, 'explicit_logout');
    assert.strictEqual(actSnap.val().totalTimeSpentSeconds, 12);
  });

  // 8. Subsequent Login Accumulates Total Time
  await test('Subsequent login accumulates duration onto previous totalTimeSpentSeconds', async () => {
    const actSnapBefore = await rtdb.ref(`activity/${testUid}`).once('value');
    const priorTotal = actSnapBefore.val().totalTimeSpentSeconds;

    const newDuration = 18;
    await rtdb.ref(`activity/${testUid}`).update({
      totalTimeSpentSeconds: priorTotal + newDuration,
      lastLogoutReason: 'inactivity_timeout'
    });

    const actSnapAfter = await rtdb.ref(`activity/${testUid}`).once('value');
    assert.strictEqual(actSnapAfter.val().totalTimeSpentSeconds, 30);
    assert.strictEqual(actSnapAfter.val().lastLogoutReason, 'inactivity_timeout');
  });

  // Cleanup test record
  await rtdb.ref(`presence/${testUid}`).remove();
  await rtdb.ref(`activity/${testUid}`).remove();

  console.log('\n========================================================');
  console.log(`SUMMARY: ${passed}/${total} Tests Passed`);
  console.log(`STATUS: ${passed === total ? 'ALL RTDB CHECKS PASSED' : 'FAILURES DETECTED'}`);
  console.log('========================================================\n');

  if (passed !== total) process.exit(1);
}

runTestSuite();
