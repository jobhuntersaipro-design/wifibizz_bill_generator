// Smoke-test the RUNTIME database path: the Neon serverless WebSocket driver
// (via wsproxy) + Prisma Neon adapter, exactly as the Next.js app uses it.
import "dotenv/config";
import "./neon-ws-local.mjs";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

async function main() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const email = `dev+${Date.now()}@example.com`;
  const created = await prisma.user.create({
    data: { name: "Dev Smoke Test", email },
  });
  const count = await prisma.user.count();
  const cases = await prisma.wifibizzCase.count();
  console.log("CREATED_USER_ID", created.id);
  console.log("USER_COUNT", count);
  console.log("WIFIBIZZ_CASE_COUNT", cases);
  await prisma.$disconnect();
  console.log("DB_RUNTIME_PATH_OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
