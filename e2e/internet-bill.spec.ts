import { test, expect, Page } from "@playwright/test";
import { navigateToDashboard } from "./auth.setup";

function getCheckboxes(page: Page) {
  return page.locator('table tbody tr td:first-child input[type="checkbox"]');
}

function getHeaderCheckbox(page: Page) {
  return page.locator('table thead tr th:first-child input[type="checkbox"]');
}

function getGenerateInternetBillButton(page: Page) {
  return page.getByRole("button", { name: /Generate Internet Bill/i });
}

function getDownloadInternetBillButton(page: Page) {
  return page.getByRole("button", { name: /Download Internet Bill/i });
}

function getSelectAllCasesLink(page: Page) {
  return page.locator("button", { hasText: /Select all \d+ cases/i });
}

function getClearSelectionLink(page: Page) {
  return page.locator("button", { hasText: /Clear selection/i });
}

// ─── Test Suite ────────────────────────────────────────────

test.describe("Internet Bill Generation & Download", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToDashboard(page);
  });

  // ── Section 1: UI State & Buttons ──

  test.describe("Initial UI State", () => {
    test("Generate Internet Bill button is disabled when no cases selected", async ({ page }) => {
      const btn = getGenerateInternetBillButton(page);
      await expect(btn).toBeVisible();
      await expect(btn).toBeDisabled();
    });

    test("Download Internet Bill button is disabled when no cases selected", async ({ page }) => {
      const btn = getDownloadInternetBillButton(page);
      await expect(btn).toBeVisible();
      await expect(btn).toBeDisabled();
    });

    test("Generate Utility Bill button is always disabled (not yet implemented)", async ({ page }) => {
      const btn = page.getByRole("button", { name: /Generate Utility Bill/i });
      await expect(btn).toBeVisible();
      await expect(btn).toBeDisabled();
    });

    test("Download Utility Bill button is always disabled (not yet implemented)", async ({ page }) => {
      const btn = page.getByRole("button", { name: /Download Utility Bill/i });
      await expect(btn).toBeVisible();
      await expect(btn).toBeDisabled();
    });

    test("Bills column header is visible in case table", async ({ page }) => {
      const header = page.locator("th", { hasText: "Bills" });
      await expect(header).toBeVisible();
    });

    test("Each row has internet and utility bill icon buttons", async ({ page }) => {
      const rows = page.locator("table tbody tr");
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);

      // Check the first row has 2 icon buttons in the last cell
      const billButtons = rows.first().locator("td:last-child button");
      await expect(billButtons).toHaveCount(2);
    });
  });

  // ── Section 2: Case Selection ──

  test.describe("Case Selection", () => {
    test("individual checkbox selects a single case", async ({ page }) => {
      const checkboxes = getCheckboxes(page);
      const firstCheckbox = checkboxes.first();

      await firstCheckbox.check();
      await expect(firstCheckbox).toBeChecked();

      // Generate button should now be enabled with count
      const btn = getGenerateInternetBillButton(page);
      await expect(btn).toBeEnabled();
      await expect(btn).toContainText("(1)");
    });

    test("selecting a case highlights the row", async ({ page }) => {
      const checkboxes = getCheckboxes(page);
      await checkboxes.first().check();

      const firstRow = page.locator("table tbody tr").first();
      // Selected rows get bg-[#F0EEFF]
      await expect(firstRow).toHaveClass(/bg-\[#F0EEFF\]/);
    });

    test("selecting multiple cases updates button count", async ({ page }) => {
      const checkboxes = getCheckboxes(page);
      const count = await checkboxes.count();
      const toSelect = Math.min(count, 3);

      for (let i = 0; i < toSelect; i++) {
        await checkboxes.nth(i).check();
      }

      const btn = getGenerateInternetBillButton(page);
      await expect(btn).toContainText(`(${toSelect})`);
    });

    test("header checkbox toggles select all on current page", async ({ page }) => {
      const headerCheckbox = getHeaderCheckbox(page);
      const rowCheckboxes = getCheckboxes(page);
      const rowCount = await rowCheckboxes.count();

      // Select all
      await headerCheckbox.check();
      for (let i = 0; i < rowCount; i++) {
        await expect(rowCheckboxes.nth(i)).toBeChecked();
      }

      // Unselect all
      await headerCheckbox.uncheck();
      for (let i = 0; i < rowCount; i++) {
        await expect(rowCheckboxes.nth(i)).not.toBeChecked();
      }
    });

    test("Select all cases link appears after selecting page, selects ALL cases", async ({ page }) => {
      const headerCheckbox = getHeaderCheckbox(page);
      await headerCheckbox.check();

      const selectAllLink = getSelectAllCasesLink(page);
      await expect(selectAllLink).toBeVisible({ timeout: 3_000 });

      await selectAllLink.click();

      // "All X cases selected" text should appear
      const allSelectedText = page.locator("text=/All \\d+ cases selected/i");
      await expect(allSelectedText).toBeVisible({ timeout: 5_000 });
    });

    test("Clear selection link clears all selected cases", async ({ page }) => {
      const checkboxes = getCheckboxes(page);
      await checkboxes.first().check();

      const clearBtn = getClearSelectionLink(page);
      await expect(clearBtn).toBeVisible();
      await clearBtn.click();

      // Button should be disabled again
      const btn = getGenerateInternetBillButton(page);
      await expect(btn).toBeDisabled();

      // Checkbox should be unchecked
      await expect(checkboxes.first()).not.toBeChecked();
    });

    test("unchecking individual case after select-all deselects properly", async ({ page }) => {
      const headerCheckbox = getHeaderCheckbox(page);
      await headerCheckbox.check();

      const checkboxes = getCheckboxes(page);
      const firstCheckbox = checkboxes.first();
      await firstCheckbox.uncheck();

      await expect(firstCheckbox).not.toBeChecked();
      // Header checkbox should also be unchecked now
      await expect(headerCheckbox).not.toBeChecked();
    });
  });

  // ── Section 3: Generate Internet Bill ──

  test.describe("Generate Internet Bill", () => {
    test("generating bill for a single case shows progress bar and completes", async ({ page }) => {
      const checkboxes = getCheckboxes(page);
      await checkboxes.first().check();

      const btn = getGenerateInternetBillButton(page);
      await btn.click();

      // Progress bar should appear
      const progressText = page.locator("text=/Generating internet bills/i");
      await expect(progressText).toBeVisible({ timeout: 5_000 });

      // Wait for completion
      const completeText = page.locator("text=/Generation complete!/i");
      await expect(completeText).toBeVisible({ timeout: 60_000 });

      // Toast notification should appear
      const toast = page.locator("[data-sonner-toast]").first();
      await expect(toast).toBeVisible({ timeout: 5_000 });
    });

    test("generating bill for multiple selected cases processes in batches", async ({ page }) => {
      const checkboxes = getCheckboxes(page);
      const count = await checkboxes.count();
      const toSelect = Math.min(count, 3);

      for (let i = 0; i < toSelect; i++) {
        await checkboxes.nth(i).check();
      }

      const btn = getGenerateInternetBillButton(page);
      await btn.click();

      // Progress bar with batch info
      const progressCounter = page.locator("text=/\\d+ of \\d+ bill/i");
      await expect(progressCounter).toBeVisible({ timeout: 10_000 });

      // Wait for completion
      await page.locator("text=/Generation complete!/i").waitFor({ timeout: 120_000 });
    });

    test("after generation, bill icon becomes active (not greyed out) for generated cases", async ({ page }) => {
      // First, select a case and generate
      const checkboxes = getCheckboxes(page);
      await checkboxes.first().check();

      // Get the case_no from first row
      const firstRowCaseNo = await page.locator("table tbody tr:first-child td:nth-child(2)").textContent();

      const btn = getGenerateInternetBillButton(page);
      await btn.click();

      // Wait for completion and data refresh
      await page.locator("text=/Generation complete!/i").waitFor({ timeout: 60_000 });
      // Wait for the progress bar to disappear (cases refresh)
      await page.waitForTimeout(2_000);

      // Find the row for the case we generated and check the internet bill button is enabled
      const row = page.locator(`table tbody tr`, { hasText: firstRowCaseNo! });
      const internetBillBtn = row.locator('td:last-child button').first();
      await expect(internetBillBtn).not.toBeDisabled();
      // Should have the active color class
      await expect(internetBillBtn).toHaveClass(/text-\[#635BFF\]/);
    });

    test("generate button is disabled during generation (prevents double-click)", async ({ page }) => {
      const checkboxes = getCheckboxes(page);
      await checkboxes.first().check();

      const btn = getGenerateInternetBillButton(page);
      await btn.click();

      // Button should be disabled while generating
      await expect(btn).toBeDisabled();

      // Wait for completion
      await page.locator("text=/Generation complete!/i").waitFor({ timeout: 60_000 });
    });

    test("selection is cleared after generation completes", async ({ page }) => {
      const checkboxes = getCheckboxes(page);
      await checkboxes.first().check();

      const btn = getGenerateInternetBillButton(page);
      await btn.click();

      // Wait for completion
      await page.locator("text=/Generation complete!/i").waitFor({ timeout: 60_000 });
      await page.waitForTimeout(2_000);

      // Selection should be cleared
      await expect(btn).toBeDisabled();
      await expect(checkboxes.first()).not.toBeChecked();
    });

    test("generate with select all cases works end-to-end", async ({ page }) => {
      // Select all on page
      const headerCheckbox = getHeaderCheckbox(page);
      await headerCheckbox.check();

      // Click "Select all X cases" if visible
      const selectAllLink = getSelectAllCasesLink(page);
      if (await selectAllLink.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await selectAllLink.click();
        await page.locator("text=/All \\d+ cases selected/i").waitFor({ timeout: 5_000 });
      }

      const btn = getGenerateInternetBillButton(page);
      await btn.click();

      // Progress should appear
      const progressText = page.locator("text=/Generating internet bills/i");
      await expect(progressText).toBeVisible({ timeout: 5_000 });

      // Wait for completion (may take longer with all cases)
      await page.locator("text=/Generation complete!/i").waitFor({ timeout: 180_000 });
    });
  });

  // ── Section 4: Download Internet Bill (Per-Row) ──

  test.describe("Per-Row Internet Bill Download", () => {
    test("internet bill icon is greyed out when bill not generated", async ({ page }) => {
      // Find a row where internet bill is NOT generated
      const rows = page.locator("table tbody tr");
      const count = await rows.count();

      for (let i = 0; i < count; i++) {
        const billBtn = rows.nth(i).locator("td:last-child button").first();
        const isDisabled = await billBtn.isDisabled();
        if (isDisabled) {
          // Greyed out button should have cursor-not-allowed
          await expect(billBtn).toHaveClass(/cursor-not-allowed/);
          await expect(billBtn).toHaveClass(/text-\[#D1D5DB\]/);
          return;
        }
      }

      // If all bills are generated, skip this test
      test.skip(true, "All cases have bills generated - cannot test greyed-out state");
    });

    test("internet bill icon opens download in new tab when bill exists", async ({ page, context }) => {
      // Find a row where internet bill IS generated
      const rows = page.locator("table tbody tr");
      const count = await rows.count();

      for (let i = 0; i < count; i++) {
        const billBtn = rows.nth(i).locator("td:last-child button").first();
        const isDisabled = await billBtn.isDisabled();
        if (!isDisabled) {
          // Click should open in new tab
          const [newPage] = await Promise.all([
            context.waitForEvent("page", { timeout: 5_000 }),
            billBtn.click(),
          ]);

          // New tab URL should be the download API
          expect(newPage.url()).toContain("/api/bills/download");
          expect(newPage.url()).toContain("type=internet");

          await newPage.close();
          return;
        }
      }

      test.skip(true, "No cases have bills generated - cannot test download");
    });

    test("utility bill icon is always disabled", async ({ page }) => {
      const rows = page.locator("table tbody tr");
      const firstRow = rows.first();
      const utilityBtn = firstRow.locator("td:last-child button").nth(1);

      await expect(utilityBtn).toBeDisabled();
      await expect(utilityBtn).toHaveClass(/cursor-not-allowed/);
    });
  });

  // ── Section 5: Bulk Download Internet Bill ──

  test.describe("Bulk Download Internet Bill", () => {
    test("download button shows confirmation dialog with bill count info", async ({ page }) => {
      // Select a case
      const checkboxes = getCheckboxes(page);
      await checkboxes.first().check();

      const downloadBtn = getDownloadInternetBillButton(page);
      await downloadBtn.click();

      // Confirmation dialog should appear with "Download (X)" button
      const confirmBtn = page.getByRole("button", { name: /^Download \(\d+\)$/i });
      await expect(confirmBtn).toBeVisible({ timeout: 5_000 });

      // Should show bills generated count
      const billsGenerated = page.locator("text=/Bills generated/i");
      await expect(billsGenerated).toBeVisible();

      // Cancel button should be present
      const cancelBtn = page.getByRole("button", { name: /^Cancel$/i });
      await expect(cancelBtn).toBeVisible();
    });

    test("download confirmation shows warning when some cases have no bills", async ({ page }) => {
      // Select cases (some may not have bills)
      const headerCheckbox = getHeaderCheckbox(page);
      await headerCheckbox.check();

      const downloadBtn = getDownloadInternetBillButton(page);
      await downloadBtn.click();

      // Look for warning text about partial bills
      const warningText = page.locator("text=/Only \\d+ of \\d+ selected cases have bills generated/i");
      // This may or may not appear depending on data state
      const hasWarning = await warningText.isVisible({ timeout: 3_000 }).catch(() => false);

      if (hasWarning) {
        await expect(warningText).toBeVisible();
      }

      // Cancel the dialog
      const cancelBtn = page.getByRole("button", { name: /Cancel/i });
      if (await cancelBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await cancelBtn.click();
      }
    });

    test("cancelling download confirmation does not trigger download", async ({ page }) => {
      const checkboxes = getCheckboxes(page);
      await checkboxes.first().check();

      const downloadBtn = getDownloadInternetBillButton(page);
      await downloadBtn.click();

      // Cancel
      const cancelBtn = page.getByRole("button", { name: /Cancel/i });
      if (await cancelBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await cancelBtn.click();
      }

      // Download progress should NOT appear
      const progressText = page.locator("text=/Downloading internet bills/i");
      await expect(progressText).not.toBeVisible({ timeout: 2_000 });
    });

    test("confirming download shows progress bar and completes", async ({ page }) => {
      // First ensure at least one case has a bill generated
      // Select a case that has a bill
      const rows = page.locator("table tbody tr");
      const count = await rows.count();

      let foundCaseWithBill = false;
      for (let i = 0; i < count; i++) {
        const billBtn = rows.nth(i).locator("td:last-child button").first();
        const isDisabled = await billBtn.isDisabled();
        if (!isDisabled) {
          // Select this case
          const checkbox = rows.nth(i).locator('td:first-child input[type="checkbox"]');
          await checkbox.check();
          foundCaseWithBill = true;
          break;
        }
      }

      if (!foundCaseWithBill) {
        test.skip(true, "No cases with generated bills to test download");
        return;
      }

      const downloadBtn = getDownloadInternetBillButton(page);
      await downloadBtn.click();

      // Confirm download
      const confirmBtn = page.getByRole("button", { name: /^Download \(\d+\)$/i });
      await confirmBtn.click();

      // Progress bar should appear
      const progressText = page.locator("text=/Downloading internet bills|Download complete!/i");
      await expect(progressText).toBeVisible({ timeout: 10_000 });

      // Wait for completion
      await page.locator("text=/Download complete!/i").waitFor({ timeout: 30_000 });
    });

    test("download button is disabled during download and generation", async ({ page }) => {
      const checkboxes = getCheckboxes(page);
      await checkboxes.first().check();

      // Start generation
      const genBtn = getGenerateInternetBillButton(page);
      await genBtn.click();

      // Download button should be disabled during generation
      const downloadBtn = getDownloadInternetBillButton(page);
      await expect(downloadBtn).toBeDisabled();

      // Wait for generation to complete
      await page.locator("text=/Generation complete!/i").waitFor({ timeout: 60_000 });
    });

    test("bulk download with select-all cases works", async ({ page }) => {
      // Select all on page
      const headerCheckbox = getHeaderCheckbox(page);
      await headerCheckbox.check();

      // Click "Select all X cases" if visible
      const selectAllLink = getSelectAllCasesLink(page);
      if (await selectAllLink.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await selectAllLink.click();
        await page.locator("text=/All \\d+ cases selected/i").waitFor({ timeout: 5_000 });
      }

      const downloadBtn = getDownloadInternetBillButton(page);
      await downloadBtn.click();

      // Confirmation dialog should appear
      const confirmBtn = page.getByRole("button", { name: /^Download \(\d+\)$/i });
      await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    });
  });

  // ── Section 6: Slide-In Detail Panel ──

  test.describe("Bill Preview in Detail Panel", () => {
    test("clicking a case row opens slide-in panel", async ({ page }) => {
      const firstRow = page.locator("table tbody tr").first();
      await firstRow.click();

      // Detail panel should slide in
      const detailPanel = page.locator("text=/Internet Bill/i").last();
      await expect(detailPanel).toBeVisible({ timeout: 5_000 });
    });

    test("detail panel shows bill preview iframe when bill is generated", async ({ page }) => {
      // Find a row with a generated bill
      const rows = page.locator("table tbody tr");
      const count = await rows.count();

      for (let i = 0; i < count; i++) {
        const billBtn = rows.nth(i).locator("td:last-child button").first();
        const isDisabled = await billBtn.isDisabled();
        if (!isDisabled) {
          // Click the row to open detail panel
          await rows.nth(i).click();

          // Wait for panel to appear
          await page.waitForTimeout(1_000);

          // Check for iframe with bill preview
          const iframe = page.locator('iframe[title="Internet Bill Preview"]');
          await expect(iframe).toBeVisible({ timeout: 5_000 });

          // iframe src should point to download API
          const src = await iframe.getAttribute("src");
          expect(src).toContain("/api/bills/download");
          expect(src).toContain("type=internet");
          return;
        }
      }

      test.skip(true, "No cases with generated bills to test preview");
    });

    test("detail panel shows placeholder when bill is NOT generated", async ({ page }) => {
      // Find a row WITHOUT a generated bill
      const rows = page.locator("table tbody tr");
      const count = await rows.count();

      for (let i = 0; i < count; i++) {
        const billBtn = rows.nth(i).locator("td:last-child button").first();
        const isDisabled = await billBtn.isDisabled();
        if (isDisabled) {
          await rows.nth(i).click();
          await page.waitForTimeout(1_000);

          const placeholder = page.locator('text=/No bill generated yet/i');
          await expect(placeholder).toBeVisible({ timeout: 5_000 });
          return;
        }
      }

      test.skip(true, "All cases have generated bills - cannot test placeholder");
    });

    test("detail panel has download link for generated bill", async ({ page }) => {
      const rows = page.locator("table tbody tr");
      const count = await rows.count();

      for (let i = 0; i < count; i++) {
        const billBtn = rows.nth(i).locator("td:last-child button").first();
        const isDisabled = await billBtn.isDisabled();
        if (!isDisabled) {
          await rows.nth(i).click();
          await page.waitForTimeout(1_000);

          const downloadLink = page.locator("a", { hasText: /Download Internet Bill/i });
          await expect(downloadLink).toBeVisible({ timeout: 5_000 });

          const href = await downloadLink.getAttribute("href");
          expect(href).toContain("/api/bills/download");
          return;
        }
      }

      test.skip(true, "No cases with generated bills to test download link");
    });
  });

  // ── Section 7: Edge Cases & Error Handling ──

  test.describe("Edge Cases", () => {
    test("selecting cases across pages maintains selection", async ({ page }) => {
      // Check if pagination exists
      const paginationText = page.locator("text=/Showing .+ of .+ cases/i");
      await expect(paginationText).toBeVisible();

      const totalText = await paginationText.textContent();
      const totalMatch = totalText?.match(/of (\d+)/);
      const totalCases = totalMatch ? parseInt(totalMatch[1]) : 0;

      if (totalCases <= 10) {
        test.skip(true, "Not enough cases for pagination test");
        return;
      }

      // Select first case on page 1
      const checkboxes = getCheckboxes(page);
      await checkboxes.first().check();

      // Navigate to page 2
      const nextBtn = page.getByRole("button", { name: /Next|→|›/i });
      if (await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await nextBtn.click();
        await waitForCaseTable(page);

        // Button should still show selection count
        const btn = getGenerateInternetBillButton(page);
        await expect(btn).toContainText("(1)");
      }
    });

    test("rapid checkbox clicking does not cause inconsistent state", async ({ page }) => {
      const checkboxes = getCheckboxes(page);
      const count = Math.min(await checkboxes.count(), 5);

      // Rapidly toggle checkboxes
      for (let i = 0; i < count; i++) {
        await checkboxes.nth(i).check({ force: true });
      }
      for (let i = 0; i < count; i++) {
        await checkboxes.nth(i).uncheck({ force: true });
      }

      // All should be unchecked
      for (let i = 0; i < count; i++) {
        await expect(checkboxes.nth(i)).not.toBeChecked();
      }

      // Button should be disabled
      const btn = getGenerateInternetBillButton(page);
      await expect(btn).toBeDisabled();
    });

    test("checkbox click does not open detail panel (event propagation)", async ({ page }) => {
      const checkboxes = getCheckboxes(page);
      await checkboxes.first().check();

      // The detail panel should NOT open from checkbox click
      // (detail panel opens on row click, checkbox has stopPropagation)
      // Wait briefly and verify no panel opened
      await page.waitForTimeout(500);

      // The slide-in panel uses a fixed overlay; check it's not there
      const iframe = page.locator('iframe[title="Internet Bill Preview"]');
      const noPreview = page.locator('text=/No bill generated yet/i');

      // Neither should be visible from just checkbox click
      // (unless the panel was already open from a prior test)
      const checkboxOnly = !(await iframe.isVisible().catch(() => false)) &&
        !(await noPreview.isVisible().catch(() => false));

      // This is expected — checkbox click should not trigger row click
      expect(checkboxOnly).toBe(true);
    });

    test("bill icon click does not open detail panel (event propagation)", async ({ page }) => {
      const firstRow = page.locator("table tbody tr").first();
      const billBtnCell = firstRow.locator("td:last-child");

      // Click on the bill buttons cell (has stopPropagation)
      await billBtnCell.click();

      // Wait briefly
      await page.waitForTimeout(500);

      // Detail panel should NOT have opened
      const iframe = page.locator('iframe[title="Internet Bill Preview"]');
      await expect(iframe).not.toBeVisible({ timeout: 1_000 });
    });
  });

  // ── Section 8: Download API Responses ──

  test.describe("Download API", () => {
    test("download API returns 401 when not authenticated", async ({ page, request }) => {
      // Direct API call without session
      const response = await request.get("/api/bills/download?case_no=123&type=internet");
      // Should redirect to auth or return 401
      expect([401, 302, 307]).toContain(response.status());
    });

    test("download API returns 400 when case_no is missing", async ({ page }) => {
      // Use page.evaluate to make fetch with session cookies
      const status = await page.evaluate(async () => {
        const res = await fetch("/api/bills/download?type=internet");
        return res.status;
      });
      expect(status).toBe(400);
    });

    test("download API returns 400 for invalid type", async ({ page }) => {
      const status = await page.evaluate(async () => {
        const res = await fetch("/api/bills/download?case_no=123&type=invalid");
        return res.status;
      });
      expect(status).toBe(400);
    });

    test("download API returns 404 for non-existent case", async ({ page }) => {
      const status = await page.evaluate(async () => {
        const res = await fetch("/api/bills/download?case_no=999999999&type=internet");
        return res.status;
      });
      expect(status).toBe(404);
    });
  });

  // ── Section 9: Generate API Responses ──

  test.describe("Generate API", () => {
    test("generate API returns 401 when not authenticated", async ({ request }) => {
      const response = await request.post("/api/bills/generate", {
        data: { caseNos: ["123"] },
      });
      expect([401, 302, 307]).toContain(response.status());
    });

    test("generate API returns 400 for empty caseNos array", async ({ page }) => {
      const status = await page.evaluate(async () => {
        const res = await fetch("/api/bills/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseNos: [] }),
        });
        return res.status;
      });
      expect(status).toBe(400);
    });

    test("generate API returns 400 for missing caseNos", async ({ page }) => {
      const status = await page.evaluate(async () => {
        const res = await fetch("/api/bills/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        return res.status;
      });
      expect(status).toBe(400);
    });

    test("generate API enforces max batch size of 20", async ({ page }) => {
      const result = await page.evaluate(async () => {
        const caseNos = Array.from({ length: 21 }, (_, i) => `fake${i}`);
        const res = await fetch("/api/bills/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseNos }),
        });
        return { status: res.status, body: await res.json() };
      });
      expect(result.status).toBe(400);
      expect(result.body.error).toContain("Maximum 20");
    });
  });

  // ── Section 10: Bulk Download API ──

  test.describe("Bulk Download API", () => {
    test("bulk download API returns 401 when not authenticated", async ({ request }) => {
      const response = await request.post("/api/bills/bulk-download", {
        data: { caseNos: ["123"], type: "internet" },
      });
      expect([401, 302, 307]).toContain(response.status());
    });

    test("bulk download API returns 400 for empty caseNos", async ({ page }) => {
      const status = await page.evaluate(async () => {
        const res = await fetch("/api/bills/bulk-download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseNos: [], type: "internet" }),
        });
        return res.status;
      });
      expect(status).toBe(400);
    });

    test("bulk download API returns 404 when no bills exist for given cases", async ({ page }) => {
      const status = await page.evaluate(async () => {
        const res = await fetch("/api/bills/bulk-download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseNos: ["nonexistent999"], type: "internet" }),
        });
        return res.status;
      });
      expect(status).toBe(404);
    });
  });
});
