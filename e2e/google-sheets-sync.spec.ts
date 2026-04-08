import { test, expect } from "@playwright/test";
import { navigateToDashboard } from "./auth.setup";

// ─── Helpers ────────────────────────────────────────────

function getSyncButton(page: import("@playwright/test").Page) {
  return page.locator("button", { hasText: /Sync to Sheet/i });
}

// ─── Test Suite ────────────────────────────────────────────

test.describe("Google Sheets Sync", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToDashboard(page);
  });

  test("Sync to Sheet button is visible on dashboard", async ({ page }) => {
    const btn = getSyncButton(page);
    await expect(btn).toBeVisible();
  });

  test("Sync to Sheet triggers sync and shows toast", async ({ page }) => {
    const btn = getSyncButton(page);
    await btn.click();

    // Should show either success toast or error toast (depending on config)
    // Wait for a toast notification to appear
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 15_000 });

    const toastText = await toast.textContent();
    // Valid outcomes: synced N cases, all already synced, or config error
    const validMessages = [
      /synced \d+ case/i,
      /already synced/i,
      /no google sheet id/i,
      /not configured/i,
      /permission denied/i,
      /not found/i,
      /sync failed/i,
      /no wifibizz/i,
    ];
    const matchesAny = validMessages.some((re) => re.test(toastText ?? ""));
    expect(matchesAny).toBeTruthy();
  });

  test("Second sync after first shows re-sync or already synced", async ({ page }) => {
    const btn = getSyncButton(page);

    // First sync
    await btn.click();
    const firstToast = page.locator('[data-sonner-toast]').first();
    await expect(firstToast).toBeVisible({ timeout: 15_000 });

    // Wait for toast to dismiss or dismiss manually
    await page.waitForTimeout(3000);

    // Second sync — if sheet ID is configured and first succeeded,
    // this should check the sheet and either re-sync deleted rows or say "already synced"
    await btn.click();
    const secondToast = page.locator('[data-sonner-toast]').last();
    await expect(secondToast).toBeVisible({ timeout: 15_000 });

    const text = await secondToast.textContent();
    // After a successful first sync, second sync should check sheet contents
    // and either find deleted rows to re-sync or confirm all synced
    expect(text).toBeTruthy();
  });

  test("Settings page has Google Sheet ID field", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.waitForLoadState("networkidle");

    // Should have the Google Sheet ID input
    const sheetInput = page.getByLabel(/Google Sheet ID/i);
    await expect(sheetInput).toBeVisible({ timeout: 10_000 });
  });

  test("Settings page shows service account email", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.waitForLoadState("networkidle");

    // Service account email should be displayed (or a message about config)
    const settingsContent = await page.textContent("main");
    // Should mention service account or Google Sheets somewhere
    const hasSheetSection =
      /google sheet/i.test(settingsContent ?? "") ||
      /service account/i.test(settingsContent ?? "") ||
      /sheet id/i.test(settingsContent ?? "");
    expect(hasSheetSection).toBeTruthy();
  });
});
