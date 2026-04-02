import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log("Renaming column 'name' to 'full_name'...");
  await sql`ALTER TABLE wifibizz_cases RENAME COLUMN name TO full_name`;

  console.log("Adding column 'full_address'...");
  await sql`ALTER TABLE wifibizz_cases ADD COLUMN IF NOT EXISTS full_address TEXT`;

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
