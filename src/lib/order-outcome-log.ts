/**
 * The outcome log: one row per terminal outcome of one submit attempt.
 *
 * The Unifi UI sentence is the reason an attempt failed. BizzFlow's own class
 * (`unclassified`, `job_lost`, a scraper slug) is a grouping key, never the
 * why. When the portal showed no text, the death-screen frame is the evidence.
 *
 * Every terminal event `recordEvent` files is mirrored as one row into a Google
 * Sheet. The mapping is a table and pure functions, testable without Prisma or
 * Google. The sink never throws: losing a log row must not fail the submit.
 */
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/notifications/templates";
import {
  isCaptureStage,
  isScreenshotKey,
  portalCodeFrom,
} from "@/lib/order-types";
import type { StatusEventInput } from "@/lib/order-history";

/** What the builder needs of the order. The sink selects exactly this. */
export interface OutcomeOrder {
  id: string;
  reference: string | null;
  addressFull: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  state: string | null;
  orderId: string | null;
  screenshotUrl: string | null;
  user: { email: string | null } | null;
}

export interface PortalUiInput {
  /** The scraper's dedicated Unifi-UI field, when it sent one. */
  portalMessage?: string | null;
  /** The dialog object the scraper read off the portal. */
  dialog?: { message?: string | null; title?: string | null } | null;
  /** `result.message` or a trail message — may be our wrapping. */
  message?: string | null;
}

/** One terminal outcome of one submit attempt, as one sheet row. */
export interface AttemptOutcome {
  timestamp: string;
  address: string;
  step: string;
  errorClass: string;
  portalMessage: string;
  screenshotOrLog: string;
  orderId: string;
  outcome: string;
  reference: string;
  attempt: number;
  portalCode: string;
  agent: string;
}

export const OUTCOME_SHEET_HEADERS = [
  "timestamp",
  "address",
  "step",
  "error_class",
  "portal_message",
  "screenshot_or_log",
  "order_id",
  "outcome",
  "reference",
  "attempt",
  "portal_code",
  "agent",
] as const;

type Header = (typeof OUTCOME_SHEET_HEADERS)[number];

/**
 * Grouping labels that are ours, not the portal's. Never a `portal_message`.
 */
const INTERNAL_CLASSES = new Set([
  "unclassified",
  "success",
  "order_entered",
  "job_lost",
  "infra",
  "unexpected",
  "runner_died",
  "abandoned",
  "portal_timeout",
  "submit_stopped",
  "session_expired",
  "exception",
]);

/**
 * Sentences BizzFlow or the job runner wrote. They describe us, not Unifi.
 * Matched as a prefix on the lowercased candidate.
 */
const AUTHORED_PREFIXES = [
  "the submit run was lost",
  "the portal run failed",
  "stopped by the agent",
  "the portal did not respond in time",
  "your dealer session has expired",
  "couldn't start the order job",
  "the order service",
  "the run finished without downloading",
  "the order was placed but no e-rf",
  "advance payment rm",
  "screenshot not ",
];

/**
 * The Unifi UI sentence, or empty when the portal showed nothing we can quote.
 *
 * Empty is a real answer: the death-screen frame is then the reason. A BizzFlow
 * class or our own wrapping must never fill this column in their place.
 */
export function portalUiText(input: PortalUiInput): string {
  const fromDialog = (input.dialog?.message ?? "").trim();
  const explicit = (input.portalMessage ?? "").trim();
  for (const candidate of [explicit, fromDialog, input.message ?? ""]) {
    const cleaned = cleanPortalCandidate(candidate);
    if (cleaned) return cleaned;
  }
  return "";
}

function cleanPortalCandidate(raw: string): string {
  let text = raw.trim();
  if (!text) return "";

  const wrapped = text.match(
    /was created but the flow didn't finish:\s*(.+?)\.\s*Verify in the portal before retrying\.?\s*$/i,
  );
  if (wrapped?.[1]) text = wrapped[1].trim();

  const said = text.match(/the portal said:\s*['"](.+?)['"]/i);
  if (said?.[1]) text = said[1].trim();

  if (!text) return "";
  if (INTERNAL_CLASSES.has(text.toLowerCase())) return "";
  // A scraper slug (`voice_no_free_numbers`) is a class, not Unifi UI.
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(text)) return "";

  const lower = text.toLowerCase();
  if (lower.includes("verify in the portal before retrying")) return "";
  if (AUTHORED_PREFIXES.some((p) => lower.startsWith(p))) return "";
  if (lower.includes("dealer session has expired")) return "";
  return text;
}

/**
 * The frame of the page the run died on (failure) or finished on (success).
 *
 * `capture_failure` wins when present: that is the death screen. Otherwise the
 * last capture with a real R2 key — page 1 is a stand-in for the row, not the
 * reason.
 */
export function deathScreenKey(
  captures: { stage: string | null; message: string | null }[],
): string | null {
  const failure = captures.find(
    (c) => c.stage === "capture_failure" && isScreenshotKey(c.message),
  );
  if (failure?.message) return failure.message.trim();
  for (let i = captures.length - 1; i >= 0; i--) {
    const c = captures[i];
    if (c.stage && isCaptureStage(c.stage) && isScreenshotKey(c.message)) {
      return c.message.trim();
    }
  }
  return null;
}

/**
 * The class of a terminal event that carries no code. Never empty: the sheet
 * is filtered on this column. It is a grouping key, not the reason — the
 * reason is `portal_message`, or the death screen when that is blank.
 */
const CLASS_BY_STATUS: Record<string, string> = {
  submitted: "success",
  order_entered: "order_entered",
  failed: "unclassified",
  warning: "unclassified",
};

function detailPage(order: OutcomeOrder): string | null {
  const base = appBaseUrl();
  return base ? `${base}/dashboard/order-entry/orders/${order.id}` : null;
}

function screenshotOrLog(order: OutcomeOrder, deathKey: string | null): string {
  const page = detailPage(order);
  if (deathKey && page) return `${page} | ${deathKey}`;
  if (deathKey) return deathKey;
  if (page) return page;
  return order.id;
}

export function outcomeFor(order: OutcomeOrder, event: StatusEventInput): AttemptOutcome {
  const portalMessage = portalUiText({
    portalMessage: event.portalMessage,
    message: event.message,
  });
  return {
    timestamp: (event.createdAt ?? new Date()).toISOString(),
    address:
      order.addressFull ||
      [order.street, order.postcode, order.city, order.state].filter(Boolean).join(", "),
    step: event.stage || "start",
    errorClass: event.errorCode || CLASS_BY_STATUS[event.status] || "unclassified",
    portalMessage,
    screenshotOrLog: screenshotOrLog(order, event.deathScreenKey ?? null),
    orderId: order.orderId ?? "",
    outcome: event.status,
    reference: order.reference ?? order.id,
    attempt: event.attempt,
    portalCode: portalCodeFrom(portalMessage || event.message) ?? "",
    agent: order.user?.email ?? "",
  };
}

// One entry per header, so a column cannot be added without saying what fills
// it, and the row can never fall out of step with the header order.
const COLUMN: Record<Header, (o: AttemptOutcome) => string> = {
  timestamp: (o) => o.timestamp,
  address: (o) => o.address,
  step: (o) => o.step,
  error_class: (o) => o.errorClass,
  portal_message: (o) => o.portalMessage.slice(0, 2000),
  screenshot_or_log: (o) => o.screenshotOrLog,
  order_id: (o) => o.orderId,
  outcome: (o) => o.outcome,
  reference: (o) => o.reference,
  attempt: (o) => String(o.attempt),
  portal_code: (o) => o.portalCode,
  agent: (o) => o.agent,
};

/** Tabs and line breaks become one space: a cell must stay one cell. */
const cell = (v: string): string => v.replace(/[\t\r\n]+/g, " ");

export function outcomeRow(o: AttemptOutcome): string[] {
  return OUTCOME_SHEET_HEADERS.map((h) => cell(COLUMN[h](o)));
}

// Neither range names a tab, so the first tab is used whatever it is called.
const HEADER_RANGE = "A1:L1";
const APPEND_RANGE = "A:L";

// A Google call that never answers must not hold a submit's terminal write.
const GOOGLE_TIMEOUT = { timeout: 8000 };

/**
 * Mirror one terminal event into the sheet.
 *
 * A no-op until ORDER_ENTRY_OUTCOME_SHEET_ID names a sheet, and never throws:
 * the row is a diagnostic, and its caller is the one funnel every terminal
 * writer already runs through.
 */
export async function mirrorTerminalEvent(e: StatusEventInput): Promise<void> {
  const spreadsheetId = process.env.ORDER_ENTRY_OUTCOME_SHEET_ID;
  if (!spreadsheetId) return;
  try {
    const [order, captures] = await Promise.all([
      prisma.order.findUnique({
        where: { id: e.orderId },
        select: {
          id: true, reference: true, addressFull: true, street: true, postcode: true,
          city: true, state: true, orderId: true, screenshotUrl: true,
          user: { select: { email: true } },
        },
      }),
      e.deathScreenKey
        ? Promise.resolve([])
        : prisma.orderStatusEvent.findMany({
            where: {
              orderId: e.orderId,
              attempt: e.attempt,
              OR: [
                { stage: { startsWith: "capture_" } },
                { stage: "page1_captured" },
              ],
            },
            select: { stage: true, message: true },
            orderBy: { createdAt: "asc" },
          }),
    ]);
    if (!order) return;
    const row = outcomeRow(outcomeFor(order, {
      ...e,
      portalMessage: portalUiText({
        portalMessage: e.portalMessage,
        message: e.message,
      }),
      deathScreenKey: e.deathScreenKey ?? deathScreenKey(captures),
    }));

    // Loaded here rather than at the top: every terminal writer imports this
    // module, and googleapis is a heavy import for a path most deploys never
    // take.
    const { google } = await import("googleapis");
    const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!credentials) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(credentials),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    const existing = await sheets.spreadsheets.values.get(
      { spreadsheetId, range: HEADER_RANGE },
      GOOGLE_TIMEOUT,
    );
    const hasHeaders = !!existing.data.values?.length;
    await sheets.spreadsheets.values.append(
      {
        spreadsheetId,
        range: APPEND_RANGE,
        // RAW, so a portal message starting with "=" or "+" can never become a
        // formula in the sheet.
        valueInputOption: "RAW",
        requestBody: { values: hasHeaders ? [row] : [[...OUTCOME_SHEET_HEADERS], row] },
      },
      GOOGLE_TIMEOUT,
    );
  } catch (err) {
    console.error("[outcome-log] failed (continuing):", err);
  }
}
