# MEDICORE-AI — Phase 2.3: Admin Role Management System Report

**Date:** March 2026  
**Repository:** [https://github.com/dj933429-wq/MEDICORE-AI](https://github.com/dj933429-wq/MEDICORE-AI)  
**Branch:** `feature/phase-2-firebase-restoration`  
**Target Project:** `medicore-ai-exhibition`  

---

## 1. Root Cause Analysis

Before this implementation, the administrator experience was incomplete:

1. **Client-Side Inactivity:** In `src/app/dashboard/AdminDashboard.tsx`, user records were fetched directly from the Firestore client SDK. The action buttons rendered an edit SVG icon without any click handler or role modification state.
2. **Security Barrier by Design:** As hardened during Phase 1, `firestore.rules` strictly prevents any authenticated user (even an administrator) from updating the `role` field on another user's document via client SDK queries (`(!('role' in request.resource.data.diff(resource.data).affectedKeys()))`).
3. **Absence of Server-Side Admin Machinery:** `package.json` did not contain the `firebase-admin` SDK, and no server-side API endpoints existed to manipulate authoritative Firebase Authentication Custom Claims.
4. **Authority Divergence:** Client Firestore documents only stored a profile projection of the role. The application's runtime authorization model (`request.auth.token.role` and `AuthProvider`) evaluates token Custom Claims. Without an Admin SDK bridge, changing a user's role was impossible.

---

## 2. Architecture & Implementation Overview

```
┌────────────────────────────────────────────────────────┐
│               Admin Dashboard UI                       │
│    (Role Selectors, Search, Confirmation Modal)         │
└──────────────────────────┬─────────────────────────────┘
                           │ 1. Bearer Token + PATCH { targetUid, newRole }
                           ▼
┌────────────────────────────────────────────────────────┐
│        Server-Side Next.js Route Handler               │
│          /api/admin/users (route.ts)                   │
├────────────────────────────────────────────────────────┤
│ • Verify Caller ID Token via Admin Auth                │
│ • Assert decodedToken.role === 'admin'                 │
│ • Validate targetUid !== callerUid (Self-Protection)   │
│ • Enforce Role Allowlist: patient, doctor, pharmacist  │
└────────────┬─────────────────────────────┬─────────────┘
             │ 2. setCustomUserClaims()     │ 3. Update user profile
             ▼                             ▼
┌─────────────────────────┐   ┌──────────────────────────┐
│  Firebase Authentication │   │     Cloud Firestore      │
│  Authoritative Claims:  │   │  users/{targetUid}.role  │
│     { role: newRole }   │   │  adminAuditLogs/ (Audit) │
└─────────────────────────┘   └──────────────────────────┘
```

---

## 3. Files Created & Modified

### 1. `src/lib/firebaseAdmin.ts` (Created)
- Annotated with `import 'server-only'` to prevent leaking Admin SDK code into browser bundles.
- Reuses existing Admin app instance (`getApps().find(app => app.name === 'medicore-admin')`).
- Credential Resolution Hierarchy:
  1. `FIREBASE_SERVICE_ACCOUNT_KEY` / `FIREBASE_ADMIN_SERVICE_ACCOUNT` (JSON or Base64-encoded string).
  2. Individual credentials (`FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`).
  3. Google Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS` or GCP ADC).
  4. Project ID fallback for emulated/local environments.
- Exports typed `adminAuth` and `adminDb`.

### 2. `src/app/api/admin/users/route.ts` (Created)
- **`GET` Endpoint:**
  - Authenticates caller via `Authorization: Bearer <token>`.
  - Verifies token and asserts `decodedToken.role === 'admin'` (HTTP 401 on missing/invalid token; HTTP 403 on non-admin).
  - Fetches all users from Cloud Firestore and cross-references them against Firebase Authentication `listUsers()`.
  - Returns authoritative Custom Claims merged with profile metadata (`uid`, `name`, `email`, `role`, `requestedRole`, `createdAt`).
- **`PATCH` Endpoint:**
  - Authenticates caller and enforces admin authorization.
  - Rejects caller attempts to modify their own role (`targetUid === callerUid` $\rightarrow$ HTTP 400).
  - Enforces strict role allowlist: `['patient', 'doctor', 'pharmacist']` (attempts to grant `admin` or `blood_bank` are rejected with HTTP 400).
  - Verifies target user exists in Firebase Authentication (HTTP 404 if missing).
  - Preserves target user's existing unrelated custom claims.
  - Updates Firebase Authentication Custom Claims via `adminAuth.setCustomUserClaims()`.
  - Dual-writes role projection to Firestore `users/{targetUid}` with rollback handling if Firestore write fails.
  - Clears `requestedRole` when the approved role matches the request.
  - Synchronizes public directories (`publicDoctorProfiles` for doctors, `pharmacyPatientLookup` for patients).
  - Records an immutable audit record in `adminAuditLogs` (`actorUid`, `targetUid`, `oldRole`, `newRole`, `timestamp`).

### 3. `src/app/dashboard/AdminDashboard.tsx` (Modified)
- Replaced direct Firestore query with authenticated API calls to `/api/admin/users`.
- Added search filter supporting name, email, or role.
- Integrated stats cards: Total Accounts, Doctors, Pharmacists, and Pending Requests.
- Added role selector dropdowns (`patient`, `doctor`, `pharmacist`) with dirty state tracking.
- Implemented "Confirm Role Change" modal displaying user details, current role, and new role before execution.
- Protected the administrator's own row: marked with a "You" badge and "Self (Protected)" label with disabled controls.
- Displayed `requestedRole` as an interactive pending pill with a one-click "Approve" shortcut.
- Displays immediate success/error alert banners with the mandatory token refresh notice.

### 4. `tests/admin-roles.test.mjs` (Created)
- Complete unit test harness covering all 12 security requirements.

### 5. `package.json` & `.env.example` (Modified)
- Installed `firebase-admin@^14.5.0`.
- Added script `"test:admin": "node tests/admin-roles.test.mjs"`.
- Documented `FIREBASE_SERVICE_ACCOUNT_KEY` and `GOOGLE_APPLICATION_CREDENTIALS` in [.env.example](file:///c:/Users/dj933/OneDrive/Desktop/PE/MEDICORE-AI/.env.example).

---

## 4. Test & Verification Results

### Admin Role Management Test Suite (`npm run test:admin`)

| # | Test Scenario | Target Condition | Result |
| :---: | :--- | :--- | :--- |
| **1** | Admin fetches user directory | Bearer token with `role: 'admin'` | **PASS (HTTP 200)** |
| **2** | Admin changes patient to doctor | Valid target, allowlisted role | **PASS (HTTP 200)** |
| **3** | Admin changes doctor to pharmacist | Valid target, allowlisted role | **PASS (HTTP 200)** |
| **4** | Admin changes pharmacist to patient | Valid target, allowlisted role | **PASS (HTTP 200)** |
| **5** | Unauthenticated request rejected | Missing / invalid Bearer header | **PASS (HTTP 401)** |
| **6** | Non-admin caller rejected | Token has `role: 'patient'` | **PASS (HTTP 403)** |
| **7** | Invalid role supplied | Role `super_hacker` not in allowlist | **PASS (HTTP 400)** |
| **8** | Admin modifying own role rejected | `targetUid === callerUid` | **PASS (HTTP 400)** |
| **9** | Admin granting admin role rejected | `newRole === 'admin'` | **PASS (HTTP 400)** |
| **10** | Nonexistent target UID | Target UID not found in Auth | **PASS (HTTP 404)** |
| **11** | Unrelated Custom Claims preserved | Target claim `customFacility` retained | **PASS** |
| **12** | Firestore projection & audit record | `users/{uid}.role` matches; `requestedRole` cleared; audit logged | **PASS** |

### Quality Gates

* **Admin Role Management Suite:** `12 / 12 PASS (100%)`
* **Firestore Security Emulator Suite:** `45 / 45 PASS (100%)`
* **ESLint Static Analysis:** `0 Errors`
* **TypeScript Compiler:** `npx tsc --noEmit` $\rightarrow$ `0 Errors`
* **Next.js Production Build:** `10 / 10 Routes Compiled Cleanly` in 8.5s (including dynamic route `/api/admin/users`)

---

## 5. Deployment & Runtime Configuration

For local development or deployment environments (such as Vercel, Cloud Run, or Node servers):

1. **Option A (Google Cloud / ADC):**  
   If running on Google Cloud or with `gcloud auth application-default login`, Firebase Admin SDK detects credentials automatically without extra environment variables.
2. **Option B (Environment Service Account Key):**  
   Download a private key JSON from:  
   *Firebase Console $\rightarrow$ Project Settings $\rightarrow$ Service accounts $\rightarrow$ Generate new private key*  
   Set the minified JSON string in [.env.local](file:///c:/Users/dj933/OneDrive/Desktop/PE/MEDICORE-AI/.env.local):
   ```env
   FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"medicore-ai-exhibition",...}
   ```
3. **Security Invariant:**  
   `FIREBASE_SERVICE_ACCOUNT_KEY` is strictly server-side and never prefixed with `NEXT_PUBLIC_`. [.gitignore](file:///c:/Users/dj933/OneDrive/Desktop/PE/MEDICORE-AI/.gitignore) prevents accidental commits.

---

## 6. How to Run & Verify

1. **Run Full Test Suites:**
   ```bash
   npm run test:admin      # Run 12 admin role management tests
   npm run test:security   # Run 45 Firestore security emulator tests
   npm run lint            # Verify ESLint code standards
   npm run build           # Verify Next.js production build
   ```

2. **Run Local Development Server:**
   ```bash
   npm run dev
   ```

3. **Verify in Browser:**
   - Log in at `/login` with your administrator credentials (`dj933429@gmail.com`).
   - Navigate to `/dashboard` — the system recognizes your `admin` claim and displays the **Administrator Portal**.
   - Your account is marked as **You** with protected controls.
   - For any other registered patient, select a role (`Doctor` or `Pharmacist`), click **Save**, review the confirmation dialog, and apply the role.
   - The user's Firebase Authentication Custom Claim will update instantly, and their Firestore profile projection will reflect the new role.
