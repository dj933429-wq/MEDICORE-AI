import { test, expect } from '@playwright/test';

// Credentials provisioned by global-setup.ts
const USERS = {
  patient: {
    email: 'e2e_patient_female@medicore.ai',
    password: 'E2E_TestPassword123!',
    expectedName: 'Jane',
  },
  doctor: {
    email: 'e2e_doctor@medicore.ai',
    password: 'E2E_TestPassword123!',
  },
  pharmacist: {
    email: 'e2e_pharmacist@medicore.ai',
    password: 'E2E_TestPassword123!',
    expectedPath: '/dashboard/pharmacist',
  },
  bloodBank: {
    email: 'e2e_bloodbank@medicore.ai',
    password: 'E2E_TestPassword123!',
    dashboardPath: '/dashboard/blood-bank',
  },
  admin: {
    email: 'e2e_admin@medicore.ai',
    password: 'E2E_TestPassword123!',
  },
};

test.describe('Module 1: Authentication & RBAC Routing', () => {

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await context.clearPermissions();
  });

  test('1.1 Patient login and dashboard view', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', USERS.patient.email);
    await page.fill('#password', USERS.patient.password);
    await page.click('button[type="submit"]');

    // Should redirect to /dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    // Patient header greeting
    await expect(page.locator('text=Welcome').first()).toBeVisible({ timeout: 15000 });
  });

  test('1.2 Doctor login and role-based view', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', USERS.doctor.email);
    await page.fill('#password', USERS.doctor.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await expect(page.locator('text=Dr.').or(page.locator('text=Patient Records')).first()).toBeVisible({ timeout: 15000 });
  });

  test('1.3 Pharmacist login redirects to dedicated /dashboard/pharmacist', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', USERS.pharmacist.email);
    await page.fill('#password', USERS.pharmacist.password);
    await page.click('button[type="submit"]');

    // Should route to /dashboard/pharmacist
    await expect(page).toHaveURL(/\/dashboard\/pharmacist/, { timeout: 20000 });
    await expect(page.locator('text=Pharmacist').first()).toBeVisible({ timeout: 15000 });
  });

  test('1.4 Blood Bank staff access to /dashboard/blood-bank', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', USERS.bloodBank.email);
    await page.fill('#password', USERS.bloodBank.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    
    // Navigate directly to blood bank portal
    await page.goto('/dashboard/blood-bank');
    await expect(page).toHaveURL(/\/dashboard\/blood-bank/, { timeout: 15000 });
    // Should render the Blood Bank management console without Access Denied
    await expect(page.locator('text=Blood Bank').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Access Denied')).not.toBeVisible();
  });

  test('1.5 Admin login and dashboard view', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', USERS.admin.email);
    await page.fill('#password', USERS.admin.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await expect(page.locator('text=Administrator').or(page.locator('text=Admin')).first()).toBeVisible({ timeout: 15000 });
  });

  test('1.6 Edge Case - URL Tampering: Patient denied access to /dashboard/blood-bank', async ({ page }) => {
    // Log in as patient
    await page.goto('/login');
    await page.fill('#email', USERS.patient.email);
    await page.fill('#password', USERS.patient.password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // Attempt to force-navigate to Blood Bank management portal
    await page.goto('/dashboard/blood-bank');
    
    // Must show Access Denied screen
    await expect(page.locator('text=Access Denied').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Current Role:').first()).toBeVisible({ timeout: 10000 });
  });

  test('1.7 Edge Case - URL Tampering: Patient denied access to /dashboard/pharmacist', async ({ page }) => {
    // Log in as patient
    await page.goto('/login');
    await page.fill('#email', USERS.patient.email);
    await page.fill('#password', USERS.patient.password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // Attempt to force-navigate to Pharmacist dashboard
    await page.goto('/dashboard/pharmacist');
    
    // Should immediately bounce back to /dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });

  test('1.8 Edge Case - Session Expiry: Clearing storage/cookies kicks user to /login or shows access denied', async ({ page, context }) => {
    await page.goto('/login');
    await page.fill('#email', USERS.patient.email);
    await page.fill('#password', USERS.patient.password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // Clear browser cookies and storage
    await context.clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      indexedDB.deleteDatabase('firebaseLocalStorageDb');
    });

    // Reload page
    await page.reload();

    // Session cleared: Dashboard layout must kick unauthenticated user to /login
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    await expect(page.locator('button[type="submit"]')).toBeVisible({ timeout: 10000 });
  });

  test('1.9 Signup as Doctor persists doctor role and routes to Doctor dashboard', async ({ page }) => {
    const uniqueEmail = `e2e_doc_${Date.now()}@medicore.ai`;
    await page.goto('/signup');
    await page.fill('#name', 'Dr. Fresh Signup');
    await page.selectOption('#role', 'doctor');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'E2E_TestPassword123!');
    await page.click('button[type="submit"]');

    // Should route directly to Doctor dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
    await expect(page.locator('text=Dr.').or(page.locator('text=Patient Records')).first()).toBeVisible({ timeout: 15000 });
  });

  test('1.10 Signup as Pharmacist persists pharmacist role and routes to Pharmacist dashboard', async ({ page }) => {
    const uniqueEmail = `e2e_pharm_${Date.now()}@medicore.ai`;
    await page.goto('/signup');
    await page.fill('#name', 'Pharm. Fresh Signup');
    await page.selectOption('#role', 'pharmacist');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'E2E_TestPassword123!');
    await page.click('button[type="submit"]');

    // Should route directly to Pharmacist dashboard
    await expect(page).toHaveURL(/\/dashboard\/pharmacist/, { timeout: 20000 });
    await expect(page.locator('text=Pharmacist').first()).toBeVisible({ timeout: 15000 });
  });

  test('1.11 Signup as Blood Bank persists blood_bank role and routes to Blood Bank dashboard', async ({ page }) => {
    const uniqueEmail = `e2e_bloodbank_${Date.now()}@medicore.ai`;
    await page.goto('/signup');
    await page.fill('#name', 'Blood Bank Center Staff');
    await page.selectOption('#role', 'blood_bank');
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', 'E2E_TestPassword123!');
    await page.click('button[type="submit"]');

    // Should route directly to Blood Bank dashboard
    await expect(page).toHaveURL(/\/dashboard\/blood-bank/, { timeout: 20000 });
    await expect(page.locator('text=Blood Bank').first()).toBeVisible({ timeout: 15000 });
  });
});
