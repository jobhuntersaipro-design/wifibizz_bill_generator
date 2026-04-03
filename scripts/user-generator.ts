import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import "dotenv/config";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function createUser(name: string, email: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.error(`User with email "${email}" already exists.`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, password: hash },
  });

  console.log(`User created successfully:`);
  console.log(`  ID:    ${user.id}`);
  console.log(`  Name:  ${user.name}`);
  console.log(`  Email: ${user.email}`);
}

async function verifyUser(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email "${email}".`);
    process.exit(1);
  }
  if (!user.password) {
    console.error(`User "${email}" has no password set.`);
    process.exit(1);
  }

  const isValid = await bcrypt.compare(password, user.password);
  console.log(`  Email:    ${user.email}`);
  console.log(`  Name:     ${user.name}`);
  console.log(`  Password: ${isValid ? "VALID" : "INVALID"}`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "verify") {
    if (args.length < 3) {
      console.log("Usage: npx tsx scripts/user-generator.ts verify <email> <password>");
      process.exit(1);
    }
    await verifyUser(args[1], args[2]);
  } else if (command === "create") {
    if (args.length < 4) {
      console.log('Usage: npx tsx scripts/user-generator.ts create <name> <email> <password>');
      process.exit(1);
    }
    await createUser(args[1], args[2], args[3]);
  } else {
    console.log("Commands:");
    console.log('  create <name> <email> <password>  — Create a new user');
    console.log("  verify <email> <password>         — Verify a user's password");
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error("Error:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
