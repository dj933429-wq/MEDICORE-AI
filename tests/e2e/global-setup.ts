import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

export const E2E_TEST_USERS = [
  {
    email: 'e2e_patient_female@medicore.ai',
    password: 'E2E_TestPassword123!',
    displayName: 'E2E Jane Patient',
    role: 'patient',
    gender: 'female',
    claims: { role: 'patient' },
  },
  {
    email: 'e2e_patient_male@medicore.ai',
    password: 'E2E_TestPassword123!',
    displayName: 'E2E John Patient',
    role: 'patient',
    gender: 'male',
    claims: { role: 'patient' },
  },
  {
    email: 'e2e_doctor@medicore.ai',
    password: 'E2E_TestPassword123!',
    displayName: 'Dr. E2E Robert Specialist',
    role: 'doctor',
    claims: { role: 'doctor' },
    doctorProfile: {
      specialization: 'Internal Medicine',
      availability: 'Mon-Fri 09:00 AM - 05:00 PM',
    },
  },
  {
    email: 'e2e_pharmacist@medicore.ai',
    password: 'E2E_TestPassword123!',
    displayName: 'E2E Pharmacist David',
    role: 'pharmacist',
    claims: { role: 'pharmacist' },
  },
  {
    email: 'e2e_bloodbank@medicore.ai',
    password: 'E2E_TestPassword123!',
    displayName: 'E2E Blood Bank Officer',
    role: 'blood_bank',
    claims: { role: 'blood_bank' },
  },
  {
    email: 'e2e_admin@medicore.ai',
    password: 'E2E_TestPassword123!',
    displayName: 'E2E Master Administrator',
    role: 'admin',
    claims: { role: 'admin' },
  },
];

export default async function globalSetup() {
  console.log('\n[E2E Global Setup] Initializing Firebase Admin SDK for E2E user provisioning...');
  
  const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!rawKey) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY missing from environment. Cannot provision E2E test users.');
  }

  const serviceAccount = JSON.parse(rawKey);
  const app = getApps().length === 0
    ? initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.project_id,
      })
    : getApps()[0];

  const auth = getAuth(app);
  const db = getFirestore(app);

  for (const userConfig of E2E_TEST_USERS) {
    let uid: string;
    try {
      const existing = await auth.getUserByEmail(userConfig.email).catch(() => null);
      if (existing) {
        uid = existing.uid;
        await auth.updateUser(uid, {
          displayName: userConfig.displayName,
          password: userConfig.password,
        });
      } else {
        const created = await auth.createUser({
          email: userConfig.email,
          password: userConfig.password,
          displayName: userConfig.displayName,
        });
        uid = created.uid;
      }

      // Provision Custom Claims for privileged/role authorization
      await auth.setCustomUserClaims(uid, userConfig.claims);

      // Upsert into /users/{uid} document
      const userDocRef = db.collection('users').doc(uid);
      const userPayload: Record<string, unknown> = {
        name: userConfig.displayName,
        email: userConfig.email,
        role: userConfig.role,
        updatedAt: new Date().toISOString(),
      };
      if (userConfig.gender) {
        userPayload.gender = userConfig.gender;
      }
      await userDocRef.set(userPayload, { merge: true });

      // If patient, ensure /patients/{uid} exists
      if (userConfig.role === 'patient') {
        const patientDocRef = db.collection('patients').doc(uid);
        const patientPayload: Record<string, unknown> = {
          name: userConfig.displayName,
          email: userConfig.email,
          userId: uid,
          phone: '+1-555-0199',
          updatedAt: new Date().toISOString(),
        };
        if (userConfig.gender) {
          patientPayload.gender = userConfig.gender;
        }
        await patientDocRef.set(patientPayload, { merge: true });
      }

      // If doctor, ensure public lookup exists
      if (userConfig.role === 'doctor' && userConfig.doctorProfile) {
        const doctorLookupRef = db.collection('publicDoctorProfiles').doc(uid);
        await doctorLookupRef.set({
          name: userConfig.displayName,
          specialization: userConfig.doctorProfile.specialization,
          availability: userConfig.doctorProfile.availability,
          email: userConfig.email,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

      console.log(`  [OK] Provisioned E2E user: ${userConfig.email} (${userConfig.role})`);
    } catch (err) {
      console.error(`  [FAIL] Error provisioning ${userConfig.email}:`, err);
      throw err;
    }
  }

  console.log('[E2E Global Setup] Completed provisioning all dedicated E2E accounts.\n');
}

