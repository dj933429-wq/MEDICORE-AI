import { NextResponse } from 'next/server';
import { adminAuth, adminRtdb, adminDb } from '@/lib/firebaseAdmin';
import {
  finalizeUserSessionAtomic,
  evaluateSessionCreation,
  reserveConnection,
  activateConnection,
} from '@/lib/rtdbSession';

interface SessionRequestBody {
  action?: 'login' | 'connect' | 'reserve_connection' | 'activate_connection' | 'heartbeat' | 'activity' | 'logout' | 'timeout' | 'reconcile';
  connectionKey?: string;
  previousConnectionKey?: string;
  sessionId?: string;
  reason?: 'explicit_logout' | 'inactivity_timeout' | 'connection_lost';
  isExplicitLogin?: boolean;
  token?: string;
  expectedGeneration?: number;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    let token = '';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split('Bearer ')[1]?.trim();
    }

    const body: SessionRequestBody = await req.json().catch(() => ({}));
    if (!token && body.token) {
      token = body.token.trim();
    }

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized: Authentication token is required' }, { status: 401 });
    }

    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch {
      return NextResponse.json({ error: 'Unauthorized: Invalid or expired authentication token' }, { status: 401 });
    }

    const uid = decodedToken.uid;
    const action = body.action || 'connect';
    const serverTime = new Date().toISOString();
    const serverEpoch = Date.now();

    // Determine trusted role from Custom Claims or profile
    let role = (decodedToken.role as string) || '';
    if (!role) {
      try {
        const userDoc = await adminDb.collection('users').doc(uid).get();
        role = (userDoc.data()?.role as string) || 'patient';
      } catch {
        role = 'patient';
      }
    }

    const activityRef = adminRtdb.ref(`activity/${uid}`);
    const presenceRef = adminRtdb.ref(`presence/${uid}`);

    // ACTION: RESERVE_CONNECTION (Phase 1 of 2-phase connection handshake)
    // Generates connectionKey and reserves it without creating an active presence record
    if (action === 'reserve_connection') {
      const reservation = await reserveConnection(adminRtdb, {
        uid,
        decodedToken,
        serverEpoch,
        role,
        previousConnectionKey: body.previousConnectionKey,
      });

      return NextResponse.json({
        success: true,
        connectionKey: reservation.connectionKey,
        sessionId: reservation.sessionId,
        isNewSession: reservation.isNewSession,
        expiresAt: reservation.expiresAt,
        serverTime,
      });
    }

    // ACTION: ACTIVATE_CONNECTION (Phase 2 of 2-phase connection handshake)
    // Called ONLY after client has successfully registered onDisconnect().remove()
    if (action === 'activate_connection') {
      const connectionKey = body.connectionKey || '';
      const sessionId = body.sessionId || '';

      const result = await activateConnection(adminRtdb, {
        uid,
        connectionKey,
        sessionId,
        serverEpoch,
        serverTime,
        role,
      });

      if (!result.activated) {
        return NextResponse.json(
          { success: false, error: result.reason || 'Activation failed' },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        activated: true,
        connectionKey: result.connectionKey,
        sessionId: result.sessionId,
        connectionGeneration: result.connectionGeneration,
        activationId: result.activationId,
        serverTime,
        currentStatus: 'online',
      });
    }

    // ACTION: CONNECT or LOGIN (Direct / Backward-compatible path)
    // Establishes a physical connection and atomically advances connectionGeneration
    if (action === 'login' || action === 'connect') {
      const [activitySnap] = await Promise.all([
        activityRef.once('value'),
      ]);

      const existingActivity = activitySnap.val() || {};

      // Cryptographically verified credential authentication recency check
      const decision = evaluateSessionCreation(decodedToken, existingActivity, serverEpoch);
      const isNewSession = decision.isNewSession;
      const authTime = decision.authTime;

      let sessionId: string;
      if (!isNewSession && existingActivity.activeSessionId) {
        // Reuse existing logical session: browser refresh, route change, or additional tab
        sessionId = existingActivity.activeSessionId as string;
      } else {
        // Genuinely new logical login
        sessionId = `sess_${serverEpoch}_${Math.random().toString(36).substring(2, 9)}`;

        // If there was an old unfinalized session from hours ago or prior to re-login, finalize it first
        if (existingActivity.currentStatus === 'online' && existingActivity.activeSessionId) {
          await finalizeUserSessionAtomic(adminRtdb, uid, {
            targetSessionId: existingActivity.activeSessionId as string,
            reason: decision.reason === 'new_credential_login' ? 'explicit_logout' : 'inactivity_timeout',
            serverEpoch,
            serverTime,
          });
        }
      }

      // Generate trusted server-side connection and activation identifiers
      const connectionKey = `conn_${serverEpoch}_${Math.random().toString(36).substring(2, 9)}`;
      const activationId = `act_${serverEpoch}_${Math.random().toString(36).substring(2, 9)}`;

      // Atomically advance connectionGeneration and register in verifiedConnections
      let connectionGeneration = 1;
      await activityRef.transaction((current) => {
        if (!current) {
          current = {
            totalTimeSpentSeconds: 0,
            connectionGeneration: 0,
          };
        }

        const currentGen = typeof current.connectionGeneration === 'number' ? current.connectionGeneration : 0;
        connectionGeneration = currentGen + 1;

        current.connectionGeneration = connectionGeneration;
        current.currentStatus = 'online';
        current.lastActivityAt = serverTime;
        current.activeRole = role;
        current.lastLogoutReason = null;
        current.activeSessionId = sessionId;

        if (typeof current.sessionStartGeneration !== 'number') {
          current.sessionStartGeneration = connectionGeneration;
        }

        if (isNewSession) {
          current.lastLoginAt = serverTime;
          current.sessionStartEpoch = serverEpoch;
          current.sessionStartGeneration = connectionGeneration;
          current.verifiedConnections = {};
          if (authTime !== null && authTime !== undefined) {
            current.lastAuthTime = authTime;
          }
          if (typeof current.totalTimeSpentSeconds !== 'number') {
            current.totalTimeSpentSeconds = 0;
          }
        }

        if (!current.verifiedConnections || typeof current.verifiedConnections !== 'object') {
          current.verifiedConnections = {};
        }

        // Register in Authoritative Verified Connection Registry
        current.verifiedConnections[connectionKey] = {
          connectionKey,
          activationId,
          sessionId,
          connectionGeneration,
          verifiedAtEpoch: serverEpoch,
        };

        return current;
      });

      // Register connection under /presence/{uid}/{connectionKey} with matching activation metadata
      await adminRtdb.ref(`presence/${uid}/${connectionKey}`).set({
        connectedAt: serverTime,
        lastSeenAt: serverTime,
        role,
        sessionId,
        activationId,
        connectionGeneration,
      });

      return NextResponse.json({
        success: true,
        connectionKey,
        sessionId,
        connectionGeneration,
        serverTime,
        currentStatus: 'online',
        isNewSession,
      });
    }

    // ACTION: HEARTBEAT or ACTIVITY
    if (action === 'heartbeat' || action === 'activity') {
      const connectionKey = body.connectionKey;
      const updates: Record<string, unknown> = {
        [`activity/${uid}/lastActivityAt`]: serverTime,
        [`activity/${uid}/currentStatus`]: 'online',
        [`activity/${uid}/activeRole`]: role,
      };

      if (connectionKey) {
        updates[`presence/${uid}/${connectionKey}/lastSeenAt`] = serverTime;
      }

      await adminRtdb.ref().update(updates);

      return NextResponse.json({
        success: true,
        serverTime,
      });
    }

    // ACTION: LOGOUT or TIMEOUT
    if (action === 'logout' || action === 'timeout') {
      const connectionKey = body.connectionKey;
      const targetSessionId = body.sessionId;
      const reason = action === 'timeout' ? 'inactivity_timeout' : (body.reason || 'explicit_logout');

      if (connectionKey) {
        await adminRtdb.ref(`presence/${uid}/${connectionKey}`).remove().catch(() => {});
        await adminRtdb.ref(`activity/${uid}/verifiedConnections/${connectionKey}`).remove().catch(() => {});
      }

      // Fetch presence and verified connections for this user to perform session-fenced cleanup
      const [presenceSnap, verifiedSnap] = await Promise.all([
        presenceRef.once('value'),
        adminRtdb.ref(`activity/${uid}/verifiedConnections`).once('value'),
      ]);

      const presenceVal = (presenceSnap.val() || {}) as Record<string, { sessionId?: string }>;
      const verifiedVal = (verifiedSnap.val() || {}) as Record<string, { sessionId?: string }>;

      // If targetSessionId is specified, remove ONLY presence and verified connections matching targetSessionId
      if (targetSessionId) {
        const removalPromises: Promise<void>[] = [];
        for (const [key, conn] of Object.entries(presenceVal)) {
          if (conn && conn.sessionId === targetSessionId) {
            removalPromises.push(adminRtdb.ref(`presence/${uid}/${key}`).remove().catch(() => {}));
            delete presenceVal[key];
          }
        }
        for (const [key, reg] of Object.entries(verifiedVal)) {
          if (reg && reg.sessionId === targetSessionId) {
            removalPromises.push(adminRtdb.ref(`activity/${uid}/verifiedConnections/${key}`).remove().catch(() => {}));
            delete verifiedVal[key];
          }
        }
        await Promise.all(removalPromises);
      } else if (reason === 'explicit_logout' || action === 'timeout') {
        // Blanket cleanup only when no targetSessionId is specified
        await Promise.all([
          presenceRef.remove().catch(() => {}),
          adminRtdb.ref(`activity/${uid}/verifiedConnections`).remove().catch(() => {}),
        ]);
        Object.keys(presenceVal).forEach((k) => delete presenceVal[k]);
      }

      // Remaining count of active connections for this user
      const remainingCount = Object.keys(presenceVal).length;

      // Finalize session atomically:
      // - If targetSessionId is given, finalize that specific session (finalizeUserSessionAtomic fences by targetSessionId).
      // - If no targetSessionId and remainingCount === 0 (or explicit_logout / timeout), finalize current session.
      let finalizationResult = null;
      if (targetSessionId || remainingCount === 0 || reason === 'explicit_logout' || action === 'timeout') {
        finalizationResult = await finalizeUserSessionAtomic(adminRtdb, uid, {
          targetSessionId,
          reason,
          serverEpoch,
          serverTime,
        });
      }

      return NextResponse.json({
        success: true,
        serverTime,
        remainingConnections: remainingCount,
        finalized: finalizationResult?.finalized ?? false,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PresenceSessionAPI] Error processing presence session:', msg);
    return NextResponse.json({ error: `Presence session failed: ${msg}` }, { status: 500 });
  }
}
