import "dotenv/config";
import { crawl } from "../src/lib/crawler/scraper";
import { upsertUser, upsertCases, updateLastCrawl } from "../src/lib/crawler/db";

async function main() {
  const email = process.env.WIFIBIZZ_EMAIL;
  const password = process.env.WIFIBIZZ_PASSWORD;

  if (!email || !password) {
    console.error("Set WIFIBIZZ_EMAIL and WIFIBIZZ_PASSWORD in .env");
    process.exit(1);
  }

  console.log("\nLogging in and crawling...");

  const user = await upsertUser(email, password);
  const { cases } = await crawl(email, password);

  console.log(`Found ${cases.length} cases.`);

  const saved = await upsertCases(user.id, cases);
  await updateLastCrawl(user.id);

  console.log(`Saved ${saved} cases to database.`);
}

main().catch((err) => {
  console.error("Crawl failed:", err.message);
  process.exit(1);
});
