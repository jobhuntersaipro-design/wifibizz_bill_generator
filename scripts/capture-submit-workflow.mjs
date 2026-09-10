/**
 * Capture order-entry submission workflow screenshots on production.
 * Does NOT click Submit (would mint a real Unifi order).
 */
import { chromium } from "playwright";
import { mkdirSync, copyFileSync } from "fs";
import { join } from "path";

const BASE = "https://bizzflow.top";
const OUT = "/opt/cursor/artifacts/order-submit-workflow";
const DOCS = "/workspace/docs/order-submit-workflow/snapshots";
mkdirSync(OUT, { recursive: true });
mkdirSync(DOCS, { recursive: true });

const EMAIL = "REDACTED_EMAIL";
const PASSWORD = "REDACTED_PASSWORD";

async function shot(page, name) {
  const file = `${name}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: false });
  await page.screenshot({ path: join(DOCS, file), fullPage: false });
  console.log("SHOT", file, "url=", page.url());
}

async function login(page) {
  await page.goto(`${BASE}/auth/signin`, { waitUntil: "networkidle" });
  // type=email rejects REDACTED_EMAIL — loosen validation for this account
  await page.evaluate(() => {
    const el = document.querySelector("#email");
    if (el) el.type = "text";
  });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await Promise.all([
    page.waitForURL("**/dashboard**", { timeout: 30000 }),
    page.getByRole("button", { name: /^Sign in$/i }).click(),
  ]);
  await page.waitForLoadState("networkidle");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await login(page);
  await shot(page, "08_after_login");

  await page.goto(`${BASE}/dashboard/order-entry/drafts`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "09_orders_list");

  const moreButtons = page.getByRole("button", { name: /More actions for/i });
  await moreButtons.first().waitFor({ timeout: 15000 });
  const count = await moreButtons.count();
  console.log("more-actions count:", count);

  // Open menu → Clone
  await moreButtons.first().click();
  await page.waitForTimeout(600);
  await shot(page, "10_row_menu_open");

  const cloneItem = page.getByRole("menuitem", { name: /Clone to new draft/i });
  await cloneItem.waitFor({ state: "visible", timeout: 5000 });
  await cloneItem.click();
  await page.waitForURL(/new-order\?clone=/, { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  console.log("CLONE URL", page.url());
  await shot(page, "11_clone_form_top");

  await page.evaluate(() => window.scrollTo(0, 550));
  await page.waitForTimeout(400);
  await shot(page, "12_clone_form_address");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await shot(page, "13_clone_form_docs");

  // Back to drafts — open Details (window.open)
  await page.goto(`${BASE}/dashboard/order-entry/drafts`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  let detailPage = null;
  const n = await moreButtons.count();
  for (let i = 0; i < Math.min(n, 20); i++) {
    await moreButtons.nth(i).click();
    await page.waitForTimeout(400);
    const details = page.getByRole("menuitem", { name: /^Details/i });
    if (await details.isVisible().catch(() => false)) {
      const popupPromise = context.waitForEvent("page", { timeout: 12000 });
      await details.click();
      detailPage = await popupPromise.catch(() => null);
      if (detailPage) {
        await detailPage.waitForLoadState("networkidle");
        console.log("DETAIL URL", detailPage.url());
        break;
      }
    } else {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
  }

  if (!detailPage) {
    // Fallback: scrape cuid from network response of listOrders RSC/actions
    console.log("No Details popup — scanning page for order ids via performance entries / DOM");
    // Try clicking ORD reference text won't work — look at React props via aria on rows
    // Hit the list API if any public — otherwise dump HTML ids
    const html = await page.content();
    const ids = [...new Set([...html.matchAll(/["'](c[a-z0-9]{20,})["']/g)].map((m) => m[1]))];
    console.log("candidate cuids", ids.slice(0, 10));
    // Prefer navigating with first More-actions row's associated order via evaluate
  }

  if (detailPage) {
    await detailPage.setViewportSize({ width: 1440, height: 900 });
    await detailPage.waitForTimeout(1500);
    await shot(detailPage, "14_order_detail_hero");

    // Tabs
    for (const name of ["Attempt", "History", "Progress", "Details", "Captures"]) {
      const tab = detailPage.getByRole("tab", { name: new RegExp(name, "i") });
      if (await tab.first().isVisible().catch(() => false)) {
        await tab.first().click().catch(() => {});
        await detailPage.waitForTimeout(400);
      }
    }
    await shot(detailPage, "15_order_detail_attempts");

    await detailPage.evaluate(() => window.scrollTo(0, 700));
    await detailPage.waitForTimeout(500);
    await shot(detailPage, "16_order_detail_mid");

    // Click first thumbnail-ish image
    const imgs = detailPage.locator("img");
    const imgCount = await imgs.count();
    console.log("detail imgs", imgCount);
    for (let i = 0; i < Math.min(imgCount, 8); i++) {
      const box = await imgs.nth(i).boundingBox().catch(() => null);
      if (box && box.width > 40 && box.width < 400) {
        await imgs.nth(i).click().catch(() => {});
        await detailPage.waitForTimeout(800);
        await shot(detailPage, "17_capture_opened");
        break;
      }
    }

    await detailPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await detailPage.waitForTimeout(400);
    await shot(detailPage, "18_order_detail_bottom");
  }

  // Dealer header
  await page.goto(`${BASE}/dashboard/order-entry/new-order`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await shot(page, "19_dealer_header_new_order");

  // Also try status filter on drafts for Failed
  await page.goto(`${BASE}/dashboard/order-entry/drafts`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const statusFilter = page.getByRole("button", { name: /All statuses|Status/i }).first();
  if (await statusFilter.isVisible().catch(() => false)) {
    await statusFilter.click();
    await page.waitForTimeout(400);
    await shot(page, "20_status_filter_open");
    const failed = page.getByRole("option", { name: /Failed|Warning|Draft/i }).first();
    if (await failed.isVisible().catch(() => false)) {
      await failed.click();
      await page.waitForTimeout(1200);
      await shot(page, "21_filtered_orders");
    }
  }

  await browser.close();
  console.log("DONE");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
