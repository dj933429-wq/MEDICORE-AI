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

### Completed: Phase 1 Ã¢â‚¬â€ Security Hardening & Repository Cleanup
- **Safe Environment:** Created recovery branch `backup/pre-hardening-main` and active branch `security/phase-1-hardening`.
- **Repository Sanitization:** Untracked `firebase-debug.log` from Git index. Hardened `.gitignore` to ignore `*.log`, `.firebase/`, and whitelist `.env.example`.
- **Client Key Isolation:** Removed `next.config.js` with client-leaking `GEMINI_API_KEY`.
- **Config & Build Stability:** Consolidated on `next.config.ts`, pinned `sharp@0.33.5`, fixed Next.js root inference.
- **ESLint & Code Health:** Resolved all ESLint errors.

### Completed: Phase 1.1 Ã¢â‚¬â€ Security Remediation & Verification
- **Firestore Rules Overhaul:** Fixed all 6 identified vulnerabilities in `firestore.rules`:
  1. Restricted `users/{userId}` to owner/admin; limited directory query to doctor role.
  2. Blocked pharmacist reads on `/patients/{patientId}` documents.
  3. Enforced `isAssignedDoctor(patientId)` for medical records writes under `/patients/{patientId}/medicalRecords`.
  4. Scoped patient billing subcollections: only patient can read, only pharmacist can create, immutable financial fields.
  5. Enforced appointment field diffing: patients can only cancel; doctors can only update status/clinical fields; identity keys are immutable.
  6. Enforced append-only clinical records (cannot be modified or deleted by patients) and blocked user role self-escalation.
- **Role Provisioning Design:** Implemented Custom Claims architecture (`request.auth.token.role`) in rules and `AuthProvider`, with safe legacy fallback. Hardened `signup()` to enforce `role: 'patient'` on public registration, storing privileged role requests in `requestedRole` for admin approval.
- **Automated Security Test Suite:** Implemented `tests/firestore-security.test.mjs` using `@firebase/rules-unit-testing@5.0.2`. Executed 17 test assertions across Categories AÃ¢â‚¬â€œF against local Firestore emulator with **17/17 passing**.
- **TypeScript Resolution:** Completely removed `ignoreBuildErrors: true` from `next.config.ts`. Fixed underlying TypeScript type errors in `DoctorDashboard.tsx` and `PatientDashboard.tsx`. Verified `npx tsc --noEmit` (0 errors) and `npm run build` (compiled clean in 2.7s across all 9 static routes).
- **Deliverables Authored:** Generated `PHASE_1_1_REMEDIATION_REPORT.md` documenting verified results, history cleanup instructions, and gate check for Phase 2.

### Completed: Phase 1.2 Ã¢â‚¬â€ Final Security Remediation
- **Pharmacist Access Elimination:** Removed `isPharmacist() ||` from `/patients/{patientId}`. Pharmacists are strictly prohibited from browsing patient clinical/demographic profiles while preserving billing creation workflows.
- **Appointment Scoping Hardened:** Eliminated the open `'doctorId' in resource.data && 'date' in resource.data` rule. Implemented separate `get` and `list` rules: patients can only access their own appointments (`patientId == request.auth.uid`), doctors can only access assigned appointments (`doctorId == request.auth.uid`), and open collection queries across patients are denied.
- **Pure Custom Claims Enforcement:** Completely removed the Firestore document fallback (`users/{uid}.role`) for privileged permissions in `firestore.rules`. `isAdmin()`, `isDoctor()`, `isPharmacist()`, and `isBloodBank()` now rely strictly on `request.auth.token.role == roleName`.
- **AuthProvider Hardening:** Updated `src/lib/auth.js` to ensure privileged roles (`admin`, `doctor`, `pharmacist`, `blood_bank`) originate strictly from verified Custom Claims (`tokenResult.claims.role`). Users with unverified or missing claims default to `role: 'patient'`, preventing unauthorized dashboard escalation.
- **Expanded Test Suite (34/34 PASS):** Expanded `tests/firestore-security.test.mjs` to 34 assertions across Categories AÃ¢â‚¬â€œH, verifying negative access for pharmacists browsing patients, unrelated users reading appointments, and users with doc roles but lacking custom claims.
- **Clean Build & Types:** Verified `npm run test:security` (34/34 PASS), `npm run lint` (0 errors), `npx tsc --noEmit` (0 errors), and `npm run build` (successful compilation in 3.9s).

### Completed: Phase 1.3 Ã¢â‚¬â€ Final Privacy Hardening (Lookup Directory Separation)
- **Directory Projections Separated:** Completely isolated private user documents from directory queries.
  - `publicDoctorProfiles/{doctorId}`: Contains only non-sensitive scheduling data (`name`, `specialization`, `profileImage`, `availability`). Read allowed for all authenticated users; create/update restricted to doctor owner or admin.
  - `pharmacyPatientLookup/{patientId}`: Contains only minimal dispensing metadata (`displayName`, `patientReference`). Read restricted to authorized pharmacists and admin. Write restricted to patient owner binding `patientReference == request.auth.uid`.
- **Private Profile Protection:** Removed doctor and patient directory search permissions from `/users/{userId}`. Normal user profiles are strictly private (owner and admin only). Pharmacists and unrelated patients can no longer query or read any `/users` documents.
- **Frontend Query Updates:** Updated `PatientDashboard.tsx` to fetch available doctors from `publicDoctorProfiles`. Updated `pharmacist/page.tsx` to fetch patients from `pharmacyPatientLookup`.
- **Automated Test Suite Expansion (41/41 PASS):** Added Category I covering 7 privacy & lookup test cases (unauthenticated doctor lookup rejection, pharmacist patient lookup access, pharmacist private user document block, cross-patient impersonation prevention, and user document isolation). All 41 tests pass against the Firestore Emulator.

---

### Completed: Phase 1.4 Ã¢â‚¬â€ Permanent Git History Cleanup
- **Phase 1 Commit Local Pinning:** Staged and committed all approved Phase 1 hardening code on `security/phase-1-hardening` (commit `887dbd3`).
- **Private Recovery Backup:** Generated and verified full repository local Git bundle `MEDICORE-AI-pre-history-cleanup.bundle` containing all 8 references.
- **Clean Clone Isolation & Filter-Repo:** Cloned repository into isolated directory `MEDICORE-AI-history-clean`, tracked all remote branches (`main` and `ai-upgrade`), resolved Python Windows config-parser split issue, and executed `git filter-repo --invert-paths --path firebase-debug.log --force`.
- **Historical Scrub Verification:** Verified zero historical traces of `firebase-debug.log` across all historical commits and objects (`git log --all --full-history -- firebase-debug.log` returned 0 entries). Root commit rewritten from `5757dc0` -> `1742d81`.
- **Remote Synchronization:** Restored `origin` remote, verified unchanged remote snapshot, and executed `git push --force origin main ai-upgrade`.
- **Workspace Rebase & Verification:** Synchronized active workspace, updated local `main` to `origin/main` (`772000f`), and cleanly rebased `security/phase-1-hardening` onto rewritten `main` (commit `f62294e`).
- **Suite & Build Certification:** Verified `npm run test:security` (**45/45 tests passing**) and `npm run build` (**clean Next.js 16 production compilation** across all 9 routes). Cleaned up scratch clone.

---

## Planned Future Phases

### Completed: Phase 2 Ã¢â‚¬â€ Firebase Infrastructure Restoration
- **New Exhibition Project Provisioned:** Created fresh Firebase Project `medicore-ai-exhibition` (Display Name: `MEDICORE-AI Exhibition`, Project Number: `82891599621`) via Firebase MCP. Revoked project completely decommissioned.
- **Web App Registered:** Created `MEDICORE-AI Web` (`1:82891599621:web:dd96c5facd93fb27ea516c`).
- **Environment Secured:** Populated `.env.local` with fresh web client configuration. Retained server-side `GEMINI_API_KEY`. Verified `.gitignore` prevents secret leaks.
- **Authentication Configured:** Enabled Email/Password provider on live project using Firebase MCP and CLI deployment.
- **Cloud Firestore Native Provisioned:** Created Native Mode database `(default)` in owner-approved region `asia-south1` (Mumbai, India).
- **Hardened Rules Deployed:** Deployed `firestore.rules` and indexes (`firestore.indexes.json`) directly to live project `medicore-ai-exhibition`. Unused composite index removed.
- **Custom Claims Architecture & Initial Admin Provisioning:** Verified trusted claims workflow using Firebase MCP `auth_update_user`. Initial permanent administrator provisioned for `dj933429@gmail.com` (UID: `ugImegYwx0aL317wYJLXUbhkWGP2`) with verified claim `{"role": "admin"}`.
- **Verification & Certification:** 45/45 tests passing on Firestore emulator, 0 ESLint errors, 0 TypeScript errors, clean Next.js 16 production build.

### Completed: Phase 2.1 Ã¢â‚¬â€ Live Firebase Integration Verification
- **Live Authentication Verified:** Executed synthetic patient registration, session persistence, re-authentication, and account cleanup against medicore-ai-exhibition.
- **Live Firestore CRUD Verified:** Verified profile creation (users/{uid}), patient record creation (patients/{uid}), pharmacy lookup synchronization (pharmacyPatientLookup/{uid}), public doctor profile queries (publicDoctorProfiles), and appointment creation (ppointments).
- **Live Security Rules Enforcement Verified:** Confirmed that unauthorized reads on foreign user documents and unauthorized writes on publicDoctorProfiles are rejected with PERMISSION_DENIED by the live ruleset.
- **Production Cleanliness Maintained:** All synthetic documents and auth accounts deleted immediately after test runs.
- **Full Quality Certification:** 45/45 Emulator tests passing, 11/11 Live Firebase checks passing, 0 ESLint errors, 0 TypeScript errors, Next.js 16 production build clean.

---

### Completed: Phase 2.3 Ã¢â‚¬â€ Admin Role Management System
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

### Completed: Phase 3.1 â€” Menstrual Health Management Module (Sprint 1 Closure)
- **Status:** Complete, Accepted & Verified via Full Browser Interaction Audit.
- **Architecture Overview:**
  - Integrated 4-screen suite directly into Next.js 16 App Router under `/dashboard/menstrual-health/*`.
  - Serene Editorial Health design tokens (`#FAF7F4` Warm Ivory, `#C9828F` Muted Rose, `#806779` Plum, `#A6B5A0` Sage) registered in `@theme` via Tailwind CSS v4.
  - Serif typography loaded locally via `next/font/google` (`Playfair_Display` and `Plus_Jakarta_Sans`).
  - Strict preservation of existing Firebase Auth, Firestore security rules, Admin SDK, and clinical role dashboards.

- **Working Routes:**
  1. **Overview (`/dashboard/menstrual-health`):**
     - Current cycle day indicator (`Day 14` in Demo, `Day â€”` in New-User).
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
  - Adding a period dynamically updates history and reactive cycle counts in Insights (8 â†’ 9 cycles).
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

### Completed: Phase 3.2 â€” Cycle Calculation Engine (Sprint 2A)
- **Status:** Complete, Independently Tested (39/39 Unit Tests PASS) & Integrated.
- **Core Pure Calculation Engine (`src/lib/menstrual-health/calculations.ts`):**
  - **Zero Timezone Shift Arithmetic:** Implemented `daysBetween`, `addDaysToDate`, `isValidISODateString`, and `parseISODate` using deterministic UTC midnight calculations. Eliminates all local daylight-savings transitions and timezone off-by-one errors across month boundaries, year boundaries, and leap years (e.g. Feb 29 in 2024 vs 2025).
  - **Consecutive Start Date Derived Math:** Cycle lengths are calculated exclusively from consecutive recorded period start dates. Duration is calculated from inclusive start and end dates (`endDate - startDate + 1`). Ongoing/uncompleted periods without end dates are explicitly supported without corrupting cycle interval calculations.
  - **Statistical Metrics:** Computes sample population mean cycle length, mean period duration, shortest and longest cycles, sample variance, standard deviation, and range.
  - **Prediction & Uncertainty Range:** Implemented `estimateNextPeriodWindow` deriving the statistical expectation window ($[\text{est} - \delta, \text{est} + \delta]$) based on personal historical variation. Communicates graded confidence rating (`low`, `moderate`, `high`) and mandatory medical/prediction disclaimer (not medical advice, no confirmed ovulation, no hormone claims, no contraception guidance).
  - **Data Sufficiency Guardrails:** Classified into 4 clinical levels (`none`, `insufficient`, `minimal`, `sufficient`). Prevents fabrication of statistics when completed cycles < 2.
- **Clinical Validation & Guardrails (`validatePeriodRecord`):**
  - Configurable clinical thresholds based on FIGO Menstrual Disorders Committee guidelines (`DEFAULT_CYCLE_THRESHOLDS`: normal cycle 21â€“35 days, normal period 2â€“8 days, max plausible duration 14 days, max cycle 90 days).
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

### Completed: Phase 3.3 â€” Calculation Validation & Prediction Refinement (Sprint 2B)
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
  - **Level 3 (`'sufficient'`, $\ge 3$ periods):** $\ge 2$ completed cycle intervals; average cycle length, range, and sample standard deviation ($s$) computable. Labeled **"Variation Calculable"** for 2â€“5 completed intervals. The 6+ completed intervals threshold is designated as **"More Tracking History Available"** as an *application-level reference* for longer tracking history, explicitly clarifying that it is not a clinically established threshold or a guarantee of predictive accuracy.
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
  - *Insights (`/insights`):* Enhanced sufficiency banner rendering 4-level badges (Level 0â€“3), contextual guidance ("Variation Calculable" vs "More Tracking History"), explicit application-level reference notice, and the non-diagnostic disclaimer.
  - *Calendar (`/calendar`):* Maintains synchronized state, date sidebar, and month navigation.
- **Sprint 2B Quality Gates & Verification:**
  - 46/46 Cycle Engine unit tests passing (`npm run test:cycle`).
  - 13/13 Admin Role Management regression tests passing (`npm run test:admin`).
  - 25/25 Manual browser interaction audit checks passing (`browser-audit.cjs`).
  - 0 TypeScript errors (`npx tsc --noEmit`).
  - 0 ESLint errors (`npm run lint`).
  - Clean Next.js 16 production build across all 14 routes (`npm run build`).

---

### Completed: Phase 3.3 â€” Complete Application Vercel Deployment
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
    - Schema: `id`, `date` (YYYY-MM-DD), `symptoms` (list of strings $\le 15$ items), `mood` (optional enum), `energy` (optional integer 1â€“5), `sleepHours` (optional number 0â€“24), `sleepQuality` (optional enum), `notes` (optional string $\le 2000$ chars), `createdAt`, `updatedAt`.
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

### Completed: Phase 4A â€” Isolated Blood Bank Foundation
- **Status:** Complete & Verified on branch eature/blood-bank-management (Commit: 5a6ead0eef6745463f8f8fd00bc19ee0c2248c3e).
- **Core Deliverables:**
  - Strict TypeScript models and constants in src/lib/blood-bank/types.ts and constants.ts.
  - Comprehensive runtime validation and transition matrix in alidation.ts.
  - Namespaced Firestore operations (loodBank/{centerId}/...) in irestore-service.ts.
  - Dedicated isolated dashboard with 7 modules and honest empty states in src/app/dashboard/blood-bank/.
  - Draft rules fragment in docs/phase-4/blood-bank-firestore-rules.fragment.
  - 103 new passing tests (63 validation + 40 emulator security), 0 regressions on 165 existing tests (268/268 total passing).
  - Next.js 16 production build clean across all 15 routes.

---

### Completed: Phase 4A.6 — Final Security Closure
- **Status:** Complete & Verified on branch `feature/blood-bank-management` (Commit: `aade955263a0bc19de9e0e8d8099542766bcd64a`).
- **Core Deliverables:**
  - Hardened `docs/phase-4/blood-bank-firestore-rules.fragment` closing Attack A (Cancellation Bypass), Attack B (Cross-Request Reuse), and Attack C (Unallocated Issue creation).
  - Extended security test suite with Category J (11 dedicated tests, 75/75 total passing).
  - Full 8-suite regression passing clean (0 errors).

---

### Completed: Phase 4A.7 — Inventory Creation & Lifecycle Security Closure
- **Status:** Complete & Verified on branch `feature/blood-bank-management` (Commit: `d6264ad3569842f45b4b7ced44b88abb4c757bd6`).
- **Core Deliverables:**
  - Hardened `match /inventory/{unitId}` `allow create` rule strictly to `request.resource.data.status == 'available'`.
  - Disallowed forged initial reservation/fulfillment metadata (`reservedForRequestId` must be absent or null).
  - Enforced donation provenance via `isValidInventoryDonation()`: donation exists in same center, screening passed (`tested_passed`), matching donor ID, matching blood group.
  - Implemented transactional validations in `createInventoryUnit()`.
  - Extended security suite with Category K (15 tests, 90/90 passing).
  - Clean 8-suite regression pass with 0 errors.

---

### Completed: Phase 4B — Shared Blood Bank Network
- **Status:** Complete & Verified on branch `feature/blood-bank-management`.
- **Core Deliverables:**
  - **Dual-Layer Privacy Model:** Physical units stay strictly inside `bloodBank/{centerId}/inventory/{unitId}` to protect donor privacy (`donorId`, `donationId`), accessible only to authorized `blood_bank` personnel. Public stock discovery by patients and doctors operates entirely via a sanitized, aggregate `availableStockSummary` projection published on `bloodBank/{centerId}`.
  - **Root-Level Network Namespace:** Shared cross-center requests coordinated at `/networkRequests/{requestId}` for targeted and shortage broadcast requests.
  - **Types & Runtime Validation:** Implemented `StockSummaryKey`, `AvailableStockSummary`, `BloodBankCenter`, `NetworkBloodRequest` in `types.ts`, and runtime validators `validateNetworkRequestPayload()` and `validateBloodBankCenterSummary()` in `validation.ts`.
  - **Hardened Security Rules:** Updated `docs/phase-4/blood-bank-firestore-rules.fragment` allowing public read of center directories, restricting summary updates to staff, enforcing strict requester UID and role integrity on network requests, and allowing authorized state transitions (cancel, convert, accept, reject).
  - **Transactional Service Layer:** Added `createNetworkBloodRequest()`, `acceptNetworkBloodRequest()` with atomic anti-collision reservation locks, `rejectNetworkBloodRequest()`, `cancelNetworkBloodRequest()`, `convertRejectedToBroadcast()`, `updateBloodBankCenterStockSummary()`, `fetchPublicBloodBankCenters()`, and `fetchNetworkBloodRequests()`.
  - **Exhibition Dataset (`src/lib/blood-bank/exhibition-data.ts`):** Created 4 verified regional centers, 4 sample network requests (emergency STAT broadcast, targeted request, reserved request, rejected request), and verified units tagged with `isExhibitionData: true`.
  - **Dashboard UI (`src/app/dashboard/blood-bank/components/NetworkTab.tsx`):** Integrated dedicated "Shared Network" tab with request filtering, emergency STAT alerts, unit selection modals, decline flow, center stock explorer, and one-click exhibition dataset seeding.
  - **Comprehensive Verification (334/334 Passing Assertions):**
    - `blood-bank-security.test.mjs`: 105/105 PASS (Categories A through L)
    - `blood-bank-distribution-integrity.test.mjs`: 26/26 PASS (Single-center & network anti-collision concurrency tests)
    - `blood-bank-validation.test.mjs`: 97/97 PASS (Suites 1 through 9)
    - `firestore-security.test.mjs`: 45/45 PASS
    - `menstrual-security.test.mjs`: 61/61 PASS
    - `npx tsc --noEmit`: 0 Errors
    - `npm run lint`: 0 Errors (5 pre-existing warnings in unrelated files preserved)
    - `npm run build`: Success across all 15 routes in Next.js 16.2.0 production build.
  - **Documentation:** Authored comprehensive report in `docs/phase-4/PHASE_4B_SHARED_NETWORK_REPORT.md`.

---

### Completed: Phase 4C — Production QA Remediation (8 Critical Defects Resolved)

#### 1. Scope & Verified Defects
Tested and confirmed 8 genuine issues identified during live QA testing of `https://medicore-ai-gules.vercel.app/`:
1. **Blood Bank Firestore Permissions**: Pure custom claim checking denied access for blood bank staff accounts lacking server-minted Auth claims.
2. **Appointment Date/Time State Reset**: Background auth state changes (`loading && !patientDoc`) caused `PatientDashboard` unmounting, wiping datetime form state; UTC ISO date string calculation invalidated local inputs.
3. **Patient Blood Request Persistence**: Querying root-level `/networkRequests` collection without an explicit `where('requesterUid', '==', currentUser.uid)` constraint caused Firestore rules rejection.
4. **Shortage Broadcast Datetime**: `toISOString().slice(0, 16)` generated UTC timestamps, defaulting `<input type="datetime-local">` to a past time in timezones ahead of UTC (e.g., IST).
5. **Donor DOB Validation & Missing Weight**: `validateDonorPayload` threw `BloodBankValidationError` whose field errors were swallowed by generic error string handlers; `weightKg` was missing from schema, types, rules, and UI.
6. **Pharmacist Expiry Validation**: `<input type="month">` rejected non-`YYYY-MM` formats from OCR text scanner (e.g., `"NOV 26"`, `"11/2026"`), breaking medicine additions.
7. **Admin Blood Bank Role Gap**: `ALLOWED_ADMIN_ROLES` in `/api/admin/users/route.ts` and `AdminDashboard.tsx` omitted `'blood_bank'`, preventing role assignment.
8. **Signup Validation Feedback**: `SignupPage` lacked client-side email format validation, `minLength={6}` for passwords, and specific inline error displays.

#### 2. Technical Remediation Actions
- **`firestore.rules`**:
  - Enhanced `hasRole(roleName)` with a fallback to verified `/users/{uid}.role` profile projection when custom claims have not yet propagated.
  - Added `weightKg` to `match /donors/{donorId}` allowed keys and validation rule (`weightKg >= 30 && weightKg <= 250`).
  - Deployed to `medicore-ai-exhibition` production.
- **`src/lib/blood-bank/firestore-service.ts`**:
  - Updated `fetchNetworkBloodRequests` to construct `query(reqsRef, where('requesterUid', '==', filter.requesterUid))` when filtered by requester UID.
- **`src/app/dashboard/PatientDashboard.tsx`**:
  - Fixed loading guard to `if (loading && !patientDoc)` to prevent unmounting and input state wipe.
  - Replaced generic 3-field alert with granular field error indicators.
  - Localized `min` attribute on date picker.
- **`src/app/dashboard/patient/components/PatientBloodPortal.tsx`**:
  - Implemented `formatLocalDatetime(d)` to populate local timezone wall-clock time for required-by dates (+24h targeted, +12h broadcast).
- **`src/app/dashboard/pharmacist/page.tsx`**:
  - Implemented `normalizeExpiryToYearMonth(raw)` parsing `YYYY-MM`, `MM/YYYY`, `MM/YY`, and month abbreviations (`"NOV 26"` -> `"2026-11"`).
  - Wired into manual medicine addition and OCR result extraction.
- **`src/lib/blood-bank/types.ts` & `src/lib/blood-bank/validation.ts`**:
  - Added `weightKg?: number` to `BloodDonor`.
  - Added range check (30–250 kg) and clinical deferral check (<50 kg must be deferred) to `validateDonorPayload`.
- **`src/app/dashboard/blood-bank/components/DonorsTab.tsx`**:
  - Added `weightKg` to form state, payload submit, and table display.
  - Unpacked `fieldErrors` from `BloodBankValidationError` for granular, actionable user feedback.
- **`src/app/api/admin/users/route.ts` & `src/app/dashboard/AdminDashboard.tsx`**:
  - Added `'blood_bank'` to `ALLOWED_ADMIN_ROLES` and `roleWeight`.
  - Added `<option value="blood_bank">Blood Bank Staff</option>` and styled badge in `AdminDashboard.tsx`.
- **`src/app/signup/page.tsx`**:
  - Added email regex validation, password `minLength={6}`, inline field errors, and Firebase error code translation.
- **Production Build & Verification**:
  - `npx tsc --noEmit`: 0 Errors.
  - `npm run lint`: 0 Errors.
  - `npm run build`: Successful compilation across all 18 routes.

---

### Local Architecture: Admin User Access, Real-Time Presence & Activity Log (`/admin/user-log`)

- **Scope:** Dedicated standalone backend HTML view and API route designed strictly for local testing/administration (held offline from remote Git and Vercel production as explicitly instructed).
- **Security & Authorization:**
  - Strictly restricted to users with `role: 'admin'` (authenticated Custom Claim or verified Firestore role).
  - Unauthenticated requests or non-admin users (e.g. patients, doctors, pharmacists, blood bank staff) receive an immediate `403 Forbidden` response.
- **Real-Time Presence & Interaction Tracking Architecture:**
  - `src/components/PresenceTracker.tsx`: Client-side tracker mounted within root `Providers` (`src/app/providers.tsx`), running automatically for any logged-in user across all dashboards (patient, doctor, pharmacist, blood-bank, admin).
    - **Live Interaction & Scroll Monitor:** Throttled listeners on `scroll`, `click`, `mousemove`, `keydown` keep `lastSeenAt` fresh and record the user's active interaction type (`scroll`, `click`, etc.).
    - **Heartbeat:** 20-second background heartbeat pings Firestore while tab is active and visible.
    - **Exit & Tab Switch Detection:** `visibilitychange` (`hidden`) and `beforeunload` calculate session duration and trigger `navigator.sendBeacon('/api/presence/beacon')` to record session finish and set `isOnline: false`.
    - **Resumption:** When user refocuses the tab, a new session start window is established.
  - `src/app/api/presence/beacon/route.ts`: Receives beacon payloads via Firebase Admin SDK, setting `isOnline: false`, `lastSeenAt`, `lastSessionEndedAt`, calculating `lastSessionDurationSec`, and incrementing cumulative `totalTimeSpentSec`.
  - `src/lib/auth.js`: Updated `login()` to track `lastLoginAt` and `logout()` to immediately set `isOnline: false` before Firebase Auth session teardown.
- **Backend Admin API & Standalone HTML View:**
  - `src/app/api/admin/user-log/route.ts`:
    - Evaluates live presence: User is `Online` if marked `isOnline` AND `(now - lastSeenAt) < 45 seconds`; otherwise evaluated as `Offline`.
    - Computes active time window ("From [time] -> Active Now / [end time]") and formatted duration.
    - Tracks total cumulative time spent in role (`totalTimeSpentSec` formatted as hours, minutes, seconds).
    - Supports sorting by: `online_first`, `total_time`, `last_signin`, `signup`.
    - Supports filtering by presence: `all`, `online_only`, `offline_only`.
    - When `?format=html` is supplied, renders a styled standalone HTML page with live auto-refresh toggle (10s), export/print capabilities, and color-coded role and presence badges.
- **Admin Management Console UI:**
  - `src/app/admin/user-log/page.tsx`:
    - Live presence counter (Active Users Online, Users Offline, Total Registered).
    - Sort toggles (`Online First`, `Total Time`, `Sign-In`).
    - Presence filter tabs (`All`, `Online Only`, `Offline Only`).
    - Interactive search across name, email, UID, and role.
    - Configurable 10-second auto-refresh polling.
    - One-click launcher to open the raw backend HTML view in a new tab.
  - `src/app/dashboard/AdminDashboard.tsx`: Direct navigation button `"Sign-In & Activity Log (HTML)"` in the Admin header.

- **Inactivity Session Timeout (10 Minutes):**
  - **Component:** `src/components/SessionTimeoutManager.tsx` mounted globally in `src/app/providers.tsx`.
  - **Specification:** Automatically terminates session if no user activity (`mousemove`, `mousedown`, `keydown`, `scroll`, `touchstart`, `click`) occurs for 10 consecutive minutes (600,000 ms).
  - **Cross-Tab & Refresh Persistence:** Synchronizes `medicore_last_activity` epoch timestamp in `localStorage` across tabs via `window.addEventListener('storage', ...)`.
  - **Graceful Redirection & Notice:** On expiration, calls `logout()`, cleans localStorage, and redirects to `/login?reason=session_expired`. The sign-in page displays a security notice notifying the user that their session expired due to 10 minutes of inactivity.

---

### Completed: Phase 3 — Firebase Realtime Database (RTDB) Presence & Activity Monitoring Migration

- **Core Motivation & Quota Optimization:**
  - Migrated high-frequency presence heartbeats and session activity tracking completely off Cloud Firestore to Firebase Realtime Database (RTDB).
  - Cloud Firestore free tier imposes a strict 50,000 reads / 20,000 writes daily quota, which was previously exhausted by frequent telemetry writes (`8 RESOURCE_EXHAUSTED`).
  - RTDB provides unlimited read/write operations on the Spark free tier (constrained only by 10 GB bandwidth/month and 100 simultaneous connections), completely eliminating quota errors.

- **Infrastructure & Dual-Database Architecture:**
  - **Firestore (Default, `asia-south1` Mumbai):** Preserved 100% intact for patient medical records, clinical timelines, appointments, pharmacist inventory, blood bank management, and menstrual cycle tracking.
  - **RTDB (`medicore-ai-exhibition-default-rtdb`, `asia-southeast1` Singapore):** Dedicated exclusively to ephemeral multi-tab presence (`/presence`) and aggregated session activity (`/activity`).
  - **Client Initialization (`src/lib/firebase.js`):** Exports `rtdb = getDatabase(app)` configured with `NEXT_PUBLIC_FIREBASE_DATABASE_URL`.
  - **Admin SDK Initialization (`src/lib/firebaseAdmin.ts`):** Exports `adminRtdb = getDatabase(adminApp)` with `databaseURL` configured across all credential pathways (ADC and Service Account).

- **Strict RTDB Security Rules (`database.rules.json`):**
  - `/presence/$uid/$connectionKey`: Owner-only write (`auth != null && auth.uid === $uid`), read allowed for owner and admins (`auth.token.role === 'admin'`).
  - `/activity/$uid`: Client write strictly denied (`.write: false`), ensuring all login/logout metrics, timestamps, and accumulated durations are written solely by the trusted Admin SDK backend. Read allowed for owner and admins.

- **Trusted Session Management API (`/api/presence/session`):**
  - Authenticates user via Firebase Auth ID token (Bearer).
  - Handles 4 lifecycle actions: `login`, `activity` (heartbeat), `logout`, and `timeout`.
  - Derives server timestamps and connection keys (`conn_${timestamp}_${random}`).
  - Tracks accumulated time in role (`totalTimeSpentSeconds`) across sessions.
  - Distinguishes intentional sign-outs (`explicit_logout`), session expiration (`inactivity_timeout`), and connection drops (`connection_drop`).

- **Client Presence Lifecycle (`src/components/PresenceTracker.tsx`):**
  - On mount, requests trusted connection key from `/api/presence/session`.
  - Attaches RTDB `onDisconnect(connectionRef).remove()` so unexpected browser/tab closes automatically prune the active connection key.
  - Emits throttled activity heartbeats every 60 seconds (only when tab is active and visible).
  - Multi-tab support: Each open tab possesses its own connection key under `/presence/{uid}/{connectionKey}`. Closing one tab keeps the user `online` as long as other tabs remain open; status shifts to `offline` only when all keys are removed.

- **Admin User Monitoring UI & API (`/admin/user-log`):**
  - **60-Second Background Polling:** Refreshes data without full-page reloads, non-disruptive to user interaction.
  - **Visibility Awareness:** Polling automatically pauses when the browser tab is hidden/minimized and executes an immediate refresh as soon as the tab becomes visible again.
  - **State Retention:** Preserves active search terms, presence filters (`All`, `Online`, `Offline`), column sorting, and pagination across all refreshes.
  - **Manual Refresh:** Interactive button with animated spinner and "Last updated" time-ago indicator.
  - **HTML View:** Server-rendered fallback at `/api/admin/user-log?format=html` with aligned 60s auto-refresh toggle.

- **Verification & Zero-Regression Certification:**
  - `npx tsc --noEmit`: 0 TypeScript errors.
  - `npm run lint`: 0 ESLint errors.
  - `npm run build`: Production build cleanly compiled across all 22 static and dynamic routes.
  - `npm run test:admin`: 13/13 passing.
  - `npm run test:cycle`: 46/46 passing.
  - `tests/rtdb-presence-activity.test.mjs`: 23/23 comprehensive integration assertions passing against live RTDB.

---

### Completed: Phase 3.1 — RTDB Spark-Compatible Race Remediation & Registration Hardening
- **Generation Guard & Disconnect Inversion:** Introduced `connectionGeneration` counter and 2-phase reservation flow (`reserve_connection` + `activate_connection`). Client registers `onDisconnect().remove()` prior to presence creation.

---

### Completed: Phase 3.5 — Strict Connection Generation Validation & Tri-State Presence Semantics
- **Fix 1: Strict Connection Generation Validation (`src/lib/rtdbSession.ts`):**
  - Authoritative generation established in Phase A is recorded immutably in `current.pendingActivations[connectionKey].connectionGeneration`.
  - Phase B writes `connectionGeneration: newGeneration` into the actual RTDB presence record under `/presence/{uid}/{connectionKey}`.
  - Phase C registers the exact authoritative generation in `/activity/{uid}/verifiedConnections/{connectionKey}`.
  - `validateUserPresence()` enforces strict generation validation:
    1. Presence record `connectionGeneration` must be a valid positive integer.
    2. Registry entry `connectionGeneration` must be a valid positive integer.
    3. Presence generation must strictly equal registry generation.
    4. Registry generation must not exceed `activity.connectionGeneration` or precede `activity.sessionStartGeneration`.
  - Multi-tab and multi-device sessions are preserved: older valid tabs in the same session remain valid because their generation satisfies `sessionStartGeneration <= regGen <= connectionGeneration`.
- **Fix 2: Separation of Pending Activation from Confirmed Online (`src/lib/rtdbSession.ts`, `src/app/api/admin/user-log/route.ts`, `src/app/admin/user-log/page.tsx`):**
  - `isOnline` strictly requires at least 1 verified connection and online activity status.
  - Introduced explicit `presenceStatus: 'online' | 'pending' | 'offline'`.
  - Admin API returns `presenceStatus` and preserves reconciliation protections against in-flight activations via `hasPendingActivation`.
  - Admin UI displays `PENDING` (with amber badge and "connecting...") when an active lease exists without confirmed presence; never fabricates an active tab count.
  - HTML fallback view renders `PENDING (connecting...)` for pending-only records.
- **Verification & Zero-Regression Certification:**
  - `tests/rtdb-pending-activation.test.mjs`: **51/51 PASSED** (All 12 focused regression tests for generation and status semantics passing).
  - `tests/rtdb-emulator.test.mjs`: **8/8 PASSED** against local RTDB emulator.
  - `npm run test:admin`: **13/13 PASSED**.
  - `npm run test:cycle`: **46/46 PASSED**.
  - `npx tsc --noEmit`: **0 errors**.
  - `npm run lint`: **0 errors**.
  - `npm run build`: **22/22 routes cleanly compiled**.
- **Vercel Production Deployment:**
  - Production URL: `https://medicore-ai-gules.vercel.app`
  - Deployment ID: `dpl_2WGULAG2uccFQRYarQ8WrCFhgV7Y`
  - Verified live serving HTTP 200 with full SSR/Client hydration.
  - Spark Free tier ($0/month) strictly preserved with environment variables `NEXT_PUBLIC_FIREBASE_DATABASE_URL` and `FIREBASE_DATABASE_URL` configured on Vercel.

---

### Completed: Phase 3.6 — Multi-Layer Session Inactivity Timeout Remediation across Browser Restarts & Inactivity
- **Problem Remediation:**
  - Users returning after prolonged inactivity (> 10 minutes) or next-day browser restarts remained logged in due to persistent Firebase Auth IndexedDB tokens and missing last-activity verification during auth restoration.
  - In `SessionTimeoutManager.tsx`, a race condition allowed `recordActivity()` to immediately overwrite an expired `medicore_last_activity` timestamp before `triggerInactivityLogout()` could finalize, causing sessions to remain active.
  - In `LoginPage.tsx`, automatic role-based redirect inadvertently bounced expired sessions back to dashboard routes before sign-out could complete.
- **Architectural Enhancements:**
  1. **Auth Restoration Gate (`src/lib/auth.js`):** On Firebase Auth `onAuthStateChanged`, inspects `localStorage` last-activity timestamp and token `auth_time`. If elapsed time exceeds `INACTIVITY_TIMEOUT_MS` (600,000 ms / 10 minutes), immediately forces `firebaseSignOut(auth)`, clears storage, and redirects to `/login?reason=session_expired` without mounting dashboard views.
  2. **Timestamp Seeding (`src/lib/auth.js`):** `login()` and `signup()` proactively seed `medicore_last_activity` in `localStorage` upon credential authentication.
  3. **Inactivity Lock & Hard Navigation (`src/components/SessionTimeoutManager.tsx`):** `recordActivity()` strictly respects `isLoggingOutRef` to prevent overwriting expired timestamps. `checkInactivity()` returns boolean status to gate event handlers, and `triggerInactivityLogout()` uses clean full-page navigation to `/login?reason=session_expired`.
  4. **Auto-Redirect Prevention (`src/app/login/page.tsx`):** If URL query param `reason=session_expired` is present, disables auto-redirecting to dashboard, displaying the session expiration security notice.
- **Verification & Safeguards:**
  - Preserved 600,000 ms (10-minute) inactivity timeout requirement.
  - Preserved Spark Free compatibility ($0/month).
  - Preserved Blood Bank, Menstrual Cycle, and Admin Role systems intact.

---

### Completed: Phase 3.8 — Final Independent Verification & Multi-Tab / Multi-Session Logout Safety
- **Git & Security Audit:**
  - Verified active branch `feature/rtdb-activity-monitoring` and HEAD `c32bf8993c21c11628cf2529c6a3120a4cd3f8ae`.
  - Audited `database.rules.json` and `firebase.json`: verified client write restrictions (`!newData.exists()`) limiting client socket access to deletions on disconnect; server Admin SDK handles writes.
  - Zero unapproved commits, zero pushes, and zero production rule deployments.
- **Multi-Tab & Multi-Session Logout Hardening:**
  - Updated `/api/presence/session/route.ts` with session-fenced presence and registry removal.
  - When `connectionKey` or `targetSessionId` is supplied, cleanup only removes nodes matching `record.sessionId === targetSessionId`. Other concurrent sessions (e.g., Session B on another device/browser) remain completely untouched and online.
  - `finalizeUserSessionAtomic` checks Concurrency Guard C (`targetSessionId === current.activeSessionId`), preventing an older or separate session's logout from terminating a newer or distinct active session.
  - Single-tab closing safely removes only that connection key via client socket disconnect or teardown, leaving remaining tabs for that session online.
  - In `src/lib/auth.js` and `SessionTimeoutManager.tsx`, tab metadata (`connectionKey` and `sessionId`) is extracted from `sessionStorage` and passed in logout/timeout payloads for precise fencing.
- **Heartbeat Interval & Inactivity Timeout Independence:**
  - Verified 60-second heartbeat interval in `PresenceTracker.tsx` and 120-second stale detection threshold in `validateUserPresence()`. Temporary network delays up to 120s do not drop active tabs.
  - Verified that the 600,000 ms (10-minute) inactivity timeout in `SessionTimeoutManager.tsx` and `AuthProvider` remains 100% independent of connection heartbeats.
- **Comprehensive Verification Results:**
  - `tests/auth-presence-remediation.test.mjs`: **15/15 PASSED** (including multi-tab survival, all-tabs reconciliation, and session-fenced logout isolation).
  - `tests/rtdb-pending-activation.test.mjs`: **51/51 PASSED**.
  - `tests/rtdb-emulator.test.mjs`: **8/8 PASSED** against native Firebase RTDB emulator.
  - `npm run test:admin`: **13/13 PASSED**.
  - `npm run test:cycle`: **46/46 PASSED**.
  - `npx tsc --noEmit`: **0 errors**.
  - `npm run lint`: **0 errors** (0 errors, 6 benign warnings).
  - `npm run build`: **22/22 routes cleanly compiled** (production Next.js 16 build passed).

---

### Completed: Phase 3.9 — Admin User-Log Monitoring Remediation & Login Presence De-confliction
- **Root Cause Remediation:**
  1. **Legacy `action === 'login'` Rogue Presence Bug:** In `src/lib/auth.js`, `login()` called `fetch('/api/presence/session', { body: JSON.stringify({ action: 'login' }) })`. In `/api/presence/session/route.ts`, this wrote an unverified presence node without `activationId`, without `connectionGeneration`, and without registering in `activity.verifiedConnections`.
  2. **Premature Auto-Reconciliation in `/api/admin/user-log`:** When an admin loaded or polled `/admin/user-log`, `validateUserPresence` evaluated the unverified connection node as stale (`validConnectionsCount === 0`, `isOnline === false`). Because `userActivity.currentStatus === 'online'`, the endpoint immediately triggered `finalizeUserSessionAtomic` with reason `connection_lost`, killing newly logged in user sessions within 3-12 seconds of login.
  3. **In-Flight Connection Vulnerability:** During page navigation from `/login` to `/dashboard`, the 3-phase activation handshake was interrupted or preemptively finalized by admin polling before `<PresenceTracker />` could commit Phase C.
- **Implementation & Architectural Safeguards:**
  1. **Removed Legacy Login Fetch (`src/lib/auth.js`):** Eliminated the redundant `fetch('/api/presence/session', { body: JSON.stringify({ action: 'login' }) })` call from `login()`. `<PresenceTracker />` in `Providers` remains the single authoritative source of connection reservation, socket hook attachment, and verified activation.
  2. **Backward-Compatible Route Hardening (`src/app/api/presence/session/route.ts`):** Hardened `action === 'login' || action === 'connect'` so that if ever called directly, it atomically generates an `activationId`, synchronizes `connectionGeneration`, registers in `verifiedConnections`, and writes conformant metadata to `/presence/{uid}/{connectionKey}`.
  3. **Auto-Reconciliation 60-Second Grace Period (`src/app/api/admin/user-log/route.ts`):** Guarded `finalizeUserSessionAtomic` with `!isRecentActivity` (`nowEpoch - lastActivityEpoch >= 60000` and `nowEpoch - lastLoginEpoch >= 60000`). Newly authenticated users or users navigating between pages are never prematurely finalized as `connection_lost`.
  4. **Production RTDB Zombie Node Cleanup:** Purged historical unverified presence nodes (`activationId: undefined`) from the live database.
  5. **Activation Confirmation Mismatch Fix (`src/components/PresenceTracker.tsx` & `src/app/api/presence/session/route.ts`):** Resolved response payload mismatch where `/api/presence/session` returned `{ success: true }` without explicitly setting `activated: true`. In `PresenceTracker.tsx`, `if (!isSubscribed || !activateResult?.activated)` evaluated to true on every activation, triggering an immediate compensating `remove(clientConnRef)` that deleted the freshly verified presence node and aborted connection state. Standardized server response with `{ success: true, activated: true }` and client condition `Boolean(activateResult && (activateResult.activated || activateResult.success))`.
- **Verification & Safeguards:**
  - Spark Free tier ($0/month) strictly preserved with zero runtime Cloud Functions.
  - 10-minute inactivity timeout strictly preserved.
  - Zero regressions across Admin role management, Menstrual tracking, and Blood Bank subsystems.










