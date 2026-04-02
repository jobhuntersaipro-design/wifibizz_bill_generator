import "dotenv/config";
import { createTables } from "../src/lib/crawler/db";

async function main() {
  console.log("Creating tables...");
  await createTables();
  console.log("Tables created successfully.");
}

main().catch((err) => {
  console.error("Failed to create tables:", err);
  process.exit(1);
});
