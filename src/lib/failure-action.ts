import { SUBMIT_ERROR_CODES, type SubmitErrorCopy } from "@/lib/order-types";
import { isRetryPending } from "@/lib/retry-policy";
import type { FormSection } from "@/lib/order-sections";

/**
 * What an agent should DO about a failed submit.
 *
 * The copy in SUBMIT_ERROR_CODES says what went wrong and, in prose, how to fix
 * it. This turns that prose into a button. One table, one function, so a code
 * cannot have a remedy without an action, and an action cannot be offered that
 * the order's state makes wrong.
 */

export type FailureAction =
  /** The draft is wrong — open it on the card that needs changing. */
  | "fix_field"
  /** Nothing to change; try again. */
  | "resubmit"
  /** An automatic retry is owed. The pill already says so; no button. */
  | "wait"
  /** A real order may exist at Unifi — look there before doing anything. */
  | "check_portal"
  /** The dealer session is gone. */
  | "reconnect"
  /** Nothing the agent can do themselves. */
  | "contact_admin";

export interface ResolvedAction {
  action: FailureAction;
  /** For fix_field: the card to open. */
  section: FormSection | null;
  /** The copy, when the code has any. */
  copy: SubmitErrorCopy | null;
}

/**
 * Codes BizzFlow itself writes — from its own reconciliation, not the scraper —
 * and what they mean for the agent. Kept beside the scraper table rather than
 * inside it so the two vocabularies stay visibly separate.
 */
const BIZZFLOW_ACTIONS: Record<string, FailureAction> = {
  session_expired: "reconnect",
  abandoned: "check_portal",
  portal_timeout: "resubmit",
  infra: "resubmit",
  cancelled: "check_portal",
};

export function actionFor(
  order: {
    errorCode: string | null | undefined;
    orderId?: string | null;
    autoRetries?: number;
    autoRetryAt?: Date | string | null;
    status: string;
  },
): ResolvedAction {
  const code = order.errorCode ?? null;
  const copy = (code && SUBMIT_ERROR_CODES[code]) || null;

  // A retry that is owed overrides everything: pressing anything now starts a
  // second run against an order the retry is about to run anyway.
  if (isRetryPending({ status: order.status, autoRetries: order.autoRetries, autoRetryAt: order.autoRetryAt })) {
    return { action: "wait", section: null, copy };
  }

  let action: FailureAction =
    copy?.action ?? (code ? BIZZFLOW_ACTIONS[code] : undefined) ?? "contact_admin";
  let section: FormSection | null = copy?.section ?? null;

  // check_portal with nothing to check is a dead button. Degrade rather than
  // point at a portal record that does not exist.
  if (action === "check_portal" && !order.orderId) {
    action = "contact_admin";
  }
  if (action !== "fix_field") section = null;

  return { action, section, copy };
}

/** The button's label. */
export const ACTION_LABEL: Record<FailureAction, string> = {
  fix_field: "Fix the draft",
  resubmit: "Submit again",
  wait: "Retrying automatically",
  check_portal: "Check at Unifi",
  reconnect: "Reconnect",
  contact_admin: "Tell your admin",
};

/**
 * The line shown under a contact_admin action. There is no in-app way to reach
 * an admin yet, so it says what to tell them — the code and the reference are
 * what the admin needs to find it on the oversight page.
 */
export function contactAdminNote(order: { errorCode: string | null | undefined; reference?: string | null }): string {
  const what = order.errorCode ?? "an unclassified failure";
  return order.reference
    ? `Tell your admin: ${what} on ${order.reference}.`
    : `Tell your admin: ${what}.`;
}
