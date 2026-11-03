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

### Completed: Phase 1 â€” Security Hardening & Repository Cleanup
- **Safe Environment:** Created recovery branch `backup/pre-hardening-main` and active branch `security/phase-1-hardening`.
- **Repository Sanitization:** Untracked `firebase-debug.log` from Git index. Hardened `.gitignore` to ignore `*.log`, `.firebase/`, and whitelist `.env.example`.
- **Client Key Isolation:** Removed `next.config.js` with client-leaking `GEMINI_API_KEY`.
- **Config & Build Stability:** Consolidated on `next.config.ts`, pinned `sharp@0.33.5`, fixed Next.js root inference.
- **ESLint & Code Health:** Resolved all ESLint errors.

### Completed: Phase 1.1 â€” Security Remediation & Verification
- **Firestore Rules Overhaul:** Fixed all 6 identified vulnerabilities in `firestore.rules`:
  1. Restricted `users/{userId}` to owner/admin; limited directory query to doctor role.
  2. Blocked pharmacist reads on `/patients/{patientId}` documents.
  3. Enforced `isAssignedDoctor(patientId)` for medical records writes under `/patients/{patientId}/medicalRecords`.
  4. Scoped patient billing subcollections: only patient can read, only pharmacist can create, immutable financial fields.
  5. Enforced appointment field diffing: patients can only cancel; doctors can only update status/clinical fields; identity keys are immutable.
  6. Enforced append-only clinical records (cannot be modified or deleted by patients) and blocked user role self-escalation.
- **Role Provisioning Design:** Implemented Custom Claims architecture (`request.auth.token.role`) in rules and `AuthProvider`, with safe legacy fallback. Hardened `signup()` to enforce `role: 'patient'` on public registration, storing privileged role requests in `requestedRole` for admin approval.
- **Automated Security Test Suite:** Implemented `tests/firestore-security.test.mjs` using `@firebase/rules-unit-testing@5.0.2`. Executed 17 test assertions across Categories Aâ€“F against local Firestore emulator with **17/17 passing**.
- **TypeScript Resolution:** Completely removed `ignoreBuildErrors: true` from `next.config.ts`. Fixed underlying TypeScript type errors in `DoctorDashboard.tsx` and `PatientDashboard.tsx`. Verified `npx tsc --noEmit` (0 errors) and `npm run build` (compiled clean in 2.7s across all 9 static routes).
- **Deliverables Authored:** Generated `PHASE_1_1_REMEDIATION_REPORT.md` documenting verified results, history cleanup instructions, and gate check for Phase 2.

### Completed: Phase 1.2 â€” Final Security Remediation
- **Pharmacist Access Elimination:** Removed `isPharmacist() ||` from `/patients/{patientId}`. Pharmacists are strictly prohibited from browsing patient clinical/demographic profiles while preserving billing creation workflows.
- **Appointment Scoping Hardened:** Eliminated the open `'doctorId' in resource.data && 'date' in resource.data` rule. Implemented separate `get` and `list` rules: patients can only access their own appointments (`patientId == request.auth.uid`), doctors can only access assigned appointments (`doctorId == request.auth.uid`), and open collection queries across patients are denied.
- **Pure Custom Claims Enforcement:** Completely removed the Firestore document fallback (`users/{uid}.role`) for privileged permissions in `firestore.rules`. `isAdmin()`, `isDoctor()`, `isPharmacist()`, and `isBloodBank()` now rely strictly on `request.auth.token.role == roleName`.
- **AuthProvider Hardening:** Updated `src/lib/auth.js` to ensure privileged roles (`admin`, `doctor`, `pharmacist`, `blood_bank`) originate strictly from verified Custom Claims (`tokenResult.claims.role`). Users with unverified or missing claims default to `role: 'patient'`, preventing unauthorized dashboard escalation.
- **Expanded Test Suite (34/34 PASS):** Expanded `tests/firestore-security.test.mjs` to 34 assertions across Categories Aâ€“H, verifying negative access for pharmacists browsing patients, unrelated users reading appointments, and users with doc roles but lacking custom claims.
- **Clean Build & Types:** Verified `npm run test:security` (34/34 PASS), `npm run lint` (0 errors), `npx tsc --noEmit` (0 errors), and `npm run build` (successful compilation in 3.9s).

### Completed: Phase 1.3 â€” Final Privacy Hardening (Lookup Directory Separation)
- **Directory Projections Separated:** Completely isolated private user documents from directory queries.
  - `publicDoctorProfiles/{doctorId}`: Contains only non-sensitive scheduling data (`name`, `specialization`, `profileImage`, `availability`). Read allowed for all authenticated users; create/update restricted to doctor owner or admin.
  - `pharmacyPatientLookup/{patientId}`: Contains only minimal dispensing metadata (`displayName`, `patientReference`). Read restricted to authorized pharmacists and admin. Write restricted to patient owner binding `patientReference == request.auth.uid`.
- **Private Profile Protection:** Removed doctor and patient directory search permissions from `/users/{userId}`. Normal user profiles are strictly private (owner and admin only). Pharmacists and unrelated patients can no longer query or read any `/users` documents.
- **Frontend Query Updates:** Updated `PatientDashboard.tsx` to fetch available doctors from `publicDoctorProfiles`. Updated `pharmacist/page.tsx` to fetch patients from `pharmacyPatientLookup`.
- **Automated Test Suite Expansion (41/41 PASS):** Added Category I covering 7 privacy & lookup test cases (unauthenticated doctor lookup rejection, pharmacist patient lookup access, pharmacist private user document block, cross-patient impersonation prevention, and user document isolation). All 41 tests pass against the Firestore Emulator.

---

### Completed: Phase 1.4 â€” Permanent Git History Cleanup
- **Phase 1 Commit Local Pinning:** Staged and committed all approved Phase 1 hardening code on `security/phase-1-hardening` (commit `887dbd3`).
- **Private Recovery Backup:** Generated and verified full repository local Git bundle `MEDICORE-AI-pre-history-cleanup.bundle` containing all 8 references.
- **Clean Clone Isolation & Filter-Repo:** Cloned repository into isolated directory `MEDICORE-AI-history-clean`, tracked all remote branches (`main` and `ai-upgrade`), resolved Python Windows config-parser split issue, and executed `git filter-repo --invert-paths --path firebase-debug.log --force`.
- **Historical Scrub Verification:** Verified zero historical traces of `firebase-debug.log` across all historical commits and objects (`git log --all --full-history -- firebase-debug.log` returned 0 entries). Root commit rewritten from `5757dc0` -> `1742d81`.
- **Remote Synchronization:** Restored `origin` remote, verified unchanged remote snapshot, and executed `git push --force origin main ai-upgrade`.
- **Workspace Rebase & Verification:** Synchronized active workspace, updated local `main` to `origin/main` (`772000f`), and cleanly rebased `security/phase-1-hardening` onto rewritten `main` (commit `f62294e`).
- **Suite & Build Certification:** Verified `npm run test:security` (**45/45 tests passing**) and `npm run build` (**clean Next.js 16 production compilation** across all 9 routes). Cleaned up scratch clone.

---

## Planned Future Phases

### Completed: Phase 2 â€” Firebase Infrastructure Restoration
- **New Exhibition Project Provisioned:** Created fresh Firebase Project `medicore-ai-exhibition` (Display Name: `MEDICORE-AI Exhibition`, Project Number: `82891599621`) via Firebase MCP. Revoked project completely decommissioned.
- **Web App Registered:** Created `MEDICORE-AI Web` (`1:82891599621:web:dd96c5facd93fb27ea516c`).
- **Environment Secured:** Populated `.env.local` with fresh web client configuration. Retained server-side `GEMINI_API_KEY`. Verified `.gitignore` prevents secret leaks.
- **Authentication Configured:** Enabled Email/Password provider on live project using Firebase MCP and CLI deployment.
- **Cloud Firestore Native Provisioned:** Created Native Mode database `(default)` in owner-approved region `asia-south1` (Mumbai, India).
- **Hardened Rules Deployed:** Deployed `firestore.rules` and indexes (`firestore.indexes.json`) directly to live project `medicore-ai-exhibition`. Unused composite index removed.
- **Custom Claims Architecture & Initial Admin Provisioning:** Verified trusted claims workflow using Firebase MCP `auth_update_user`. Initial permanent administrator provisioned for `dj933429@gmail.com` (UID: `ugImegYwx0aL317wYJLXUbhkWGP2`) with verified claim `{"role": "admin"}`.
- **Verification & Certification:** 45/45 tests passing on Firestore emulator, 0 ESLint errors, 0 TypeScript errors, clean Next.js 16 production build.

### Completed: Phase 2.1 â€” Live Firebase Integration Verification
- **Live Authentication Verified:** Executed synthetic patient registration, session persistence, re-authentication, and account cleanup against medicore-ai-exhibition.
- **Live Firestore CRUD Verified:** Verified profile creation (users/{uid}), patient record creation (patients/{uid}), pharmacy lookup synchronization (pharmacyPatientLookup/{uid}), public doctor profile queries (publicDoctorProfiles), and appointment creation (ppointments).
- **Live Security Rules Enforcement Verified:** Confirmed that unauthorized reads on foreign user documents and unauthorized writes on publicDoctorProfiles are rejected with PERMISSION_DENIED by the live ruleset.
- **Production Cleanliness Maintained:** All synthetic documents and auth accounts deleted immediately after test runs.
- **Full Quality Certification:** 45/45 Emulator tests passing, 11/11 Live Firebase checks passing, 0 ESLint errors, 0 TypeScript errors, Next.js 16 production build clean.

---

### Completed: Phase 2.3 â€” Admin Role Management System
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

### Completed: Phase 3.1 — Menstrual Health Management Module (Sprint 1 Closure)
- **Status:** Complete, Accepted & Verified via Full Browser Interaction Audit.
- **Architecture Overview:**
  - Integrated 4-screen suite directly into Next.js 16 App Router under `/dashboard/menstrual-health/*`.
  - Serene Editorial Health design tokens (`#FAF7F4` Warm Ivory, `#C9828F` Muted Rose, `#806779` Plum, `#A6B5A0` Sage) registered in `@theme` via Tailwind CSS v4.
  - Serif typography loaded locally via `next/font/google` (`Playfair_Display` and `Plus_Jakarta_Sans`).
  - Strict preservation of existing Firebase Auth, Firestore security rules, Admin SDK, and clinical role dashboards.

- **Working Routes:**
  1. **Overview (`/dashboard/menstrual-health`):**
     - Current cycle day indicator (`Day 14` in Demo, `Day —` in New-User).
     - Circular SVG Cycle Wheel visualizing follicular, ovulatory, luteal, and menstrual phases.
     - Cycle statistics summary (Average length, variation, last period, next estimated window).
     - Daily wellness snapshot bento and Quick Log modal for rapid flow/symptom check-in.
  2. **Interactive Cycle Calendar (`/dashboard/menstrual-health/calendar`):**
     - Dynamic monthly calendar with 7-column grid and month navigation (Previous, Next, Today).
     - Visual distinction between recorded period spans and estimated upcoming period windows.
     - Interactive date selection updating the right-hand inspection drawer with detailed status and logged symptoms.
  3. **Daily Journal & Period Log (`/dashboard/menstrual-health/log`):**
     - Dual-tab view: Daily Wellness Journal and Period Log & Cycle History.
     - Flow intensity selector (None, Light, Medium, Heavy), 12 multi-select symptom chips, mood buttons, 1-5 energy scale, sleep quality, and notes.
     - Period record modal with inverted date validation and overlap prevention against existing records.
     - Chronological period history feed with duration and calculated cycle length.
  4. **Cycle Insights & Trends (`/dashboard/menstrual-health/insights`):**
     - Timeframe filtering (Past 3 Months, Past 6 Months, All Cycles).
     - Calculated statistics: Average cycle length, average period duration, shortest and longest cycles.
     - Longitudinal cycle length chart with 28-day reference line, flow distribution, and symptom frequency analysis.
     - RFC 4180 compliant CSV export (`medicore_cycle_history_YYYY-MM-DD.csv`) and toggleable cycle log table.

- **Shared-State Architecture & Demo Data Lifetime:**
  - Implemented centralized client-side React Context (`MenstrualHealthProvider` in `src/lib/menstrual-health/context.tsx`).
  - Manages reactive state across all 4 screens for period spans, daily logs, active mode (`'demo'` vs `'new-user'`), and toast notifications.
  - **Temporary State Lifecycle:** All changes (logging periods, recording symptoms, editing entries) persist seamlessly across internal SPA navigation but reset cleanly to baseline upon hard browser refresh (`F5`), as architecturally designed for Sprint 1 without Firestore persistence.
  - Pure calculation engine (`src/lib/menstrual-health/calculations.ts`) computes statistics strictly from recorded period start dates without fabricating metrics.
  - Full data isolation between Demo Mode (anchored around current date) and New-User Mode (clean empty states with zero leaked metrics).

- **Browser Interaction Audit Results (All 25 Checks PASS):**
  - All 4 routes load with correct editorial typography and zero hydration mismatches.
  - Demo Mode initialized on Day 14 with 8 cycles; New-User mode shows genuine empty states.
  - Mode switching confirmed 100% data isolation without leakage.
  - Inverted date ranges and overlapping periods rejected with inline validation.
  - Adding a period dynamically updates history and reactive cycle counts in Insights (8 → 9 cycles).
  - Saving and editing daily journal entries updates Calendar selected date pane and Overview check-in snapshot.
  - Calendar month navigation (Prev, Next, Today) and day inspection drawer verified.
  - Insights 3M/6M/All filters, cycle log table toggle, and CSV export verified.
  - Desktop (1280px) and mobile responsive layout (375px) with slide-in navigation drawer verified.
  - Zero browser console errors and zero React hydration warnings in the Menstrual Health module.

- **Remaining Limitations (Deferred to Sprint 2 / Future Sprints):**
  - State is currently client-side and ephemeral (no Firestore persistence).
  - Cycle estimation uses historical average intervals; no predictive machine learning models or hormone sensors are integrated.
  - Reminders and calendar notifications are local UI indicators.

---

### Completed: Phase 3.2 — Cycle Calculation Engine (Sprint 2A)
- **Status:** Complete, Independently Tested (39/39 Unit Tests PASS) & Integrated.
- **Core Pure Calculation Engine (`src/lib/menstrual-health/calculations.ts`):**
  - **Zero Timezone Shift Arithmetic:** Implemented `daysBetween`, `addDaysToDate`, `isValidISODateString`, and `parseISODate` using deterministic UTC midnight calculations. Eliminates all local daylight-savings transitions and timezone off-by-one errors across month boundaries, year boundaries, and leap years (e.g. Feb 29 in 2024 vs 2025).
  - **Consecutive Start Date Derived Math:** Cycle lengths are calculated exclusively from consecutive recorded period start dates. Duration is calculated from inclusive start and end dates (`endDate - startDate + 1`). Ongoing/uncompleted periods without end dates are explicitly supported without corrupting cycle interval calculations.
  - **Statistical Metrics:** Computes sample population mean cycle length, mean period duration, shortest and longest cycles, sample variance, standard deviation, and range.
  - **Prediction & Uncertainty Range:** Implemented `estimateNextPeriodWindow` deriving the statistical expectation window ($[\text{est} - \delta, \text{est} + \delta]$) based on personal historical variation. Communicates graded confidence rating (`low`, `moderate`, `high`) and mandatory medical/prediction disclaimer (not medical advice, no confirmed ovulation, no hormone claims, no contraception guidance).
  - **Data Sufficiency Guardrails:** Classified into 4 clinical levels (`none`, `insufficient`, `minimal`, `sufficient`). Prevents fabrication of statistics when completed cycles < 2.
- **Clinical Validation & Guardrails (`validatePeriodRecord`):**
  - Configurable clinical thresholds based on FIGO Menstrual Disorders Committee guidelines (`DEFAULT_CYCLE_THRESHOLDS`: normal cycle 21–35 days, normal period 2–8 days, max plausible duration 14 days, max cycle 90 days).
  - Hard errors for invalid date strings, inverted dates (end < start), duplicate start dates, overlapping date spans, and implausible durations (> 14 days).
  - Non-blocking advisory warnings for unusually short (< 21d) or long (> 35d) cycle intervals, or short (< 2d) / long (> 8d) period durations, ensuring honest patient tracking is never silently discarded.
- **Automated Unit Test Suite (`tests/cycle-engine.test.mjs` / `npm run test:cycle`):**
  - 39/39 passing unit tests covering normal cycles, varying lengths, leap years, month/year boundaries, negative deltas, data sufficiency, prediction windows, duplicate/overlap detection, ongoing periods, and clinical thresholds.
- **Quality Gates Verification:**
  - 39/39 Cycle Engine tests passing.
  - 13/13 Admin Role Management regression tests passing.
  - 25/25 Manual browser interaction audit checks passing.
  - 0 TypeScript errors (`npx tsc --noEmit`).
  - 0 ESLint errors (`npm run lint`).
  - Clean Next.js 16 production build across all 14 routes.

---

### Completed: Phase 3.3 — Calculation Validation & Prediction Refinement (Sprint 2B)
- **Status:** Complete, Independently Validated (44/44 Unit Tests PASS, 25/25 Browser Checks PASS) & Integrated.
- **Statistical Interpretation Review & Bessel's Correction:**
  - **Sample vs. Population Standard Deviation:** Replaced population standard deviation ($\sigma = \sqrt{\sum(x - \mu)^2 / N}$) with **Sample Standard Deviation** using Bessel's correction ($s = \sqrt{\sum(x - \bar{x})^2 / (N - 1)}$).
    - *Rationale:* User menstrual records constitute an open longitudinal biological *sample* of reproductive cycles, not a closed population. Dividing by $N - 1$ provides an unbiased variance estimator.
    - *Degrees of Freedom:* When $N < 2$ completed cycle intervals (fewer than 3 recorded periods), sample variance has $\le 0$ degrees of freedom and is mathematically undefined; `sampleStandardDeviation` is reported as `null` with explicit notice.
    - *Explicit Verification:* For cycle lengths `[26, 28, 30, 32]` ($N = 4$, sum of squared deviations = 20), population $\sigma = 2.2$ days ($\sqrt{20/4}$), whereas sample $s = 2.6$ days ($\sqrt{20/3}$).
  - **Removal of Unsupported Regularity Classifications:**
    - Completely removed `isRegular: boolean` and arbitrary cutoffs (e.g. $\le 4$ days standard deviation or $\le 7$ days range).
    - Replaced with descriptive variation metrics (`sampleStandardDeviation`, `rangeDays`, `standardDeviationType: 'sample'`, and `description`). Menstrual cycles naturally vary across reproductive life; binary classification lacks clinical validity and creates false diagnostic impressions.
  - **Uncertainty Language vs. Pseudo-Probabilities:**
    - Removed pseudo-probability labels (`confidence: 'low' | 'moderate' | 'high'`) from estimation windows.
    - Replaced with descriptive uncertainty language (`historyDescription`, `uncertaintyDescription`) detailing history depth and empirical variation.
    - **Presentation Cap Disclosure:** When empirical cycle variation is high (e.g., $s = 17.0$ days for intervals `[21, 45]`), the estimation window retains a $\pm 7$-day calendar presentation cap while explicitly disclosing (`isCapped: true`, `actualVariationDays: 17.0`) that the observed biological variation is significantly wider and not fully captured by the display window.
    - **Medical Disclaimer (Overview & Insights):**
      > "Predictions are calculated from previously recorded menstrual cycle dates and observed historical variation. They are statistical estimates, not medically validated predictions. Actual cycle dates may differ due to natural biological variation and other factors. This tracker does not confirm ovulation, measure hormones, diagnose medical conditions, or provide contraception guidance."
- **4-Level Data Sufficiency Hierarchy & Application Reference:**
  - **Level 0 (`'none'`, 0 periods):** Empty profile; all calculation capabilities false; limitations communicate that period dates are required.
  - **Level 1 (`'insufficient'`, 1 period):** 0 completed cycle intervals; cycle length cannot be calculated; period bleeding duration can be calculated if an `endDate` is logged; next-period prediction is provisional 28-day baseline.
  - **Level 2 (`'minimal'`, 2 periods):** Exactly 1 completed cycle interval; average cycle length can be calculated; variation and sample standard deviation require $\ge 2$ intervals (reported as `null`).
  - **Level 3 (`'sufficient'`, $\ge 3$ periods):** $\ge 2$ completed cycle intervals; average cycle length, range, and sample standard deviation ($s$) computable. Labeled **"Variation Calculable"** for 2–5 completed intervals. The 6+ completed intervals threshold is designated as **"More Tracking History Available"** as an *application-level reference* for longer tracking history, explicitly clarifying that it is not a clinically established threshold or a guarantee of predictive accuracy.
- **Verification Levels Distinction (Statistical vs. Clinical Validation):**
  1. **Calculation Verification:** Automated unit tests (`npm run test:cycle`, 46 tests) verify deterministic mathematical behavior, calendar arithmetic, Bessel's correction, and edge case scenarios.
  2. **Software Verification:** Automated and manual browser interaction suites (`browser-audit.cjs`, 25 tests; `npm run test:admin`, 13 tests) verify application behavior, state reactivity, UI navigation, and system integration.
  3. **Clinical Validation:** **Not performed.** The application has not undergone formal clinical trials and has not established medical accuracy, diagnostic efficacy, or therapeutic safety for individual patients.
- **Realistic Clinical Scenarios Tested:**
  - *Fixed 28-day cycles:* 0.0 sample standard deviation, 0 range, uncertainty window safely clamped to baseline $\pm 2$ days.
  - *Variable cycles (`[25, 35, 28, 32]`):* Mean 30.0d, $s = 4.4$ days, range 10 days, $\pm 4$ days window.
  - *Irregular cycles (`[21, 45]`):* Handled with descriptive variance ($s = 17.0$ days, range 24 days), explicit presentation cap explanation ($\pm 7$ days cap with notice that actual variation is $\pm 17$ days), without binary diagnostic classification.
  - *Incomplete periods:* Ongoing periods without `endDate` calculate cycle length accurately from consecutive start dates; duration averages only completed spans.
  - *Leap years & Century rules:* Feb 29 in 2024 vs 2025; 2000 is leap, 1900 is not; `daysBetween('2024-02-28', '2024-03-01')` strictly yields 2 days.
  - *Month & Year boundaries:* Validated crossing month boundaries (Oct 31 $\to$ Nov 28) and year transitions (Dec 28, 2026 $\to$ Jan 25, 2027).
- **UI & Shared State Integration:**
  - *Overview (`/dashboard/menstrual-health`):* Displays next period estimation window with history description, sample standard deviation, presentation cap notice when $s > 7$ days, and the required non-diagnostic disclaimer.
  - *Insights (`/insights`):* Enhanced sufficiency banner rendering 4-level badges (Level 0–3), contextual guidance ("Variation Calculable" vs "More Tracking History"), explicit application-level reference notice, and the non-diagnostic disclaimer.
  - *Calendar (`/calendar`):* Maintains synchronized state, date sidebar, and month navigation.
- **Sprint 2B Quality Gates & Verification:**
  - 46/46 Cycle Engine unit tests passing (`npm run test:cycle`).
  - 13/13 Admin Role Management regression tests passing (`npm run test:admin`).
  - 25/25 Manual browser interaction audit checks passing (`browser-audit.cjs`).
  - 0 TypeScript errors (`npx tsc --noEmit`).
  - 0 ESLint errors (`npm run lint`).
  - Clean Next.js 16 production build across all 14 routes (`npm run build`).

---

### Completed: Phase 3.3 — Complete Application Vercel Deployment
- **Status:** Complete, Deployed & Verified in Production.
- **Platform & Project Details:**
  - **Platform:** Vercel (CLI 65.10.0, Hobby Plan)
  - **Project Name:** `medicore-ai` (`prj_AEU8m5wxH8GaHADP6v0JSgqM40mA`)
  - **Branch:** `feature/menstrual-health-foundation`
  - **Live Production URL:** `https://medicore-ai-gules.vercel.app`
  - **Alternate Production Alias:** `https://medicore-ai-dj933429-wqs-projects.vercel.app`
  - **Inspection URL:** `https://vercel.com/dj933429-wqs-projects/medicore-ai/3Ece2MCxuxSkeDGoqF9mbfzo8ipQ`
- **Configuration & Infrastructure Adjustments:**
  - **Framework Preset:** Configured to `nextjs` (ensuring correct App Router routing).
  - **Node.js Runtime:** `26.x` with `NODE_OPTIONS="--experimental-require-module"` to support CommonJS (`jwks-rsa`) requiring ESM modules (`jose`).
  - **Next.js Config (`next.config.ts`):** Added `serverExternalPackages: ["firebase-admin"]` to isolate Firebase Admin SDK bundles from client bundling and enable seamless server-side execution.
  - **Environment Variables Synced:** Configured across Production, Preview, and Development (`NEXT_PUBLIC_FIREBASE_*`, `GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_KEY`).
- **Live Endpoint Verification Matrix:**
  - `GET /` (Homepage): HTTP 200 OK (Cache: HIT/PRERENDER)
  - `GET /login` (Authentication): HTTP 200 OK (Cache: PRERENDER)
  - `GET /dashboard/menstrual-health`: HTTP 200 OK (Cache: PRERENDER)
  - `POST /api/ai-assistant`: HTTP 200 OK (Serverless Function execution)
  - `GET /api/admin/users`: HTTP 401 Unauthorized (Auth guard verified)

---

### Completed: Phase 3.2 - Menstrual Health Firestore Persistence & Security Rules (Sprint 3)
- **Status:** Complete, Accepted & Verified via Firebase Local Emulator Acceptance Test Suites.
- **Data Architecture & Subcollections:**
  - `users/{userId}/menstrualRecords/{recordId}`: Document ID deterministically formatted as `period_{startDate}` (e.g., `period_2026-03-01`).
    - Schema: `id`, `startDate` (YYYY-MM-DD), `endDate` (optional YYYY-MM-DD), `flow` ('light'|'medium'|'heavy'), `notes` (optional string $\le 1000$ chars), `source` ('user'|'demo'), `createdAt`, `updatedAt`.
  - `users/{userId}/menstrualLogs/{logId}`: Document ID deterministically formatted as `log_{date}` (e.g., `log_2026-03-01`).
    - Schema: `id`, `date` (YYYY-MM-DD), `symptoms` (list of strings $\le 15$ items), `mood` (optional enum), `energy` (optional integer 1–5), `sleepHours` (optional number 0–24), `sleepQuality` (optional enum), `notes` (optional string $\le 2000$ chars), `createdAt`, `updatedAt`.
- **Security & Authorization Model (`firestore.rules`):**
  - **Strict Patient Role Enforcement:** Evaluated via helper `isStrictPatientOwner(userId)`:
    - User is authenticated: `request.auth != null`.
    - User owns UID path: `request.auth.uid == userId`.
    - Custom claim role is strictly patient: `request.auth.token.role == 'patient'`.
    - Claimless users, unauthenticated callers, and privileged staff roles (`doctor`, `pharmacist`, `admin`, `blood_bank`) are strictly denied read/write access, even if accessing a path matching their own UID.
  - **Granular Operation Isolation:** Separate `create`, `update`, and `delete` rules prevent write-rule bypasses.
  - **Defensive Optional-Field Evaluation:** Both create and update rules strictly validate optional fields with pattern `(!('key' in request.resource.data) || ...)`.
  - **Field Immutability:** On update, `startDate`, `date`, `createdAt`, and `source` cannot be changed.
  - **Payload Integrity:** Derived metrics (`cycleLength`, `dayOfCycle`) and client demo-mode sources (`source == 'demo'`) are rejected by rules; `endDate >= startDate` strictly enforced.
- **Atomic Operations & Concurrency Control:**
  - Client service `updatePeriodStartDate()` utilizes `runTransaction` to safely verify destination non-existence, create new document (`period_${newStartDate}`), and delete old document (`period_${oldStartDate}`) in a single atomic commit.
  - Concurrent race tests verified with `Promise.all` preventing double-writes and overwrite collisions.
- **Verification & Acceptance Test Suites:**
  - 61/61 Menstrual Security acceptance tests passing (`tests/menstrual-security.test.mjs`).
  - 8/8 Concurrency & Transaction tests passing (`tests/concurrency-tx.test.mjs`).
  - 45/45 Firestore Security regression tests passing (`tests/firestore-security.test.mjs`).
  - 25/25 Manual Playwright browser interaction audit checks passing against live server (`scratch/browser-audit.cjs`).
  - 46/46 Cycle Engine unit tests passing (`tests/cycle-engine.test.mjs`).
  - 10/10 Firestore Persistence serialization tests passing (`tests/firestore-persistence.test.mjs`).
  - 0 TypeScript compiler errors (`npx tsc --noEmit`).
  - 0 ESLint errors (`npm run lint`, 5 pre-existing warnings in unrelated files preserved).
  - 14/14 Next.js 16 production build pages generated successfully (`npm run build`).

---

### In Progress: Phase 4A — Isolated Blood Bank Development
- **Status:** In Progress (Strict Isolation Mode in worktree ../MEDICORE-AI-blood-bank on branch eature/blood-bank-management).
- **Baseline Commit:** ee00a5b5701a2bb1abf77a958cb3c488c887657 (Phase 3 Menstrual Health Foundation).
- **Core Architecture & Isolation Plan:**
  - **Zero Regression Guarantee:** Zero modifications to existing auth providers (src/lib/auth.js), root routing (Dashboard.tsx, layout.tsx, Navbar.tsx), existing dashboards (Doctor, Patient, Pharmacist, Admin), menstrual health modules, or existing irestore.rules.
  - **Isolated Route & Guard:** Independent route /dashboard/blood-bank with direct access guard utilizing useAuth(). Unauthenticated users redirected to /login; authenticated users without verified Custom Claim 
ole === 'blood_bank' denied access with dedicated explanatory refusal view.
  - **Domain Architecture:** Strict TypeScript models for Donors, Donations, Inventory Units, Blood Requests, Distribution/Issues, and Audit Logs in src/lib/blood-bank/types.ts.
  - **Non-Automated Clinical Guardrail:** System strictly records staff-verified and laboratory-tested outcomes. No automated clinical eligibility or transfusion compatibility decisions are computed by software.
  - **Firestore Namespace Isolation:** Draft rules proposed in docs/phase-4/blood-bank-firestore-rules.fragment for namespace loodBank/{centerId}/** with append-only audit trail and strict cross-role denial.
  - **Dashboard Modules:** 7 dedicated operational views with honest empty states (Overview, Donors, Donations, Inventory, Requests, Distribution, Reports).
  - **Testing Strategy:** Independent emulator test suite in 	ests/blood-bank/ with temporary combined rules fixture and zero synthetic production data writes. Full regression pass on existing suites.
