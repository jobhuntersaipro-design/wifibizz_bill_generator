// Local-development bridge for the Neon serverless driver, for standalone
// scripts (seed-dev-user.ts, verify-db.ts) that construct their own Prisma Neon
// adapter outside of Next.js. The Next.js app configures this inline in
// src/lib/prisma.ts; this module mirrors that for plain `tsx`/node scripts.
//
// It mutates the shared `neonConfig` singleton from `@neondatabase/serverless`
// so the driver talks to a local Postgres via wsproxy instead of a real Neon
// endpoint. No-op unless NEON_WS_LOCAL_PROXY is set, so it is safe to import
// anywhere.
import "dotenv/config"; // load .env early: this runs before app env resolution
import { neonConfig } from "@neondatabase/serverless";

const proxy = process.env.NEON_WS_LOCAL_PROXY;
if (proxy) {
  neonConfig.wsProxy = proxy; // driver appends `?address=host:port`
  neonConfig.useSecureWebSocket = false; // plain ws to the local proxy
  neonConfig.pipelineConnect = false; // local Postgres uses SCRAM, not cleartext
  // webSocketConstructor is left as the Node global WebSocket (Node 22+).
}
