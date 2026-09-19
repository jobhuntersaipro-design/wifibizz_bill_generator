import { test, expect, Page, Cookie } from "@playwright/test";

/**
 * Production E2E test: Case Usage Limit System
 *
 * Tests the full case limit lifecycle on https://bizzflow.top:
 *   1. Admin creates test user with caseLimit=1
 *   2. Sign in as test user, verify usage API
 *   3. Bill generation API enforces limits
 *   4. Usage page shows correct limit/remaining
 *   5. Admin topups the user → limit increases
 *   6. Cleanup: delete test user
 */

const BASE = "https://bizzflow.top";
const ADMIN_EMAIL = "admin@bizzflow.com";
const ADMIN_PWD = "bizzflow_admin_888";

const TEST_USER = {
  name: "E2E Limit Test",
  email: `e2e-limit-${Date.now()}@test.com`,
  password: "TestPass123!",
  caseLimit: 1,
};

// ── Helpers ──

let adminCookies: Cookie[] = [];

async function adminLogin(page: Page) {
  // Restore saved admin cookies if we have them
  if (adminCookies.length > 0) {
    await page.context().addCookies(adminCookies);
    await page.goto(`${BASE}/admin`);
    await page.waitForLoadState("networkidle");
    // Check if we're on admin (not redirected to login)
    if (page.url().includes("/admin") && !page.url().includes("/login")) return;
  }

  await page.goto(`${BASE}/admin/login`);
  await page.waitForLoadState("networkidle");
  if (page.url().includes("/admin") && !page.url().includes("/login")) return;

  // Check for existing rate limit message before attempting
  const rateLimitBefore = page.locator("text=Too many attempts");
  if (await rateLimitBefore.isVisible({ timeout: 500 }).catch(() => false)) {
    const text = await rateLimitBefore.textContent();
    const minutes = parseInt(text?.match(/(\d+) minute/)?.[1] ?? "1");
    console.log(`  Rate limited before login, waiting ${minutes} min...`);
    await page.waitForTimeout(minutes * 60_000 + 5000);
  }

  await page.locator("#username").fill(ADMIN_EMAIL);
  await page.locator("#password").fill(ADMIN_PWD);
  await page.getByRole("button", { name: /sign in as admin/i }).click();

  // Race: either redirect to /admin (success) or rate limit error stays on page
  const result = await Promise.race([
    page.waitForURL("**/admin", { timeout: 30_000 }).then(() => "success" as const),
    page.locator("text=Too many attempts").waitFor({ state: "visible", timeout: 30_000 }).then(() => "rate_limited" as const),
  ]).catch(() => "timeout" as const);

  if (result === "rate_limited") {
    const text = await page.locator("text=Too many attempts").textContent();
    const minutes = parseInt(text?.match(/(\d+) minute/)?.[1] ?? "2");
    console.log(`  Rate limited after login attempt, waiting ${minutes} min...`);
    await page.waitForTimeout(minutes * 60_000 + 5000);
    // Retry once
    await page.locator("#username").fill(ADMIN_EMAIL);
    await page.locator("#password").fill(ADMIN_PWD);
    await page.getByRole("button", { name: /sign in as admin/i }).click();
    await page.waitForURL("**/admin", { timeout: 30_000 });
  }

  await page.waitForLoadState("networkidle");

  // Save admin cookies for reuse
  adminCookies = await page.context().cookies();
}

async function waitForAdminUsersLoaded(page: Page) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const createBtn = page.getByRole("button", { name: /create user/i });
    if (await createBtn.isVisible({ timeout: 2_000 }).catch(() => false)) return;

    const retryBtn = page.getByRole("button", { name: /retry/i });
    if (await retryBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      console.log(`  Retry loading users (attempt ${attempt + 1})...`);
      await retryBtn.click();
      await page.waitForTimeout(3000);
    } else {
      await page.waitForTimeout(2000);
    }
  }

  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  await expect(page.getByRole("button", { name: /create user/i })).toBeVisible({
    timeout: 15_000,
  });
}

async function switchToUser(page: Page, email: string, password: string) {
  // Save current cookies before clearing
  const currentCookies = await page.context().cookies();
  const adminSessionCookie = currentCookies.find((c) => c.name === "admin_session");
  if (adminSessionCookie) {
    // Update saved admin cookies
    adminCookies = currentCookies;
  }

  // Clear all cookies and sign in as user
  await page.context().clearCookies();
  await page.goto(`${BASE}/auth/signin`);
  await page.waitForLoadState("networkidle");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForURL("**/dashboard**", { timeout: 15_000 });
}

async function switchToAdmin(page: Page) {
  // Clear user cookies, restore admin cookies
  await page.context().clearCookies();
  await page.context().addCookies(adminCookies);
  await page.goto(`${BASE}/admin`);
  await page.waitForLoadState("networkidle");

  // If redirected to login, the admin session expired — re-login
  if (page.url().includes("/login")) {
    await adminLogin(page);
  }
}

// ── Test Suite ──

test.describe("Case Usage Limit System (Production)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Full lifecycle: create user, verify limits, test API enforcement, topup, cleanup", async ({
    page,
  }) => {
    test.setTimeout(300_000); // 5 min — accounts for rate limit waits

    // ─── Step 1: Admin creates test user with caseLimit=1 ───
    console.log("Step 1: Admin creates test user");
    await adminLogin(page);
    await waitForAdminUsersLoaded(page);

    await page.getByRole("button", { name: /create user/i }).click();
    await page.waitForTimeout(500);

    await page.getByRole("textbox", { name: "Name" }).fill(TEST_USER.name);
    await page.getByRole("textbox", { name: "Login Email" }).fill(TEST_USER.email);
    await page.getByRole("textbox", { name: "Password" }).fill(TEST_USER.password);
    await page.getByRole("spinbutton", { name: "Case Limit" }).fill(String(TEST_USER.caseLimit));

    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.waitForTimeout(3000);

    await expect(page.locator(`text=${TEST_USER.email}`)).toBeVisible({ timeout: 10_000 });
    console.log(`  ✓ User created (${TEST_USER.email}, caseLimit: 1)`);

    // ─── Step 2: Sign in as test user ───
    console.log("Step 2: Sign in as test user");
    await switchToUser(page, TEST_USER.email, TEST_USER.password);
    console.log("  ✓ Signed in → /dashboard");

    // ─── Step 3: Verify usage API ───
    console.log("Step 3: Verify usage API");
    const usageRes = await page.request.get(`${BASE}/api/cases/usage`);
    expect(usageRes.ok()).toBeTruthy();
    const usage = await usageRes.json();
    console.log("  Usage:", JSON.stringify(usage));

    expect(usage.limit).toBe(1);
    expect(usage.casesUsed).toBe(0);
    expect(usage.remaining).toBe(1);
    expect(usage.totalCases).toBe(0);
    console.log("  ✓ limit=1, used=0, remaining=1");

    // ─── Step 4: Bill generation API rejects without WifiBizz link ───
    console.log("Step 4: Bill generation API enforcement");

    const genRes = await page.request.post(`${BASE}/api/bills/generate`, {
      data: { caseNos: ["TEST_CASE_001"], type: "internet" },
    });
    expect(genRes.status()).toBe(400);
    const genData = await genRes.json();
    expect(genData.success).toBe(false);
    expect(genData.error).toContain("WifiBizz account not linked");
    console.log("  ✓ 400: WifiBizz account not linked");

    // ─── Step 5: Dashboard KPI shows 0/1 ───
    console.log("Step 5: Dashboard KPI");
    await page.goto(`${BASE}/dashboard`);
    await page.waitForLoadState("networkidle");

    const kpiArea = page.locator("text=Cases Used").locator("..").locator("..");
    await expect(kpiArea).toBeVisible({ timeout: 10_000 });
    const kpiText = await kpiArea.textContent();
    expect(kpiText).toContain("0");
    expect(kpiText).toContain("/ 1");
    console.log("  ✓ KPI: 0/1 cases used");

    await expect(page.getByRole("button", { name: /Generate Umobile Bill/i })).toBeDisabled();
    console.log("  ✓ Generate button disabled (no cases)");

    // ─── Step 6: Usage page ───
    console.log("Step 6: Usage page");
    await page.goto(`${BASE}/dashboard/usage`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("text=/ 1 cases used")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=1 case remaining")).toBeVisible();
    console.log("  ✓ 0/1 cases used, 1 remaining");

    // ─── Step 7: Admin topup (+100 cases) ───
    console.log("Step 7: Admin topup");
    await switchToAdmin(page);
    await waitForAdminUsersLoaded(page);

    const userRow = page.locator("tr", { has: page.locator(`text=${TEST_USER.email}`) });
    await expect(userRow).toBeVisible({ timeout: 10_000 });
    await userRow.getByRole("button", { name: /topup/i }).click();
    await page.waitForTimeout(500);

    // Topup modal: fill amount + reason, submit
    await page.locator("#topupAmount").fill("100");
    await page.locator("#topupReason").fill("E2E test topup");
    await page.getByRole("button", { name: /topup \+100/i }).click();
    await page.waitForTimeout(3000);
    console.log("  ✓ Topup +100 submitted");

    // ─── Step 8: Verify updated limit ───
    console.log("Step 8: Verify updated limit");
    await switchToUser(page, TEST_USER.email, TEST_USER.password);

    const usageRes2 = await page.request.get(`${BASE}/api/cases/usage`);
    expect(usageRes2.ok()).toBeTruthy();
    const usage2 = await usageRes2.json();
    console.log("  Updated:", JSON.stringify(usage2));
    expect(usage2.limit).toBe(101);
    expect(usage2.remaining).toBe(101);
    console.log("  ✓ Limit: 1 → 101");

    // Usage page should reflect
    await page.goto(`${BASE}/dashboard/usage`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=/ 101 cases used")).toBeVisible({ timeout: 10_000 });
    console.log("  ✓ Usage page: 0/101");

    // Purchase history should show a topup entry
    await expect(page.getByText("1 topup")).toBeVisible({ timeout: 10_000 });
    console.log("  ✓ Purchase history shows topup entry");

    // ─── Step 9: Cleanup — delete test user ───
    console.log("Step 9: Cleanup");
    await switchToAdmin(page);
    await waitForAdminUsersLoaded(page);

    const deleteRow = page.locator("tr", { has: page.locator(`text=${TEST_USER.email}`) });
    await expect(deleteRow).toBeVisible({ timeout: 10_000 });
    await deleteRow.getByRole("button", { name: /delete/i }).click();
    await page.waitForTimeout(500);

    // Type "DELETE" to confirm
    await page.getByRole("textbox", { name: /DELETE/i }).fill("DELETE");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /^Delete$/i }).last().click();
    await page.waitForTimeout(3000);

    await expect(page.locator(`text=${TEST_USER.email}`)).not.toBeVisible({ timeout: 10_000 });
    console.log("  ✓ Test user deleted");

    console.log("\n✅ All case limit tests passed!");
  });
});
