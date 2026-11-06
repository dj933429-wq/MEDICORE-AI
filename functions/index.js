/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * MEDICORE-AI — Firebase Cloud Functions
 * Real-time presence reconciliation trigger for unexpected RTDB disconnects.
 * Prepared locally for future deployment.
 */

const { onValueDeleted } = require('firebase-functions/v2/database');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

if (!getApps().length) {
  initializeApp();
}

const RTDB_INSTANCE = 'medicore-ai-exhibition-default-rtdb';
const RTDB_REGION = 'asia-southeast1';

/**
 * Triggered whenever a connection node is deleted under /presence/{uid}/{connectionKey}
 * (e.g. by onDisconnect().remove() when a browser closes or client loses connectivity).
 */
exports.onPresenceConnectionDeleted = onValueDeleted(
  {
    ref: '/presence/{uid}/{connectionKey}',
    instance: RTDB_INSTANCE,
    region: RTDB_REGION,
  },
  async (event) => {
    const uid = event.params.uid;
    const connectionKey = event.params.connectionKey;
    const rtdb = getDatabase();

    // 1. Read the deleted connection's sessionId from before-data
    const deletedSnap = event.data;
    const deletedVal = deletedSnap ? deletedSnap.val() : null;
    const deletedSessionId =
      deletedVal && typeof deletedVal === 'object' && typeof deletedVal.sessionId === 'string'
        ? deletedVal.sessionId.trim()
        : null;

    // Fail safe: If no valid session ID was attached to the deleted connection, abort to protect active sessions
    if (!deletedSessionId) {
      console.warn(
        `[PresenceTrigger] Connection ${connectionKey} for UID ${uid} had no valid sessionId. Skipping finalization.`
      );
      return null;
    }

    // 2. Brief grace period (3 seconds) to distinguish browser refresh from true disconnect
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 3. Check if user has any remaining active connections
    const presenceSnap = await rtdb.ref(`presence/${uid}`).once('value');
    const remainingConnections = presenceSnap.val() || {};
    const remainingCount = Object.keys(remainingConnections).length;

    if (remainingCount > 0) {
      // User has other active tabs/devices connected, or has reconnected via refresh
      return null;
    }

    // 4. Atomically finalize orphaned session with session-matching protection
    const serverEpoch = Date.now();
    const serverTime = new Date(serverEpoch).toISOString();
    const activityRef = rtdb.ref(`activity/${uid}`);

    let finalized = false;
    await activityRef.transaction((current) => {
      // Verify an activity record exists
      if (!current) return current;

      // Idempotency: if already offline, do nothing
      if (current.currentStatus === 'offline') {
        return current;
      }

      // Session-matching protection: verify that the deleted connection's sessionId matches current activeSessionId
      if (current.activeSessionId !== deletedSessionId) {
        // Deleted connection belongs to an older or different session; do not finalize newer session!
        return current;
      }

      const startEpoch =
        typeof current.sessionStartEpoch === 'number'
          ? current.sessionStartEpoch
          : (current.lastLoginAt ? new Date(current.lastLoginAt).getTime() : serverEpoch);

      const endEpoch = Math.max(startEpoch, serverEpoch);
      const sessionDuration = Math.max(0, Math.floor((endEpoch - startEpoch) / 1000));
      const priorTotal = typeof current.totalTimeSpentSeconds === 'number' ? current.totalTimeSpentSeconds : 0;

      current.currentStatus = 'offline';
      current.lastLogoutAt = serverTime;
      current.lastLogoutReason = 'connection_lost';
      current.totalTimeSpentSeconds = priorTotal + sessionDuration;
      current.lastActivityAt = serverTime;
      current.activeSessionId = null;
      current.sessionStartEpoch = null;

      finalized = true;
      return current;
    });

    console.log(
      `[PresenceTrigger] Reconciled UID ${uid} (connection ${connectionKey}, session ${deletedSessionId}): finalized=${finalized}`
    );
    return null;
  }
);
