import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

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
    // 1. Fetch Firestore user documents (gracefully fall back if Firestore quota is exhausted)
    const firestoreMap = new Map<string, Record<string, unknown>>();
    try {
      const usersSnap = await adminDb.collection('users').get();
      usersSnap.forEach((doc) => {
        firestoreMap.set(doc.id, doc.data());
      });
    } catch (fsErr: unknown) {
      const fsMsg = fsErr instanceof Error ? fsErr.message : String(fsErr);
      console.warn('[AdminUserLogAPI] Firestore read bypassed (Quota/Offline). Falling back to Auth metadata:', fsMsg);
    }

    // 2. Fetch Firebase Authentication user records
    const authResult = await adminAuth.listUsers(1000);
    const authMap = new Map<string, (typeof authResult.users)[0]>();
    authResult.users.forEach((u) => {
      authMap.set(u.uid, u);
    });

    // 3. Compile active presence and session data
    const allUids = new Set([...firestoreMap.keys(), ...authMap.keys()]);
    const records = [];
    const nowEpoch = Date.now();

    for (const uid of allUids) {
      const authUser = authMap.get(uid);
      const fsData = firestoreMap.get(uid) || {};

      const claims = authUser?.customClaims || {};
      const customRole = claims.role as string | undefined;
      const profileRole = (fsData.role as string) || 'patient';
      const effectiveRole = customRole || profileRole || 'patient';

      if (filterRole !== 'all' && effectiveRole !== filterRole) {
        continue;
      }

      // Compute creation timestamp
      const createdAtRaw = (fsData.createdAt as string) || authUser?.metadata.creationTime || '';
      const createdEpoch = createdAtRaw ? new Date(createdAtRaw).getTime() : 0;

      // Compute last sign-in timestamp
      const lastSignInRaw = (fsData.lastLoginAt as string) || authUser?.metadata.lastSignInTime || createdAtRaw || '';
      const lastSignInEpoch = lastSignInRaw ? new Date(lastSignInRaw).getTime() : createdEpoch;

      // Presence Calculation:
      // Active if marked isOnline AND lastSeenAt is within 45 seconds (45,000 ms)
      const lastSeenAtRaw = (fsData.lastSeenAt as string) || lastSignInRaw || '';
      const lastSeenEpoch = lastSeenAtRaw ? new Date(lastSeenAtRaw).getTime() : 0;
      const timeSinceLastSeenMs = lastSeenEpoch > 0 ? Math.max(0, nowEpoch - lastSeenEpoch) : Infinity;

      const isRecordedOnline = Boolean(fsData.isOnline);
      const isOnline = isRecordedOnline && timeSinceLastSeenMs <= 45000;

      if (filterPresence === 'online_only' && !isOnline) {
        continue;
      }
      if (filterPresence === 'offline_only' && isOnline) {
        continue;
      }

      // Session Start & End Window:
      const sessionStartedAtRaw = (fsData.sessionStartedAt as string) || (isOnline ? lastSeenAtRaw : null);
      const sessionStartedEpoch = sessionStartedAtRaw ? new Date(sessionStartedAtRaw).getTime() : 0;

      const lastSessionEndedAtRaw = (fsData.lastSessionEndedAt as string) || (!isOnline && lastSeenAtRaw ? lastSeenAtRaw : null);
      const lastSessionEndedEpoch = lastSessionEndedAtRaw ? new Date(lastSessionEndedAtRaw).getTime() : 0;

      // Current / Last Session Duration:
      let currentSessionSec = 0;
      if (isOnline && sessionStartedEpoch > 0) {
        currentSessionSec = Math.max(0, Math.floor((nowEpoch - sessionStartedEpoch) / 1000));
      } else if (typeof fsData.lastSessionDurationSec === 'number') {
        currentSessionSec = Math.floor(fsData.lastSessionDurationSec);
      } else if (sessionStartedEpoch > 0 && lastSessionEndedEpoch >= sessionStartedEpoch) {
        currentSessionSec = Math.max(0, Math.floor((lastSessionEndedEpoch - sessionStartedEpoch) / 1000));
      }

      // Cumulative Total Time in Role:
      const baseTotalSec = typeof fsData.totalTimeSpentSec === 'number' ? Math.floor(fsData.totalTimeSpentSec) : 0;
      const totalTimeSpentSec = isOnline ? baseTotalSec + currentSessionSec : baseTotalSec;

      const lastInteractionType = (fsData.lastInteractionType as string) || (isOnline ? 'active' : 'idle');

      records.push({
        uid,
        name: (fsData.name as string) || authUser?.displayName || (authUser?.email ? authUser.email.split('@')[0] : 'Unknown'),
        email: (fsData.email as string) || authUser?.email || 'N/A',
        role: effectiveRole,
        isOnline,
        timeSinceLastSeenMs,
        lastInteractionType,
        sessionStartedAt: sessionStartedAtRaw ? new Date(sessionStartedAtRaw).toISOString() : null,
        sessionEndedAt: isOnline ? null : (lastSessionEndedAtRaw ? new Date(lastSessionEndedAtRaw).toISOString() : null),
        currentSessionSec,
        currentSessionFormatted: formatDuration(currentSessionSec),
        totalTimeSpentSec,
        totalTimeSpentFormatted: formatDuration(totalTimeSpentSec),
        createdAt: createdAtRaw ? new Date(createdAtRaw).toISOString() : null,
        createdEpoch,
        lastSignInAt: lastSignInRaw ? new Date(lastSignInRaw).toISOString() : null,
        lastSignInEpoch,
        lastSeenAt: lastSeenAtRaw ? new Date(lastSeenAtRaw).toISOString() : null,
        lastSeenEpoch,
        disabled: Boolean(authUser?.disabled),
      });
    }

    // 4. Sorting
    if (sortBy === 'signup') {
      records.sort((a, b) => b.createdEpoch - a.createdEpoch);
    } else if (sortBy === 'online_first') {
      records.sort((a, b) => {
        if (a.isOnline === b.isOnline) return b.lastSeenEpoch - a.lastSeenEpoch;
        return a.isOnline ? -1 : 1;
      });
    } else if (sortBy === 'total_time') {
      records.sort((a, b) => b.totalTimeSpentSec - a.totalTimeSpentSec);
    } else {
      // Default: last_signin
      records.sort((a, b) => b.lastSignInEpoch - a.lastSignInEpoch);
    }

    // 5. Render HTML view if requested
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

          // Session Time Window ("from how much time to how much time they are online")
          let timeWindowHtml = '';
          if (u.isOnline) {
            const startStr = u.sessionStartedAt ? formatTimeOnly(u.sessionStartedAt) : 'Session Active';
            timeWindowHtml = `
              <div style="font-weight:700; color:#15803d; font-size:12px;">From ${startStr} &rarr; Active Now</div>
              <div style="color:#16a34a; font-size:11px; font-weight:600;">Scrolling / Active (${u.currentSessionFormatted})</div>
            `;
          } else if (u.sessionStartedAt && u.sessionEndedAt) {
            timeWindowHtml = `
              <div style="font-weight:600; color:#475569; font-size:12px;">${formatTimeOnly(u.sessionStartedAt)} &rarr; ${formatTimeOnly(u.sessionEndedAt)}</div>
              <div style="color:#64748b; font-size:11px;">Duration: ${u.currentSessionFormatted}</div>
            `;
          } else {
            timeWindowHtml = `
              <div style="color:#94a3b8; font-size:12px; font-style:italic;">No recorded session</div>
              <div style="color:#94a3b8; font-size:11px;">${u.lastSeenAt ? 'Last seen ' + formatTimeOnly(u.lastSeenAt) : ''}</div>
            `;
          }

          // Presence Pill
          const presenceBadge = u.isOnline
            ? `<span style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:9999px; font-size:11px; font-weight:700; background:#dcfce7; color:#15803d; border:1px solid #86efac;">
                <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#22c55e; box-shadow:0 0 8px #22c55e;"></span>
                ONLINE
               </span>
               <div style="font-size:10px; color:#16a34a; margin-top:3px; text-transform:capitalize;">${escapeHtml(u.lastInteractionType)}</div>`
            : `<span style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:9999px; font-size:11px; font-weight:700; background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1;">
                <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#94a3b8;"></span>
                OFFLINE
               </span>
               <div style="font-size:10px; color:#94a3b8; margin-top:3px;">${u.lastSeenAt ? 'Last: ' + formatTimeOnly(u.lastSeenAt) : 'Never seen'}</div>`;

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
            <td style="padding: 12px 16px; min-width: 130px;">
              ${presenceBadge}
            </td>
            <td style="padding: 12px 16px; min-width: 170px;">
              ${timeWindowHtml}
            </td>
            <td style="padding: 12px 16px; font-size: 13px; font-weight: 700; color: #0f172a;">
              ${u.totalTimeSpentFormatted}
            </td>
            <td style="padding: 12px 16px; font-size: 12px;">
              ${formatDt(u.lastSignInAt)}
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
        <h1>User Presence & Role Activity Log (Backend HTML View)</h1>
        <p>Real-time presence tracking, scroll & interaction monitor, and session time accounting &bull; Admin Authorized</p>
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
        <label style="font-size: 12px; color: #64748b; display: flex; align-items: center; gap: 4px; cursor: pointer;">
          <input type="checkbox" id="autoRefreshToggle" checked onchange="toggleAutoRefresh(this.checked)" /> Auto-Refresh (10s)
        </label>
        <button onclick="window.print()" class="btn">Print PDF</button>
        <button onclick="window.location.reload()" class="btn">Refresh Now</button>
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
            <th>Active Time Window (From - To)</th>
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
      <div>Real-Time Presence Tracker &bull; Confidential Healthcare Audit</div>
    </div>
  </div>

  <script>
    let refreshTimer = setInterval(() => {
      window.location.reload();
    }, 10000);

    function toggleAutoRefresh(enabled) {
      if (enabled) {
        if (!refreshTimer) refreshTimer = setInterval(() => window.location.reload(), 10000);
      } else {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    }
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
      offlineCount: records.filter((r) => !r.isOnline).length,
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
