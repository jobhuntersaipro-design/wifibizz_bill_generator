/**
 * Order references and the status trail.
 *
 * The Order row only ever holds the LATEST state, which is enough to render a
 * badge and nothing else. Answering "why did this fail, and did it fail the same
 * way last time?" needs an append-only trail — that is what `recordEvent` builds.
 */
import { prisma } from "@/lib/prisma";

/**
 * Next short reference, e.g. "ORD-0042".
 *
 * Backed by a Postgres sequence rather than a count(*): two agents saving a
 * draft in the same second must never be handed the same number, and a sequence
 * is the only thing that guarantees that without locking the table.
 */
export async function nextOrderReference(): Promise<string> {
  const rows =
    await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('order_reference_seq') AS n`;
  const n = Number(rows[0]?.n ?? 0);
  return `ORD-${String(n).padStart(4, "0")}`;
}

export interface StatusEventInput {
  orderId: string;
  attempt: number;
  status: string;
  stage?: string | null;
  message?: string | null;
  // oe_errors classification, on failure events. Stored per event as well as on
  // the order so the trail can answer "did it fail this same way last time?" —
  // which is the question that turns one refusal into a pattern worth acting on.
  errorCode?: string | null;
  // When the step actually happened, if known. Stage rows are drained from the
  // scraper's history in a burst, so insert time would compress a ten-minute run
  // into one instant and make every per-step timing read as 0s.
  createdAt?: Date;
}

/**
 * Append one status event.
 *
 * Never throws: the trail is a diagnostic, and losing a row from it must not be
 * able to fail the submit it is describing.
 */
export async function recordEvent(e: StatusEventInput): Promise<void> {
  try {
    await prisma.orderStatusEvent.create({
      data: {
        orderId: e.orderId,
        attempt: e.attempt,
        status: e.status,
        stage: e.stage ?? null,
        message: e.message ?? null,
        errorCode: e.errorCode ?? null,
        ...(e.createdAt ? { createdAt: e.createdAt } : {}),
      },
    });
  } catch (err) {
    console.error("[recordEvent] failed (continuing):", err);
  }
}

/**
 * Attach the value the portal resolved to a stage row already in the trail.
 *
 * The trail stays append-only in ROWS — this never inserts, it fills in the
 * message of the row that stage already wrote. A stage is reported twice (bare
 * when it starts, again once the portal answers), and a second row per stage
 * would show every step name twice in the timeline.
 *
 * The `message: null` guard makes this idempotent and race-safe: once a detail
 * is written the row no longer matches, so overlapping polls replaying the same
 * job history are a no-op rather than a last-writer-wins scramble.
 *
 * `status: "submitting"` is load-bearing, not decoration. A run's TERMINAL row
 * carries a stage too, and a clean finish leaves its message null — so without
 * this a poll racing the finish would stamp a step's detail onto the
 * "Submitted" row, which would then read as if the order ended on that step.
 */
export async function attachStageDetail(
  orderId: string,
  attempt: number,
  stage: string,
  message: string,
): Promise<void> {
  if (!message) return;
  try {
    await prisma.orderStatusEvent.updateMany({
      where: { orderId, attempt, stage, message: null, status: "submitting" },
      data: { message },
    });
  } catch (err) {
    console.error("[attachStageDetail] failed (continuing):", err);
  }
}

export interface StatusEventView {
  id: string;
  attempt: number;
  stage: string | null;
  status: string;
  message: string | null;
  errorCode: string | null;
  createdAt: string;
}

/** One submit run's worth of events, newest run first. */
export interface AttemptView {
  attempt: number;
  startedAt: string;
  endedAt: string | null;
  outcome: string; // the run's final status, or "submitting" while live
  events: StatusEventView[];
}

/**
 * Group a flat event stream into attempts for the timeline.
 *
 * Newest attempt first, because that is the one an agent is asking about; the
 * events WITHIN an attempt stay chronological, because that is the story of what
 * happened.
 */
export function groupByAttempt(events: StatusEventView[]): AttemptView[] {
  const byAttempt = new Map<number, StatusEventView[]>();
  for (const e of events) {
    const list = byAttempt.get(e.attempt);
    if (list) list.push(e);
    else byAttempt.set(e.attempt, [e]);
  }

  // "cancelled" joined when the portal cancel became its own attempt-like run:
  // its terminal event carries that status, and without it here a successful
  // cancel's group would read as Running forever.
  const TERMINAL = new Set(["submitted", "failed", "warning", "order_entered", "cancelled"]);
  return [...byAttempt.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([attempt, list]) => {
      const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      // The last TERMINAL event, not the last event: info events legitimately
      // trail a finished run (a manual cancellation note, a data correction),
      // and reading one as "still running" relabelled a submitted attempt as
      // Running the moment it was cancelled.
      const ended =
        [...sorted].reverse().find((e) => TERMINAL.has(e.status ?? "")) ?? null;
      return {
        attempt,
        startedAt: sorted[0]?.createdAt ?? "",
        endedAt: ended?.createdAt ?? null,
        outcome: ended?.status ?? "submitting",
        events: sorted,
      };
    });
}
