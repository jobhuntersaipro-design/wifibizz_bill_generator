import { NextResponse } from "next/server";
import { sweepPendingRetries } from "@/lib/order-retry";
import { scraperBusy } from "@/actions/order";

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

    // Second job, same tick: notice a submit lock nobody can see.
    //
    // The droplet reaps its own stale jobs, so this is a backstop rather than
    // the remedy — but a lock still held past the server's cap means the reaper
    // did not fire (a wedged /health, an old build), and that is the state that
    // greys out Submit for every agent with nothing on screen to explain it.
    // Logged, not emailed: this runs every 5 minutes, and a mail per tick would
    // be ignored by the second hour.
    let lock: { stuck: boolean; ageS: number | null } = { stuck: false, ageS: null };
    try {
      const health = await scraperBusy();
      const cap = health.maxRuntimeS;
      const age = health.ageS;
      const stuck =
        health.busy && typeof age === "number" && typeof cap === "number" && age > cap;
      lock = { stuck, ageS: age };
      if (stuck) {
        console.error(
          `[cron/retry-sweep] scraper lock held ${age}s, past its ${cap}s cap — ` +
            "the droplet's reaper is not clearing it. Submit is greyed out for every agent. " +
            "Check GET /jobs on the scraper, then POST /jobs/<id>/cancel?force=1.",
        );
      }
    } catch (e) {
      // Never fail the sweep over a health read — starting the owed retries is
      // this route's actual job.
      console.warn("[cron/retry-sweep] lock check failed:", e);
    }

    return NextResponse.json({ ok: true, started, lock });
  } catch (e) {
    console.error("[cron/retry-sweep] failed:", e);
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 });
  }
}
