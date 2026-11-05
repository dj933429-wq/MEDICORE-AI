import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";

const DEFAULT_RTDB_URL = "https://medicore-ai-exhibition-default-rtdb.asia-southeast1.firebasedatabase.app";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || DEFAULT_RTDB_URL,
};

let app;

// Safely initialize Firebase to prevent client-side hot-reload crashes
if (!getApps().length) {
  if (!firebaseConfig.apiKey) {
    console.error("Firebase Critical Error: api key is missing. Ensure .env.local is injected securely.");
  }
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

export { auth, db, rtdb };
