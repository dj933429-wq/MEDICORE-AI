import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import assert from 'node:assert';
import {
  finalizeUserSessionAtomic,
  reconcileOrphanedPresence,
  evaluateSessionCreation,
  handleDeletedConnectionReconciliation,
  reserveConnection,
  activateConnection,
} from '../src/lib/rtdbSession.ts';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'medicore-ai-exhibition';
const databaseURL =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
  'https://medicore-ai-exhibition-default-rtdb.asia-southeast1.firebasedatabase.app';

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert(serviceAccount),
      projectId,
      databaseURL,
    });

const rtdb = getDatabase(app);

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

  try {
    // ----------------------------------------------------
    // SECTION 1: RTDB CORE INTEGRATION TESTS
    // ----------------------------------------------------

    // 1. Connectivity
    await test('RTDB instance connection and root reachability', async () => {
      const snap = await rtdb.ref('.info/connected').once('value');
      assert.strictEqual(typeof snap.val(), 'boolean');
    });

    // 2. Initial State
    await test('User initial presence and activity are empty', async () => {
      const [pSnap, aSnap] = await Promise.all([
        rtdb.ref(`presence/${testUid}`).once('value'),
        rtdb.ref(`activity/${testUid}`).once('value'),
      ]);
      assert.strictEqual(pSnap.val(), null);
      assert.strictEqual(aSnap.val(), null);
    });

    // 3. Tab 1 Initial Login & Logical Session Minting
    const session1Id = `sess_${Date.now()}_initial`;
    const loginEpoch = Date.now() - 30000; // 30 seconds ago
    const loginIso = new Date(loginEpoch).toISOString();

    await test('Login records connection and creates logical session', async () => {
      await rtdb.ref(`presence/${testUid}/${connKey1}`).set({
        connectedAt: loginIso,
        lastSeenAt: loginIso,
        role: 'doctor',
        sessionId: session1Id,
      });

      await rtdb.ref(`activity/${testUid}`).set({
        lastLoginAt: loginIso,
        lastActivityAt: loginIso,
        currentStatus: 'online',
        sessionStartEpoch: loginEpoch,
        lastLogoutReason: null,
        activeRole: 'doctor',
        activeSessionId: session1Id,
        totalTimeSpentSeconds: 0,
      });

      const actSnap = await rtdb.ref(`activity/${testUid}`).once('value');
      assert.strictEqual(actSnap.val().currentStatus, 'online');
      assert.strictEqual(actSnap.val().activeSessionId, session1Id);
      assert.strictEqual(actSnap.val().lastLoginAt, loginIso);
    });

    // 4. Browser Refresh
    await test('Browser refresh preserves logical session, lastLoginAt, and sessionStartEpoch', async () => {
      // Step A: Old tab unmounts and removes its connection key
      await rtdb.ref(`presence/${testUid}/${connKey1}`).remove();

      const pSnapMid = await rtdb.ref(`presence/${testUid}`).once('value');
      assert.strictEqual(pSnapMid.val(), null, 'Old connection removed on unload');

      // Step B: Reloaded tab mounts within inactivity window and connects
      const actBefore = (await rtdb.ref(`activity/${testUid}`).once('value')).val();
      const lastActivityEpoch = new Date(actBefore.lastActivityAt).getTime();
      const nowEpoch = Date.now();
      const isWithinInactivity = nowEpoch - lastActivityEpoch <= 10 * 60 * 1000;

      assert.strictEqual(isWithinInactivity, true, 'Reload occurred within 10-minute inactivity window');
      assert.strictEqual(actBefore.currentStatus, 'online', 'Session still marked online');

      // Connection is re-established attached to the existing logical session
      const refreshConnKey = `conn_${Date.now()}_refreshed`;
      const refreshIso = new Date().toISOString();

      await rtdb.ref(`presence/${testUid}/${refreshConnKey}`).set({
        connectedAt: refreshIso,
        lastSeenAt: refreshIso,
        role: 'doctor',
        sessionId: actBefore.activeSessionId, // Reuses session
      });

      await rtdb.ref(`activity/${testUid}`).update({
        lastActivityAt: refreshIso,
      });

      const actAfter = (await rtdb.ref(`activity/${testUid}`).once('value')).val();
      assert.strictEqual(actAfter.activeSessionId, session1Id, 'Session ID preserved across reload');
      assert.strictEqual(actAfter.lastLoginAt, loginIso, 'Original lastLoginAt strictly preserved');
      assert.strictEqual(actAfter.sessionStartEpoch, loginEpoch, 'sessionStartEpoch preserved without duration loss');

      // Cleanup refresh conn
      await rtdb.ref(`presence/${testUid}/${refreshConnKey}`).remove();
    });

    // 5. Multi-Tab Presence Handling
    await test('Multi-tab: Tab 2 connects to same logical session; Tab 1 unmount keeps user online', async () => {
      const nowIso = new Date().toISOString();
      await rtdb.ref(`presence/${testUid}/${connKey1}`).set({ connectedAt: nowIso, lastSeenAt: nowIso, role: 'doctor', sessionId: session1Id });
      await rtdb.ref(`presence/${testUid}/${connKey2}`).set({ connectedAt: nowIso, lastSeenAt: nowIso, role: 'doctor', sessionId: session1Id });

      let pSnap = await rtdb.ref(`presence/${testUid}`).once('value');
      assert.strictEqual(Object.keys(pSnap.val() || {}).length, 2, '2 tabs connected');

      // Tab 1 closes
      await rtdb.ref(`presence/${testUid}/${connKey1}`).remove();
      pSnap = await rtdb.ref(`presence/${testUid}`).once('value');
      assert.strictEqual(Object.keys(pSnap.val() || {}).length, 1, '1 tab remaining');

      const actSnap = await rtdb.ref(`activity/${testUid}`).once('value');
      assert.strictEqual(actSnap.val().currentStatus, 'online', 'User remains online via Tab 2');
    });

    // 6. Explicit Logout Idempotency
    await test('Explicit logout finalizes session once; repeated logout calls do not double-count', async () => {
      // Remove remaining tab
      await rtdb.ref(`presence/${testUid}/${connKey2}`).remove();

      const serverEpoch = loginEpoch + 25000; // simulated 25s session
      const serverTime = new Date(serverEpoch).toISOString();

      // First logout call
      const res1 = await finalizeUserSessionAtomic(rtdb, testUid, {
        targetSessionId: session1Id,
        reason: 'explicit_logout',
        serverEpoch,
        serverTime,
      });

      assert.strictEqual(res1.finalized, true, 'First logout finalized successfully');
      assert.strictEqual(res1.totalTimeSpentSeconds, 25, 'Duration calculated as 25s');

      const actAfter1 = (await rtdb.ref(`activity/${testUid}`).once('value')).val();
      assert.strictEqual(actAfter1.currentStatus, 'offline');
      assert.strictEqual(actAfter1.lastLogoutReason, 'explicit_logout');
      assert.strictEqual(actAfter1.totalTimeSpentSeconds, 25);
      assert.ok(!actAfter1.activeSessionId, 'Active session cleared');

      // Second identical logout call (duplicate request / retry)
      const res2 = await finalizeUserSessionAtomic(rtdb, testUid, {
        targetSessionId: session1Id,
        reason: 'explicit_logout',
        serverEpoch: serverEpoch + 5000,
        serverTime: new Date(serverEpoch + 5000).toISOString(),
      });

      assert.strictEqual(res2.finalized, false, 'Duplicate logout was idempotent and did not re-finalize');

      const actAfter2 = (await rtdb.ref(`activity/${testUid}`).once('value')).val();
      assert.strictEqual(actAfter2.totalTimeSpentSeconds, 25, 'Duration NOT double-counted on repeated request');
    });

    // 7. Concurrency: Timeout followed by Explicit Logout
    await test('Timeout followed by explicit logout accumulates duration only once', async () => {
      const sess2Id = `sess_${Date.now()}_2`;
      const sess2Start = Date.now() - 10000;
      await rtdb.ref(`activity/${testUid}`).update({
        currentStatus: 'online',
        activeSessionId: sess2Id,
        sessionStartEpoch: sess2Start,
        totalTimeSpentSeconds: 25,
      });

      // Timeout fires
      const timeoutRes = await finalizeUserSessionAtomic(rtdb, testUid, {
        targetSessionId: sess2Id,
        reason: 'inactivity_timeout',
        serverEpoch: sess2Start + 10000,
      });
      assert.strictEqual(timeoutRes.finalized, true);
      assert.strictEqual(timeoutRes.totalTimeSpentSeconds, 35); // 25 + 10 = 35s

      // Explicit logout fires immediately after
      const logoutRes = await finalizeUserSessionAtomic(rtdb, testUid, {
        targetSessionId: sess2Id,
        reason: 'explicit_logout',
        serverEpoch: sess2Start + 12000,
      });
      assert.strictEqual(logoutRes.finalized, false, 'Explicit logout after timeout was ignored');

      const actCheck = (await rtdb.ref(`activity/${testUid}`).once('value')).val();
      assert.strictEqual(actCheck.totalTimeSpentSeconds, 35, 'Total time strictly 35s');
      assert.strictEqual(actCheck.lastLogoutReason, 'inactivity_timeout');
    });

    // 8. Delayed Request from Stale Session
    await test('Delayed logout from older session cannot terminate a newer session', async () => {
      const sess3Id = `sess_${Date.now()}_3`;
      const sess3Start = Date.now();
      await rtdb.ref(`activity/${testUid}`).update({
        currentStatus: 'online',
        activeSessionId: sess3Id,
        sessionStartEpoch: sess3Start,
        totalTimeSpentSeconds: 35,
      });

      const staleRes = await finalizeUserSessionAtomic(rtdb, testUid, {
        targetSessionId: 'sess_stale_old_id',
        reason: 'explicit_logout',
      });
      assert.strictEqual(staleRes.finalized, false, 'Stale session ID rejected');

      const actCheck = (await rtdb.ref(`activity/${testUid}`).once('value')).val();
      assert.strictEqual(actCheck.currentStatus, 'online', 'Session 3 remains active');
      assert.strictEqual(actCheck.activeSessionId, sess3Id);
    });

    // 9. Unexpected Disconnection Reconciliation
    await test('Unexpected disconnection: zero connections reconciles to offline with connection_lost', async () => {
      const pSnap = await rtdb.ref(`presence/${testUid}`).once('value');
      assert.strictEqual(pSnap.val(), null, '0 connections in presence');

      const reconcileRes = await reconcileOrphanedPresence(rtdb, testUid, Date.now() + 15000);
      assert.ok(reconcileRes !== null, 'Reconciliation occurred');
      assert.strictEqual(reconcileRes.finalized, true);
      assert.strictEqual(reconcileRes.reason, 'connection_lost');

      const actSnap = await rtdb.ref(`activity/${testUid}`).once('value');
      assert.strictEqual(actSnap.val().currentStatus, 'offline');
      assert.strictEqual(actSnap.val().lastLogoutReason, 'connection_lost');
      assert.ok(actSnap.val().totalTimeSpentSeconds >= 35, 'Accumulated duration preserved');
    });

    // 10. Security Rules Static Verification
    await test('Security rule verification: client-side connection creation denied; deletion allowed', async () => {
      const rulesJson = JSON.parse(
        await import('fs').then((fs) => fs.promises.readFile('database.rules.json', 'utf-8'))
      );
      assert.strictEqual(
        rulesJson.rules.presence.$uid.$connectionKey['.write'],
        'auth != null && auth.uid === $uid && !newData.exists()',
        'Delete-only rule enforced for clients'
      );
      assert.strictEqual(
        rulesJson.rules.activity.$uid['.write'],
        false,
        'Client-side write to /activity is strictly denied'
      );
    });

    // ----------------------------------------------------
    // SECTION 2: DEFECT 1 VERIFICATION — SECURE LOGIN RECOGNITION
    // ----------------------------------------------------

    const nowEpoch = Date.now();
    const nowSec = Math.floor(nowEpoch / 1000);

    // 11. Forged isExplicitLogin without recent authentication
    await test('Defect 1.1: Forged request without recent auth_time does not create new session', async () => {
      const oldAuthTime = nowSec - 300; // 5 minutes ago
      const token = { auth_time: oldAuthTime, uid: testUid, role: 'doctor' };
      const existingActivity = {
        currentStatus: 'online',
        activeSessionId: 'sess_active_123',
        lastLoginAt: '2026-11-05T20:00:00.000Z',
        lastActivityAt: new Date(nowEpoch - 10000).toISOString(), // 10s ago
        lastAuthTime: oldAuthTime,
      };

      const decision = evaluateSessionCreation(token, existingActivity, nowEpoch);
      assert.strictEqual(decision.isNewSession, false, 'Session must be reused, not reset');
      assert.strictEqual(decision.reason, 'reuse_active_session');
    });

    // 12. Valid recent Firebase authentication creates a new session
    await test('Defect 1.2: Valid recent Firebase authentication creates a new session', async () => {
      const freshAuthTime = nowSec - 5; // 5 seconds ago
      const token = { auth_time: freshAuthTime, uid: testUid, role: 'doctor' };
      const existingActivity = {
        currentStatus: 'online',
        activeSessionId: 'sess_prior_old',
        lastLoginAt: '2026-11-05T19:00:00.000Z',
        lastActivityAt: new Date(nowEpoch - 20000).toISOString(),
        lastAuthTime: freshAuthTime - 3600, // previous auth was 1 hour ago
      };

      const decision = evaluateSessionCreation(token, existingActivity, nowEpoch);
      assert.strictEqual(decision.isNewSession, true, 'Genuine new credential login creates new session');
      assert.strictEqual(decision.reason, 'new_credential_login');
      assert.strictEqual(decision.authTime, freshAuthTime);
    });

    // 13. Browser refresh reuses the existing session and preserves lastLoginAt
    await test('Defect 1.3: Browser refresh reuses existing session and preserves lastLoginAt', async () => {
      const originalAuthTime = nowSec - 20; // authenticated 20 seconds ago
      const token = { auth_time: originalAuthTime, uid: testUid, role: 'patient' };
      const originalLoginAt = '2026-11-05T22:00:00.000Z';
      const existingActivity = {
        currentStatus: 'online',
        activeSessionId: 'sess_keep_me',
        lastLoginAt: originalLoginAt,
        lastActivityAt: new Date(nowEpoch - 2000).toISOString(), // refreshed 2s ago
        lastAuthTime: originalAuthTime, // already recorded on initial login
      };

      const decision = evaluateSessionCreation(token, existingActivity, nowEpoch);
      assert.strictEqual(decision.isNewSession, false, 'Refresh reuses session even within 60s of login');
      assert.strictEqual(decision.reason, 'reuse_active_session');
    });

    // 14. Ordinary ID-token refresh does not create a new session
    await test('Defect 1.4: Ordinary ID-token refresh does not create a new session', async () => {
      const hourAgoAuthTime = nowSec - 3600; // token refreshed automatically after 1 hour, auth_time stays 1h ago
      const token = { auth_time: hourAgoAuthTime, uid: testUid, role: 'doctor' };
      const existingActivity = {
        currentStatus: 'online',
        activeSessionId: 'sess_hourly_active',
        lastLoginAt: new Date(nowEpoch - 3600000).toISOString(),
        lastActivityAt: new Date(nowEpoch - 30000).toISOString(), // active 30s ago
        lastAuthTime: hourAgoAuthTime,
      };

      const decision = evaluateSessionCreation(token, existingActivity, nowEpoch);
      assert.strictEqual(decision.isNewSession, false, 'Hourly token refresh must not reset session');
      assert.strictEqual(decision.reason, 'reuse_active_session');
    });

    // 15. Invalid or missing auth_time is rejected as proof of new login
    await test('Defect 1.5: Missing or invalid auth_time is rejected as proof of new login', async () => {
      const invalidTokens = [
        { uid: testUid }, // missing
        { auth_time: 'not-a-number', uid: testUid }, // string
        { auth_time: null, uid: testUid }, // null
        { auth_time: NaN, uid: testUid }, // NaN
      ];

      const existingActivity = {
        currentStatus: 'online',
        activeSessionId: 'sess_valid_running',
        lastActivityAt: new Date(nowEpoch - 5000).toISOString(),
        lastAuthTime: nowSec - 100,
      };

      for (const t of invalidTokens) {
        const decision = evaluateSessionCreation(t, existingActivity, nowEpoch);
        assert.strictEqual(decision.isNewSession, false, 'Invalid auth_time cannot create new session');
        assert.strictEqual(decision.reason, 'reuse_active_session');
      }
    });

    // 16. Future authentication timestamps are rejected
    await test('Defect 1.6: Future authentication timestamps do not establish a new login', async () => {
      const futureAuthTime = nowSec + 120; // 2 minutes in the future (beyond 5s skew tolerance)
      const token = { auth_time: futureAuthTime, uid: testUid, role: 'pharmacist' };
      const existingActivity = {
        currentStatus: 'online',
        activeSessionId: 'sess_current_ok',
        lastActivityAt: new Date(nowEpoch - 5000).toISOString(),
        lastAuthTime: nowSec - 60,
      };

      const decision = evaluateSessionCreation(token, existingActivity, nowEpoch);
      assert.strictEqual(decision.isNewSession, false, 'Future auth_time must be rejected as spoof/skew');
    });

    // ----------------------------------------------------
    // SECTION 3: DEFECT 2 VERIFICATION — CLOUD FUNCTION SESSION-MATCHING
    // ----------------------------------------------------

    const mockUid = `test_cf_usr_${Date.now()}`;
    const activeSessionId = `sess_cf_active_${Date.now()}`;
    const staleSessionId = `sess_cf_stale_${Date.now()}`;

    // 17. Deleted connection belonging to active session can finalize it
    await test('Defect 2.1: Deleted connection belonging to active session finalizes it', async () => {
      await rtdb.ref(`activity/${mockUid}`).set({
        currentStatus: 'online',
        activeSessionId: activeSessionId,
        sessionStartEpoch: nowEpoch - 15000,
        lastLoginAt: new Date(nowEpoch - 15000).toISOString(),
        totalTimeSpentSeconds: 0,
      });

      // No connections in presence
      await rtdb.ref(`presence/${mockUid}`).remove();

      const res = await handleDeletedConnectionReconciliation(rtdb, mockUid, activeSessionId, nowEpoch);
      assert.strictEqual(res.finalized, true);
      assert.strictEqual(res.reason, 'connection_lost');

      const actSnap = (await rtdb.ref(`activity/${mockUid}`).once('value')).val();
      assert.strictEqual(actSnap.currentStatus, 'offline');
      assert.strictEqual(actSnap.lastLogoutReason, 'connection_lost');
      assert.strictEqual(actSnap.totalTimeSpentSeconds, 15);
    });

    // 18. Deleted connection belonging to an old session cannot finalize a newer session
    await test('Defect 2.2: Deleted connection belonging to an old session cannot finalize a newer session', async () => {
      const newerSessionId = `sess_cf_newer_${Date.now()}`;
      await rtdb.ref(`activity/${mockUid}`).set({
        currentStatus: 'online',
        activeSessionId: newerSessionId,
        sessionStartEpoch: nowEpoch,
        lastLoginAt: new Date(nowEpoch).toISOString(),
        totalTimeSpentSeconds: 15,
      });

      // Old connection deletion event arrives with staleSessionId
      const res = await handleDeletedConnectionReconciliation(rtdb, mockUid, staleSessionId, nowEpoch + 5000);
      assert.strictEqual(res.finalized, false, 'Stale session deletion must not finalize newer session');

      const actSnap = (await rtdb.ref(`activity/${mockUid}`).once('value')).val();
      assert.strictEqual(actSnap.currentStatus, 'online', 'Newer session remains online');
      assert.strictEqual(actSnap.activeSessionId, newerSessionId);
      assert.strictEqual(actSnap.totalTimeSpentSeconds, 15, 'Duration unmodified');
    });

    // 19. Reconnection during grace period preserves session
    await test('Defect 2.3: Reconnection during grace period (active connection exists) prevents finalization', async () => {
      const reconnSessionId = `sess_cf_reconn_${Date.now()}`;
      await rtdb.ref(`activity/${mockUid}`).set({
        currentStatus: 'online',
        activeSessionId: reconnSessionId,
        sessionStartEpoch: nowEpoch,
        totalTimeSpentSeconds: 15,
      });

      // Client reconnected and has an active connection node
      await rtdb.ref(`presence/${mockUid}/conn_refreshed`).set({
        connectedAt: new Date().toISOString(),
        role: 'doctor',
        sessionId: reconnSessionId,
      });

      const res = await handleDeletedConnectionReconciliation(rtdb, mockUid, reconnSessionId, nowEpoch + 3000);
      assert.strictEqual(res.finalized, false, 'Active connection prevents premature logout');
      assert.strictEqual(res.reason, 'connections_remaining');

      const actSnap = (await rtdb.ref(`activity/${mockUid}`).once('value')).val();
      assert.strictEqual(actSnap.currentStatus, 'online', 'User remains online');

      // Cleanup
      await rtdb.ref(`presence/${mockUid}`).remove();
    });

    // 20. Multiple remaining connections prevent premature logout
    await test('Defect 2.4: Multiple remaining connections prevent premature logout', async () => {
      const multiSessionId = `sess_cf_multi_${Date.now()}`;
      await rtdb.ref(`presence/${mockUid}/conn_tab_A`).set({ connectedAt: new Date().toISOString(), sessionId: multiSessionId });
      await rtdb.ref(`presence/${mockUid}/conn_tab_B`).set({ connectedAt: new Date().toISOString(), sessionId: multiSessionId });

      // Tab A was deleted, but Tab B is still connected
      await rtdb.ref(`presence/${mockUid}/conn_tab_A`).remove();

      const res = await handleDeletedConnectionReconciliation(rtdb, mockUid, multiSessionId);
      assert.strictEqual(res.finalized, false);
      assert.strictEqual(res.reason, 'connections_remaining');

      // Cleanup
      await rtdb.ref(`presence/${mockUid}`).remove();
    });

    // 21. Duplicate deletion events do not double-count session duration
    await test('Defect 2.5: Duplicate deletion events do not double-count session duration', async () => {
      const dupSessionId = `sess_cf_dup_${Date.now()}`;
      await rtdb.ref(`activity/${mockUid}`).set({
        currentStatus: 'online',
        activeSessionId: dupSessionId,
        sessionStartEpoch: nowEpoch - 10000,
        totalTimeSpentSeconds: 15,
      });

      // First deletion event
      const res1 = await handleDeletedConnectionReconciliation(rtdb, mockUid, dupSessionId, nowEpoch);
      assert.strictEqual(res1.finalized, true);

      const snap1 = (await rtdb.ref(`activity/${mockUid}`).once('value')).val();
      assert.strictEqual(snap1.totalTimeSpentSeconds, 25);

      // Duplicate delivery of the exact same event
      const res2 = await handleDeletedConnectionReconciliation(rtdb, mockUid, dupSessionId, nowEpoch + 2000);
      assert.strictEqual(res2.finalized, false, 'Duplicate delivery must be rejected');

      const snap2 = (await rtdb.ref(`activity/${mockUid}`).once('value')).val();
      assert.strictEqual(snap2.totalTimeSpentSeconds, 25, 'Total time strictly unchanged on duplicate event');
    });

    // 22. Missing session IDs fail safely without finalizing an unrelated session
    await test('Defect 2.6: Missing session IDs fail safely without finalizing an unrelated session', async () => {
      const safeSessionId = `sess_cf_safe_${Date.now()}`;
      await rtdb.ref(`activity/${mockUid}`).set({
        currentStatus: 'online',
        activeSessionId: safeSessionId,
        sessionStartEpoch: nowEpoch,
        totalTimeSpentSeconds: 25,
      });

      const badInputs = [null, undefined, '', '   ', 12345];
      for (const bad of badInputs) {
        const res = await handleDeletedConnectionReconciliation(rtdb, mockUid, bad);
        assert.strictEqual(res.finalized, false, 'Invalid or missing sessionId must abort finalization');
        assert.strictEqual(res.reason, 'missing_session_id');
      }

      const snap = (await rtdb.ref(`activity/${mockUid}`).once('value')).val();
      assert.strictEqual(snap.currentStatus, 'online', 'Session remains active and protected');
      assert.strictEqual(snap.activeSessionId, safeSessionId);
    });

    // 23. Concurrent connection deletion and session creation do not corrupt active session
    await test('Defect 2.7: Concurrent connection deletion and session creation do not corrupt active session', async () => {
      const oldSession = `sess_old_${Date.now()}`;
      const newSession = `sess_new_${Date.now()}`;

      // User just logged into a new session
      await rtdb.ref(`activity/${mockUid}`).set({
        currentStatus: 'online',
        activeSessionId: newSession,
        sessionStartEpoch: nowEpoch,
        lastLoginAt: new Date(nowEpoch).toISOString(),
        totalTimeSpentSeconds: 25,
      });

      // In-flight deletion event from the previous old session arrives concurrently
      const concurrentRes = await handleDeletedConnectionReconciliation(rtdb, mockUid, oldSession, nowEpoch + 1000);
      assert.strictEqual(concurrentRes.finalized, false, 'Concurrent old deletion must be rejected');

      const finalSnap = (await rtdb.ref(`activity/${mockUid}`).once('value')).val();
      assert.strictEqual(finalSnap.currentStatus, 'online');
      assert.strictEqual(finalSnap.activeSessionId, newSession);
      assert.strictEqual(finalSnap.totalTimeSpentSeconds, 25);
    });

    // ----------------------------------------------------
    // SECTION 4: PHASE 3.1 HARDENED RACE & ORDERING TESTS
    // ----------------------------------------------------
    const testUid2 = `test_rtdb_hardened_${Date.now()}`;

    // 24. Test A: Reconciliation race prevention via generation guard
    await test('Test A: Stale admin reconciliation aborts when user reconnected (generation changed)', async () => {
      const sessRaceA = `sess_race_${Date.now()}`;
      await rtdb.ref(`activity/${testUid2}`).set({
        currentStatus: 'online',
        activeSessionId: sessRaceA,
        connectionGeneration: 5,
        sessionStartEpoch: nowEpoch - 30000,
        totalTimeSpentSeconds: 100,
        lastLoginAt: new Date(nowEpoch - 30000).toISOString(),
      });

      // Admin observed snapshot: 0 connections, connectionGeneration: 5
      const observedGeneration = 5;

      // User reconnected before finalization executed: advances generation to 6
      await rtdb.ref(`activity/${testUid2}`).transaction((curr) => {
        if (!curr) return curr;
        curr.connectionGeneration = 6;
        curr.currentStatus = 'online';
        return curr;
      });

      // Admin reconciliation attempts to finalize with stale observedGeneration = 5
      const res = await finalizeUserSessionAtomic(rtdb, testUid2, {
        targetSessionId: sessRaceA,
        expectedGeneration: observedGeneration,
        reason: 'connection_lost',
        serverEpoch: nowEpoch,
      });

      assert.strictEqual(res.finalized, false, 'Finalization must abort because generation changed');

      const actSnap = (await rtdb.ref(`activity/${testUid2}`).once('value')).val();
      assert.strictEqual(actSnap.currentStatus, 'online', 'User remains online');
      assert.strictEqual(actSnap.activeSessionId, sessRaceA, 'Active session remains intact');
      assert.strictEqual(actSnap.connectionGeneration, 6, 'Generation remains at 6');
      assert.strictEqual(actSnap.totalTimeSpentSeconds, 100, 'Duration was not prematurely accrued');
    });

    // 25. Test B: Normal disconnect with matching generation finalizes successfully
    await test('Test B: Disconnect with matching generation finalizes session normally', async () => {
      const actSnapBefore = (await rtdb.ref(`activity/${testUid2}`).once('value')).val();
      const currentGen = actSnapBefore.connectionGeneration; // 6
      const targetSession = actSnapBefore.activeSessionId;

      const res = await finalizeUserSessionAtomic(rtdb, testUid2, {
        targetSessionId: targetSession,
        expectedGeneration: currentGen,
        reason: 'connection_lost',
        serverEpoch: nowEpoch + 1000,
      });

      assert.strictEqual(res.finalized, true, 'Finalization succeeds when generation matches');

      const actSnapAfter = (await rtdb.ref(`activity/${testUid2}`).once('value')).val();
      assert.strictEqual(actSnapAfter.currentStatus, 'offline');
      assert.strictEqual(actSnapAfter.activeSessionId || null, null);
      assert.strictEqual(actSnapAfter.lastLogoutReason, 'connection_lost');
      assert.ok(actSnapAfter.totalTimeSpentSeconds >= 100);
    });

    // 26. Test C: Multi-tab closure - one of two connections drops, user stays online
    await test('Test C: One of two connections drops, remaining tab keeps user online', async () => {
      const multiSess = `sess_multi_${Date.now()}`;
      await rtdb.ref(`presence/${testUid2}/conn_tab_A`).set({ sessionId: multiSess });
      await rtdb.ref(`presence/${testUid2}/conn_tab_B`).set({ sessionId: multiSess });
      await rtdb.ref(`activity/${testUid2}`).set({
        currentStatus: 'online',
        activeSessionId: multiSess,
        connectionGeneration: 7,
        sessionStartEpoch: nowEpoch,
        totalTimeSpentSeconds: 150,
      });

      // Tab A closes
      await rtdb.ref(`presence/${testUid2}/conn_tab_A`).remove();

      // Background reconciliation runs
      const res = await reconcileOrphanedPresence(rtdb, testUid2, nowEpoch + 5000);
      assert.strictEqual(res, null, 'Reconciliation must not finalize while Tab B is active');

      const act = (await rtdb.ref(`activity/${testUid2}`).once('value')).val();
      assert.strictEqual(act.currentStatus, 'online');

      // Cleanup Tab B
      await rtdb.ref(`presence/${testUid2}/conn_tab_B`).remove();
    });

    // 27. Test D: Concurrent reconnects advance generation without losing updates
    await test('Test D: Concurrent connection registrations advance generation atomically', async () => {
      await rtdb.ref(`activity/${testUid2}`).set({
        currentStatus: 'online',
        connectionGeneration: 10,
        activeSessionId: `sess_concurrent_${Date.now()}`,
      });

      // Simulate 3 concurrent registrations
      const incrementGen = () =>
        rtdb.ref(`activity/${testUid2}`).transaction((curr) => {
          if (!curr) return curr;
          curr.connectionGeneration = (curr.connectionGeneration || 0) + 1;
          return curr;
        });

      await Promise.all([incrementGen(), incrementGen(), incrementGen()]);

      const act = (await rtdb.ref(`activity/${testUid2}`).once('value')).val();
      assert.strictEqual(act.connectionGeneration, 13, 'Generation advanced by exactly 3 without lost updates');
    });

    // 28. Test E: Duplicate finalization accumulates duration only once
    await test('Test E: Duplicate finalization calls do not double-count session duration', async () => {
      const dupSess = `sess_dup_${Date.now()}`;
      await rtdb.ref(`activity/${testUid2}`).set({
        currentStatus: 'online',
        activeSessionId: dupSess,
        sessionStartEpoch: nowEpoch - 10000,
        connectionGeneration: 14,
        totalTimeSpentSeconds: 200,
      });

      const res1 = await finalizeUserSessionAtomic(rtdb, testUid2, {
        targetSessionId: dupSess,
        expectedGeneration: 14,
        reason: 'explicit_logout',
        serverEpoch: nowEpoch,
      });
      assert.strictEqual(res1.finalized, true);
      const total1 = (await rtdb.ref(`activity/${testUid2}`).once('value')).val().totalTimeSpentSeconds;
      assert.strictEqual(total1, 210);

      // Repeated finalization call
      const res2 = await finalizeUserSessionAtomic(rtdb, testUid2, {
        targetSessionId: dupSess,
        expectedGeneration: 14,
        reason: 'explicit_logout',
        serverEpoch: nowEpoch + 5000,
      });
      assert.strictEqual(res2.finalized, false);
      const total2 = (await rtdb.ref(`activity/${testUid2}`).once('value')).val().totalTimeSpentSeconds;
      assert.strictEqual(total2, 210, 'Duration strictly unchanged on duplicate call');
    });

    // 29. Test F: Disconnect ordering - reservation creates no presence node before onDisconnect
    await test('Test F: 2-phase reservation creates no presence node until activation; idempotent', async () => {
      const reserveRes = await reserveConnection(rtdb, {
        uid: testUid2,
        decodedToken: { uid: testUid2 },
        role: 'patient',
        serverEpoch: nowEpoch,
      });

      assert.ok(reserveRes.connectionKey.startsWith('conn_'));
      assert.ok(reserveRes.sessionId);

      // Verify NO presence node exists yet
      const presenceBefore = (await rtdb.ref(`presence/${testUid2}/${reserveRes.connectionKey}`).once('value')).val();
      assert.strictEqual(presenceBefore, null, 'Presence node MUST NOT exist prior to activation');

      // Verify reservation exists
      const reservationSnap = (await rtdb.ref(`reservations/${testUid2}/${reserveRes.connectionKey}`).once('value')).val();
      assert.ok(reservationSnap);
      assert.strictEqual(reservationSnap.sessionId, reserveRes.sessionId);

      // Client registers onDisconnect hook on socket, then calls activateConnection
      const activateRes = await activateConnection(rtdb, {
        uid: testUid2,
        connectionKey: reserveRes.connectionKey,
        sessionId: reserveRes.sessionId,
        role: 'patient',
        serverEpoch: nowEpoch + 100,
      });

      assert.strictEqual(activateRes.activated, true);
      assert.ok(activateRes.connectionGeneration > 0);

      // Verify presence node now exists
      const presenceAfter = (await rtdb.ref(`presence/${testUid2}/${reserveRes.connectionKey}`).once('value')).val();
      assert.ok(presenceAfter);
      assert.strictEqual(presenceAfter.sessionId, reserveRes.sessionId);

      // Verify reservation was consumed
      const resAfter = (await rtdb.ref(`reservations/${testUid2}/${reserveRes.connectionKey}`).once('value')).val();
      assert.strictEqual(resAfter, null, 'Reservation consumed on activation');

      // Idempotency: repeated activation returns alreadyActive without double incrementing
      const repeatRes = await activateConnection(rtdb, {
        uid: testUid2,
        connectionKey: reserveRes.connectionKey,
        sessionId: reserveRes.sessionId,
        role: 'patient',
        serverEpoch: nowEpoch + 200,
      });
      assert.strictEqual(repeatRes.activated, true);
      assert.strictEqual(repeatRes.alreadyActive, true);
      assert.strictEqual(repeatRes.connectionGeneration, activateRes.connectionGeneration);

      // Cleanup connection
      await rtdb.ref(`presence/${testUid2}/${reserveRes.connectionKey}`).remove();
    });

    // 30. Test G: Invalid or expired reservations are rejected safely
    await test('Test G: Rejects invalid, expired, or mismatched connection activations', async () => {
      // 1. Invalid key format
      const badKey = await activateConnection(rtdb, {
        uid: testUid2,
        connectionKey: '../invalid/key',
        sessionId: 'sess_1',
      });
      assert.strictEqual(badKey.activated, false);
      assert.strictEqual(badKey.reason, 'invalid_connection_key');

      // 2. Non-existent reservation
      const notFound = await activateConnection(rtdb, {
        uid: testUid2,
        connectionKey: `conn_${Date.now()}_missing`,
        sessionId: 'sess_1',
      });
      assert.strictEqual(notFound.activated, false);
      assert.strictEqual(notFound.reason, 'reservation_not_found');

      // 3. Mismatched session ID
      const validReserve = await reserveConnection(rtdb, {
        uid: testUid2,
        decodedToken: { uid: testUid2 },
        serverEpoch: nowEpoch,
      });
      const mismatch = await activateConnection(rtdb, {
        uid: testUid2,
        connectionKey: validReserve.connectionKey,
        sessionId: 'sess_wrong_id',
      });
      assert.strictEqual(mismatch.activated, false);
      assert.strictEqual(mismatch.reason, 'session_mismatch');

      // 4. Expired reservation
      const expired = await activateConnection(rtdb, {
        uid: testUid2,
        connectionKey: validReserve.connectionKey,
        sessionId: validReserve.sessionId,
        serverEpoch: nowEpoch + 120000, // 2 minutes later (> 60s TTL)
      });
      assert.strictEqual(expired.activated, false);
      assert.strictEqual(expired.reason, 'reservation_expired');
    });

    // 31. Test H: Session continuity across refresh & genuine login
    await test('Test H: Session continuity across refresh vs genuine credential login', async () => {
      const activeSess = `sess_active_${Date.now()}`;
      const existingActivity = {
        currentStatus: 'online',
        activeSessionId: activeSess,
        lastActivityAt: new Date(nowEpoch - 30000).toISOString(),
        lastAuthTime: 1700000000,
      };

      // Page refresh within 10 minutes (ordinary ID token, same auth_time)
      const refreshDecision = evaluateSessionCreation(
        { auth_time: 1700000000 },
        existingActivity,
        nowEpoch
      );
      assert.strictEqual(refreshDecision.isNewSession, false);
      assert.strictEqual(refreshDecision.reason, 'reuse_active_session');

      // Genuine new login (recent auth_time never consumed)
      const nowSec = Math.floor(nowEpoch / 1000);
      const loginDecision = evaluateSessionCreation(
        { auth_time: nowSec - 5 },
        existingActivity,
        nowEpoch
      );
      assert.strictEqual(loginDecision.isNewSession, true);
      assert.strictEqual(loginDecision.reason, 'new_credential_login');
    });

    // Final cleanup of test nodes
    await rtdb.ref(`presence/${testUid}`).remove();
    await rtdb.ref(`activity/${testUid}`).remove();
    await rtdb.ref(`presence/${mockUid}`).remove();
    await rtdb.ref(`activity/${mockUid}`).remove();
    await rtdb.ref(`presence/${testUid2}`).remove();
    await rtdb.ref(`activity/${testUid2}`).remove();
    await rtdb.ref(`reservations/${testUid2}`).remove();

  } finally {
    // Resource cleanup: release all network handles so Node exits naturally
    rtdb.goOffline();
    await app.delete();
  }

  console.log('\n========================================================');
  console.log(`SUMMARY: ${passed}/${total} Tests Passed`);
  console.log(`STATUS: ${passed === total ? 'ALL RTDB CHECKS PASSED' : 'FAILURES DETECTED'}`);
  console.log('========================================================\n');

  if (passed !== total) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite();
