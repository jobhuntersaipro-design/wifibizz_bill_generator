/**
 * Starting a submit run, with no browser session involved.
 *
 * Split out of `src/actions/order.ts` because that file is a `"use server"`
 * module — every export there is a directly POST-able endpoint — and an
 * automatic retry needs to start a run from the server with no session at all.
 * Putting the starter here keeps it callable from the webhook handler without
 * also publishing it to the internet.
 *
 * The single submit, the batch runner and the automatic retry all come through
 * `startSubmitRun`, so a field added for one of them cannot go missing from
 * another.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/order-history";
import { appointmentPolicyFor } from "@/lib/appointment-settings";
import { mandatoryGroupsFor } from "@/actions/plans";

export const SCRAPER_API_URL = process.env.SCRAPER_API_URL ?? "http://localhost:5000";
export const ORDER_TOKEN = process.env.ORDER_ENTRY_API_TOKEN ?? "";

export const SESSION_EXPIRED_MSG =
  "Your dealer session has expired. Reconnect on the Order Entry page, then submit again.";

/**
 * The raw order the scraper is given for one run.
 *
 * Shared by the single submit and the server-side batch runner so the two can
 * never drift: a field added for one path but not the other would submit a
 * different order depending on which button the agent pressed.
 *
 * The user id is deliberately NOT included — the scraper takes it from the
 * authenticated `user_key`, so a request body can't redirect an upload into
 * someone else's R2 namespace.
 */
export function buildOrderJobRequest(
  order: Prisma.OrderGetPayload<object>,
  attempt: number,
  offerGroups: Awaited<ReturnType<typeof mandatoryGroupsFor>>,
) {
  return {
    offerGroups: offerGroups.all,
    // Device-kind groups only — the pool the scraper may substitute from if the
    // portal refuses the chosen device. A channel bundle is not a device.
    deviceOfferGroups: offerGroups.devices,
    // Built from the order itself, so the single submit and the batch runner
    // cannot book different slots for the same draft. `strategy`/`fixedDate`
    // are pinned inside appointmentPolicyFor — the scraper still understands a
    // fixed date, but nothing in the app can send one.
    appointment: appointmentPolicyFor(order.appointmentLeadHours),
    id: order.id,
    idType: order.idType,
    idNumber: order.idNumber,
    fullName: order.fullName,
    gender: order.gender,
    birthday: order.birthday,
    race: order.race,
    nationality: order.nationality,
    mobilePrefix: order.mobilePrefix,
    mobile: order.mobile,
    email: order.email,
    street: order.street,
    postcode: order.postcode,
    city: order.city,
    state: order.state,
    country: order.country,
    addressId: order.addressId,
    addressFull: order.addressFull,
    serviceCategory: order.serviceCategory,
    offerName: order.offerName,
    offerCategory: order.offerCategory,
    deviceCode: order.deviceCode,
    deviceName: order.deviceName,
    remarks: order.remarks,
    documents: order.documents,
    // Which run this is, so the scraper can file this attempt's captures against
    // this order AND attempt (`id` above already identifies the order).
    attempt,
  };
}

/**
 * Is this user's dealer session still good enough to start a run?
 *
 * Reads the stored expiry rather than calling the portal: it costs nothing and
 * catches the common case (an agent who never reconnected today). A session that
 * dies mid-run is still handled by the run itself.
 */
export async function dealerSessionLive(userId: string): Promise<boolean> {
  const dealer = await prisma.dealerAccount.findUnique({
    where: { userId },
    select: { sessionExpiresAt: true },
  });
  return !!dealer?.sessionExpiresAt && dealer.sessionExpiresAt.getTime() > Date.now();
}

export type StartRunResult =
  | { ok: true; jobId: string; attempt: number }
  /**
   * `busy` separates "the droplet is holding its single-browser lock" from
   * "this order is wrong". The retry path must not spend a try on the former —
   * it is somebody else's job running, not a failure of this order.
   */
  | { ok: false; busy: boolean; error: string };

/**
 * Start one submit run against the scraper.
 *
 * `userKey` is whose dealer session the run uses, which is NOT always the
 * draft's owner: a superadmin submits another agent's draft under their own
 * portal session. It is recorded on the order so an automatic retry can run
 * under the same session rather than guessing.
 */
export async function startSubmitRun(
  order: Prisma.OrderGetPayload<object>,
  opts: { userKey: string; auto?: boolean; batchOf?: number },
): Promise<StartRunResult> {
  if (!ORDER_TOKEN) {
    return { ok: false, busy: false, error: "Order service is not configured." };
  }

  // Each submit is its own attempt in the status history, so the timeline can
  // show "attempt 3 failed the same way attempt 1 did".
  const attempt = order.attempt + 1;

  // A start that never happened always lands the order in a real terminal
  // state, busy or not: by this point the row has already been flipped to
  // `submitting`, and leaving it there would strand a run that does not exist —
  // no job id to poll, and nothing to reconcile it back. `busy` is carried in
  // the RETURN so the retry orchestrator can tell "someone else's job is
  // running" from "this order is wrong", without that distinction having to
  // survive in the row.
  const fail = async (message: string, opts_: { busy?: boolean } = {}) => {
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "failed", errorMessage: message },
    });
    return { ok: false as const, busy: !!opts_.busy, error: message };
  };

  await prisma.order.update({
    where: { id: order.id },
    data: {
      attempt,
      // Whose session this run uses — read back by the automatic retry.
      lastSubmitUserId: opts.userKey,
      // A person pressing Submit is a new decision and hands back a full budget.
      // Held HERE, in the one place every start goes through, so the reset rule
      // cannot be forgotten by a new caller.
      ...(opts.auto ? {} : { autoRetries: 0, autoRetryAt: null }),
    },
  });

  await recordEvent({
    orderId: order.id,
    attempt,
    status: "submitting",
    stage: "validating_draft",
    message: opts.batchOf
      ? `Submit started (batch of ${opts.batchOf}).`
      : opts.auto
        ? "Automatic retry started."
        : "Submit started.",
  });

  // Read the stored expiry rather than calling the portal: it costs nothing and
  // catches the common case (an agent who never reconnected today).
  if (!(await dealerSessionLive(opts.userKey))) {
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "failed", stage: "checking_session", errorMessage: SESSION_EXPIRED_MSG },
    });
    await recordEvent({
      orderId: order.id, attempt, status: "failed",
      stage: "checking_session", message: SESSION_EXPIRED_MSG,
    });
    return { ok: false, busy: false, error: SESSION_EXPIRED_MSG };
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: "submitting",
      errorMessage: null,
      errorCode: null,
      // Cleared so this attempt gets its own email, exactly as the batch path
      // does. The guard is per-send, not per-order-lifetime — a resubmitted
      // order is news again.
      notifiedAt: null,
      stage: "creating_customer",
      stageAt: new Date(),
    },
  });

  // The mandatory offer-group names an admin recorded for this plan. The scraper
  // expands these groups by name instead of guessing at the portal's red "*".
  const offerGroups = await mandatoryGroupsFor(order.offerName);
  const reqOrder = buildOrderJobRequest(order, attempt, offerGroups);

  try {
    // Full per-order flow: create the customer profile, then feasibility -> Order
    // -> attach the customer -> capture the order id. One dealer session.
    const startRes = await fetch(`${SCRAPER_API_URL}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": ORDER_TOKEN },
      cache: "no-store",
      // Starting a job is a payload-build + thread-spawn on the scraper — it
      // never legitimately takes long. Without this, Node's fetch waits forever
      // and a wedged droplet surfaces as a platform timeout instead of an error
      // the agent can read.
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        order: reqOrder,
        user_key: opts.userKey,
        full_order: true,
        // Real submit: the scraper defaults dry_run=true, so opt OUT explicitly to
        // actually click Order + drive the whole New Connection flow through Pay.
        dry_run: false,
        // do_pay clicks the REAL, billable Pay button. Default false (stops at the
        // Pay gate). Enable per-environment via ORDER_ENTRY_DO_PAY=true.
        do_pay: process.env.ORDER_ENTRY_DO_PAY === "true",
      }),
    });
    const start = (await startRes.json().catch(() => ({}))) as {
      job_id?: string;
      error?: string;
      message?: string;
    };
    if (!startRes.ok || !start.job_id) {
      // The droplet refuses with 409 while its capacity is taken —
      // USER_JOB_IN_PROGRESS (a run already going on this account) or
      // SERVER_AT_CAPACITY (every slot busy). Neither is this order failing, so
      // both are reported as busy and the order is left where it was.
      //
      // Keyed on the STATUS, not the code, deliberately: the codes have already
      // split once (from the old JOB_IN_PROGRESS), and a droplet running an
      // older or newer build must still be understood. 503 SERVER_LOW_MEMORY is
      // the same kind of answer — the box, not the order.
      const busy = startRes.status === 409 || startRes.status === 503;
      return fail(start.message || "Couldn't start the order job.", { busy });
    }

    await prisma.order.update({ where: { id: order.id }, data: { jobId: start.job_id } });
    return { ok: true, jobId: start.job_id, attempt };
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      return fail(
        "The order service didn't respond within 10 seconds — it may be overloaded. Try again shortly.",
        // Unreachable is not this order's fault either: an automatic retry
        // should come back to it rather than spend a try on a dead box.
        { busy: true },
      );
    }
    return fail(e instanceof Error ? e.message : "Order service unreachable.", { busy: true });
  }
}
