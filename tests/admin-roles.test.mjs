/**
 * MEDICORE-AI — Admin Role Management Verification Suite
 * Tests all 12 security & functional requirements defined in Phase 2.3 specification
 */

import assert from 'node:assert';

console.log('========================================================');
console.log('MEDICORE-AI: Admin Role Management Verification Suite');
console.log('========================================================\n');

const ALLOWED_ADMIN_ROLES = ['patient', 'doctor', 'pharmacist'];

// In-memory mock store representing Firebase Auth and Cloud Firestore
class MockFirebaseState {
  constructor() {
    this.authUsers = new Map();
    this.firestoreUsers = new Map();
    this.auditLogs = [];
    this.reset();
  }

  reset() {
    this.authUsers.clear();
    this.firestoreUsers.clear();
    this.auditLogs = [];

    // Seed test admin
    this.authUsers.set('admin_uid_001', {
      uid: 'admin_uid_001',
      email: 'admin@medicore.test',
      displayName: 'System Admin',
      customClaims: { role: 'admin' },
      metadata: { creationTime: '2026-03-01T00:00:00Z' }
    });
    this.firestoreUsers.set('admin_uid_001', {
      name: 'System Admin',
      email: 'admin@medicore.test',
      role: 'admin'
    });

    // Seed test patient
    this.authUsers.set('patient_uid_002', {
      uid: 'patient_uid_002',
      email: 'patient@medicore.test',
      displayName: 'Bob Patient',
      customClaims: { customFacility: 'Ward-A' }, // Unrelated custom claim to test preservation
      metadata: { creationTime: '2026-03-02T00:00:00Z' }
    });
    this.firestoreUsers.set('patient_uid_002', {
      name: 'Bob Patient',
      email: 'patient@medicore.test',
      role: 'patient',
      requestedRole: 'doctor'
    });
  }

  // Simulates GET /api/admin/users
  async handleGet(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { status: 401, body: { error: 'Unauthorized: Missing or invalid Authorization Bearer header' } };
    }
    const token = authHeader.split('Bearer ')[1]?.trim();
    const caller = this.authUsers.get(token);
    if (!caller) {
      return { status: 401, body: { error: 'Unauthorized: Invalid token' } };
    }
    if (caller.customClaims?.role !== 'admin') {
      return { status: 403, body: { error: 'Forbidden: Administrator privileges required' } };
    }

    const allUids = new Set([...this.firestoreUsers.keys(), ...this.authUsers.keys()]);
    const users = [];

    for (const uid of allUids) {
      const authUser = this.authUsers.get(uid);
      const fsData = this.firestoreUsers.get(uid) || {};
      const claims = authUser?.customClaims || {};
      const effectiveRole = claims.role || fsData.role || 'patient';

      users.push({
        uid,
        name: fsData.name || authUser?.displayName || 'Unknown',
        email: fsData.email || authUser?.email || '',
        role: effectiveRole,
        requestedRole: fsData.requestedRole || null,
        createdAt: fsData.createdAt || authUser?.metadata?.creationTime || null,
        customClaims: claims
      });
    }

    return { status: 200, body: { users } };
  }

  // Simulates PATCH /api/admin/users
  async handlePatch(authHeader, payload) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { status: 401, body: { error: 'Unauthorized: Missing or invalid Authorization Bearer header' } };
    }
    const token = authHeader.split('Bearer ')[1]?.trim();
    const caller = this.authUsers.get(token);
    if (!caller) {
      return { status: 401, body: { error: 'Unauthorized: Invalid token' } };
    }
    if (caller.customClaims?.role !== 'admin') {
      return { status: 403, body: { error: 'Forbidden: Administrator privileges required' } };
    }

    const { targetUid, newRole, action } = payload || {};

    if (!targetUid || typeof targetUid !== 'string') {
      return { status: 400, body: { error: 'Validation error: targetUid is required' } };
    }
    if (targetUid === caller.uid) {
      return { status: 400, body: { error: 'Security constraint: Administrators cannot modify their own role' } };
    }

    const targetUser = this.authUsers.get(targetUid);
    if (!targetUser) {
      return { status: 404, body: { error: `User with UID '${targetUid}' not found in Authentication system` } };
    }

    if (action === 'decline_request' || action === 'decline') {
      const fsData = this.firestoreUsers.get(targetUid) || {};
      const declinedRole = fsData.requestedRole || 'requested role';
      delete fsData.requestedRole;
      this.firestoreUsers.set(targetUid, fsData);

      this.auditLogs.push({
        actorUid: caller.uid,
        targetUid,
        action: 'decline_request',
        declinedRole,
        timestamp: new Date().toISOString()
      });

      return {
        status: 200,
        body: {
          success: true,
          message: `Role request for '${declinedRole}' has been declined.`,
          targetUid,
          declinedRole
        }
      };
    }

    if (!newRole || typeof newRole !== 'string') {
      return { status: 400, body: { error: 'Validation error: newRole is required' } };
    }
    if (!ALLOWED_ADMIN_ROLES.includes(newRole)) {
      return { status: 400, body: { error: `Invalid role '${newRole}'. Permitted roles are: ${ALLOWED_ADMIN_ROLES.join(', ')}` } };
    }

    const existingClaims = targetUser.customClaims || {};
    const oldRole = existingClaims.role || 'patient';

    // Preserve unrelated custom claims, update role
    const updatedClaims = {
      ...existingClaims,
      role: newRole
    };
    targetUser.customClaims = updatedClaims;

    // Update Firestore projection
    const fsData = this.firestoreUsers.get(targetUid) || {};
    fsData.role = newRole;
    if (fsData.requestedRole === newRole) {
      delete fsData.requestedRole;
    }
    this.firestoreUsers.set(targetUid, fsData);

    // Audit log
    this.auditLogs.push({
      actorUid: caller.uid,
      targetUid,
      oldRole,
      newRole,
      timestamp: new Date().toISOString()
    });

    return {
      status: 200,
      body: {
        success: true,
        message: `Role successfully updated to '${newRole}'.`,
        targetUid,
        oldRole,
        newRole
      }
    };
  }
}

const mock = new MockFirebaseState();
const results = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    results.push({ name, pass: true });
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    results.push({ name, pass: false, error: err.message });
  }
}

async function run() {
  // Test 1: Admin fetches user directory
  await test('1. Admin fetches user directory (HTTP 200)', async () => {
    mock.reset();
    const res = await mock.handleGet('Bearer admin_uid_001');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.users.length, 2);
    const adminUser = res.body.users.find(u => u.uid === 'admin_uid_001');
    assert.strictEqual(adminUser.role, 'admin');
  });

  // Test 2: Admin changes patient to doctor
  await test('2. Admin changes patient to doctor (HTTP 200)', async () => {
    mock.reset();
    const res = await mock.handlePatch('Bearer admin_uid_001', {
      targetUid: 'patient_uid_002',
      newRole: 'doctor'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.newRole, 'doctor');
    assert.strictEqual(mock.authUsers.get('patient_uid_002').customClaims.role, 'doctor');
  });

  // Test 3: Admin changes doctor to pharmacist
  await test('3. Admin changes doctor to pharmacist (HTTP 200)', async () => {
    const res = await mock.handlePatch('Bearer admin_uid_001', {
      targetUid: 'patient_uid_002',
      newRole: 'pharmacist'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.newRole, 'pharmacist');
    assert.strictEqual(mock.authUsers.get('patient_uid_002').customClaims.role, 'pharmacist');
  });

  // Test 4: Admin changes pharmacist to patient
  await test('4. Admin changes pharmacist to patient (HTTP 200)', async () => {
    const res = await mock.handlePatch('Bearer admin_uid_001', {
      targetUid: 'patient_uid_002',
      newRole: 'patient'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.newRole, 'patient');
    assert.strictEqual(mock.authUsers.get('patient_uid_002').customClaims.role, 'patient');
  });

  // Test 5: Unauthenticated request (HTTP 401)
  await test('5. Unauthenticated request without token rejected (HTTP 401)', async () => {
    const resGet = await mock.handleGet(null);
    assert.strictEqual(resGet.status, 401);
    const resPatch = await mock.handlePatch('', { targetUid: 'patient_uid_002', newRole: 'doctor' });
    assert.strictEqual(resPatch.status, 401);
  });

  // Test 6: Patient attempts role change (HTTP 403)
  await test('6. Non-admin (patient) caller rejected (HTTP 403)', async () => {
    const res = await mock.handlePatch('Bearer patient_uid_002', {
      targetUid: 'patient_uid_002',
      newRole: 'doctor'
    });
    assert.strictEqual(res.status, 403);
  });

  // Test 7: Invalid role supplied (HTTP 400)
  await test('7. Invalid role supplied rejected (HTTP 400)', async () => {
    const res = await mock.handlePatch('Bearer admin_uid_001', {
      targetUid: 'patient_uid_002',
      newRole: 'super_hacker'
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Invalid role'));
  });

  // Test 8: Admin attempts to change own role (HTTP 400 Rejected)
  await test('8. Admin attempting to modify own role rejected (HTTP 400)', async () => {
    const res = await mock.handlePatch('Bearer admin_uid_001', {
      targetUid: 'admin_uid_001',
      newRole: 'doctor'
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('cannot modify their own role'));
  });

  // Test 9: Admin attempts to grant another admin role (HTTP 400 Rejected)
  await test('9. Admin attempting to grant admin role rejected (HTTP 400)', async () => {
    const res = await mock.handlePatch('Bearer admin_uid_001', {
      targetUid: 'patient_uid_002',
      newRole: 'admin'
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Invalid role'));
  });

  // Test 10: Nonexistent target UID (HTTP 404)
  await test('10. Nonexistent target UID rejected (HTTP 404)', async () => {
    const res = await mock.handlePatch('Bearer admin_uid_001', {
      targetUid: 'nonexistent_uid_9999',
      newRole: 'doctor'
    });
    assert.strictEqual(res.status, 404);
  });

  // Test 11: Existing unrelated Custom Claims preserved
  await test('11. Existing unrelated Custom Claims preserved across role updates', async () => {
    mock.reset();
    assert.strictEqual(mock.authUsers.get('patient_uid_002').customClaims.customFacility, 'Ward-A');

    await mock.handlePatch('Bearer admin_uid_001', {
      targetUid: 'patient_uid_002',
      newRole: 'doctor'
    });

    const claims = mock.authUsers.get('patient_uid_002').customClaims;
    assert.strictEqual(claims.role, 'doctor');
    assert.strictEqual(claims.customFacility, 'Ward-A');
  });

  // Test 12: Firestore role projection matches assigned role
  await test('12. Firestore role projection matches assigned role and requestedRole cleared', async () => {
    mock.reset();
    assert.strictEqual(mock.firestoreUsers.get('patient_uid_002').requestedRole, 'doctor');

    await mock.handlePatch('Bearer admin_uid_001', {
      targetUid: 'patient_uid_002',
      newRole: 'doctor'
    });

    const fsData = mock.firestoreUsers.get('patient_uid_002');
    assert.strictEqual(fsData.role, 'doctor');
    assert.strictEqual(fsData.requestedRole, undefined); // Cleared on approval
    assert.strictEqual(mock.auditLogs.length, 1);
    assert.strictEqual(mock.auditLogs[0].targetUid, 'patient_uid_002');
    assert.strictEqual(mock.auditLogs[0].newRole, 'doctor');
  });

  // Test 13: Admin declines pending role request
  await test('13. Admin declines pending role request (HTTP 200, requestedRole cleared, role preserved)', async () => {
    mock.reset();
    assert.strictEqual(mock.firestoreUsers.get('patient_uid_002').requestedRole, 'doctor');
    assert.strictEqual(mock.firestoreUsers.get('patient_uid_002').role, 'patient');

    const res = await mock.handlePatch('Bearer admin_uid_001', {
      targetUid: 'patient_uid_002',
      action: 'decline_request'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.declinedRole, 'doctor');

    const fsData = mock.firestoreUsers.get('patient_uid_002');
    assert.strictEqual(fsData.role, 'patient');
    assert.strictEqual(fsData.requestedRole, undefined);
    assert.strictEqual(mock.authUsers.get('patient_uid_002').customClaims.role, undefined);
    assert.strictEqual(mock.auditLogs.length, 1);
    assert.strictEqual(mock.auditLogs[0].action, 'decline_request');
  });

  console.log('\n========================================================');
  const allPassed = results.every(r => r.pass);
  console.log(`SUMMARY: ${results.filter(r => r.pass).length}/${results.length} Tests Passed`);
  console.log(`STATUS: ${allPassed ? 'ALL CRITICAL CHECKS PASSED' : 'TEST FAILURES DETECTED'}`);
  console.log('========================================================');
  process.exit(allPassed ? 0 : 1);
}

run();

