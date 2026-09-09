// Create/refresh a local demo login user so the auth flow can be exercised
// end-to-end in development. Run with:
//   NEON_WS_LOCAL_PROXY=localhost:5433/v1 npx tsx scripts/dev/seed-dev-user.ts
import "dotenv/config";
import "./neon-ws-local.mjs";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import bcrypt from "bcryptjs";

const EMAIL = process.env.DEV_USER_EMAIL ?? "demo@bizzflow.dev";
const PASSWORD = process.env.DEV_USER_PASSWORD ?? "DemoPass123!";

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
  });
  const hash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { password: hash, name: "Demo Agent" },
    create: { email: EMAIL, password: hash, name: "Demo Agent", orderEntryEnabled: true },
  });
  console.log(`USER_READY email=${user.email} id=${user.id}`);
  console.log(`LOGIN => ${EMAIL} / ${PASSWORD}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
