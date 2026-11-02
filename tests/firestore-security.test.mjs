import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where } from 'firebase/firestore';

const PROJECT_ID = 'medicore-security-test';
const rules = readFileSync('firestore.rules', 'utf8');

async function runSecurityTestSuite() {
  console.log('====================================================');
  console.log('MEDICORE-AI: Comprehensive Firestore Security Suite');
  console.log('====================================================\n');

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: rules,
      host: '127.0.0.1',
      port: 8080,
    },
  });

  const results = [];

  async function test(category, description, fn) {
    try {
      await fn();
      console.log(`[PASS] ${category} - ${description}`);
      results.push({ category, description, status: 'PASS' });
    } catch (err) {
      console.error(`[FAIL] ${category} - ${description}:`, err.message);
      results.push({ category, description, status: 'FAIL', error: err.message });
    }
  }

  // Pre-seed test data using withSecurityRulesDisabled
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    
    // Patient 1 (Alice)
    await setDoc(doc(db, 'users', 'patient_alice'), {
      name: 'Alice Patient',
      email: 'alice@example.com',
      role: 'patient',
      doctorId: 'doctor_bob',
      createdAt: '2026-03-20T00:00:00Z'
    });
    await setDoc(doc(db, 'patients', 'patient_alice'), {
      name: 'Alice Patient',
      email: 'alice@example.com',
      userId: 'patient_alice',
      doctorId: 'doctor_bob',
      createdAt: '2026-03-20T00:00:00Z'
    });
    await setDoc(doc(db, 'patients', 'patient_alice', 'medicalRecords', 'record_001'), {
      diagnosis: 'Mild Flu',
      medicines: 'Paracetamol',
      notes: 'Bed rest for 2 days',
      doctorId: 'doctor_bob',
      createdAt: '2026-03-20T00:00:00Z'
    });
    await setDoc(doc(db, 'patients', 'patient_alice', 'bills', 'bill_alice_1'), {
      patientId: 'patient_alice',
      pharmacistId: 'pharmacist_dan',
      totalAmount: 150,
      createdAt: '2026-03-20T00:00:00Z'
    });

    // Patient 2 (Eve)
    await setDoc(doc(db, 'users', 'patient_eve'), {
      name: 'Eve Patient',
      email: 'eve@example.com',
      role: 'patient',
      createdAt: '2026-03-20T00:00:00Z'
    });
    await setDoc(doc(db, 'patients', 'patient_eve'), {
      name: 'Eve Patient',
      email: 'eve@example.com',
      userId: 'patient_eve',
      createdAt: '2026-03-20T00:00:00Z'
    });

    // Doctor Bob (assigned to Alice)
    await setDoc(doc(db, 'users', 'doctor_bob'), {
      name: 'Dr. Bob',
      email: 'bob@hospital.com',
      role: 'doctor',
      createdAt: '2026-03-20T00:00:00Z'
    });

    // Doctor Carol (unassigned to Alice)
    await setDoc(doc(db, 'users', 'doctor_carol'), {
      name: 'Dr. Carol',
      email: 'carol@hospital.com',
      role: 'doctor',
      createdAt: '2026-03-20T00:00:00Z'
    });

    // Pharmacist Dan
    await setDoc(doc(db, 'users', 'pharmacist_dan'), {
      name: 'Dan Pharmacist',
      email: 'dan@pharmacy.com',
      role: 'pharmacist',
      createdAt: '2026-03-20T00:00:00Z'
    });
    await setDoc(doc(db, 'inventory', 'pharmacist_dan', 'medicines', 'med_001'), {
      name: 'Paracetamol 500mg',
      batch: 'BATCH123',
      expiry: '2027-12',
      stock: 100,
      createdBy: 'pharmacist_dan'
    });

    // Admin Super
    await setDoc(doc(db, 'users', 'admin_super'), {
      name: 'Super Admin',
      email: 'admin@medicore.ai',
      role: 'admin',
      createdAt: '2026-03-20T00:00:00Z'
    });

    // Minimal Lookup Projections
    await setDoc(doc(db, 'publicDoctorProfiles', 'doctor_bob'), {
      name: 'Dr. Bob',
      specialization: 'General Medicine',
      profileImage: 'https://example.com/bob.jpg',
      availability: 'Mon-Fri 09:00-17:00',
      doctorId: 'doctor_bob'
    });

    await setDoc(doc(db, 'pharmacyPatientLookup', 'patient_alice'), {
      displayName: 'Alice Patient',
      patientReference: 'patient_alice',
      createdAt: '2026-03-20T00:00:00Z'
    });

    // Impostors: Have privileged role in Firestore doc, but NO Custom Claim token!
    await setDoc(doc(db, 'users', 'impostor_admin'), {
      name: 'Impostor Admin',
      email: 'impostor_admin@fake.com',
      role: 'admin',
      createdAt: '2026-03-20T00:00:00Z'
    });
    await setDoc(doc(db, 'users', 'impostor_doctor'), {
      name: 'Impostor Doctor',
      email: 'impostor_doctor@fake.com',
      role: 'doctor',
      createdAt: '2026-03-20T00:00:00Z'
    });
    await setDoc(doc(db, 'users', 'impostor_pharmacist'), {
      name: 'Impostor Pharmacist',
      email: 'impostor_pharmacist@fake.com',
      role: 'pharmacist',
      createdAt: '2026-03-20T00:00:00Z'
    });

    // Appointment between Alice and Doctor Bob
    await setDoc(doc(db, 'appointments', 'appt_alice_bob'), {
      patientId: 'patient_alice',
      patientName: 'Alice Patient',
      doctorId: 'doctor_bob',
      doctorName: 'Dr. Bob',
      date: '2026-04-10',
      time: '10:00',
      status: 'pending',
      notes: 'Routine checkup',
      recordAdded: false
    });

    // Central Bill
    await setDoc(doc(db, 'bills', 'bill_alice_1'), {
      patientId: 'patient_alice',
      pharmacistId: 'pharmacist_dan',
      totalAmount: 150,
      createdAt: '2026-03-20T00:00:00Z'
    });

    // Patient Bill issued by another Pharmacist (Oscar)
    await setDoc(doc(db, 'patients', 'patient_alice', 'bills', 'bill_oscar_1'), {
      patientId: 'patient_alice',
      pharmacistId: 'pharmacist_oscar',
      totalAmount: 250,
      createdAt: '2026-03-20T00:00:00Z'
    });
  });

  // Client contexts
  const unauthDb = testEnv.unauthenticatedContext().firestore();
  const aliceDb = testEnv.authenticatedContext('patient_alice', { role: 'patient' }).firestore();
  const eveDb = testEnv.authenticatedContext('patient_eve', { role: 'patient' }).firestore();
  const bobDb = testEnv.authenticatedContext('doctor_bob', { role: 'doctor' }).firestore();
  const carolDb = testEnv.authenticatedContext('doctor_carol', { role: 'doctor' }).firestore();
  const danDb = testEnv.authenticatedContext('pharmacist_dan', { role: 'pharmacist' }).firestore();
  const adminDb = testEnv.authenticatedContext('admin_super', { role: 'admin' }).firestore();

  // Impostor contexts (token has no privileged claims)
  const impostorAdminDb = testEnv.authenticatedContext('impostor_admin', {}).firestore();
  const impostorDoctorDb = testEnv.authenticatedContext('impostor_doctor', {}).firestore();
  const impostorPharmacistDb = testEnv.authenticatedContext('impostor_pharmacist', {}).firestore();

  // ---------------------------------------------------------------------------
  // Category A: Authentication & Basic Access
  // ---------------------------------------------------------------------------
  await test('A. Authentication', 'Unauthenticated user CANNOT read protected patient records', async () => {
    await assertFails(getDoc(doc(unauthDb, 'patients', 'patient_alice')));
    await assertFails(getDoc(doc(unauthDb, 'patients', 'patient_alice', 'medicalRecords', 'record_001')));
  });

  await test('A. Authentication', 'Authenticated patient CAN access their own permitted data', async () => {
    await assertSucceeds(getDoc(doc(aliceDb, 'patients', 'patient_alice')));
    await assertSucceeds(getDoc(doc(aliceDb, 'patients', 'patient_alice', 'medicalRecords', 'record_001')));
  });

  // ---------------------------------------------------------------------------
  // Category B: Role Escalation Prevention
  // ---------------------------------------------------------------------------
  await test('B. Role Escalation', 'Patient CANNOT change their role to doctor', async () => {
    await assertFails(updateDoc(doc(aliceDb, 'users', 'patient_alice'), { role: 'doctor' }));
  });

  await test('B. Role Escalation', 'Patient CANNOT change their role to pharmacist', async () => {
    await assertFails(updateDoc(doc(aliceDb, 'users', 'patient_alice'), { role: 'pharmacist' }));
  });

  await test('B. Role Escalation', 'Patient CANNOT change their role to admin', async () => {
    await assertFails(updateDoc(doc(aliceDb, 'users', 'patient_alice'), { role: 'admin' }));
  });

  await test('B. Role Escalation', 'New user CANNOT self-assign doctor role on creation', async () => {
    const malloryDb = testEnv.authenticatedContext('user_mallory').firestore();
    await assertFails(setDoc(doc(malloryDb, 'users', 'user_mallory'), {
      name: 'Mallory Impostor',
      email: 'mallory@fake.com',
      role: 'doctor'
    }));
  });

  // ---------------------------------------------------------------------------
  // Category C: Patient Profile & Directory Security (Loopholes Remediated)
  // ---------------------------------------------------------------------------
  await test('C. Patient Profiles', 'Pharmacist CANNOT read an individual patient profile', async () => {
    await assertFails(getDoc(doc(danDb, 'patients', 'patient_alice')));
  });

  await test('C. Patient Profiles', 'Pharmacist CANNOT query the complete patient collection', async () => {
    await assertFails(getDocs(collection(danDb, 'patients')));
  });

  await test('C. Patient Profiles', 'Unrelated patient CANNOT read another patient profile', async () => {
    await assertFails(getDoc(doc(eveDb, 'patients', 'patient_alice')));
  });

  await test('C. Patient Profiles', 'Unrelated patient CANNOT query the complete patient collection', async () => {
    await assertFails(getDocs(collection(eveDb, 'patients')));
  });

  await test('C. Patient Profiles', 'Assigned doctor CAN read their patient profile', async () => {
    await assertSucceeds(getDoc(doc(bobDb, 'patients', 'patient_alice')));
  });

  await test('C. Patient Profiles', 'Administrator CAN read any patient profile', async () => {
    await assertSucceeds(getDoc(doc(adminDb, 'patients', 'patient_alice')));
  });

  // ---------------------------------------------------------------------------
  // Category D: Medical Records Security
  // ---------------------------------------------------------------------------
  await test('D. Medical Records', 'Patient CANNOT edit or delete existing medical records', async () => {
    await assertFails(updateDoc(doc(aliceDb, 'patients', 'patient_alice', 'medicalRecords', 'record_001'), {
      diagnosis: 'Altered diagnosis'
    }));
    await assertFails(deleteDoc(doc(aliceDb, 'patients', 'patient_alice', 'medicalRecords', 'record_001')));
  });

  await test('D. Medical Records', 'Assigned doctor CAN perform permitted clinical operations (append record)', async () => {
    await assertSucceeds(addDoc(collection(bobDb, 'patients', 'patient_alice', 'medicalRecords'), {
      diagnosis: 'Follow-up Checkup',
      medicines: 'Vitamins',
      notes: 'Patient recovering well',
      doctorId: 'doctor_bob',
      createdAt: '2026-03-22T00:00:00Z'
    }));
  });

  await test('D. Medical Records', 'Unassigned doctor CANNOT access or modify those records', async () => {
    await assertFails(getDoc(doc(carolDb, 'patients', 'patient_alice', 'medicalRecords', 'record_001')));
    await assertFails(addDoc(collection(carolDb, 'patients', 'patient_alice', 'medicalRecords'), {
      diagnosis: 'Unauthorized record',
      medicines: 'None',
      notes: 'Intrusion test',
      doctorId: 'doctor_carol',
      createdAt: '2026-03-22T00:00:00Z'
    }));
  });

  // ---------------------------------------------------------------------------
  // Category E: Appointment Security (Strict Explicit Authorization)
  // ---------------------------------------------------------------------------
  await test('E. Appointments', 'Patient CAN read their own appointment', async () => {
    await assertSucceeds(getDoc(doc(aliceDb, 'appointments', 'appt_alice_bob')));
  });

  await test('E. Appointments', 'Patient CAN query their own appointments collection', async () => {
    const q = query(collection(aliceDb, 'appointments'), where('patientId', '==', 'patient_alice'));
    await assertSucceeds(getDocs(q));
  });

  await test('E. Appointments', 'Patient CANNOT read another patient appointment', async () => {
    await assertFails(getDoc(doc(eveDb, 'appointments', 'appt_alice_bob')));
  });

  await test('E. Appointments', 'Unrelated patient CANNOT query all appointments', async () => {
    await assertFails(getDocs(collection(eveDb, 'appointments')));
  });

  await test('E. Appointments', 'Pharmacist CANNOT read appointments', async () => {
    await assertFails(getDoc(doc(danDb, 'appointments', 'appt_alice_bob')));
    await assertFails(getDocs(collection(danDb, 'appointments')));
  });

  await test('E. Appointments', 'Assigned doctor CAN read their appointment', async () => {
    await assertSucceeds(getDoc(doc(bobDb, 'appointments', 'appt_alice_bob')));
  });

  await test('E. Appointments', 'Assigned doctor CAN query appointments assigned to them', async () => {
    const q = query(collection(bobDb, 'appointments'), where('doctorId', '==', 'doctor_bob'));
    await assertSucceeds(getDocs(q));
  });

  await test('E. Appointments', 'Unassigned doctor CANNOT read another doctor appointment', async () => {
    await assertFails(getDoc(doc(carolDb, 'appointments', 'appt_alice_bob')));
  });

  await test('E. Appointments', 'Patient CANNOT change appointment ownership or doctor assignment', async () => {
    await assertFails(updateDoc(doc(aliceDb, 'appointments', 'appt_alice_bob'), {
      doctorId: 'doctor_carol'
    }));
    await assertFails(updateDoc(doc(aliceDb, 'appointments', 'appt_alice_bob'), {
      patientId: 'patient_eve'
    }));
  });

  await test('E. Appointments', 'Unrelated user CANNOT modify another user appointment', async () => {
    await assertFails(updateDoc(doc(eveDb, 'appointments', 'appt_alice_bob'), {
      status: 'cancelled'
    }));
  });

  await test('E. Appointments', 'Authorized doctor CAN update permitted appointment fields (status, recordAdded)', async () => {
    await assertSucceeds(updateDoc(doc(bobDb, 'appointments', 'appt_alice_bob'), {
      status: 'scheduled'
    }));
    await assertSucceeds(updateDoc(doc(bobDb, 'appointments', 'appt_alice_bob'), {
      status: 'completed',
      recordAdded: true
    }));
  });

  // ---------------------------------------------------------------------------
  // Category F: Custom Claims Security (No Profile Role Fallback)
  // ---------------------------------------------------------------------------
  await test('F. Custom Claims', 'User with users/{uid}.role = admin but NO admin claim CANNOT perform admin actions', async () => {
    await assertFails(deleteDoc(doc(impostorAdminDb, 'users', 'patient_alice')));
  });

  await test('F. Custom Claims', 'User with users/{uid}.role = doctor but NO doctor claim CANNOT perform doctor actions', async () => {
    await assertFails(addDoc(collection(impostorDoctorDb, 'patients', 'patient_alice', 'medicalRecords'), {
      diagnosis: 'Hacked diagnosis',
      medicines: 'Hacked medicine',
      notes: 'No claim test',
      doctorId: 'impostor_doctor',
      createdAt: '2026-03-22T00:00:00Z'
    }));
  });

  await test('F. Custom Claims', 'User with users/{uid}.role = pharmacist but NO pharmacist claim CANNOT create invoices', async () => {
    await assertFails(addDoc(collection(impostorPharmacistDb, 'bills'), {
      patientId: 'patient_alice',
      pharmacistId: 'impostor_pharmacist',
      totalAmount: 999,
      createdAt: '2026-03-22T00:00:00Z'
    }));
  });

  await test('F. Custom Claims', 'Properly provisioned Custom Claims permit intended privileged actions', async () => {
    await assertSucceeds(deleteDoc(doc(adminDb, 'users', 'impostor_admin')));
    await assertSucceeds(addDoc(collection(danDb, 'bills'), {
      patientId: 'patient_alice',
      pharmacistId: 'pharmacist_dan',
      totalAmount: 100,
      createdAt: '2026-03-22T00:00:00Z'
    }));
  });

  // ---------------------------------------------------------------------------
  // Category G: Billing Security
  // ---------------------------------------------------------------------------
  await test('G. Billing', 'Patient CANNOT read another patient bills', async () => {
    await assertFails(getDoc(doc(eveDb, 'bills', 'bill_alice_1')));
    await assertFails(getDoc(doc(eveDb, 'patients', 'patient_alice', 'bills', 'bill_alice_1')));
  });

  await test('G. Billing', 'Unauthorized user CANNOT create or modify invoices', async () => {
    await assertFails(addDoc(collection(aliceDb, 'bills'), {
      patientId: 'patient_alice',
      totalAmount: 50
    }));
    await assertFails(updateDoc(doc(aliceDb, 'bills', 'bill_alice_1'), {
      totalAmount: 0
    }));
  });

  // ---------------------------------------------------------------------------
  // Category H: Inventory Security
  // ---------------------------------------------------------------------------
  await test('H. Inventory', 'Pharmacist CAN manage their own inventory', async () => {
    await assertSucceeds(getDoc(doc(danDb, 'inventory', 'pharmacist_dan', 'medicines', 'med_001')));
    await assertSucceeds(updateDoc(doc(danDb, 'inventory', 'pharmacist_dan', 'medicines', 'med_001'), {
      stock: 95
    }));
  });

  await test('H. Inventory', 'Other users CANNOT read or modify pharmacy inventory', async () => {
    await assertFails(getDoc(doc(aliceDb, 'inventory', 'pharmacist_dan', 'medicines', 'med_001')));
    await assertFails(updateDoc(doc(aliceDb, 'inventory', 'pharmacist_dan', 'medicines', 'med_001'), {
      stock: 0
    }));
    await assertFails(updateDoc(doc(bobDb, 'inventory', 'pharmacist_dan', 'medicines', 'med_001'), {
      stock: 50
    }));
  });

  // ---------------------------------------------------------------------------
  // Category I: Privacy & Minimal Lookup Directories (Section 4 Verification)
  // ---------------------------------------------------------------------------
  await test('I. Privacy & Lookups', 'Unauthenticated users cannot access doctor lookup profiles', async () => {
    await assertFails(getDoc(doc(unauthDb, 'publicDoctorProfiles', 'doctor_bob')));
    await assertFails(getDocs(collection(unauthDb, 'publicDoctorProfiles')));
  });

  await test('I. Privacy & Lookups', 'Authenticated users can access permitted doctor lookup profiles', async () => {
    await assertSucceeds(getDoc(doc(aliceDb, 'publicDoctorProfiles', 'doctor_bob')));
    await assertSucceeds(getDocs(collection(aliceDb, 'publicDoctorProfiles')));
  });

  await test('I. Privacy & Lookups', 'Patients cannot access pharmacy-only lookup records', async () => {
    await assertFails(getDoc(doc(aliceDb, 'pharmacyPatientLookup', 'patient_alice')));
    await assertFails(getDocs(collection(aliceDb, 'pharmacyPatientLookup')));
  });

  await test('I. Privacy & Lookups', 'Pharmacists can access permitted lookup records', async () => {
    await assertSucceeds(getDoc(doc(danDb, 'pharmacyPatientLookup', 'patient_alice')));
    await assertSucceeds(getDocs(collection(danDb, 'pharmacyPatientLookup')));
  });

  await test('I. Privacy & Lookups', 'Pharmacists cannot access private user documents', async () => {
    await assertFails(getDoc(doc(danDb, 'users', 'patient_alice')));
    await assertFails(getDocs(query(collection(danDb, 'users'), where('role', '==', 'patient'))));
  });

  await test('I. Privacy & Lookups', 'A patient cannot create or modify another patient lookup document', async () => {
    // Eve cannot create a lookup record with Alice's ID or reference
    await assertFails(setDoc(doc(eveDb, 'pharmacyPatientLookup', 'patient_alice'), {
      displayName: 'Impersonated Alice',
      patientReference: 'patient_alice'
    }));
    // Eve cannot update Alice's lookup document
    await assertFails(updateDoc(doc(eveDb, 'pharmacyPatientLookup', 'patient_alice'), {
      displayName: 'Tampered Alice'
    }));
    // Eve CAN create their own minimal lookup record matching their auth.uid
    await assertSucceeds(setDoc(doc(eveDb, 'pharmacyPatientLookup', 'patient_eve'), {
      displayName: 'Eve Patient',
      patientReference: 'patient_eve',
      createdAt: '2026-03-22T00:00:00Z'
    }));
  });

  await test('I. Privacy & Lookups', 'User documents remain inaccessible to unrelated users', async () => {
    await assertFails(getDoc(doc(aliceDb, 'users', 'patient_eve')));
    await assertFails(getDoc(doc(eveDb, 'users', 'patient_alice')));
    await assertFails(getDocs(collection(aliceDb, 'users')));
  });

  await test('I. Privacy & Lookups', 'Doctor cannot add unauthorized fields to publicDoctorProfiles', async () => {
    // Attempt adding phone/privateNotes
    await assertFails(updateDoc(doc(bobDb, 'publicDoctorProfiles', 'doctor_bob'), {
      phone: '1234567890'
    }));
    await assertFails(setDoc(doc(bobDb, 'publicDoctorProfiles', 'doctor_bob'), {
      name: 'Dr. Bob',
      specialization: 'Cardiology',
      profileImage: '',
      availability: '9-5',
      doctorId: 'doctor_bob',
      privateNotes: 'Confidential doctor notes'
    }));
  });

  await test('I. Privacy & Lookups', 'Patient cannot add medicalHistory or arbitrary fields to pharmacyPatientLookup', async () => {
    await assertFails(updateDoc(doc(aliceDb, 'pharmacyPatientLookup', 'patient_alice'), {
      medicalHistory: 'Hypertension'
    }));
    await assertFails(setDoc(doc(aliceDb, 'pharmacyPatientLookup', 'patient_alice'), {
      displayName: 'Alice Patient',
      patientReference: 'patient_alice',
      medicalHistory: 'Confidential diagnosis'
    }));
  });

  await test('I. Privacy & Lookups', 'Patient cannot change patientReference to another UID', async () => {
    await assertFails(updateDoc(doc(aliceDb, 'pharmacyPatientLookup', 'patient_alice'), {
      patientReference: 'patient_eve'
    }));
  });

  await test('I. Privacy & Lookups', 'Pharmacist cannot access another pharmacist restricted billing records', async () => {
    // Dan cannot read Oscar's bill
    await assertFails(getDoc(doc(danDb, 'patients', 'patient_alice', 'bills', 'bill_oscar_1')));
    // Dan CAN read their own bill
    await assertSucceeds(getDoc(doc(danDb, 'patients', 'patient_alice', 'bills', 'bill_alice_1')));
  });

  await testEnv.cleanup();

  console.log('\n====================================================');
  console.log(`SUMMARY: ${results.filter(r => r.status === 'PASS').length}/${results.length} Tests Passed`);
  console.log('====================================================');

  const failed = results.filter(r => r.status === 'FAIL');
  if (failed.length > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSecurityTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
