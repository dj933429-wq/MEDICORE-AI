import { test, expect } from '@playwright/test';

const USERS = {
  femalePatient: {
    email: 'e2e_patient_female@medicore.ai',
    password: 'E2E_TestPassword123!',
  },
  malePatient: {
    email: 'e2e_patient_male@medicore.ai',
    password: 'E2E_TestPassword123!',
  },
};

test.describe('Module 2: Menstrual Health Tracker', () => {

  test('2.1 Female patient clean empty state & overview access', async ({ page }) => {
    // 1. Sign in as female patient
    await page.goto('/login');
    await page.fill('#email', USERS.femalePatient.email);
    await page.fill('#password', USERS.femalePatient.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // 2. Locate and click Menstrual Health Tracker link
    const trackerLink = page.locator('a[href="/dashboard/menstrual-health"]');
    await expect(trackerLink).toBeVisible({ timeout: 15000 });
    await trackerLink.click();

    // 3. Confirm transition to /dashboard/menstrual-health
    await expect(page).toHaveURL(/\/dashboard\/menstrual-health/, { timeout: 15000 });

    // 4. Verify clean slate: empty cycle status (no mock data fallback)
    await expect(
      page.locator('text=No Active Cycle')
        .or(page.locator('text=Welcome to your menstrual wellness tracker'))
        .first()
    ).toBeVisible({ timeout: 15000 });

    // Verify Action buttons are available
    await expect(page.locator('button:has-text("Log Period")').first()).toBeVisible({ timeout: 10000 });
  });

  test('2.2 Daily status logging via modal', async ({ page }) => {
    // 1. Sign in as female patient
    await page.goto('/login');
    await page.fill('#email', USERS.femalePatient.email);
    await page.fill('#password', USERS.femalePatient.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await page.goto('/dashboard/menstrual-health');
    await expect(page).toHaveURL(/\/dashboard\/menstrual-health/, { timeout: 15000 });

    // 2. Open quick log modal
    const logButton = page.locator('button:has-text("Record Today\'s Symptoms"), button:has-text("Log Period")').first();
    await expect(logButton).toBeVisible({ timeout: 10000 });
    await logButton.click();

    // 3. Select flow intensity and save
    const mediumFlowBtn = page.locator('button:has-text("Medium")').first();
    if (await mediumFlowBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await mediumFlowBtn.click();
    }

    const saveButton = page.locator('button:has-text("Save Entry"), button:has-text("Save")').first();
    await expect(saveButton).toBeVisible({ timeout: 10000 });
    await saveButton.click();

    // Modal should close
    await expect(saveButton).not.toBeVisible({ timeout: 10000 });
  });

  test('2.3 Calendar, Log, and Insights sub-view navigation', async ({ page }) => {
    // 1. Sign in as female patient
    await page.goto('/login');
    await page.fill('#email', USERS.femalePatient.email);
    await page.fill('#password', USERS.femalePatient.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // 2. Test Calendar navigation
    await page.goto('/dashboard/menstrual-health/calendar');
    await expect(page).toHaveURL(/\/dashboard\/menstrual-health\/calendar/, { timeout: 15000 });
    await expect(page.locator('text=Calendar').first()).toBeVisible({ timeout: 15000 });

    // 3. Test Daily Log page navigation
    await page.goto('/dashboard/menstrual-health/log');
    await expect(page).toHaveURL(/\/dashboard\/menstrual-health\/log/, { timeout: 15000 });
    await expect(page.locator('text=Daily Wellness').or(page.locator('text=Cycle Log')).first()).toBeVisible({ timeout: 15000 });

    // 4. Test Insights navigation
    await page.goto('/dashboard/menstrual-health/insights');
    await expect(page).toHaveURL(/\/dashboard\/menstrual-health\/insights/, { timeout: 15000 });
    await expect(page.locator('text=Insights').or(page.locator('text=Analytics')).first()).toBeVisible({ timeout: 15000 });
  });

  test('2.4 Male patient gate enforcement: Hidden UI and direct URL redirect', async ({ page }) => {
    // 1. Sign in as male patient
    await page.goto('/login');
    await page.fill('#email', USERS.malePatient.email);
    await page.fill('#password', USERS.malePatient.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // 2. In Patient Dashboard, Menstrual Health Tracker button must NOT be present
    const trackerLink = page.locator('a[href="/dashboard/menstrual-health"]');
    await expect(trackerLink).not.toBeVisible();

    // 3. Attempt direct URL navigation to /dashboard/menstrual-health
    await page.goto('/dashboard/menstrual-health');

    // 4. Guard should intercept: either show Module Restricted or bounce to /dashboard
    await expect(
      page.locator('text=Module Restricted')
        .or(page.locator('text=Redirecting to dashboard'))
        .first()
    ).toBeVisible({ timeout: 10000 }).catch(() => {
      // If immediate redirect, URL is /dashboard
    });

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15000 });
  });
});

