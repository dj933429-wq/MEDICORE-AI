import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const ALLOWED_ADMIN_ROLES = ['patient', 'doctor', 'pharmacist'] as const;
type AllowedRole = typeof ALLOWED_ADMIN_ROLES[number];

/**
 * Helper to authenticate caller and verify 'admin' Custom Claim
 */
async function verifyAdminCaller(req: Request) {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Unauthorized: Missing or invalid Authorization Bearer header', status: 401 };
  }

  const token = authHeader.split('Bearer ')[1]?.trim();
  if (!token) {
    return { error: 'Unauthorized: Token not provided', status: 401 };
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    if (decodedToken.role !== 'admin') {
      return { error: 'Forbidden: Administrator privileges required', status: 403 };
    }
    return { decodedToken, status: 200 };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[AdminUsersAPI] Token verification error:', message);
    return { error: 'Unauthorized: Invalid or expired authentication token', status: 401 };
  }
}

/**
 * GET — Fetch the complete user directory with real Custom Claims
 */
export async function GET(req: Request) {
  const authCheck = await verifyAdminCaller(req);
  if (authCheck.error || !authCheck.decodedToken) {
    return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
  }

  try {
    // 1. Fetch all Firestore user profile records
    const usersSnap = await adminDb.collection('users').get();
    const firestoreUsersMap = new Map<string, Record<string, unknown>>();
    usersSnap.forEach(doc => {
      firestoreUsersMap.set(doc.id, doc.data());
    });

    // 2. Fetch all Auth users to retrieve real, authoritative Custom Claims
    const authUsersResult = await adminAuth.listUsers(1000);
    const authUsersMap = new Map<string, typeof authUsersResult.users[0]>();
    authUsersResult.users.forEach(u => {
      authUsersMap.set(u.uid, u);
    });

    // 3. Merge profiles: Auth claims are authoritative over Firestore role projection
    // Include all UIDs present in either Auth or Firestore
    const allUids = new Set([...firestoreUsersMap.keys(), ...authUsersMap.keys()]);
    const userList = [];

    for (const uid of allUids) {
      const authUser = authUsersMap.get(uid);
      const fsData = firestoreUsersMap.get(uid) || {};

      const claims = authUser?.customClaims || {};
      const customRole = claims.role as string | undefined;
      const profileRole = (fsData.role as string) || 'patient';

      // Effective role priority: verified Custom Claim > profile role > default 'patient'
      const effectiveRole = customRole || profileRole || 'patient';

      userList.push({
        uid,
        name: (fsData.name as string) || authUser?.displayName || (authUser?.email ? authUser.email.split('@')[0] : 'Unknown'),
        email: (fsData.email as string) || authUser?.email || '',
        role: effectiveRole,
        requestedRole: (fsData.requestedRole as string) || null,
        createdAt: (fsData.createdAt as string) || authUser?.metadata.creationTime || null,
        customClaims: claims
      });
    }

    // Sort users: admins first, then doctors, then pharmacists, then patients
    const roleWeight: Record<string, number> = { admin: 0, doctor: 1, pharmacist: 2, patient: 3 };
    userList.sort((a, b) => {
      const weightA = roleWeight[a.role] ?? 4;
      const weightB = roleWeight[b.role] ?? 4;
      if (weightA !== weightB) return weightA - weightB;
      return (a.name || '').localeCompare(b.name || '');
    });

    return NextResponse.json({ users: userList }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[AdminUsersAPI] Failed to fetch users:', message);

    if (message.includes('Could not load the default credentials') || 
        message.includes('NO_ADC_FOUND') || 
        message.includes('credential')) {
      return NextResponse.json({ 
        error: 'Firebase Admin SDK credentials missing on server runtime. To enable server-side role management, provide FIREBASE_SERVICE_ACCOUNT_KEY in .env.local or configure Application Default Credentials.' 
      }, { status: 500 });
    }

    return NextResponse.json({ error: `Failed to fetch user directory: ${message}` }, { status: 500 });
  }
}

/**
 * PATCH — Change a target user's role securely using Firebase Admin SDK
 */
export async function PATCH(req: Request) {
  const authCheck = await verifyAdminCaller(req);
  if (authCheck.error || !authCheck.decodedToken) {
    return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
  }

  const callerUid = authCheck.decodedToken.uid;

  try {
    const body = await req.json().catch(() => ({}));
    const { targetUid, newRole } = body;

    // 1. Validate inputs
    if (!targetUid || typeof targetUid !== 'string') {
      return NextResponse.json({ error: 'Validation error: targetUid is required' }, { status: 400 });
    }

    if (!newRole || typeof newRole !== 'string') {
      return NextResponse.json({ error: 'Validation error: newRole is required' }, { status: 400 });
    }

    // 2. Disallow self-modification
    if (targetUid === callerUid) {
      return NextResponse.json({ error: 'Security constraint: Administrators cannot modify their own role' }, { status: 400 });
    }

    // 3. Validate role against strict allowlist (disallow admin and blood_bank)
    if (!ALLOWED_ADMIN_ROLES.includes(newRole as AllowedRole)) {
      return NextResponse.json({ 
        error: `Invalid role '${newRole}'. Permitted roles through this interface are: ${ALLOWED_ADMIN_ROLES.join(', ')}` 
      }, { status: 400 });
    }

    // 4. Verify target user exists in Firebase Authentication
    let targetAuthUser;
    try {
      targetAuthUser = await adminAuth.getUser(targetUid);
    } catch (userErr: unknown) {
      console.warn('[AdminUsersAPI] Target user not found in Auth:', targetUid, userErr);
      return NextResponse.json({ error: `User with UID '${targetUid}' not found in Authentication system` }, { status: 404 });
    }

    // 5. Retrieve existing custom claims and preserve unrelated claims
    const existingClaims = targetAuthUser.customClaims || {};
    const oldRole = (existingClaims.role as string) || 'patient';

    const updatedClaims = {
      ...existingClaims,
      role: newRole
    };

    // 6. Update Firebase Authentication Custom Claims
    await adminAuth.setCustomUserClaims(targetUid, updatedClaims);

    // 7. Update Firestore user profile projection
    const userDocRef = adminDb.collection('users').doc(targetUid);
    const userSnap = await userDocRef.get();
    const existingFsData = userSnap.data() || {};

    try {
      const updatePayload: Record<string, unknown> = {
        role: newRole,
        updatedAt: new Date().toISOString()
      };

      // If user had a requestedRole matching the new approved role, clear it
      if (existingFsData.requestedRole === newRole) {
        updatePayload.requestedRole = FieldValue.delete();
      }

      await userDocRef.set(updatePayload, { merge: true });

      // Synchronize lookup directories as needed
      const displayName = (existingFsData.name as string) || targetAuthUser.displayName || targetAuthUser.email?.split('@')[0] || 'User';

      if (newRole === 'doctor') {
        const docLookupRef = adminDb.collection('publicDoctorProfiles').doc(targetUid);
        await docLookupRef.set({
          name: displayName,
          specialization: (existingFsData.specialization as string) || 'General Physician',
          profileImage: (existingFsData.profileImage as string) || '',
          availability: 'Available',
          doctorId: targetUid
        }, { merge: true });
      }

      if (newRole === 'patient') {
        const patientLookupRef = adminDb.collection('pharmacyPatientLookup').doc(targetUid);
        await patientLookupRef.set({
          displayName,
          patientReference: targetUid,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }

    } catch (fsErr: unknown) {
      // Rollback Auth claim on Firestore failure to preserve consistency
      console.error('[AdminUsersAPI] Firestore projection failed, rolling back Custom Claims:', fsErr);
      await adminAuth.setCustomUserClaims(targetUid, existingClaims);
      return NextResponse.json({ 
        error: 'Database projection update failed. Auth claim was rolled back to prevent state divergence.' 
      }, { status: 500 });
    }

    // 8. Record administrative role-change audit event in adminAuditLogs
    try {
      await adminDb.collection('adminAuditLogs').add({
        actorUid: callerUid,
        actorEmail: authCheck.decodedToken.email || 'unknown',
        targetUid,
        targetEmail: targetAuthUser.email || '',
        oldRole,
        newRole,
        timestamp: new Date().toISOString()
      });
    } catch (auditErr) {
      console.warn('[AdminUsersAPI] Warning: Audit log write failed:', auditErr);
    }

    return NextResponse.json({
      success: true,
      message: `Role successfully updated to '${newRole}'.`,
      notice: 'The role has been updated. The affected user must sign out and sign in again, or refresh their Firebase ID token, for the new permissions to take effect.',
      targetUid,
      oldRole,
      newRole
    }, { status: 200 });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[AdminUsersAPI] PATCH error:', message);

    if (message.includes('Could not load the default credentials') || 
        message.includes('NO_ADC_FOUND') || 
        message.includes('credential')) {
      return NextResponse.json({ 
        error: 'Firebase Admin SDK credentials missing on server runtime. To enable server-side role management, provide FIREBASE_SERVICE_ACCOUNT_KEY in .env.local or configure Application Default Credentials.' 
      }, { status: 500 });
    }

    return NextResponse.json({ error: `Failed to apply role change: ${message}` }, { status: 500 });
  }
}

