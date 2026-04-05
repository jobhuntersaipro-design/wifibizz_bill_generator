import { test, expect, Page } from "@playwright/test";
import { navigateToDashboard } from "./auth.setup";

function getCheckboxes(page: Page) {
  return page.locator('table tbody tr td:first-child input[type="checkbox"]');
}

function getGenerateUtilityBillButton(page: Page) {
  return page.getByRole("button", { name: /Generate Utility Bill/i });
}

test.describe("Utility Bill Generation", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToDashboard(page);
  });

  test("generate utility bill for a single case shows progress and completes", async ({ page }) => {
    const checkboxes = getCheckboxes(page);
    await checkboxes.first().check();

    const btn = getGenerateUtilityBillButton(page);
    await expect(btn).toBeEnabled();
    await btn.click();

    // Wait for success toast (bill generated successfully)
    const successToast = page.locator("[data-sonner-toast]").first();
    await expect(successToast).toBeVisible({ timeout: 60_000 });
    const toastText = await successToast.textContent();
    console.log("Toast message:", toastText);

    // Should be a success message, not an error
    expect(toastText).toContain("generated");
    expect(toastText).not.toContain("failed");
  });

  test("generate utility bill API returns detailed error on failure", async ({ page }) => {
    // Get a valid case_no from the table
    const firstCaseNo = await page.locator("table tbody tr:first-child td:nth-child(2)").textContent();
    console.log("Testing with case_no:", firstCaseNo);

    // Call the API directly to get the full error response
    const result = await page.evaluate(async (caseNo) => {
      const res = await fetch("/api/bills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseNos: [caseNo], type: "utility" }),
      });
      return { status: res.status, body: await res.json() };
    }, firstCaseNo?.trim());

    console.log("API response status:", result.status);
    console.log("API response body:", JSON.stringify(result.body, null, 2));

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.results[0].status).toBe("success");
  });
});
