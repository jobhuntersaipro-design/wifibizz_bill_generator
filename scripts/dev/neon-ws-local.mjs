// Local-development bridge for the Neon serverless driver.
//
// In production the app talks to Neon over WebSockets. Locally there is no Neon
// endpoint, so we run a plain Postgres plus a websocket->TCP proxy (wsproxy) and
// point the driver at it. This module mutates the shared `neonConfig` singleton
// exported by `@neondatabase/serverless`; because `@prisma/adapter-neon`
// imports the same module instance, preloading this file (via
// `node --import`) reconfigures Prisma's Neon adapter without touching any app
// source. It is a no-op unless NEON_WS_LOCAL_PROXY is set, so it is safe to load
// everywhere.
import "dotenv/config"; // load .env early: this runs before Next.js reads env
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

const proxy = process.env.NEON_WS_LOCAL_PROXY;
if (proxy) {
  neonConfig.webSocketConstructor = ws;
  neonConfig.wsProxy = proxy; // driver appends `?address=host:port`
  neonConfig.useSecureWebSocket = false; // plain ws to the local proxy
  neonConfig.pipelineConnect = false; // local Postgres uses SCRAM, not cleartext
  // forceDisablePgSSL defaults to true, which strips sslmode for the local DB.
}
