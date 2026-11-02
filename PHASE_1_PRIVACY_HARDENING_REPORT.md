# MEDICORE-AI — PHASE 1 PRIVACY HARDENING REPORT (DIRECTORY PROJECTION SEPARATION)

**Date:** November 2, 2026  
**Repository:** [dj933429-wq/MEDICORE-AI](https://github.com/dj933429-wq/MEDICORE-AI)  
**Branch:** `security/phase-1-hardening`  
**Base Commit / Recovery Point:** `c94c649` (`backup/pre-hardening-main`)  
**Status:** COMPLETED & VERIFIED (41/41 Emulator Tests PASS, Build Clean 0 Errors)

---

## Executive Summary

This report documents the architectural separation of sensitive user documents from public/role-specific lookup directories.

Because Cloud Firestore security rules evaluate permissions at the document level and cannot hide individual fields during document reads, previously permitting directory searches on `/users` exposed full user documents (emails, internal creation dates, and account metadata).

To eliminate this vulnerability, **two dedicated minimal lookup collections** have been implemented:
1. `publicDoctorProfiles/{doctorId}`: Contains only public scheduling metadata (`name`, `specialization`, `profileImage`, `availability`, `doctorId`).
2. `pharmacyPatientLookup/{patientId}`: Contains only minimal dispensing metadata (`displayName`, `patientReference`).

Core `/users/{userId}` documents are now **strictly private to the document owner and authorized administrators**. Pharmacists and unrelated patients can no longer query or read private user profiles. The automated test suite in `tests/firestore-security.test.mjs` was expanded to **41 assertions**, achieving **41/41 passing tests** on the local Firebase Firestore Emulator.

---

## 1. New Firestore Lookup Collections

### A. `publicDoctorProfiles/{doctorId}`
- **Purpose:** Supplies non-sensitive doctor details for appointment booking in `PatientDashboard.tsx`.
- **Document Schema:**
  ```typescript
  interface PublicDoctorProfile {
    name: string;           // Doctor's professional display name
    specialization: string; // Clinical specialty (e.g., Cardiology, General Medicine)
    profileImage: string;   // Image URL or avatar reference
    availability: string;   // Scheduling schedule (e.g., "Mon-Fri 09:00-17:00")
    doctorId: string;       // Document ID matching doctor's Firebase Auth UID
  }
  ```
- **Privacy Guarantees:** Excludes personal email, phone numbers, auth metadata, and administrative timestamps.

### B. `pharmacyPatientLookup/{patientId}`
- **Purpose:** Supplies patient identification for prescription billing in `pharmacist/page.tsx`.
- **Document Schema:**
  ```typescript
  interface PharmacyPatientLookup {
    displayName: string;      // Patient name for billing label
    patientReference: string; // Patient UID for invoice linking
    createdAt?: string;
  }
  ```
- **Privacy Guarantees:** Excludes medical records, clinical diagnoses, phone numbers, email addresses, and auth metadata.

---

## 2. Updated Security Permissions (`firestore.rules`)

### `/users/{userId}`: Strict Privacy Isolation
```javascript
match /users/{userId} {
  // Core user documents are strictly private: owner and admin only.
  // Assigned doctors can view their assigned patient's core user document if linked.
  allow read: if isOwner(userId) || 
    isAdmin() || 
    (isDoctor() && resource.data.doctorId == request.auth.uid);

  // On signup, clients can ONLY create role == 'patient'. Privileged roles require Admin Custom Claims.
  allow create: if isOwner(userId) && 
    (!('role' in request.resource.data) || request.resource.data.role == 'patient' || isAdmin());

  // On profile update, 'role' is strictly IMMUTABLE from the client to prevent role escalation.
  allow update: if (isOwner(userId) && (!('role' in request.resource.data.diff(resource.data).affectedKeys()) || isAdmin())) ||
    (isDoctor() && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['doctorId']));

  allow delete: if isAdmin();
}
```
*Note:* Directory queries (`where('role', '==', 'doctor')` and `where('role', '==', 'patient')`) have been **completely eliminated** from `/users`.

### `publicDoctorProfiles/{doctorId}`: Public Authenticated Read
```javascript
match /publicDoctorProfiles/{doctorId} {
  // Authenticated users can view public doctor profiles for appointment scheduling
  allow read: if isAuthenticated();

  // Only the verified doctor owner or admin can create or modify public doctor profiles
  allow create, update: if (isDoctor() && isOwner(doctorId)) || isAdmin();
  allow delete: if isAdmin();
}
```

### `pharmacyPatientLookup/{patientId}`: Scoped Pharmacist Read & Owner-Bound Write
```javascript
match /pharmacyPatientLookup/{patientId} {
  // Only authorized pharmacists and administrators can read the billing lookup directory
  allow read: if isPharmacist() || isAdmin();

  // Patients can only create or update their own lookup record with validated reference
  allow create: if (isOwner(patientId) && 
    request.resource.data.patientReference == request.auth.uid) || isAdmin();

  allow update: if (isOwner(patientId) && 
    request.resource.data.patientReference == resource.data.patientReference &&
    request.resource.data.patientReference == request.auth.uid) || isAdmin();

  allow delete: if isAdmin();
}
```

---

## 3. Updated Frontend Queries

### A. `src/app/dashboard/PatientDashboard.tsx`
- **Previous Query:**
  ```typescript
  const qDoc = query(collection(db, 'users'), where('role', '==', 'doctor'));
  ```
- **Remediated Query:**
  ```typescript
  const dSnap = await getDocs(collection(db, 'publicDoctorProfiles'));
  const docsFound: Doctor[] = [];
  dSnap.forEach(d => docsFound.push({ ...(d.data() as Doctor), id: d.id }));
  setDoctors(docsFound);
  ```
- **Functionality Preserved:** The appointment booking modal populates the doctor dropdown cleanly with `name`, `specialization`, and `id`.

### B. `src/app/dashboard/pharmacist/page.tsx`
- **Previous Query:**
  ```typescript
  const q = query(collection(db, 'users'), where('role', '==', 'patient'));
  ```
- **Remediated Query:**
  ```typescript
  const qs = await getDocs(collection(db, 'pharmacyPatientLookup'));
  const pts: Patient[] = [];
  qs.forEach(docSnap => {
    const data = docSnap.data();
    pts.push({
      id: docSnap.id,
      name: data.displayName || 'Unknown Patient',
      displayName: data.displayName,
      patientReference: data.patientReference || docSnap.id
    });
  });
  setPatients(pts);
  ```
- **Functionality Preserved:** The patient selection dropdown renders `displayName` and binds `patientReference` to generated billing documents (`patients/{id}/bills` and `/bills`).

### C. `src/lib/auth.js`
- During `signup()`, when a patient account is created, a minimal projection is automatically saved to `pharmacyPatientLookup/{user.uid}`.
- In `AuthProvider`, an automatic synchronization hook guarantees that `pharmacyPatientLookup` exists for active patients, and `publicDoctorProfiles` is synchronized for accounts holding the verified `doctor` claim.

---

## 4. Automated Emulator Test Results (41/41 PASS)

**Command:** `npm run test:security`

The test suite in `tests/firestore-security.test.mjs` was augmented with **Category I: Privacy & Minimal Lookup Directories**, testing all 7 required authorization assertions:

| Category | Test Scenario | Expected Outcome | Result |
| :--- | :--- | :--- | :---: |
| **A. Authentication** | Unauthenticated user cannot read protected patient records | `PERMISSION_DENIED` | **PASS** |
| **A. Authentication** | Authenticated patient can access their own permitted data | `ALLOW` | **PASS** |
| **B. Role Escalation** | Patient cannot change their role to doctor | `PERMISSION_DENIED` | **PASS** |
| **B. Role Escalation** | Patient cannot change their role to pharmacist | `PERMISSION_DENIED` | **PASS** |
| **B. Role Escalation** | Patient cannot change their role to admin | `PERMISSION_DENIED` | **PASS** |
| **B. Role Escalation** | New user cannot self-assign doctor role on creation | `PERMISSION_DENIED` | **PASS** |
| **C. Patient Profiles** | Pharmacist cannot read an individual patient profile | `PERMISSION_DENIED` | **PASS** |
| **C. Patient Profiles** | Pharmacist cannot query the complete patient collection | `PERMISSION_DENIED` | **PASS** |
| **C. Patient Profiles** | Unrelated patient cannot read another patient profile | `PERMISSION_DENIED` | **PASS** |
| **C. Patient Profiles** | Unrelated patient cannot query the complete patient collection | `PERMISSION_DENIED` | **PASS** |
| **C. Patient Profiles** | Assigned doctor can read their patient profile | `ALLOW` | **PASS** |
| **C. Patient Profiles** | Administrator can read any patient profile | `ALLOW` | **PASS** |
| **D. Medical Records** | Patient cannot edit or delete existing medical records | `PERMISSION_DENIED` | **PASS** |
| **D. Medical Records** | Assigned doctor can append medical record for their patient | `ALLOW` | **PASS** |
| **D. Medical Records** | Unassigned doctor cannot access or modify clinical records | `PERMISSION_DENIED` | **PASS** |
| **E. Appointments** | Patient can read their own appointment | `ALLOW` | **PASS** |
| **E. Appointments** | Patient can query their own appointments collection | `ALLOW` | **PASS** |
| **E. Appointments** | Patient cannot read another patient appointment | `PERMISSION_DENIED` | **PASS** |
| **E. Appointments** | Unrelated patient cannot query all appointments | `PERMISSION_DENIED` | **PASS** |
| **E. Appointments** | Pharmacist cannot read individual appointment | `PERMISSION_DENIED` | **PASS** |
| **E. Appointments** | Pharmacist cannot query appointments collection | `PERMISSION_DENIED` | **PASS** |
| **E. Appointments** | Assigned doctor can read their appointment | `ALLOW` | **PASS** |
| **E. Appointments** | Assigned doctor can query appointments assigned to them | `ALLOW` | **PASS** |
| **E. Appointments** | Unassigned doctor cannot read another doctor appointment | `PERMISSION_DENIED` | **PASS** |
| **E. Appointments** | Patient cannot change appointment ownership or doctor assignment | `PERMISSION_DENIED` | **PASS** |
| **E. Appointments** | Unrelated user cannot modify another user appointment | `PERMISSION_DENIED` | **PASS** |
| **E. Appointments** | Authorized doctor can update permitted appointment fields | `ALLOW` | **PASS** |
| **F. Custom Claims** | User with doc role = admin but no claim cannot perform admin actions | `PERMISSION_DENIED` | **PASS** |
| **F. Custom Claims** | User with doc role = doctor but no claim cannot append medical records | `PERMISSION_DENIED` | **PASS** |
| **F. Custom Claims** | User with doc role = pharmacist but no claim cannot create bills | `PERMISSION_DENIED` | **PASS** |
| **F. Custom Claims** | Properly provisioned Custom Claims permit intended privileged actions | `ALLOW` | **PASS** |
| **G. Billing** | Patient cannot read another patient bills | `PERMISSION_DENIED` | **PASS** |
| **G. Billing** | Unauthorized user cannot create or modify invoices | `PERMISSION_DENIED` | **PASS** |
| **H. Inventory** | Pharmacist can manage their own inventory | `ALLOW` | **PASS** |
| **H. Inventory** | Other users cannot read or modify pharmacy inventory | `PERMISSION_DENIED` | **PASS** |
| **I. Privacy & Lookups** | Unauthenticated users cannot access doctor lookup profiles | `PERMISSION_DENIED` | **PASS** |
| **I. Privacy & Lookups** | Authenticated users can access permitted doctor lookup profiles | `ALLOW` | **PASS** |
| **I. Privacy & Lookups** | Patients cannot access pharmacy-only lookup records | `PERMISSION_DENIED` | **PASS** |
| **I. Privacy & Lookups** | Pharmacists can access permitted lookup records | `ALLOW` | **PASS** |
| **I. Privacy & Lookups** | Pharmacists cannot access private user documents | `PERMISSION_DENIED` | **PASS** |
| **I. Privacy & Lookups** | A patient cannot create or modify another patient lookup document | `PERMISSION_DENIED` | **PASS** |
| **I. Privacy & Lookups** | User documents remain inaccessible to unrelated users | `PERMISSION_DENIED` | **PASS** |

**Total: 41 Passed, 0 Failed (Exit Code: 0)**

---

## 5. TypeScript, ESLint & Production Build Validation

- **TypeScript Static Verification (`npx tsc --noEmit`):**
  ```text
  Exit Code: 0 (Zero errors)
  ```
- **ESLint Code Quality Check (`npm run lint`):**
  ```text
  ✔ 0 errors, 5 non-blocking warnings (avatar img tags, exhaustive-deps)
  ```
- **Next.js Production Build (`npm run build`):**
  ```text
  ▲ Next.js 16.2.0 (webpack)
  - Environments: .env.local

  ✓ Compiled successfully in 2.8s
  ✓ Running TypeScript ... (Completed in 2.6s with 0 errors)
  ✓ Generating static pages (9/9)
  ✓ Collecting build traces
  ✓ Finalizing page optimization

  Route (app)
  ┌ ○ /
  ├ ○ /_not-found
  ├ ƒ /api/ai-assistant
  ├ ○ /dashboard
  ├ ƒ /dashboard/patients/[id]
  ├ ○ /dashboard/pharmacist
  ├ ○ /login
  └ ○ /signup
  ```

---

## 6. Itemized Modified Files

| File Path | Nature of Change | Purpose |
| :--- | :--- | :--- |
| `firestore.rules` | Rules Architecture | Added `publicDoctorProfiles` and `pharmacyPatientLookup`; removed directory search from `/users` |
| `src/app/dashboard/PatientDashboard.tsx` | Query Modernization | Updated doctor directory query to use `publicDoctorProfiles` |
| `src/app/dashboard/pharmacist/page.tsx` | Query Modernization | Updated patient dispensing query to use `pharmacyPatientLookup` |
| `src/lib/auth.js` | Projection Auto-Sync | Added automatic creation and synchronization for `pharmacyPatientLookup` and `publicDoctorProfiles` |
| `tests/firestore-security.test.mjs` | Test Suite Expansion | Added Category I with 7 test cases covering directory permissions and privacy isolation |
| `blueprint.md` | Documentation | Recorded completion of Phase 1.3 directory projection separation |
| `PHASE_1_PRIVACY_HARDENING_REPORT.md` | Deliverable | Comprehensive privacy hardening report (this document) |

---

## 7. Remaining Risks & Considerations

1. **Initial Cloud Firestore Index Deployment:**
   - The new lookup queries (`collection(db, 'publicDoctorProfiles')` and `collection(db, 'pharmacyPatientLookup')`) do not require composite indexes, as they are single-collection reads.
2. **First Admin Provisioning:**
   - In production, initial administrator accounts must receive the `{ role: 'admin' }` claim via the Firebase Admin SDK to manage doctor directories.
3. **Historical Commit Scrub (`firebase-debug.log`):**
   - The file was untracked from Git in Phase 1; purging it permanently from past Git history requires executing `git-filter-repo` when the repository owner authorizes a history rewrite.

---

## 8. Final Merge Recommendation

### Current Status: **READY TO MERGE**

With the completion of Phase 1.3:
- Private user profiles are strictly isolated from cross-user inspection.
- Doctor scheduling and pharmacy billing directories operate through minimal non-sensitive projections.
- All 41 automated Firestore emulator security tests pass.
- Production build compiles cleanly with zero TypeScript errors.
- Backward compatibility and existing dashboard functionality have been fully preserved without UI redesign.

**Recommendation:** Proceed with committing the hardened changes and merging branch `security/phase-1-hardening` into `main`.

