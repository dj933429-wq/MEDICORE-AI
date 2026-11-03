import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  console.error('ERROR: FIREBASE_SERVICE_ACCOUNT_KEY environment variable is missing.');
  process.exit(1);
}

const key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
const app = initializeApp({ credential: cert(key), projectId: key.project_id }, 'seed-runner');
const auth = getAuth(app);
const db = getFirestore(app);

export const TEST_USERS = [
  {
    email: 'sarah.patient@medicore.ai',
    password: 'TestPassword123!',
    displayName: 'Sarah Jenkins',
    role: 'patient',
    requestedRole: null,
    claims: {}
  },
  {
    email: 'alex.patient@medicore.ai',
    password: 'TestPassword123!',
    displayName: 'Alex Miller',
    role: 'patient',
    requestedRole: null,
    claims: {}
  },
  {
    email: 'dr.rajesh@medicore.ai',
    password: 'TestPassword123!',
    displayName: 'Dr. Rajesh Patel',
    role: 'doctor',
    requestedRole: null,
    claims: { role: 'doctor' },
    doctorProfile: {
      specialization: 'Cardiologist',
      availability: 'Mon, Wed, Fri 09:00 AM - 02:00 PM'
    }
  },
  {
    email: 'pooja.pharma@medicore.ai',
    password: 'TestPassword123!',
    displayName: 'Pooja Verma',
    role: 'pharmacist',
    requestedRole: null,
    claims: { role: 'pharmacist' }
  },
  {
    email: 'dr.vikram.pending@medicore.ai',
    password: 'TestPassword123!',
    displayName: 'Dr. Vikram Malhotra',
    role: 'patient',
    requestedRole: 'doctor',
    claims: {}
  }
];

async function seed() {
  console.log('========================================================');
  console.log('MEDICORE-AI: Seeding Test Users for Admin Page Testing');
  console.log('Target Project:', key.project_id);
  console.log('========================================================\n');

  for (const userConfig of TEST_USERS) {
    let uid;
    try {
      // Check if user already exists
      const existing = await auth.getUserByEmail(userConfig.email).catch(() => null);
      if (existing) {
        console.log(`[EXISTS] ${userConfig.email} (${existing.uid}) â€” updating...`);
        uid = existing.uid;
        await auth.updateUser(uid, {
          displayName: userConfig.displayName,
          password: userConfig.password
        });
      } else {
        const created = await auth.createUser({
          email: userConfig.email,
          password: userConfig.password,
          displayName: userConfig.displayName
        });
        uid = created.uid;
        console.log(`[CREATED AUTH] ${userConfig.email} (${uid})`);
      }

      // Set Custom Claims (if any)
      await auth.setCustomUserClaims(uid, userConfig.claims);
      console.log(` -> Assigned Claims: ${JSON.stringify(userConfig.claims)}`);

      // Write/Update Firestore users/{uid} document
      const userDoc = {
        name: userConfig.displayName,
        email: userConfig.email,
        role: userConfig.role,
        createdAt: new Date().toISOString()
      };
      if (userConfig.requestedRole) {
        userDoc.requestedRole = userConfig.requestedRole;
      }
      await db.collection('users').doc(uid).set(userDoc, { merge: true });
      console.log(` -> Synced Firestore users/${uid} (role: ${userConfig.role}${userConfig.requestedRole ? ', requestedRole: ' + userConfig.requestedRole : ''})`);

      // Complementary documents according to role
      if (userConfig.role === 'patient') {
        await db.collection('patients').doc(uid).set({
          name: userConfig.displayName,
          email: userConfig.email,
          phone: '+91 98765 43210',
          userId: uid,
          createdAt: new Date().toISOString()
        }, { merge: true });

        await db.collection('pharmacyPatientLookup').doc(uid).set({
          displayName: userConfig.displayName,
          patientReference: uid,
          createdAt: new Date().toISOString()
        }, { merge: true });
        console.log(` -> Synced patients/${uid} & pharmacyPatientLookup/${uid}`);
      }

      if (userConfig.role === 'doctor') {
        await db.collection('publicDoctorProfiles').doc(uid).set({
          name: userConfig.displayName,
          specialization: userConfig.doctorProfile?.specialization || 'General Physician',
          profileImage: '',
          availability: userConfig.doctorProfile?.availability || 'Mon - Fri 10:00 AM - 04:00 PM',
          createdAt: new Date().toISOString()
        }, { merge: true });
        console.log(` -> Synced publicDoctorProfiles/${uid}`);
      }

      console.log('');
    } catch (err) {
      console.error(`[ERROR] Failed to seed ${userConfig.email}:`, err.message);
    }
  }

  console.log('========================================================');
  console.log('SEED COMPLETE! Ready for Administrator Portal Testing');
  console.log('========================================================');
}

seed().catch(err => {
  console.error('Seed fatal error:', err);
  process.exit(1);
});

