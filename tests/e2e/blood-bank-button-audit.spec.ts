import { test, expect } from '@playwright/test';

test.describe('Detailed Blood Bank Button Diagnostics', () => {
  test('Test every button, form submission, and modal dialog', async ({ page }) => {
    const errorLogs: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errorLogs.push(msg.text());
        console.log(`[BROWSER ERROR] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      errorLogs.push(err.message);
      console.log(`[PAGE ERROR] ${err.message}`);
    });

    // 1. Sign in as blood bank staff
    await page.goto('/login');
    await page.fill('#email', 'e2e_bloodbank@medicore.ai');
    await page.fill('#password', 'E2E_TestPassword123!');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard\/blood-bank/, { timeout: 20000 });
    await expect(page.locator('text=Blood Bank').first()).toBeVisible({ timeout: 15000 });

    console.log('=== STEP 1: TEST OVERVIEW QUICK ACTION BUTTONS ===');
    const overviewButtons = [
      { name: 'Register Donor', expectedModal: 'Register New Donor' },
      { name: 'Record Donation', expectedModal: 'Record Blood Donation' },
      { name: 'Add Blood Unit', expectedModal: 'Add Screened Blood Unit' },
      { name: 'Submit Blood Request', expectedModal: 'Submit Clinical Blood Request' },
    ];

    for (const btn of overviewButtons) {
      await page.locator('header nav button:has-text("Overview")').first().click();
      await page.waitForTimeout(300);
      const actionBtn = page.locator(`button:has-text("${btn.name}")`).first();
      await actionBtn.click();
      await page.waitForTimeout(600);
      const modalHeader = page.locator(`h3:has-text("${btn.expectedModal}")`);
      const modalOpen = await modalHeader.isVisible();
      console.log(`Overview Button "${btn.name}" -> Modal "${btn.expectedModal}" Open: ${modalOpen}`);
      expect(modalOpen).toBe(true);

      // Close modal
      const closeBtn = page.locator('div[role="dialog"] button:has-text("✕"), div.fixed button:has-text("✕"), button:has-text("Cancel")').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        await page.waitForTimeout(300);
      }
    }

    console.log('=== STEP 2: TEST SHARED NETWORK SEED & ACTIONS ===');
    await page.locator('header nav button:has-text("Shared Network")').first().click();
    await page.waitForTimeout(500);

    // Click Seed Exhibition Network Data
    const seedBtn = page.locator('button:has-text("Seed Exhibition Network Data")').first();
    if (await seedBtn.isVisible()) {
      console.log('Clicking "Seed Exhibition Network Data"...');
      await seedBtn.click();
      await page.waitForTimeout(3000);
      console.log('Seed Exhibition clicked.');
    }

    // Switch to Centers sub-view
    const centersSubTab = page.locator('button:has-text("Public Blood Bank Directory")').or(page.locator('button:has-text("Network Centers")')).first();
    if (await centersSubTab.isVisible()) {
      await centersSubTab.click();
      await page.waitForTimeout(500);
      console.log('Clicked "Network Centers" subtab');

      // Click "View Available Stock" on first center
      const viewStockBtn = page.locator('button:has-text("View Available Stock")').first();
      if (await viewStockBtn.isVisible()) {
        await viewStockBtn.click();
        await page.waitForTimeout(600);
        const centerModalVisible = await page.locator('text=Available Stock Projection').isVisible();
        console.log(`Center stock modal open: ${centerModalVisible}`);
        expect(centerModalVisible).toBe(true);
        // Close modal
        await page.locator('div.fixed button:has-text("Close"), div.fixed button:has-text("✕")').first().click();
        await page.waitForTimeout(300);
      }
    }

    // Switch back to Requests sub-view
    const reqSubTab = page.locator('button:has-text("Network Requests & Shortage Broadcasts")').or(page.locator('button:has-text("Broadcast")')).first();
    if (await reqSubTab.isVisible()) {
      await reqSubTab.click();
      await page.waitForTimeout(500);
    }

    // Check Accept / Reject buttons on network requests
    const acceptBtn = page.locator('button:has-text("Accept & Reserve Units")').first();
    if (await acceptBtn.isVisible()) {
      console.log('Clicking "Accept & Reserve Units"...');
      await acceptBtn.click();
      await page.waitForTimeout(600);
      const acceptModalVisible = await page.locator('text=Accept Inter-Facility Blood Request').isVisible();
      console.log(`Accept modal open: ${acceptModalVisible}`);
      expect(acceptModalVisible).toBe(true);
      await page.locator('div.fixed button:has-text("Cancel")').first().click();
      await page.waitForTimeout(300);
    }

    console.log('=== STEP 3: TEST DONORS TAB REGISTRATION & CLEAN PAYLOAD ===');
    await page.locator('header nav button:has-text("Donors")').first().click();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Register Donor")').or(page.locator('button:has-text("Add first donor")')).first().click();
    await page.waitForTimeout(600);
    
    // Fill donor registration form
    const uniqueDonorName = `Valerie Stone ${Date.now().toString().slice(-4)}`;
    await page.fill('input[placeholder="e.g. Johnathan Doe"]', uniqueDonorName);
    await page.fill('input[type="date"]', '1992-04-18');
    await page.fill('input[placeholder="+1 555-0192"]', '+1 555-0199');
    await page.fill('input[placeholder="donor@example.com"]', `valerie_${Date.now()}@example.com`);
    await page.click('button:has-text("Confirm Registration")');
    await page.waitForTimeout(2000);

    const donorCreated = await page.locator(`text=${uniqueDonorName}`).first().isVisible();
    console.log(`Donor registered and visible in table: ${donorCreated}`);
    expect(donorCreated).toBe(true);

    console.log('=== STEP 4: TEST DONATIONS TAB RECORDING ===');
    await page.locator('header nav button:has-text("Donations")').first().click();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Record Donation")').or(page.locator('button:has-text("Record first donation")')).first().click();
    await page.waitForTimeout(600);

    const donorSelect = page.locator('div.fixed select').first();
    const donorOptionsCount = await donorSelect.locator('option').count();
    console.log(`Donor dropdown options count in Donations modal: ${donorOptionsCount}`);
    expect(donorOptionsCount).toBeGreaterThan(1);

    await donorSelect.selectOption({ index: 1 });
    await page.click('button:has-text("Save Donation Session")');
    await page.waitForTimeout(2000);
    console.log('Submitted donation record');

    console.log('=== STEP 5: TEST INVENTORY TAB ===');
    await page.locator('header nav button:has-text("Inventory")').first().click();
    await page.waitForTimeout(500);
    const addUnitBtn = page.locator('button:has-text("Add Blood Unit")').or(page.locator('button:has-text("Add first unit")')).first();
    await addUnitBtn.click();
    await page.waitForTimeout(600);
    const donSessionDropdown = page.locator('div.fixed select').first();
    const sessionCount = await donSessionDropdown.locator('option').count();
    console.log(`Donation session dropdown options count in Add Unit modal: ${sessionCount}`);
    expect(sessionCount).toBeGreaterThan(1);
    await page.locator('div.fixed button:has-text("Cancel")').first().click();
    await page.waitForTimeout(300);

    console.log('=== STEP 6: TEST REQUESTS TAB ===');
    await page.locator('header nav button:has-text("Requests")').first().click();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Submit Blood Request")').or(page.locator('button:has-text("Submit first request")')).first().click();
    await page.waitForTimeout(600);
    const testHospName = `Mercy General ${Date.now().toString().slice(-4)}`;
    await page.fill('input[placeholder="e.g. City General Hospital"]', testHospName);
    await page.fill('input[type="datetime-local"]', '2026-12-01T14:30');
    await page.click('button:has-text("Send Request")');
    await page.waitForTimeout(2000);
    const reqCreated = await page.locator(`text=${testHospName}`).first().isVisible();
    console.log(`Request created and visible in table: ${reqCreated}`);
    expect(reqCreated).toBe(true);

    console.log('=== STEP 7: TEST REPORTS TAB ===');
    await page.locator('header nav button:has-text("Reports & Audit")').first().click();
    await page.waitForTimeout(500);
    const auditHeading = await page.locator('text=Audit Trail & Blood Product Traceability').isVisible();
    console.log(`Reports tab audit trail visible: ${auditHeading}`);
    expect(auditHeading).toBe(true);

    console.log('=== ALL BUTTONS & FLOWS VERIFIED SUCCESSFULLY! ===');
  });
});
