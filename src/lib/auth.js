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
    // Observable hook binding directly to Firebase Authentication
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setLoading(true);
        try {
          // Fetch the user's role from their /users/{uid} document
          const docRef = doc(db, 'users', firebaseUser.uid);
          const docSnap = await getDoc(docRef);

          let userData = {};
          let role = 'patient';

          // Also check custom claims if present
          let customRole = null;
          try {
            const tokenResult = await firebaseUser.getIdTokenResult();
            customRole = tokenResult.claims.role || null;
          } catch {
            // ignore
          }

          if (docSnap.exists()) {
            userData = docSnap.data();
            // Prioritize custom claims if set, otherwise use the role from /users/{uid}
            role = customRole || userData.role || 'patient';
            setUser({ 
              ...firebaseUser, 
              ...userData,
              role,
              customRole,
              profileRole: userData.role || role,
              getIdToken: (forceRefresh) => firebaseUser.getIdToken(forceRefresh),
              getIdTokenResult: (forceRefresh) => firebaseUser.getIdTokenResult(forceRefresh)
            });
          } else {
            console.warn("User document not found in Firestore. Creating default profile...");
            role = customRole || 'patient';
            userData = {
              name: firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Unknown'),
              email: firebaseUser.email || '',
              role,
              createdAt: new Date().toISOString()
            };
            
            try {
              await setDoc(docRef, userData);
            } catch (err) {
              console.error("Failed to automatically create missing user profile:", err);
            }
            
            setUser({ 
              ...firebaseUser, 
              ...userData, 
              role,
              customRole,
              profileRole: role,
              getIdToken: (forceRefresh) => firebaseUser.getIdToken(forceRefresh),
              getIdTokenResult: (forceRefresh) => firebaseUser.getIdTokenResult(forceRefresh)
            });
          }

          // **AUTO-CREATE PATIENT PROFILE & PHARMACY LOOKUP LOGIC (Strictly Patients only)**
          if (role === 'patient') {
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

              // Sync minimal pharmacy patient lookup record (displayName, patientReference)
              try {
                const lookupRef = doc(db, 'pharmacyPatientLookup', firebaseUser.uid);
                await setDoc(lookupRef, {
                  displayName: userData.name || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Unknown',
                  patientReference: firebaseUser.uid,
                  createdAt: new Date().toISOString()
                }, { merge: true });
              } catch {
                // Non-critical projection
              }
            } catch (patientErr) {
              console.error("Failed to sync patient profile or pharmacy lookup:", patientErr);
            }
          }

          // **SYNC PUBLIC DOCTOR LOOKUP (If Verified Doctor)**
          if (role === 'doctor') {
            try {
              const docLookupRef = doc(db, 'publicDoctorProfiles', firebaseUser.uid);
              const docLookupSnap = await getDoc(docLookupRef);
              if (!docLookupSnap.exists()) {
                await setDoc(docLookupRef, {
                  name: userData.name || firebaseUser.displayName || 'Doctor',
                  specialization: userData.specialization || 'General Physician',
                  profileImage: userData.profileImage || '',
                  availability: 'Available',
                  doctorId: firebaseUser.uid
                });
              }
            } catch (docErr) {
              console.error("Failed to sync public doctor profile:", docErr);
            }
          }

        } catch (error) {
          console.error("Error fetching user profile details:", error);
          setUser({ 
            ...firebaseUser, 
            role: 'patient',
            getIdToken: (forceRefresh) => firebaseUser.getIdToken(forceRefresh),
            getIdTokenResult: (forceRefresh) => firebaseUser.getIdTokenResult(forceRefresh)
          }); 
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

export const signup = async (email, password, name, role, gender) => {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  // Use the exact role chosen by the user
  const assignedRole = role || 'patient';

  const userDocPayload = {
    name,
    email,
    role: assignedRole,
    createdAt: new Date().toISOString()
  };

  if (gender && ['female', 'male', 'other'].includes(gender)) {
    userDocPayload.gender = gender;
  }

  // Mutate into Firestore document using explicit UID references
  await setDoc(doc(db, 'users', user.uid), userDocPayload);

  // Automatically create a corresponding document in the "patients" collection ONLY for patients
  if (assignedRole === 'patient') {
    try {
      const patientPayload = {
        name,
        email,
        phone: "",
        userId: user.uid,
        createdAt: new Date().toISOString()
      };
      if (gender && ['female', 'male', 'other'].includes(gender)) {
        patientPayload.gender = gender;
      }
      await setDoc(doc(db, 'patients', user.uid), patientPayload);
    } catch (err) {
      console.error("Failed to auto-create patient profile during signup:", err);
    }

    // Automatically create minimal pharmacy lookup projection
    try {
      await setDoc(doc(db, 'pharmacyPatientLookup', user.uid), {
        displayName: name,
        patientReference: user.uid,
        createdAt: new Date().toISOString()
      });
    } catch (err) {
      console.error("Failed to create pharmacy patient lookup during signup:", err);
    }
  }

  // If role is doctor, create public doctor profile
  if (assignedRole === 'doctor') {
    try {
      await setDoc(doc(db, 'publicDoctorProfiles', user.uid), {
        name: name || 'Doctor',
        specialization: 'General Physician',
        profileImage: '',
        availability: 'Available',
        doctorId: user.uid
      });
    } catch (docErr) {
      console.error("Failed to create public doctor profile during signup:", docErr);
    }
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

export const updateProfileGender = async (userId, gender) => {
  if (!userId || !['female', 'male', 'other'].includes(gender)) {
    throw new Error('Invalid gender update payload');
  }
  const userRef = doc(db, 'users', userId);
  await setDoc(userRef, { gender }, { merge: true });
  try {
    const patientRef = doc(db, 'patients', userId);
    await setDoc(patientRef, { gender }, { merge: true });
  } catch (err) {
    console.warn('Could not update patient gender in patients collection:', err);
  }
};
