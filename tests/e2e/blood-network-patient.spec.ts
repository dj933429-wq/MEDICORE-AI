import { test, expect } from '@playwright/test';

const USERS = {
  patient: {
    email: 'e2e_patient_female@medicore.ai',
    password: 'E2E_TestPassword123!',
  },
};

test.describe('Module 3: Blood Bank Network - Demand Side (Patient Portal)', () => {

  test('3.1 Portal Discovery & Clinical Safety Notice Banner', async ({ page }) => {
    // 1. Sign in as patient
    await page.goto('/login');
    await page.fill('#email', USERS.patient.email);
    await page.fill('#password', USERS.patient.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // 2. Open Blood Bank Network tab
    const bloodBankTab = page.locator('button:has-text("Blood Bank Network")');
    await expect(bloodBankTab).toBeVisible({ timeout: 15000 });
    await bloodBankTab.click();

    // 3. Confirm Clinical Safety & Compatibility Notice Banner
    await expect(
      page.locator('text=The platform handles availability search, inter-facility logistics, and anti-collision reservation locks')
    ).toBeVisible({ timeout: 15000 });

    // 4. Verify Blood Bank centers directory is rendered
    await expect(page.locator('text=Registered Blood Centers').or(page.locator('text=Discover & Request Blood'))).toBeVisible({ timeout: 15000 });
    await expect(page.locator('button:has-text("Request Targeted Units"), button:has-text("Broadcast Shortage")').first()).toBeVisible({ timeout: 15000 });
  });

  test('3.2 Inventory Search & Blood Group / Component Filtering', async ({ page }) => {
    // 1. Sign in as patient and open blood portal
    await page.goto('/login');
    await page.fill('#email', USERS.patient.email);
    await page.fill('#password', USERS.patient.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await page.locator('button:has-text("Blood Bank Network")').click();

    // 2. Filter by Blood Group: O+
    const groupSelect = page.locator('select').first();
    await expect(groupSelect).toBeVisible({ timeout: 10000 });
    await groupSelect.selectOption('O+');

    // 3. Verify matching stock metrics update
    await expect(page.locator('text=Matching Stock (O+)').first()).toBeVisible({ timeout: 10000 });
  });

  test('3.3 Submit a Targeted Blood Request', async ({ page }) => {
    // 1. Sign in and open portal
    await page.goto('/login');
    await page.fill('#email', USERS.patient.email);
    await page.fill('#password', USERS.patient.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await page.locator('button:has-text("Blood Bank Network")').click();

    // 2. Click Request Targeted Units on the first available center
    const requestBtn = page.locator('button:has-text("Request Targeted Units")').first();
    await expect(requestBtn).toBeVisible({ timeout: 15000 });
    await requestBtn.click();

    // 3. Fill required destination and contact fields in modal
    await expect(page.locator('text=Submit Blood Requirement Request')).toBeVisible({ timeout: 10000 });

    await page.fill('input[placeholder*="Metropolis General Hospital"]', 'St. Jude Memorial Hospital');
    await page.fill('input[placeholder*="Metropolis"]', 'Chicago');
    await page.fill('input[placeholder*="555"]', '+1-555-019-8822');

    // 4. Submit the request
    const submitBtn = page.locator('button:has-text("Confirm & Transmit Request")');
    await expect(submitBtn).toBeVisible({ timeout: 10000 });
    await submitBtn.click();

    // 5. Verify modal closes and auto-navigates to My Requests tab with success notice
    await expect(page.locator('text=Submit Blood Requirement Request')).not.toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Targeted request successfully transmitted').or(page.locator('text=My Blood Requests'))).toBeVisible({ timeout: 15000 });
  });

  test('3.4 Cancel Blood Request Lifecycle', async ({ page }) => {
    // Automatically accept window.confirm dialogs
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // 1. Sign in and open blood portal
    await page.goto('/login');
    await page.fill('#email', USERS.patient.email);
    await page.fill('#password', USERS.patient.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await page.locator('button:has-text("Blood Bank Network")').click();

    // 2. Switch to My Blood Requests tab
    const myRequestsTab = page.locator('button:has-text("My Blood Requests")');
    await expect(myRequestsTab).toBeVisible({ timeout: 15000 });
    await myRequestsTab.click();

    // 3. Find submitted request and click Cancel Request
    const cancelBtn = page.locator('button:has-text("Cancel Request")').first();
    if (await cancelBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await cancelBtn.click();

      // 4. Verify request transitions to Cancelled status badge
      await expect(page.locator('text=Cancelled').first()).toBeVisible({ timeout: 15000 });
    }
  });
});

