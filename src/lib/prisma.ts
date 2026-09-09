import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";

// Local development only: when NEON_WS_LOCAL_PROXY is set, bridge the Neon
// serverless (WebSocket) driver to a plain local Postgres through a
// websocket->TCP proxy (Neon's `wsproxy`) instead of a real Neon endpoint. This
// block is a no-op in production, where the variable is unset and the driver
// talks to Neon directly. See scripts/dev/ for the local proxy + setup.
if (process.env.NEON_WS_LOCAL_PROXY) {
  neonConfig.wsProxy = process.env.NEON_WS_LOCAL_PROXY;
  neonConfig.useSecureWebSocket = false; // plain ws to the local proxy
  neonConfig.pipelineConnect = false; // local Postgres uses SCRAM, not cleartext
  // webSocketConstructor is left as the Node global WebSocket (Node 22+).
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
