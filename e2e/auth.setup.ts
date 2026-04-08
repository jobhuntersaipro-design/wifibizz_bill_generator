import { Page, BrowserContext } from "@playwright/test";
import path from "path";

export const STORAGE_STATE = path.join(
  process.cwd(),
  "test-results",
  ".auth",
  "user.json"
);

/**
 * Sign in via the UI and save session storage state.
 * Uses env vars TESTING_USER_EMAIL and TESTING_USER_PWD.
 */
export async function signIn(page: Page) {
  const email = process.env.TESTING_USER_EMAIL;
  const password = process.env.TESTING_USER_PWD;

  if (!email || !password) {
    throw new Error(
      "TESTING_USER_EMAIL and TESTING_USER_PWD must be set in environment"
    );
  }

  await page.goto("/auth/signin");
  await page.getByLabel("Email Address").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();

  // Wait for redirect to dashboard
  await page.waitForURL("**/dashboard**", { timeout: 15_000 });
}

/**
 * Ensure we're on the dashboard with the case table loaded.
 * Used in beforeEach when session is already authenticated via storageState.
 */
export async function navigateToDashboard(page: Page) {
  await page.goto("/dashboard");
  // Wait for the case table to finish loading
  await page.waitForSelector("table tbody tr", { timeout: 20_000 });
  // Make sure loading spinner is gone
  const spinner = page.locator("text=Loading cases...");
  if (await spinner.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await spinner.waitFor({ state: "hidden", timeout: 15_000 });
  }
}
