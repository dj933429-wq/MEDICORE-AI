import { useState, useEffect, createContext, useContext } from 'react';
import { auth, db } from './firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut as firebaseSignOut
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';

/** @type {import('react').Context<{user: any, loading: boolean}>} */
const AuthContext = createContext({ user: null, loading: true });

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // We bind directly to the actual firebase API using observable hooks instead of strict mock timers.
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const docRef = doc(db, 'users', firebaseUser.uid);
          const docSnap = await getDoc(docRef);

          let userData;

          if (docSnap.exists()) {
            userData = docSnap.data();
            setUser({ 
              ...firebaseUser, 
              ...userData,
              role: userData.role || 'patient'
            });
          } else {
            console.warn("User document not found in Firestore. Creating default profile...");
            userData = {
              name: firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Unknown'),
              email: firebaseUser.email || '',
              role: 'patient',
              createdAt: new Date().toISOString()
            };
            
            try {
              await setDoc(docRef, userData);
            } catch (err) {
              console.error("Failed to automatically create missing user profile:", err);
            }
            
            setUser({ ...firebaseUser, ...userData });
          }

          // **CRITICAL AUTO-CREATE PATIENT PROFILE LOGIC**
          try {
            const patientRef = doc(db, 'patients', firebaseUser.uid);
            const patientSnap = await getDoc(patientRef);
            
            if (!patientSnap.exists()) {
              await setDoc(patientRef, {
                name: userData.name || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Unknown',
                email: firebaseUser.email || '',
                phone: "",
                userId: firebaseUser.uid,
                createdAt: new Date().toISOString()
              });
            }
          } catch (patientErr) {
            console.error("Failed to implicitly sync patient profile:", patientErr);
          }

        } catch (error) {
          console.error("Error fetching user profile details:", error);
          setUser({ ...firebaseUser, role: 'patient' }); 
        } finally {
          setLoading(false);
        }
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);

export const signup = async (email, password, name, role) => {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  // Mutate strictly into the Firestore document using explicit UID references.
  await setDoc(doc(db, 'users', user.uid), {
    name,
    email,
    role: role || 'patient',
    createdAt: new Date().toISOString()
  });

  // Automatically create a corresponding document in the "patients" collection.
  try {
    await setDoc(doc(db, 'patients', user.uid), {
      name,
      email,
      phone: "",
      userId: user.uid,
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    console.error("Failed to auto-create patient profile during signup:", err);
  }

  return user;
};

export const login = async (email, password) => {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
};

export const logout = async () => {
  await firebaseSignOut(auth);
};
