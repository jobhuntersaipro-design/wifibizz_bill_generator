import { maskIdNumber, shortErrorMessage } from "@/lib/notifications/outcomes";
import {
  errorShortLabel,
  isCaptureStage,
  isPageBreakStage,
  STATUS_LABELS,
  SUBMIT_STEPS,
  submitErrorCopy,
} from "@/lib/order-types";
import { actionFor, ACTION_LABEL } from "@/lib/failure-action";
import { groupByAttempt, type StatusEventView } from "@/lib/order-history";

/**
 * Shapers that turn database rows into what the model is allowed to see.
 *
 * Everything the chatbot sends to the model passes through here, so this is
 * where personal data is cut down: the ID number and phone keep their last
 * four digits, and e-mail and street are never included. The admin follows the
 * link for the full record.
 */

/** Tool results are capped so one huge row cannot fill the context. */
export const MAX_TOOL_RESULT_CHARS = 12_000;

export function toolResult(value: unknown): string {
  const json = JSON.stringify(value);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
  return JSON.stringify({
    truncated: true,
    note: "Result too large; narrow the query.",
    preview: json.slice(0, MAX_TOOL_RESULT_CHARS - 200),
  });
}

export function maskPhone(prefix: string | null | undefined, mobile: string | null | undefined): string {
  const digits = String(mobile ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const tail = digits.slice(-4);
  const cc = String(prefix ?? "").replace(/\D/g, "");
  return `${cc ? `+${cc} ` : ""}${"•".repeat(Math.max(0, digits.length - 4))}${tail}`;
}

export const orderLink = (id: string) => `/admin/orders/${id}`;

/** How a free-text lookup should be matched. */
export type OrderLookup =
  | { by: "reference"; value: string }
  | { by: "portalOrderNo"; value: string }
  | { by: "id"; value: string };

export function classifyOrderLookup(raw: string): OrderLookup {
  const v = raw.trim();
  const ref = v.match(/^ord[-\s]?(\d+)$/i);
  if (ref) return { by: "reference", value: `ORD-${ref[1].padStart(4, "0")}` };
  if (/^\d{10,}$/.test(v)) return { by: "portalOrderNo", value: v };
  return { by: "id", value: v };
}

export interface OrderRowInput {
  id: string;
  reference: string | null;
  fullName: string;
  idNumber: string;
  status: string;
  orderId: string | null;
  errorCode: string | null;
  offerName: string | null;
  attempt: number;
  createdAt: Date;
  deletedAt: Date | null;
  user: { email: string | null };
}

export function orderSummary(o: OrderRowInput) {
  return {
    ref: o.reference,
    id: o.id,
    link: orderLink(o.id),
    customer: o.fullName,
    idNumber: maskIdNumber(o.idNumber),
    status: STATUS_LABELS[o.status] ?? o.status,
    portalOrderNo: o.orderId,
    error: o.errorCode ? errorShortLabel(o.errorCode) : null,
    errorCode: o.errorCode,
    package: o.offerName,
    attempts: o.attempt,
    agent: o.user.email,
    createdAt: o.createdAt.toISOString(),
    deleted: o.deletedAt ? o.deletedAt.toISOString() : null,
  };
}

const STEP_LABEL = new Map(SUBMIT_STEPS.map((s) => [s.key, s.label]));

/** What a failure code means and what to do, in the app's own words. */
export function explainError(
  code: string,
  order?: { status: string; orderId?: string | null; autoRetries?: number; autoRetryAt?: Date | null },
) {
  const copy = submitErrorCopy(code);
  const resolved = actionFor({
    errorCode: code,
    status: order?.status ?? "failed",
    orderId: order?.orderId ?? null,
    autoRetries: order?.autoRetries,
    autoRetryAt: order?.autoRetryAt ?? null,
  });
  return {
    code,
    label: errorShortLabel(code),
    known: !!copy,
    title: copy?.title ?? null,
    meaning: copy?.subtext ?? null,
    fix: copy?.fix ?? null,
    nextAction: ACTION_LABEL[resolved.action],
  };
}

export interface OrderDetailInput extends OrderRowInput {
  idType: string;
  mobilePrefix: string | null;
  mobile: string | null;
  postcode: string | null;
  city: string | null;
  state: string | null;
  deviceName: string | null;
  errorMessage: string | null;
  autoRetries: number;
  autoRetryAt: Date | null;
  stage: string | null;
  updatedAt: Date;
}

export interface EventInput {
  id: string;
  attempt: number;
  stage: string | null;
  status: string;
  message: string | null;
  errorCode: string | null;
  createdAt: Date;
}

/**
 * One order and its last three runs. Screenshot and page-break events are
 * dropped: they are pictures and dividers, and their "message" is an R2 key.
 */
export function orderDetail(o: OrderDetailInput, events: EventInput[]) {
  const views: StatusEventView[] = events
    .filter((e) => !isCaptureStage(e.stage) && !isPageBreakStage(e.stage))
    .map((e) => ({
      id: e.id,
      attempt: e.attempt,
      stage: e.stage,
      status: e.status,
      message: e.message,
      errorCode: e.errorCode,
      createdAt: e.createdAt.toISOString(),
    }));
  const attempts = groupByAttempt(views).slice(0, 3).map((a) => ({
    attempt: a.attempt,
    startedAt: a.startedAt,
    endedAt: a.endedAt,
    outcome: STATUS_LABELS[a.outcome] ?? a.outcome,
    // The tail of the run is where it went wrong; keep the last 12 events.
    events: a.events.slice(-12).map((e) => ({
      at: e.createdAt,
      step: e.stage ? STEP_LABEL.get(e.stage) ?? e.stage : null,
      status: e.status,
      message: shortErrorMessage(e.message),
      errorCode: e.errorCode,
    })),
  }));

  return {
    ...orderSummary(o),
    idType: o.idType,
    phone: maskPhone(o.mobilePrefix, o.mobile),
    area: [o.postcode, o.city, o.state].filter(Boolean).join(" ") || null,
    device: o.deviceName,
    currentStep: o.stage ? STEP_LABEL.get(o.stage) ?? o.stage : null,
    errorMessage: shortErrorMessage(o.errorMessage),
    errorExplanation: o.errorCode ? explainError(o.errorCode, o) : null,
    autoRetriesUsed: o.autoRetries,
    retryPendingAt: o.autoRetryAt ? o.autoRetryAt.toISOString() : null,
    updatedAt: o.updatedAt.toISOString(),
    recentAttempts: attempts,
  };
}
