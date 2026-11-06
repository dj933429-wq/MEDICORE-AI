import { NextResponse } from 'next/server';
import { adminAuth, adminRtdb, adminDb } from '@/lib/firebaseAdmin';
import {
  finalizeUserSessionAtomic,
  validateUserPresence,
} from '@/lib/rtdbSession';

/**
 * Verify caller has Administrator privileges (via Custom Claim or verified Firestore role)
 */
async function verifyAdminCaller(req: Request) {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split('Bearer ')[1]?.trim();
  }

  // Also allow query parameter token for direct browser HTML viewing: ?token=...
  if (!token) {
    const url = new URL(req.url);
    token = url.searchParams.get('token') || '';
  }

  if (!token) {
    return { error: 'Unauthorized: Administrator authentication token required', status: 401 };
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    let isAdmin = decodedToken.role === 'admin';

    if (!isAdmin) {
      const userDoc = await adminDb.collection('users').doc(decodedToken.uid).get();
      if (userDoc.exists && userDoc.data()?.role === 'admin') {
        isAdmin = true;
      }
    }

    if (!isAdmin) {
      return { error: 'Forbidden: Access restricted strictly to Administrators', status: 403 };
    }

    return { decodedToken, status: 200 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[AdminUserLogAPI] Token verification failed:', msg);
    return { error: 'Unauthorized: Invalid or expired authentication token', status: 401 };
  }
}

function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return '0s';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

export async function GET(req: Request) {
  const authCheck = await verifyAdminCaller(req);
  if (authCheck.error || !authCheck.decodedToken) {
    const url = new URL(req.url);
    if (url.searchParams.get('format') === 'html') {
      return new NextResponse(
        `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>403 Forbidden - Administrator Only</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; max-width: 440px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
    h1 { color: #f43f5e; margin: 0 0 12px; font-size: 24px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px; }
    a { display: inline-block; background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Access Denied (403)</h1>
    <p>${authCheck.error}</p>
    <a href="/login">Authenticate as Admin</a>
  </div>
</body>
</html>`,
        { status: authCheck.status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
    return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
  }

  const url = new URL(req.url);
  const sortBy = url.searchParams.get('sortBy') || 'last_signin'; // 'last_signin' | 'signup' | 'online_first' | 'total_time'
  const filterRole = url.searchParams.get('role') || 'all';
  const filterPresence = url.searchParams.get('presence') || 'all'; // 'all' | 'online_only' | 'offline_only'
  const format = url.searchParams.get('format') || 'json';
  const queryToken = url.searchParams.get('token') || '';

  try {
    // 1. Fetch Realtime Database presence and activity nodes (Immune to Firestore document quotas)
    let presenceMap: Record<string, Record<string, unknown>> = {};
    let activityMap: Record<string, Record<string, unknown>> = {};

    try {
      const [presenceSnap, activitySnap] = await Promise.all([
        adminRtdb.ref('presence').once('value'),
        adminRtdb.ref('activity').once('value'),
      ]);
      presenceMap = presenceSnap.val() || {};
      activityMap = activitySnap.val() || {};
    } catch (rtdbErr) {
      console.warn('[AdminUserLogAPI] RTDB read error (falling back to Auth):', rtdbErr);
    }

    // 2. Fetch Firebase Authentication user records (authoritative identity & claims)
    const authResult = await adminAuth.listUsers(1000);
    const authMap = new Map<string, (typeof authResult.users)[0]>();
    authResult.users.forEach((u) => {
      authMap.set(u.uid, u);
    });

    // 3. Gracefully fetch Firestore user documents for display profiles (without failing if quota reached)
    const firestoreMap = new Map<string, Record<string, unknown>>();
    try {
      const usersSnap = await adminDb.collection('users').get();
      usersSnap.forEach((doc) => {
        firestoreMap.set(doc.id, doc.data());
      });
    } catch {
      // Non-critical fallback for profile display names
    }

    // 4. Compile active presence and session data
    const allUids = new Set([...authMap.keys(), ...Object.keys(presenceMap), ...Object.keys(activityMap)]);
    const records = [];
    const nowEpoch = Date.now();

    for (const uid of allUids) {
      const authUser = authMap.get(uid);
      const fsData = firestoreMap.get(uid) || {};
      const userActivity = activityMap[uid] || {};
      const userPresence = presenceMap[uid];

      const claims = authUser?.customClaims || {};
      const customRole = claims.role as string | undefined;
      const profileRole = (fsData.role as string) || (userActivity.activeRole as string) || 'patient';
      const effectiveRole = customRole || profileRole || 'patient';

      if (filterRole !== 'all' && effectiveRole !== filterRole) {
        continue;
      }

      // Compute creation timestamp
      const createdAtRaw = (fsData.createdAt as string) || authUser?.metadata.creationTime || '';
      const createdEpoch = createdAtRaw ? new Date(createdAtRaw).getTime() : 0;

      // Authoritative Timestamps from RTDB / Auth
      const lastLoginAtRaw = (userActivity.lastLoginAt as string) || authUser?.metadata.lastSignInTime || (fsData.lastLoginAt as string) || createdAtRaw || '';
      const lastLoginEpoch = lastLoginAtRaw ? new Date(lastLoginAtRaw).getTime() : createdEpoch;

      const lastActivityAtRaw = (userActivity.lastActivityAt as string) || lastLoginAtRaw || null;
      const lastActivityEpoch = lastActivityAtRaw ? new Date(lastActivityAtRaw).getTime() : lastLoginEpoch;

      // Realtime Presence Validation:
      // Validates connections against active session and generation; eliminates raw Object.keys trust
      const presenceValidation = validateUserPresence(userPresence, userActivity, nowEpoch);
      const activeConnectionsCount = presenceValidation.validConnectionsCount;
      const hasPendingActivation = presenceValidation.hasPendingActivation;
      const isOnline = presenceValidation.isOnline;
      const rawPresenceStatus = presenceValidation.presenceStatus;
      const observedGeneration = typeof userActivity.connectionGeneration === 'number'
        ? userActivity.connectionGeneration
        : 0;

      // Grace period guard: never auto-reconcile or finalize as connection_lost if
      // the user authenticated or had verified activity within the last 60 seconds (handshake/navigation window)
      const isRecentActivity = (lastActivityEpoch > 0 && (nowEpoch - lastActivityEpoch < 60000)) ||
                               (lastLoginEpoch > 0 && (nowEpoch - lastLoginEpoch < 60000));

      const presenceStatus = (!isOnline && isRecentActivity && userActivity.currentStatus === 'online')
        ? 'pending'
        : rawPresenceStatus;

      // Auto-reconcile orphaned presence: socket disconnected unexpectedly without explicit logout
      // Protected by:
      // 1. hasPendingActivation check: never finalize while an activation is in-flight
      // 2. expectedGeneration guard: if user reconnected (advancing generation), finalization aborts
      // 3. isRecentActivity grace period: never finalize in-flight login, tab redirect, or connection handshake (<60s)
      if (!isOnline && !hasPendingActivation && !isRecentActivity && userActivity.currentStatus === 'online') {
        finalizeUserSessionAtomic(adminRtdb, uid, {
          targetSessionId: (userActivity.activeSessionId as string) || null,
          expectedGeneration: observedGeneration,
          reason: 'connection_lost',
          serverEpoch: nowEpoch,
          serverTime: new Date(nowEpoch).toISOString(),
        }).catch((err) => console.warn('[AdminUserLogAPI] Orphaned session reconciliation warning:', err));
      }

      if (filterPresence === 'online_only' && !isOnline) {
        continue;
      }
      if (filterPresence === 'offline_only' && isOnline) {
        continue;
      }

      const lastLogoutAtRaw = (!isOnline && userActivity.currentStatus === 'online' && !isRecentActivity)
        ? (lastActivityAtRaw || new Date(nowEpoch).toISOString())
        : ((userActivity.lastLogoutAt as string) || (fsData.lastSessionEndedAt as string) || null);

      const lastLogoutReason = (!isOnline && userActivity.currentStatus === 'online' && !isRecentActivity)
        ? 'connection_lost'
        : ((userActivity.lastLogoutReason as string) || (isOnline ? null : (isRecentActivity ? null : 'connection_lost')));

      // Cumulative Duration Calculation:
      const baseTotalSec = typeof userActivity.totalTimeSpentSeconds === 'number'
        ? Math.floor(userActivity.totalTimeSpentSeconds)
        : (typeof fsData.totalTimeSpentSec === 'number' ? Math.floor(fsData.totalTimeSpentSec) : 0);

      let currentSessionSec = 0;
      const sessionStartEpoch = typeof userActivity.sessionStartEpoch === 'number'
        ? userActivity.sessionStartEpoch
        : lastLoginEpoch;

      if (isOnline && sessionStartEpoch > 0) {
        currentSessionSec = Math.max(0, Math.floor((nowEpoch - sessionStartEpoch) / 1000));
      } else if (!isOnline && userActivity.currentStatus === 'online' && sessionStartEpoch > 0) {
        const effectiveEndEpoch = lastActivityEpoch > sessionStartEpoch ? lastActivityEpoch : sessionStartEpoch;
        currentSessionSec = Math.max(0, Math.floor((effectiveEndEpoch - sessionStartEpoch) / 1000));
      } else {
        currentSessionSec = 0;
      }

      const totalTimeSpentSec = baseTotalSec + currentSessionSec;

      records.push({
        uid,
        name: (fsData.name as string) || authUser?.displayName || (authUser?.email ? authUser.email.split('@')[0] : 'Unknown'),
        email: (fsData.email as string) || authUser?.email || 'N/A',
        role: effectiveRole,
        isOnline,
        presenceStatus,
        activeConnectionsCount,
        lastLogoutReason,
        lastLoginAt: lastLoginAtRaw ? new Date(lastLoginAtRaw).toISOString() : null,
        lastLoginEpoch,
        lastLogoutAt: lastLogoutAtRaw ? new Date(lastLogoutAtRaw).toISOString() : null,
        lastActivityAt: lastActivityAtRaw ? new Date(lastActivityAtRaw).toISOString() : null,
        lastActivityEpoch,
        currentSessionSec,
        currentSessionFormatted: formatDuration(currentSessionSec),
        totalTimeSpentSec,
        totalTimeSpentFormatted: formatDuration(totalTimeSpentSec),
        createdAt: createdAtRaw ? new Date(createdAtRaw).toISOString() : null,
        createdEpoch,
        disabled: Boolean(authUser?.disabled),
      });
    }

    // 5. Shortlist Sorting
    if (sortBy === 'signup') {
      records.sort((a, b) => b.createdEpoch - a.createdEpoch);
    } else if (sortBy === 'online_first') {
      records.sort((a, b) => {
        if (a.isOnline === b.isOnline) return b.lastActivityEpoch - a.lastActivityEpoch;
        return a.isOnline ? -1 : 1;
      });
    } else if (sortBy === 'total_time') {
      records.sort((a, b) => b.totalTimeSpentSec - a.totalTimeSpentSec);
    } else {
      // Default: latest login
      records.sort((a, b) => b.lastLoginEpoch - a.lastLoginEpoch);
    }

    // 6. Standalone HTML view formatting
    if (format === 'html') {
      const htmlTableRows = records
        .map((u, idx) => {
          const roleColors: Record<string, { bg: string; text: string; border: string }> = {
            admin: { bg: '#ffe4e6', text: '#e11d48', border: '#fecdd3' },
            doctor: { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' },
            pharmacist: { bg: '#fef3c7', text: '#b45309', border: '#fde68a' },
            blood_bank: { bg: '#ffe4e6', text: '#be123c', border: '#fecdd3' },
            patient: { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' },
          };
          const rc = roleColors[u.role] || { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };

          const formatTimeOnly = (iso: string | null) => {
            if (!iso) return 'N/A';
            const d = new Date(iso);
            return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          };

          const formatDt = (iso: string | null) => {
            if (!iso) return '<span style="color:#94a3b8; font-style:italic;">Never</span>';
            const d = new Date(iso);
            return `<div style="font-weight:600; color:#1e293b;">${d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })}</div><div style="color:#64748b; font-size:11px;">${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>`;
          };

          // Session Time Window
          let timeWindowHtml = '';
          if (u.isOnline) {
            timeWindowHtml = `
              <div style="font-weight:700; color:#15803d; font-size:12px;">From ${formatTimeOnly(u.lastLoginAt)} &rarr; Active Now</div>
              <div style="color:#16a34a; font-size:11px; font-weight:600;">Active Session (${u.currentSessionFormatted})</div>
            `;
          } else if (u.lastLoginAt && u.lastLogoutAt) {
            timeWindowHtml = `
              <div style="font-weight:600; color:#475569; font-size:12px;">${formatTimeOnly(u.lastLoginAt)} &rarr; ${formatTimeOnly(u.lastLogoutAt)}</div>
              <div style="color:#64748b; font-size:11px; text-transform:capitalize;">Ended: ${u.lastLogoutReason ? u.lastLogoutReason.replace('_', ' ') : 'Offline'}</div>
            `;
          } else {
            timeWindowHtml = `
              <div style="color:#94a3b8; font-size:12px; font-style:italic;">Offline</div>
              <div style="color:#94a3b8; font-size:11px;">${u.lastActivityAt ? 'Last seen ' + formatTimeOnly(u.lastActivityAt) : 'No session'}</div>
            `;
          }

          // Presence Pill
          let presenceBadge: string;
          if (u.presenceStatus === 'online') {
            presenceBadge = `<span style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:9999px; font-size:11px; font-weight:700; background:#dcfce7; color:#15803d; border:1px solid #86efac;">
                <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#22c55e; box-shadow:0 0 8px #22c55e;"></span>
                ONLINE (${u.activeConnectionsCount} ${u.activeConnectionsCount === 1 ? 'tab' : 'tabs'})
               </span>`;
          } else if (u.presenceStatus === 'pending') {
            presenceBadge = `<span style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:9999px; font-size:11px; font-weight:700; background:#fef3c7; color:#b45309; border:1px solid #fcd34d;">
                <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#f59e0b; box-shadow:0 0 8px #f59e0b;"></span>
                PENDING (connecting...)
               </span>`;
          } else {
            presenceBadge = `<span style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:9999px; font-size:11px; font-weight:700; background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1;">
                <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#94a3b8;"></span>
                OFFLINE
               </span>`;
          }

          return `
          <tr style="border-bottom: 1px solid #e2e8f0; ${idx % 2 === 1 ? 'background-color: #f8fafc;' : ''}">
            <td style="padding: 12px 16px; font-weight: 600; color: #0f172a;">
              <div style="font-size: 14px;">${escapeHtml(u.name)}</div>
              <div style="font-family: monospace; font-size: 10px; color: #94a3b8;">${u.uid}</div>
            </td>
            <td style="padding: 12px 16px; color: #334155; font-size: 13px;">${escapeHtml(u.email)}</td>
            <td style="padding: 12px 16px;">
              <span style="display: inline-block; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; background: ${rc.bg}; color: ${rc.text}; border: 1px solid ${rc.border};">
                ${u.role}
              </span>
            </td>
            <td style="padding: 12px 16px; min-width: 140px;">
              ${presenceBadge}
            </td>
            <td style="padding: 12px 16px; min-width: 180px;">
              ${timeWindowHtml}
            </td>
            <td style="padding: 12px 16px; font-size: 13px; font-weight: 700; color: #0f172a;">
              ${u.totalTimeSpentFormatted}
            </td>
            <td style="padding: 12px 16px; font-size: 12px;">
              ${formatDt(u.lastLoginAt)}
            </td>
            <td style="padding: 12px 16px; font-size: 12px;">
              ${formatDt(u.createdAt)}
            </td>
          </tr>`;
        })
        .join('');

      const onlineCount = records.filter((r) => r.isOnline).length;
      const offlineCount = records.length - onlineCount;

      const buildUrl = (newParams: Record<string, string>) => {
        const p = new URLSearchParams({
          sortBy,
          role: filterRole,
          presence: filterPresence,
          format: 'html',
          ...(queryToken ? { token: queryToken } : {}),
          ...newParams,
        });
        return `?${p.toString()}`;
      };

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MEDICORE-AI — Real-Time User Presence & Activity Log</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 24px; }
    .container { max-width: 1360px; margin: 0 auto; background: #ffffff; border-radius: 20px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01); border: 1px solid #e2e8f0; overflow: hidden; }
    .header { padding: 24px 32px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; background: #ffffff; flex-wrap: wrap; gap: 16px; }
    .title h1 { font-size: 20px; font-weight: 800; color: #0f172a; margin: 0; }
    .title p { font-size: 12px; color: #64748b; margin: 4px 0 0; }
    .stats-bar { display: flex; gap: 10px; align-items: center; }
    .badge { padding: 5px 14px; border-radius: 9999px; font-size: 12px; font-weight: 700; border: 1px solid transparent; }
    .badge-online { background: #dcfce7; color: #15803d; border-color: #bbf7d0; }
    .badge-offline { background: #f1f5f9; color: #64748b; border-color: #e2e8f0; }
    .badge-total { background: #eff6ff; color: #2563eb; border-color: #dbeafe; }
    .toolbar { padding: 16px 32px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; gap: 16px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
    .filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .btn { padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; border: 1px solid #cbd5e1; background: #ffffff; color: #334155; transition: all 0.15s; }
    .btn:hover { background: #f1f5f9; }
    .btn-active { background: #2563eb; color: #ffffff; border-color: #2563eb; }
    .btn-active:hover { background: #1d4ed8; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { padding: 12px 16px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; }
    .footer { padding: 16px 32px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title">
        <h1>User Presence & Role Activity Log (Firebase RTDB Backend)</h1>
        <p>Realtime Database Multi-Tab Presence &bull; 60s Refresh Cycle &bull; Zero Firestore Document Quotas</p>
      </div>
      <div class="stats-bar">
        <span class="badge badge-online">&bull; ${onlineCount} Online</span>
        <span class="badge badge-offline">&bull; ${offlineCount} Offline</span>
        <span class="badge badge-total">${records.length} Total Users</span>
      </div>
    </div>
    
    <div class="toolbar">
      <div class="filters">
        <span style="font-size: 12px; font-weight: 700; color: #475569;">Sort:</span>
        <a href="${buildUrl({ sortBy: 'last_signin' })}" class="btn ${sortBy === 'last_signin' ? 'btn-active' : ''}">Sign-In Time</a>
        <a href="${buildUrl({ sortBy: 'online_first' })}" class="btn ${sortBy === 'online_first' ? 'btn-active' : ''}">Online Users First</a>
        <a href="${buildUrl({ sortBy: 'total_time' })}" class="btn ${sortBy === 'total_time' ? 'btn-active' : ''}">Total Time Spent</a>
        <a href="${buildUrl({ sortBy: 'signup' })}" class="btn ${sortBy === 'signup' ? 'btn-active' : ''}">Sign-Up Time</a>

        <span style="font-size: 12px; font-weight: 700; color: #475569; margin-left: 12px;">Presence:</span>
        <a href="${buildUrl({ presence: 'all' })}" class="btn ${filterPresence === 'all' ? 'btn-active' : ''}">All</a>
        <a href="${buildUrl({ presence: 'online_only' })}" class="btn ${filterPresence === 'online_only' ? 'btn-active' : ''}">Online Only</a>
        <a href="${buildUrl({ presence: 'offline_only' })}" class="btn ${filterPresence === 'offline_only' ? 'btn-active' : ''}">Offline Only</a>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <span style="font-size: 11px; color: #64748b;" id="refreshCountdown">Auto-Refresh: 60s</span>
        <button onclick="window.print()" class="btn">Print PDF</button>
        <button onclick="window.location.reload()" class="btn">Manual Refresh</button>
      </div>
    </div>

    <div style="overflow-x: auto;">
      <table>
        <thead>
          <tr>
            <th>User & UID</th>
            <th>Email</th>
            <th>Role</th>
            <th>Current Status</th>
            <th>Active Time Window</th>
            <th>Total Time in Role</th>
            <th>Last Sign-In</th>
            <th>Account Created</th>
          </tr>
        </thead>
        <tbody>
          ${htmlTableRows}
        </tbody>
      </table>
    </div>

    <div class="footer">
      <div>Generated at ${new Date().toLocaleString()} &bull; MEDICORE-AI Admin Kernel</div>
      <div>Real-Time Activity Monitor &bull; Zero Quota Footprint</div>
    </div>
  </div>

  <script>
    // Exact 60-second automatic refresh (pauses when tab is hidden)
    let secondsLeft = 60;
    const label = document.getElementById('refreshCountdown');
    
    const countdownTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        secondsLeft--;
        if (label) label.textContent = 'Auto-Refresh: ' + secondsLeft + 's';
        if (secondsLeft <= 0) {
          window.location.reload();
        }
      }
    }, 1000);
  </script>
</body>
</html>`;

      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return NextResponse.json({
      success: true,
      total: records.length,
      onlineCount: records.filter((r) => r.isOnline).length,
      pendingCount: records.filter((r) => r.presenceStatus === 'pending').length,
      offlineCount: records.filter((r) => r.presenceStatus === 'offline').length,
      sortBy,
      filterRole,
      filterPresence,
      users: records,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[AdminUserLogAPI] Failed to compile user log:', msg);
    return NextResponse.json({ error: `Failed to compile user log: ${msg}` }, { status: 500 });
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
