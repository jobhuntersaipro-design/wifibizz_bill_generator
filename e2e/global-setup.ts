import { chromium } from "@playwright/test";
import { signIn, STORAGE_STATE } from "./auth.setup";
import fs from "fs";
import path from "path";

async function globalSetup() {
  // Ensure auth dir exists
  const authDir = path.dirname(STORAGE_STATE);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  // Skip if storage state is fresh (less than 30 minutes old)
  if (fs.existsSync(STORAGE_STATE)) {
    const stat = fs.statSync(STORAGE_STATE);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 30 * 60 * 1000) {
      console.log("Using cached auth state (age: " + Math.round(ageMs / 1000) + "s)");
      return;
    }
  }

  const baseURL = process.env.BASE_URL || "http://localhost:3000";
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  try {
    await signIn(page);
  } catch (err) {
    await page.screenshot({ path: path.join(authDir, "setup-failure.png") });
    throw err;
  }

  // Save signed-in state
  await context.storageState({ path: STORAGE_STATE });
  await browser.close();
}

export default globalSetup;
