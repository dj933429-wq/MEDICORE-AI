# Project Blueprint: MEDICORE-AI

## Overview
Medicore-AI is an AI-powered healthcare management platform built on Next.js 16 (App Router), React 19, Tailwind CSS v4, and Firebase (Authentication & Cloud Firestore). It provides strict role-based dashboards to manage users, patients, medical history timelines, pharmacy inventory, and appointments cleanly and securely.

## Project Structure & Architecture
- **Framework:** Next.js 16.2.0 (App Router)
- **Styling:** Tailwind CSS v4 (Modern aesthetics with fluid gradients, shadows, and responsive layout)
- **Database & Auth:** Firebase v12.11.0 (Firestore subcollections, Auth)
- **AI Integration:** Google Gemini API (`/api/ai-assistant`) with offline triage fallback (`src/lib/medicalData.ts`)
- **OCR:** Client-side Tesseract.js (Pharmacist label scanner)

### Existing Features & Security Foundations
- **Firebase Authentication & Global State:** Real authentication flow utilizing Firebase SDK `createUserWithEmailAndPassword` and `signInWithEmailAndPassword`. A global `AuthProvider` (`src/lib/auth.js`) securely guards all dashboard routes.
- **Role-Based Routing Constraints:** Users are strictly separated by roles (`admin`, `doctor`, `patient`, `pharmacist`). The `Dashboard.tsx` root routes users to their respective component natively.
- **Firestore Subcollections:** Medical records are stored efficiently under `{patients}/{id}/medicalRecords` to enforce strict ownership and simplified querying.
- **Doctor Dashboard:** Focuses on patient management using card-based layout grids to display patient records, linked securely to the doctor's roster via `doctorId` and appointment history.
- **Patient Dashboard & Timeline:** Grants insight for individuals to view their personal upcoming appointments, billing history, and medical history timeline securely bound to their `auth.uid`.
- **Pharmacist Dashboard:** Allows pharmacists to manage inventory via manual entries or OCR-assisted scans using frontend Tesseract.js, with point-of-sale billing and automated stock deduction.
- **AI Health Assistant:** Triage assistant with rate limiting, offline symptom database, and dynamic model discovery (`gemini-2.0-flash`, `gemini-1.5-flash`, etc.).
- **Security & Authorization Model:** Comprehensive Firestore security rules enforcing least-privilege access, immutable clinical audit trails, field-level protections, and hybrid role claims (`request.auth.token.role`) with legacy profile fallback.

---

## Change History & Implementation Status

### Completed: Phase 1 — Security Hardening & Repository Cleanup
- **Safe Environment:** Created recovery branch `backup/pre-hardening-main` and active branch `security/phase-1-hardening`.
- **Repository Sanitization:** Untracked `firebase-debug.log` from Git index. Hardened `.gitignore` to ignore `*.log`, `.firebase/`, and whitelist `.env.example`.
- **Client Key Isolation:** Removed `next.config.js` with client-leaking `GEMINI_API_KEY`.
- **Config & Build Stability:** Consolidated on `next.config.ts`, pinned `sharp@0.33.5`, fixed Next.js root inference.
- **ESLint & Code Health:** Resolved all ESLint errors.

### Completed: Phase 1.1 — Security Remediation & Verification
- **Firestore Rules Overhaul:** Fixed all 6 identified vulnerabilities in `firestore.rules`:
  1. Restricted `users/{userId}` to owner/admin; limited directory query to doctor role.
  2. Blocked pharmacist reads on `/patients/{patientId}` documents.
  3. Enforced `isAssignedDoctor(patientId)` for medical records writes under `/patients/{patientId}/medicalRecords`.
  4. Scoped patient billing subcollections: only patient can read, only pharmacist can create, immutable financial fields.
  5. Enforced appointment field diffing: patients can only cancel; doctors can only update status/clinical fields; identity keys are immutable.
  6. Enforced append-only clinical records (cannot be modified or deleted by patients) and blocked user role self-escalation.
- **Role Provisioning Design:** Implemented Custom Claims architecture (`request.auth.token.role`) in rules and `AuthProvider`, with safe legacy fallback. Hardened `signup()` to enforce `role: 'patient'` on public registration, storing privileged role requests in `requestedRole` for admin approval.
- **Automated Security Test Suite:** Implemented `tests/firestore-security.test.mjs` using `@firebase/rules-unit-testing@5.0.2`. Executed 17 test assertions across Categories A–F against local Firestore emulator with **17/17 passing**.
- **TypeScript Resolution:** Completely removed `ignoreBuildErrors: true` from `next.config.ts`. Fixed underlying TypeScript type errors in `DoctorDashboard.tsx` and `PatientDashboard.tsx`. Verified `npx tsc --noEmit` (0 errors) and `npm run build` (compiled clean in 2.7s across all 9 static routes).
- **Deliverables Authored:** Generated `PHASE_1_1_REMEDIATION_REPORT.md` documenting verified results, history cleanup instructions, and gate check for Phase 2.

### Completed: Phase 1.2 — Final Security Remediation
- **Pharmacist Access Elimination:** Removed `isPharmacist() ||` from `/patients/{patientId}`. Pharmacists are strictly prohibited from browsing patient clinical/demographic profiles while preserving billing creation workflows.
- **Appointment Scoping Hardened:** Eliminated the open `'doctorId' in resource.data && 'date' in resource.data` rule. Implemented separate `get` and `list` rules: patients can only access their own appointments (`patientId == request.auth.uid`), doctors can only access assigned appointments (`doctorId == request.auth.uid`), and open collection queries across patients are denied.
- **Pure Custom Claims Enforcement:** Completely removed the Firestore document fallback (`users/{uid}.role`) for privileged permissions in `firestore.rules`. `isAdmin()`, `isDoctor()`, `isPharmacist()`, and `isBloodBank()` now rely strictly on `request.auth.token.role == roleName`.
- **AuthProvider Hardening:** Updated `src/lib/auth.js` to ensure privileged roles (`admin`, `doctor`, `pharmacist`, `blood_bank`) originate strictly from verified Custom Claims (`tokenResult.claims.role`). Users with unverified or missing claims default to `role: 'patient'`, preventing unauthorized dashboard escalation.
- **Expanded Test Suite (34/34 PASS):** Expanded `tests/firestore-security.test.mjs` to 34 assertions across Categories A–H, verifying negative access for pharmacists browsing patients, unrelated users reading appointments, and users with doc roles but lacking custom claims.
- **Clean Build & Types:** Verified `npm run test:security` (34/34 PASS), `npm run lint` (0 errors), `npx tsc --noEmit` (0 errors), and `npm run build` (successful compilation in 3.9s).

### Completed: Phase 1.3 — Final Privacy Hardening (Lookup Directory Separation)
- **Directory Projections Separated:** Completely isolated private user documents from directory queries.
  - `publicDoctorProfiles/{doctorId}`: Contains only non-sensitive scheduling data (`name`, `specialization`, `profileImage`, `availability`). Read allowed for all authenticated users; create/update restricted to doctor owner or admin.
  - `pharmacyPatientLookup/{patientId}`: Contains only minimal dispensing metadata (`displayName`, `patientReference`). Read restricted to authorized pharmacists and admin. Write restricted to patient owner binding `patientReference == request.auth.uid`.
- **Private Profile Protection:** Removed doctor and patient directory search permissions from `/users/{userId}`. Normal user profiles are strictly private (owner and admin only). Pharmacists and unrelated patients can no longer query or read any `/users` documents.
- **Frontend Query Updates:** Updated `PatientDashboard.tsx` to fetch available doctors from `publicDoctorProfiles`. Updated `pharmacist/page.tsx` to fetch patients from `pharmacyPatientLookup`.
- **Automated Test Suite Expansion (41/41 PASS):** Added Category I covering 7 privacy & lookup test cases (unauthenticated doctor lookup rejection, pharmacist patient lookup access, pharmacist private user document block, cross-patient impersonation prevention, and user document isolation). All 41 tests pass against the Firestore Emulator.

---

### Completed: Phase 1.4 — Permanent Git History Cleanup
- **Phase 1 Commit Local Pinning:** Staged and committed all approved Phase 1 hardening code on `security/phase-1-hardening` (commit `887dbd3`).
- **Private Recovery Backup:** Generated and verified full repository local Git bundle `MEDICORE-AI-pre-history-cleanup.bundle` containing all 8 references.
- **Clean Clone Isolation & Filter-Repo:** Cloned repository into isolated directory `MEDICORE-AI-history-clean`, tracked all remote branches (`main` and `ai-upgrade`), resolved Python Windows config-parser split issue, and executed `git filter-repo --invert-paths --path firebase-debug.log --force`.
- **Historical Scrub Verification:** Verified zero historical traces of `firebase-debug.log` across all historical commits and objects (`git log --all --full-history -- firebase-debug.log` returned 0 entries). Root commit rewritten from `5757dc0` -> `1742d81`.
- **Remote Synchronization:** Restored `origin` remote, verified unchanged remote snapshot, and executed `git push --force origin main ai-upgrade`.
- **Workspace Rebase & Verification:** Synchronized active workspace, updated local `main` to `origin/main` (`772000f`), and cleanly rebased `security/phase-1-hardening` onto rewritten `main` (commit `f62294e`).
- **Suite & Build Certification:** Verified `npm run test:security` (**45/45 tests passing**) and `npm run build` (**clean Next.js 16 production compilation** across all 9 routes). Cleaned up scratch clone.

---

## Planned Future Phases

### Completed: Phase 2 — Firebase Infrastructure Restoration
- **New Exhibition Project Provisioned:** Created fresh Firebase Project `medicore-ai-exhibition` (Display Name: `MEDICORE-AI Exhibition`, Project Number: `82891599621`) via Firebase MCP. Revoked project completely decommissioned.
- **Web App Registered:** Created `MEDICORE-AI Web` (`1:82891599621:web:dd96c5facd93fb27ea516c`).
- **Environment Secured:** Populated `.env.local` with fresh web client configuration. Retained server-side `GEMINI_API_KEY`. Verified `.gitignore` prevents secret leaks.
- **Authentication Configured:** Enabled Email/Password provider on live project using Firebase MCP and CLI deployment.
- **Cloud Firestore Native Provisioned:** Created Native Mode database `(default)` in owner-approved region `asia-south1` (Mumbai, India).
- **Hardened Rules Deployed:** Deployed `firestore.rules` and indexes (`firestore.indexes.json`) directly to live project `medicore-ai-exhibition`. Unused composite index removed.
- **Custom Claims Architecture & Initial Admin Provisioning:** Verified trusted claims workflow using Firebase MCP `auth_update_user`. Initial permanent administrator provisioned for `dj933429@gmail.com` (UID: `ugImegYwx0aL317wYJLXUbhkWGP2`) with verified claim `{"role": "admin"}`.
- **Verification & Certification:** 45/45 tests passing on Firestore emulator, 0 ESLint errors, 0 TypeScript errors, clean Next.js 16 production build.

### Completed: Phase 2.1 — Live Firebase Integration Verification
- **Live Authentication Verified:** Executed synthetic patient registration, session persistence, re-authentication, and account cleanup against medicore-ai-exhibition.
- **Live Firestore CRUD Verified:** Verified profile creation (users/{uid}), patient record creation (patients/{uid}), pharmacy lookup synchronization (pharmacyPatientLookup/{uid}), public doctor profile queries (publicDoctorProfiles), and appointment creation (ppointments).
- **Live Security Rules Enforcement Verified:** Confirmed that unauthorized reads on foreign user documents and unauthorized writes on publicDoctorProfiles are rejected with PERMISSION_DENIED by the live ruleset.
- **Production Cleanliness Maintained:** All synthetic documents and auth accounts deleted immediately after test runs.
- **Full Quality Certification:** 45/45 Emulator tests passing, 11/11 Live Firebase checks passing, 0 ESLint errors, 0 TypeScript errors, Next.js 16 production build clean.

---

### Completed: Phase 2.3 — Admin Role Management System
- **Server-Only Firebase Admin SDK (`src/lib/firebaseAdmin.ts`):** Initialized Firebase Admin SDK with support for Application Default Credentials (ADC) and environment-injected service account keys (`FIREBASE_SERVICE_ACCOUNT_KEY`). Configured server-only protection to ensure zero client-side credential exposure.
- **Secure Admin API Route (`src/app/api/admin/users/route.ts`):**
  - `GET`: Authenticates admin ID tokens, verifies `decodedToken.role === 'admin'`, and retrieves all users with their authoritative Custom Claims merged with profile metadata.
  - `PATCH`: Validates admin authorization, enforces role allowlist (`patient`, `doctor`, `pharmacist`), disallows admin self-modification and escalation to `admin`, updates Firebase Auth Custom Claims, synchronizes the Firestore `users/{uid}` role projection, auto-clears approved `requestedRole` requests, and writes administrative audit records to `adminAuditLogs`.
- **Interactive Admin Dashboard (`src/app/dashboard/AdminDashboard.tsx`):** Built responsive UI with live user directory, search filter, role selector dropdowns, pending role request approval badges, dedicated **Approve** and **Decline** request actions, confirmation modals, loading spinners, and role change notices. The current admin's own account is protected from self-demotion.
- **Decline Role Request Workflow:** Administrators can decline pending role applications (e.g., patient asking to be doctor). The server (`/api/admin/users`) clears `requestedRole` in Firestore without granting privileged Custom Claims, preserves the user's current role, and records an administrative audit event in `adminAuditLogs`.
- **Live Admin SDK Runtime Verification:** Successfully configured `FIREBASE_SERVICE_ACCOUNT_KEY` in local `.env.local` for `medicore-ai-exhibition`. Verified live connection against Firebase Authentication (`adminAuth.listUsers`) and Cloud Firestore (`adminDb.collection('users')`).
- **Automated Test Suite (`tests/admin-roles.test.mjs`):** Implemented 13 comprehensive unit test assertions verifying authentication barriers, role transitions, claim preservation, Firestore projections, and request decline workflows with 13/13 passing.
- **Verification & Build:** 13/13 admin tests passing, 45/45 emulator tests passing, 0 ESLint errors, 0 TypeScript errors, clean Next.js 16 production compilation across all 10 routes.

---

### Phase 3: Feature 1 — Menstrual Health Management Module
- Implement opt-in menstrual health tracker for patients with private subcollection storage.

### Phase 4: Feature 2 — Blood Bank Management System
- Implement donor, inventory, and blood request portal for hospitals, patients, and blood banks.
