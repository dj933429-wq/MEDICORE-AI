import 'server-only';
import { initializeApp, getApps, cert, applicationDefault, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

const EXPECTED_PROJECT_ID = 'medicore-ai-exhibition';
const APP_NAME = 'medicore-admin';

function getAdminApp(): App {
  const existingApp = getApps().find(app => app.name === APP_NAME);
  if (existingApp) {
    return existingApp;
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || 
                    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 
                    EXPECTED_PROJECT_ID;

  if (projectId !== EXPECTED_PROJECT_ID) {
    console.warn(`[FirebaseAdmin] Warning: Expected project ID ${EXPECTED_PROJECT_ID}, but got ${projectId}`);
  }

  // 1. Check for Service Account JSON directly in environment variable
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (serviceAccountKey) {
    try {
      let parsedKey;
      if (serviceAccountKey.trim().startsWith('{')) {
        parsedKey = JSON.parse(serviceAccountKey);
      } else {
        // Handle base64 encoded service account json
        const decoded = Buffer.from(serviceAccountKey, 'base64').toString('utf-8');
        parsedKey = JSON.parse(decoded);
      }
      return initializeApp({
        credential: cert(parsedKey),
        projectId
      }, APP_NAME);
    } catch (parseErr) {
      console.error('[FirebaseAdmin] Failed to parse service account JSON from environment:', parseErr);
    }
  }

  // 2. Check for individual credentials (client email & private key)
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (clientEmail && privateKey) {
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey
      }),
      projectId
    }, APP_NAME);
  }

  // 3. Fallback to Application Default Credentials (e.g. GOOGLE_APPLICATION_CREDENTIALS or GCP environment)
  try {
    return initializeApp({
      credential: applicationDefault(),
      projectId
    }, APP_NAME);
  } catch {
    // 4. Default initialization for local emulators or basic project binding
    return initializeApp({
      projectId
    }, APP_NAME);
  }
}

export const adminApp = getAdminApp();
export const adminAuth: Auth = getAuth(adminApp);
export const adminDb: Firestore = getFirestore(adminApp);
