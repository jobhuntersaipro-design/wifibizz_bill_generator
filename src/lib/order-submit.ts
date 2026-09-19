/**
 * Finalizing an in-flight order submit.
 *
 * A submit is a long portal run (minutes) owned by the Flask scraper. BizzFlow
 * starts it, gets a job id back, and then *polls*: the browser polls the
 * progress route while it is open, and `listOrders` reconciles anything left
 * behind when it is not. Both paths land here, so the rules that decide an
 * order's final state live in exactly one place and cannot drift apart.
 *
 * Everything here must be safe to run twice on the same job — two polls can
 * overlap, and reconciliation can race a live poll.
 */
import { prisma } from "@/lib/prisma";
import { attachStageDetail, recordEvent } from "@/lib/order-history";
import {
  CAPTURE_STAGE_PREFIX,
  ERF_NOT_DOWNLOADED,
  LEGACY_PAGE1_CAPTURE_STAGE,
  PAGE1_CAPTURE_SLOT,
  POINT_OF_NO_RETURN,
  STOPPED_MSG,
  SUBMIT_STOPPED,
  isPortalOrderNumber,
  isScreenshotKey,
  movesStagePointer,
  humanizeScraperMessage,
  storedErrorCode,
  submitErrorCopy,
  type StageDetail,
  type StageDetails,
} from "@/lib/order-types";
import { retryPendingAt } from "@/lib/retry-policy";

const SCRAPER_API_URL = process.env.SCRAPER_API_URL ?? "http://localhost:5000";
const ORDER_TOKEN = process.env.ORDER_ENTRY_API_TOKEN ?? "";

export interface OrderJobResult {
  status?: string;
  // The step the run ended on (e.g. customer_order_info).
  stage?: string;
  order_id?: string;
  order_url?: string;
  advance_payment?: string;
  warning?: string;
  // The R2 key of the downloaded e-RF. Its PRESENCE is what marks an order
  // complete — absent means no registration form, whatever else went right.
  erf_key?: string;
  // Stable oe_errors code (e.g. device_out_of_stock) when the scraper could
  // classify the failure. Absent when it could not — the caller then falls back
  // to its own stage-specific wording rather than a blanket "unknown".
  error?: string;
  message?: string;
  // The portal's own numeric code, e.g. "40300338". Carried for the log; the UI
  // re-derives it from the message so the two can never disagree.
  portal_code?: string;
  // Set when the portal refused a device for this package. Recorded so the
  // picker and preflight can stop offering it — the portal only tells us this
  // AFTER the order number exists, so learning it is the only way to avoid
  // burning another order on the same combination.
  rejected_device_code?: string;
  rejected_device_name?: string;
  // The devices the portal actually listed for this package, captured from the
  // Offer dialog. Our stored catalogue is a superset, so this is the truth.
  available_devices?: { code: string; name: string }[];
  // Set when the run recovered by substituting a different device.
  substituted_device_code?: string;
  substituted_device_name?: string;
}

/** One stage milestone from the scraper's append-only history. */
export interface JobStage {
  name: string;
  detail?: StageDetail | null;
  at?: string;
}

export interface JobSnapshot {
  status?: string; // queued | running | done | error
  stage?: string;
  // Append-only stage history. A fast stage used to be overwritten in `stage`
  // before a 2s poll ever saw it, so steps went green by inference; the history
  // is what lets a poll observe every step and its resolved value.
  stages?: JobStage[];
  result?: OrderJobResult;
  error?: string;
  // How the run ended, when the scraper could say: "cancelled" (a person pressed
  // Stop), "portal_timeout", "infra", "unexpected". Only `cancelled` changes what
  // is written here — a stop is a decision, not a failure of the order.
  error_kind?: string;
}

/** What a poll concluded, for the caller to hand back to the browser. */
export interface ProgressState {
  status: string; // the order's status AFTER this poll
  stage: string | null;
  orderId: string | null;
  errorMessage: string | null;
  // oe_errors classification of the failure, when there was a classifiable one.
  errorCode?: string | null;
  done: boolean; // no further polling needed
  // Resolved values per step, so the checklist can name the address it matched
  // rather than just that it checked one.
  details?: StageDetails;
  // R2 key of this attempt's page-1 screenshot, once captured.
  screenshotKey?: string | null;
}

/**
 * Read a job from the scraper.
 *
 * `null` means the job is GONE, not that the request failed — the Flask job
 * registry is in-memory, so a scraper restart erases every in-flight job. That
 * is a distinct outcome from a network blip and the caller must treat it as
 * such (see finalizeMissingJob).
 */
async function fetchJob(jobId: string): Promise<JobSnapshot | null | "unreachable"> {
  try {
    const res = await fetch(`${SCRAPER_API_URL}/jobs/${jobId}`, {
      headers: { "X-Internal-Token": ORDER_TOKEN },
      cache: "no-store",
      // Node's fetch has NO default timeout. Without this a slow or wedged
      // scraper would hang whoever is polling — including `listOrders`, which
      // reconciles before it returns, so the whole drafts list would stall on an
      // unreachable droplet. Reading a job is an in-memory dict lookup; if it
      // hasn't answered in 5s the service is not healthy.
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return null;
    if (!res.ok) return "unreachable";
    return (await res.json()) as JobSnapshot;
  } catch {
    return "unreachable";
  }
}

/**
 * Collapse the scraper's stage history into the latest detail per step.
 *
 * A stage is emitted twice — bare when it starts, again once the portal answers
 * — so the last entry carrying a detail wins. Entries the scraper sent without
 * a detail never clear one that already arrived.
 */
export function collapseStageDetails(stages: JobStage[] | undefined): StageDetails {
  const out: StageDetails = {};
  for (const s of stages ?? []) {
    if (!s?.name || !s.detail?.value) continue;
    out[s.name] = s.detail;
  }
  return out;
}

/**
 * The page-1 frame's R2 key out of a run's collapsed details.
 *
 * A run reports one capture stage per detail screen, but `Order.screenshotUrl`
 * holds exactly one key — what a collapsed row shows to say evidence exists. It
 * is page 1 because that frame is the most representative single image of a
 * submit; the other slots are read per attempt from the status trail.
 *
 * Only a real key qualifies: a failed capture records its reason in the same
 * field, and storing that would put a broken image on the row.
 */
function page1CaptureKey(details: StageDetails): string | null {
  for (const stage of [
    `${CAPTURE_STAGE_PREFIX}${PAGE1_CAPTURE_SLOT}`,
    LEGACY_PAGE1_CAPTURE_STAGE,
  ]) {
    const d = details[stage];
    if (d?.outcome === "ok" && isScreenshotKey(d.value)) return d.value;
  }
  return null;
}

/**
 * Persist everything a job's stage history tells us that the DB doesn't know yet.
 *
 * Runs on EVERY poll, including the one that finds the job already `done` — a
 * run can finish between two polls, and the intermediate steps would otherwise
 * be lost with the in-memory job record.
 *
 * Idempotent by construction: stage rows are inserted only for stages not yet
 * seen on this attempt, and details only fill a row whose message is still null.
 */
async function drainStages(
  id: string,
  attempt: number,
  stages: JobStage[] | undefined,
  currentScreenshotUrl: string | null,
): Promise<{ details: StageDetails; screenshotKey: string | null }> {
  const details = collapseStageDetails(stages);
  const screenshotKey = page1CaptureKey(details);

  if (!stages?.length) return { details, screenshotKey: null };

  // What this attempt has already recorded, so a replayed history is a no-op.
  // `message` comes back too: a poll every 2s over a ten-minute run would
  // otherwise re-issue the same detail writes thousands of times.
  const seen = await prisma.orderStatusEvent.findMany({
    where: { orderId: id, attempt },
    select: { stage: true, message: true },
  });
  const recorded = new Set<string>();
  const needsDetail = new Set<string>();
  for (const e of seen) {
    if (!e.stage) continue;
    recorded.add(e.stage);
    if (e.message === null) needsDetail.add(e.stage);
  }

  // Order matters: insert the stage row first, then fill its detail in.
  for (const s of stages) {
    if (!s?.name || recorded.has(s.name)) continue;
    recorded.add(s.name);
    needsDetail.add(s.name);
    await recordEvent({
      orderId: id, attempt, status: "submitting", stage: s.name,
      // The portal's own timing, not this poll's — otherwise a ten-minute run
      // drained in one burst shows every step taking 0s.
      createdAt: stageTimestamp(s.at),
    });
  }
  for (const [stage, detail] of Object.entries(details)) {
    if (!needsDetail.has(stage)) continue;
    await attachStageDetail(id, attempt, stage, detailMessage(detail));
  }

  // The portal order number, the moment this attempt's portal mints it.
  //
  // Written HERE rather than only on the terminal paths, because a resubmit
  // starts with the PREVIOUS attempt's number still on the row (the submit-start
  // reset deliberately does not blank it — that would erase the only record of a
  // stranded order if the run then died without reporting one). Any terminal
  // path that did not explicitly set it therefore left the old number in place,
  // and the panel, the "needs voiding" flag and the resubmit dialog all named
  // the wrong portal order. Attempt 11 of ORD-0012 minted …429283 while the row
  // still said …429128 from attempt 10.
  //
  // Updating on the capture stage fixes every terminal path at once and never
  // blanks a known number: it only ever replaces one real order id with the
  // newer real order id for the run now in progress.
  const captured = details[POINT_OF_NO_RETURN];
  if (captured?.outcome === "ok" && isPortalOrderNumber(captured.value)) {
    const num = captured.value.trim();
    await prisma.order
      .updateMany({ where: { id, NOT: { orderId: num } }, data: { orderId: num } })
      .catch((err) => console.error("[drainStages] order id:", err));
  }

  if (screenshotKey && screenshotKey !== currentScreenshotUrl) {
    // Latest attempt's frame, so a collapsed row can show evidence exists
    // without loading history.
    await prisma.order
      .update({ where: { id }, data: { screenshotUrl: screenshotKey } })
      .catch((err) => console.error("[drainStages] screenshot url:", err));
  }
  return { details, screenshotKey };
}

/**
 * When a stage happened, as reported by the scraper.
 *
 * Always read as UTC. A droplet running an older build sends a bare
 * `utcnow().isoformat()` with no offset, which `new Date()` would interpret as
 * LOCAL time and shift every step by the server's timezone — so a missing offset
 * is appended rather than trusted. Anything unparseable falls back to insert
 * time, which is late but never wrong by hours.
 */
export function stageTimestamp(at: string | undefined): Date | undefined {
  if (!at) return undefined;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(at);
  const d = new Date(hasZone ? at : `${at}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Timeline text for a resolved stage. Failures and skips say so in words. */
function detailMessage(d: StageDetail): string {
  if (d.outcome === "ok") return d.value;
  const note = d.note ? ` (${d.note})` : "";
  return `${d.value}${note}`;
}

/**
 * Turn a finished job's result into the order's final state.
 *
 * The order of these branches matters. An `error` that still carries an
 * order_id means the portal DID mint the order before failing — persisting that
 * id is what stops a retry from creating a duplicate, so it must be checked
 * before the plain-failure path.
 */
async function applyResult(
  orderId: string,
  result: OrderJobResult,
): Promise<ProgressState> {
  const current = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      attempt: true, stage: true, offerName: true, deviceName: true,
      // Needed to judge, in the SAME write that files the outcome, whether this
      // failure is one an automatic retry will come back for.
      autoRetries: true, autoRetryDisabled: true,
    },
  });
  const attempt = current?.attempt ?? 1;

  // A device substitution means the order no longer matches what the agent
  // picked — persist it so the drafts table can't lie about what was ordered.
  if (result.substituted_device_code) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        deviceCode: result.substituted_device_code,
        deviceName: result.substituted_device_name ?? null,
      },
    });
    await recordEvent({
      orderId, attempt, status: "info", stage: "selecting_device",
      message: `Device substituted: ${current?.deviceName ?? "original"} was refused, ordered ${result.substituted_device_name ?? result.substituted_device_code} instead.`,
    });
  }

  const finish = async (data: {
    status: string;
    orderId?: string | null;
    errorMessage?: string | null;
    errorCode?: string | null;
    /** Where the run ended, as the scraper reported it. */
    stage?: string | null;
  }): Promise<ProgressState> => {
    // The pointer only moves on polls, so a run the webhook finalizes can still
    // be sitting on `creating_customer` — which is where the admin page used to
    // file a failure at Customer Order Information.
    const stage = movesStagePointer(data.stage) ? data.stage! : null;
    const o = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: data.status,
        ...(data.orderId !== undefined ? { orderId: data.orderId } : {}),
        errorMessage: data.errorMessage ?? null,
        errorCode: data.errorCode ?? null,
        ...(stage ? { stage, stageAt: new Date() } : {}),
        jobId: null, // the run is over — nothing left to reconcile
        // Stamped in the same write as the outcome, deliberately. A second
        // write would leave a window where the row reads Failed with a live
        // Submit button before anything marks it as about to be retried — which
        // is the window this exists to close. Null on a success, which also
        // clears a claim left by an earlier attempt.
        autoRetryAt: retryPendingAt({
          status: data.status,
          errorCode: data.errorCode ?? null,
          errorMessage: data.errorMessage ?? null,
          autoRetries: current?.autoRetries ?? 0,
          attempt,
          autoRetryDisabled: current?.autoRetryDisabled,
          orderId: data.orderId ?? null,
        }),
      },
    });
    await recordEvent({
      orderId, attempt, status: data.status, stage: o.stage,
      message: data.errorMessage ?? null,
      errorCode: data.errorCode ?? null,
    });
    return {
      status: o.status,
      stage: o.stage,
      orderId: o.orderId,
      errorMessage: o.errorMessage,
      errorCode: o.errorCode,
      done: true,
    };
  };

  // An order is only finished when its registration form is in hand. The scraper
  // reports `erf_key` when the e-RF reached R2 and ERF_NOT_DOWNLOADED when it
  // did not — including the do_pay=false gated stop, which never pays and so
  // never produces one. Until ORDER_ENTRY_DO_PAY=true that is EVERY run.
  //
  // A missing form never yields `failed`, whatever else happened: `failed`
  // re-enables the normal Submit button, and doing that to an order the portal
  // may already have charged for is how a customer gets billed twice. It
  // becomes `warning`, which keeps the order number, keeps it out of batch
  // submit, and leaves only the Resubmit path behind its confirmation dialog.
  const erfMissing = !result.erf_key;

  // Full flow through Pay done ("submitted"), or the legacy order-id-only path.
  if ((result.status === "submitted" || result.status === "success") && result.order_id) {
    const ap = result.advance_payment
      ? `Advance Payment RM${result.advance_payment} was required.`
      : null;
    if (erfMissing) {
      const why = result.message || result.warning
        || "The run finished without downloading the e-RF.";
      return finish({
        status: "warning",
        orderId: result.order_id,
        errorMessage: [why, ap].filter(Boolean).join(" "),
        errorCode: ERF_NOT_DOWNLOADED,
      });
    }
    const note = [result.warning, ap].filter(Boolean).join(" ") || null;
    return finish({ status: "submitted", orderId: result.order_id, errorMessage: note });
  }

  if (result.status === "error") {
    // A code we have copy for is rendered as a titled block with its own
    // explanation and remedy, so the message stays the portal's VERBATIM
    // wording. Wrapping it in our own prose here would put the explanation in
    // two voices and bury the sentence the agent can quote at Unifi support.
    //
    // The code itself is stored either way (see storedErrorCode): copy is how a
    // failure reads, never whether it is recorded.
    const code = storedErrorCode(result.error);
    const hasCopy = !!submitErrorCopy(code);
    const portalMsg = humanizeScraperMessage(result.message);
    if (result.order_id) {
      // Order EXISTS in the portal despite the failure. Surface as a warning to
      // verify/complete by hand — a plain "failed" would re-enable submit and
      // invite a duplicate.
      const msg = hasCopy
        ? portalMsg || "The portal returned an error."
        : `Order ${result.order_id} was created but the flow didn't finish: ${
            portalMsg || result.error || "error"
          }. Verify in the portal before retrying.`;
      return finish({
        status: "warning", orderId: result.order_id, errorMessage: msg, errorCode: code,
        stage: result.stage,
      });
    }
    return finish({
      status: "failed",
      errorMessage: portalMsg || result.error || "The portal returned an error.",
      errorCode: code,
      stage: result.stage,
    });
  }

  // e.g. duplicate customer records. Keep any order id so a partially-placed
  // order can't be re-submitted.
  if (result.warning) {
    return finish({
      status: "warning",
      ...(result.order_id ? { orderId: result.order_id } : {}),
      errorMessage: result.warning,
      errorCode: storedErrorCode(result.error),
      stage: result.stage,
    });
  }

  // An order exists in the portal but no registration form came back — the
  // do_pay=false gated stop lands here. "Order Entered" would claim a finished
  // order, so it reports the code instead.
  //
  // Scoped to runs that actually placed an order: the customer-create-only path
  // below has no order id, nothing was ordered, and there is no form for it to
  // be missing.
  if (result.order_id && erfMissing) {
    return finish({
      status: "warning",
      orderId: result.order_id,
      errorMessage: result.message
        || "The order was placed but no e-RF (registration form) was downloaded.",
      errorCode: ERF_NOT_DOWNLOADED,
    });
  }

  // Customer profile created — the legacy stop-early result. It usually has no
  // order id, but when it does that id must be written: passing nothing here is
  // what let a previous attempt's number survive on the row.
  return finish({
    status: "order_entered",
    ...(result.order_id ? { orderId: result.order_id } : {}),
    errorMessage: null,
  });
}

/**
 * A `submitting` order whose job the scraper no longer knows about.
 *
 * This is genuinely unknown, not failed: the run may have completed in the
 * portal moments before the scraper restarted. Marking it `failed` would
 * re-enable submit and risk a duplicate order, so it becomes a warning telling
 * the agent to check the portal.
 */
/** The order service no longer knows the job — it restarted mid-run. */
const JOB_LOST = "job_lost";

async function finalizeMissingJob(id: string): Promise<ProgressState> {
  const before = await prisma.order.findUnique({
    where: { id },
    select: { autoRetries: true, attempt: true, autoRetryDisabled: true },
  });
  const errorMessage =
    "The submit run was lost (the order service restarted). Check the portal " +
    "for this customer before submitting again — the order may already exist.";
  const o = await prisma.order.update({
    where: { id },
    data: {
      status: "warning",
      jobId: null,
      errorMessage,
      errorCode: JOB_LOST,
      // Same rule as every other finalization: if this is one the automatic
      // retry will come back for, the row must say so instead of offering a
      // Submit button that would start a second run against it.
      autoRetryAt: retryPendingAt({
        status: "warning",
        errorCode: JOB_LOST,
        errorMessage,
        autoRetries: before?.autoRetries ?? 0,
        attempt: before?.attempt ?? 1,
        autoRetryDisabled: before?.autoRetryDisabled,
      }),
    },
  });
  await recordEvent({
    orderId: id, attempt: o.attempt, status: "warning", stage: o.stage,
    message: o.errorMessage, errorCode: JOB_LOST,
  });
  return {
    status: o.status,
    stage: o.stage,
    orderId: o.orderId,
    errorMessage: o.errorMessage,
    done: true,
  };
}

/**
 * Poll one in-flight order once and persist whatever changed.
 *
 * Safe to call concurrently and after the fact — an order with no jobId, or one
 * already past `submitting`, short-circuits to its current state.
 */
export async function pollOrderProgress(id: string): Promise<ProgressState | null> {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return null;

  const current: ProgressState = {
    status: order.status,
    stage: order.stage,
    orderId: order.orderId,
    errorMessage: order.errorMessage,
    done: order.status !== "submitting",
  };
  // Already finalized (possibly by a concurrent poll) — nothing to do.
  if (!order.jobId || order.status !== "submitting") return current;

  const job = await fetchJob(order.jobId);
  // A transient network failure must NOT be mistaken for a finished run; keep
  // the order in flight and let the next poll try again.
  if (job === "unreachable") return current;
  if (job === null) return finalizeMissingJob(id);

  // Drain the history BEFORE branching on status. A run can finish between two
  // polls, and the intermediate steps — with the values the portal resolved —
  // exist only in the job record, which the scraper drops on restart.
  const { details, screenshotKey } = await drainStages(
    id, order.attempt, job.stages, order.screenshotUrl,
  );
  const withDetails = (s: ProgressState): ProgressState => ({
    ...s,
    details,
    screenshotKey,
  });

  if (job.status === "error") {
    // A run a PERSON stopped is not a failure of the order, and it must not be
    // handed straight back to the automatic retry — which is exactly what an
    // unclassified failure would be. `submit_stopped` is terminal in
    // retry-policy, so the stop stands until somebody decides otherwise.
    const stopped = job.error_kind === "cancelled";
    const errorMessage = stopped
      ? job.error || STOPPED_MSG
      : job.error || "The portal run failed.";
    // The droplet's own classification of how the run died (portal_timeout,
    // infra, abandoned, unexpected …) — kept so it never reads Unclassified.
    const errorCode = stopped ? SUBMIT_STOPPED : storedErrorCode(job.error_kind);
    const o = await prisma.order.update({
      where: { id },
      data: {
        status: "failed",
        jobId: null,
        errorMessage,
        errorCode,
        autoRetryAt: retryPendingAt({
          status: "failed",
          errorCode,
          errorMessage,
          autoRetries: order.autoRetries,
          attempt: order.attempt,
          autoRetryDisabled: order.autoRetryDisabled,
          orderId: order.orderId,
        }),
      },
    });
    await recordEvent({
      orderId: id, attempt: order.attempt, status: "failed", stage: o.stage,
      message: o.errorMessage, errorCode,
    });
    return withDetails({
      status: o.status,
      stage: o.stage,
      orderId: o.orderId,
      errorMessage: o.errorMessage,
      errorCode: o.errorCode,
      done: true,
    });
  }

  if (job.status === "done") return withDetails(await applyResult(id, job.result ?? {}));

  // Still running — move the order's pointer to the latest stage. The history
  // rows behind it were already written by drainStages, which sees every stage
  // rather than only the one a poll happened to land on.
  //
  // Only MILESTONES may move the pointer (see movesStagePointer). A capture
  // taken during "Creating customer profile" used to land here and make the live
  // view claim the run had gone back to step 1, where it stayed until the next
  // real stage — nearly a minute on the run that reported it. The frames
  // themselves are unaffected: drainStages recorded them above, on its own path,
  // before this branch is ever reached.
  if (job.stage && job.stage !== order.stage && movesStagePointer(job.stage)) {
    const o = await prisma.order.update({
      where: { id },
      data: { stage: job.stage, stageAt: new Date() },
    });
    // Older scrapers send no history, so nothing wrote this row above. Keep the
    // pre-history behaviour for them — the droplet and Vercel deploy separately
    // and a lagging scraper must still produce a timeline.
    if (!job.stages?.length) {
      await recordEvent({
        orderId: id, attempt: order.attempt, status: "submitting", stage: job.stage,
      });
    }
    return withDetails({ ...current, stage: o.stage });
  }
  return withDetails(current);
}

/**
 * How long an order may sit in `submitting` without its stage moving before a
 * reconcile is attempted. Comfortably longer than the slowest single portal
 * step (the Customer Order Information page waits up to 45s on its own) so a
 * merely slow step is never mistaken for an abandoned run.
 */
const STALE_MS = 3 * 60 * 1000;

/**
 * Reconcile orders left mid-flight by a browser that went away.
 *
 * Called from listOrders so simply reopening the page repairs them. Without
 * this an order whose submitting tab was closed would sit in `submitting`
 * forever, since nothing else ever reads its job.
 */
export async function reconcileStaleSubmits(userId: string | null): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const stale = await prisma.order.findMany({
    where: {
      status: "submitting",
      jobId: { not: null },
      ...(userId ? { userId } : {}),
      OR: [{ stageAt: null }, { stageAt: { lt: cutoff } }],
      updatedAt: { lt: cutoff },
    },
    select: { id: true },
    // Bounded because this runs BEFORE the drafts list is returned: with the 5s
    // per-fetch cap, a dead scraper costs one 5s wait, not one per batch of
    // orders. Anything not reached this time is picked up on the next load.
    take: 10,
  });
  // Best-effort: a failure here must never break the list itself.
  await Promise.allSettled(stale.map((o) => pollOrderProgress(o.id)));

  // A net for the automatic retry, not its trigger — the webhook is that, and it
  // is what makes a retry survive a closed tab. This catches the case where the
  // webhook never arrived (the droplet has no BIZZFLOW_WEBHOOK_URL set, or its
  // secret does not match), plus any retry the droplet was too busy to accept
  // when it was first owed. Same best-effort rule: the list must still render.
  //
  // Imported lazily to keep the module cycle out of the build — order-retry
  // imports order-start, which imports actions that import this file.
  try {
    const { maybeAutoRetry, sweepPendingRetries } = await import("@/lib/order-retry");
    for (const o of stale) await maybeAutoRetry(o.id).catch(() => {});
    await sweepPendingRetries();
  } catch (e) {
    console.error("[reconcile] retry sweep failed:", e);
  }
}
