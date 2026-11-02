import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { TEST_USERS } from './seed-test-users.mjs';

if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  console.error('ERROR: FIREBASE_SERVICE_ACCOUNT_KEY environment variable is missing.');
  process.exit(1);
}

const key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
const app = initializeApp({ credential: cert(key), projectId: key.project_id }, 'clean-runner');
const auth = getAuth(app);
const db = getFirestore(app);

async function clean() {
  console.log('========================================================');
  console.log('MEDICORE-AI: Cleaning Seeded Test Users');
  console.log('Target Project:', key.project_id);
  console.log('========================================================\n');

  for (const userConfig of TEST_USERS) {
    try {
      const user = await auth.getUserByEmail(userConfig.email).catch(() => null);
      if (user) {
        const uid = user.uid;
        await auth.deleteUser(uid);
        await db.collection('users').doc(uid).delete();
        await db.collection('patients').doc(uid).delete();
        await db.collection('pharmacyPatientLookup').doc(uid).delete();
        await db.collection('publicDoctorProfiles').doc(uid).delete();
        console.log(`[DELETED] ${userConfig.email} (${uid}) and associated documents.`);
      } else {
        console.log(`[SKIPPED] ${userConfig.email} not found.`);
      }
    } catch (err) {
      console.error(`[ERROR] Failed to clean ${userConfig.email}:`, err.message);
    }
  }

  console.log('\nClean complete.');
}

clean().catch(err => {
  console.error('Clean fatal error:', err);
  process.exit(1);
});

