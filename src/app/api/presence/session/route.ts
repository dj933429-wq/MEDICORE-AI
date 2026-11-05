import { NextResponse } from 'next/server';
import { adminAuth, adminRtdb, adminDb } from '@/lib/firebaseAdmin';

interface SessionRequestBody {
  action?: 'login' | 'heartbeat' | 'activity' | 'logout' | 'timeout';
  connectionKey?: string;
  reason?: 'explicit_logout' | 'inactivity_timeout' | 'connection_lost';
  token?: string;
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
    const action = body.action || 'activity';
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

    if (action === 'login') {
      const [activitySnap, presenceSnap] = await Promise.all([
        activityRef.once('value'),
        presenceRef.once('value'),
      ]);

      const existingActivity = activitySnap.val() || {};
      const existingPresence = presenceSnap.val() || {};
      const activeConnectionsCount = Object.keys(existingPresence).length;

      // Generate trusted server-side connection identifier
      const connectionKey = `conn_${serverEpoch}_${Math.random().toString(36).substring(2, 9)}`;

      // Register new connection
      await adminRtdb.ref(`presence/${uid}/${connectionKey}`).set({
        connectedAt: serverTime,
        lastSeenAt: serverTime,
        role,
      });

      // Update activity summary: if user was offline or this is the first connection
      const activityPayload: Record<string, unknown> = {
        lastActivityAt: serverTime,
        currentStatus: 'online',
        activeRole: role,
        lastLogoutReason: null,
      };

      if (activeConnectionsCount === 0 || existingActivity.currentStatus !== 'online') {
        activityPayload.lastLoginAt = serverTime;
        activityPayload.sessionStartEpoch = serverEpoch;
        if (typeof existingActivity.totalTimeSpentSeconds !== 'number') {
          activityPayload.totalTimeSpentSeconds = 0;
        }
      }

      await activityRef.update(activityPayload);

      return NextResponse.json({
        success: true,
        connectionKey,
        serverTime,
        currentStatus: 'online',
      });
    }

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

    if (action === 'logout' || action === 'timeout') {
      const connectionKey = body.connectionKey;
      const reason = action === 'timeout' ? 'inactivity_timeout' : (body.reason || 'explicit_logout');

      if (connectionKey) {
        await adminRtdb.ref(`presence/${uid}/${connectionKey}`).remove();
      }

      // Check if any connections remain for this user
      const remainingPresenceSnap = await presenceRef.once('value');
      const remainingConnections = remainingPresenceSnap.val() || {};
      const remainingCount = Object.keys(remainingConnections).length;

      // Only mark entire user offline if zero connections remain
      if (remainingCount === 0) {
        const activitySnap = await activityRef.once('value');
        const act = activitySnap.val() || {};
        const startEpoch = typeof act.sessionStartEpoch === 'number' ? act.sessionStartEpoch : serverEpoch;
        const durationSec = Math.max(0, Math.floor((serverEpoch - startEpoch) / 1000));
        const currentTotal = typeof act.totalTimeSpentSeconds === 'number' ? act.totalTimeSpentSeconds : 0;

        await activityRef.update({
          currentStatus: 'offline',
          lastLogoutAt: serverTime,
          lastLogoutReason: reason,
          totalTimeSpentSeconds: currentTotal + durationSec,
          lastActivityAt: serverTime,
        });
      }

      return NextResponse.json({
        success: true,
        serverTime,
        remainingConnections: remainingCount,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PresenceSessionAPI] Error processing presence session:', msg);
    return NextResponse.json({ error: `Presence session failed: ${msg}` }, { status: 500 });
  }
}
