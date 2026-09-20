/**
 * Capture Progress checklist + portal capture carousel from ORD-0104 detail.
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = "https://bizzflow.top";
const OUT = "/opt/cursor/artifacts/order-submit-workflow";
const DOCS = "/workspace/docs/order-submit-workflow/snapshots";
mkdirSync(OUT, { recursive: true });
mkdirSync(DOCS, { recursive: true });

const ORDER_ID = "cmtppq3ua000004l9ihgeahc7"; // ORD-0104 from prior run

async function shot(page, name) {
  const file = `${name}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: false });
  await page.screenshot({ path: join(DOCS, file), fullPage: false });
  console.log("SHOT", file);
}

async function login(page) {
  await page.goto(`${BASE}/auth/signin`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const el = document.querySelector("#email");
    if (el) el.type = "text";
  });
  await page.fill("#email", "REDACTED_EMAIL");
  await page.fill("#password", "REDACTED_PASSWORD");
  await Promise.all([
    page.waitForURL("**/dashboard**", { timeout: 30000 }),
    page.getByRole("button", { name: /^Sign in$/i }).click(),
  ]);
  await page.waitForLoadState("networkidle");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);

  await page.goto(`${BASE}/order-entry/orders/${ORDER_ID}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "22_detail_landing");

  // Progress tab — checklist of 17 steps
  const progressTab = page.getByRole("tab", { name: /^Progress/i });
  await progressTab.click();
  await page.waitForTimeout(800);
  await shot(page, "23_progress_checklist_top");
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(400);
  await shot(page, "24_progress_checklist_mid");
  await page.evaluate(() => window.scrollTo(0, 1100));
  await page.waitForTimeout(400);
  await shot(page, "25_progress_checklist_bottom");

  // History tab — full timeline + captures
  const historyTab = page.getByRole("tab", { name: /History/i });
  await historyTab.click();
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "26_history_top");

  // Click capture thumbnails by accessible name / text near Captures
  // Look for buttons or figures under Captures heading
  const captureButtons = page.locator("button, a, [role=button]").filter({
    hasText: /Offer grid|New Connection|Broadband|Voice|TV|failure|pay|Customer|feasibility/i,
  });
  const capCount = await captureButtons.count();
  console.log("capture-like buttons", capCount);

  // Also try clicking images inside the captures strip (small thumbs)
  const thumbs = page.locator("img");
  const n = await thumbs.count();
  console.log("imgs", n);
  // Prefer thumbs whose natural size is small / whose alt mentions submit
  let opened = 0;
  for (let i = 0; i < n && opened < 4; i++) {
    const alt = (await thumbs.nth(i).getAttribute("alt").catch(() => "")) || "";
    const src = (await thumbs.nth(i).getAttribute("src").catch(() => "")) || "";
    const box = await thumbs.nth(i).boundingBox().catch(() => null);
    const looksLikeCapture =
      /submit|screenshot|capture|offer|broadband|r2|order-screenshots/i.test(alt + src) ||
      (box && box.width >= 60 && box.width <= 180 && box.height >= 40 && box.height <= 140);
    if (!looksLikeCapture) continue;
    await thumbs.nth(i).scrollIntoViewIfNeeded();
    await thumbs.nth(i).click({ force: true }).catch(() => {});
    await page.waitForTimeout(900);
    // Detect dialog/carousel
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible().catch(() => false)) {
      opened++;
      await shot(page, `27_portal_capture_${opened}`);
      // next if carousel has next
      const next = page.getByRole("button", { name: /next|›|>/i });
      if (await next.first().isVisible().catch(() => false)) {
        await next.first().click().catch(() => {});
        await page.waitForTimeout(600);
        opened++;
        await shot(page, `27_portal_capture_${opened}`);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
  }

  // Scroll history timeline fully
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(400);
  await shot(page, "28_history_timeline_1");
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(400);
  await shot(page, "29_history_timeline_2");
  await page.evaluate(() => window.scrollTo(0, 2100));
  await page.waitForTimeout(400);
  await shot(page, "30_history_timeline_3");
  await page.evaluate(() => window.scrollTo(0, 2800));
  await page.waitForTimeout(400);
  await shot(page, "31_history_timeline_4");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await shot(page, "32_history_timeline_end");

  // Dump history text for the doc
  const bodyText = await page.locator("body").innerText();
  const fs = await import("fs");
  fs.writeFileSync("/workspace/docs/order-submit-workflow/ord-0104-history.txt", bodyText);
  console.log("wrote history text, length", bodyText.length);

  // Filter drafts for Failed/Warning/Draft if any
  await page.goto(`${BASE}/dashboard/order-entry/drafts`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  // Try opening status combobox
  const statusBtn = page.getByRole("combobox").nth(1).or(page.getByText("All statuses"));
  // Click the filter chip labeled All statuses
  const chip = page.locator("button, [role=combobox]").filter({ hasText: /All statuses/i }).first();
  if (await chip.isVisible().catch(() => false)) {
    await chip.click();
    await page.waitForTimeout(500);
    await shot(page, "33_status_filter");
    for (const label of ["Failed", "Warning", "Draft", "Submitting"]) {
      const opt = page.getByRole("option", { name: new RegExp(`^${label}$`, "i") })
        .or(page.getByText(label, { exact: true }));
      if (await opt.first().isVisible().catch(() => false)) {
        await opt.first().click();
        await page.waitForTimeout(1200);
        await shot(page, `34_filter_${label.toLowerCase()}`);
        // reopen filter for next
        if (await chip.isVisible().catch(() => false)) await chip.click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  }

  await browser.close();
  console.log("DONE opened captures", opened);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
