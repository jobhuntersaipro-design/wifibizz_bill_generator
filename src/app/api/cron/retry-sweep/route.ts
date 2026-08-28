import { NextResponse } from "next/server";
import { sweepPendingRetries } from "@/lib/order-retry";

/**
 * Start the automatic retries that were owed but could not be handed off.
 *
 * A retry is normally started the instant its run finishes, from the
 * `order_finished` webhook. This exists for the one case that cannot be: the
 * droplet drives a single browser and refuses an overlapping job with a 409, so
 * a retry owed while somebody else's submit is running has to wait. Vercel
 * cannot sleep between requests, so "wait" is a due date on the row and this is
 * what comes back for it.
 *
 * Without this the deferred ones would only start when a human opened the
 * Orders page, which is exactly the dependency the retry was meant to remove.
 */

const CRON_SECRET = process.env.CRON_SECRET ?? "";

export async function GET(req: Request) {
  // Vercel Cron sends this header; an unauthenticated route here would let
  // anyone on the internet drive real portal runs.
  const auth = req.headers.get("authorization") ?? "";
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const started = await sweepPendingRetries();
    return NextResponse.json({ ok: true, started });
  } catch (e) {
    console.error("[cron/retry-sweep] failed:", e);
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 });
  }
}
