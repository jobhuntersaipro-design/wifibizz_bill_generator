// Shared order types/constants usable from both client components and the
// "use server" actions file (which may only export async functions).

export const MAX_DOCS = 10;

export interface OrderDocument {
  type: string; // id | utility_bill | other
  url: string; // authenticated proxy path (/api/orders/document?key=...)
  key: string; // R2 object key, namespaced by userId (orders/<userId>/<filename>)
  filename: string;
}

// One serviceable address returned by the portal's QryNIGAddress search.
export interface AddressResult {
  addressId: string; // resourceInstId — used later to select "By Address Id"
  addressFull: string; // concatAddress (display)
  serviceCategory: string | null; // addrServiceCategory (FTTH, …)
  addressType: string | null; // Residential | Business
  houseType: string | null;
  state: string | null;
  city: string | null;
  postcode: string | null;
  streetName: string | null;
  streetType: string | null;
  section: string | null;
  buildingName: string | null;
  houseUnitLot: string | null;
}

// Exact `state` values the portal accepts (Select Address modal combobox).
export const ADDRESS_SEARCH_STATES = [
  "SELANGOR", "PAHANG", "KELANTAN", "JOHOR", "KEDAH", "MELAKA",
  "NEGERI SEMBILAN", "PERLIS", "PERAK", "PULAU PINANG", "SABAH", "SARAWAK",
  "TERENGGANU", "W.P. KUALA LUMPUR", "W.P. PUTRAJAYA", "W.P. LABUAN",
] as const;

// ── Submit progress ──────────────────────────────────────────────────────────
// The ordered steps a submit passes through. Keys match the stage names the
// scraper emits via on_stage(); the labels live here so the scraper stays free
// of user-facing copy.
//
// The first two run in BizzFlow before any portal call — they are the only two
// whose failure leaves nothing behind in the portal, which is why they are worth
// showing even though they flash by.
export interface SubmitStep {
  key: string;
  label: string;
}

export const SUBMIT_STEPS: SubmitStep[] = [
  { key: "validating_draft", label: "Checking draft" },
  { key: "checking_session", label: "Verifying dealer session" },
  { key: "creating_customer", label: "Creating customer profile" },
  { key: "checking_address", label: "Checking installation address" },
  { key: "checking_plan", label: "Checking package availability" },
  { key: "placing_order", label: "Placing order" },
  { key: "attaching_customer", label: "Attaching customer" },
  { key: "capturing_order_no", label: "Capturing order number" },
  { key: "installation_contact", label: "Setting installation contact" },
  { key: "billing_account", label: "Setting billing account" },
  { key: "winback_tagging", label: "Winback tagging" },
  { key: "selecting_device", label: "Selecting device" },
  { key: "uploading_attachments", label: "Uploading documents" },
  { key: "appointment", label: "Booking appointment" },
  { key: "delivery_terms", label: "Delivery details" },
  { key: "pay", label: "Payment" },
];

// Everything from here on has an order id in the portal: a failure after this
// step is NOT retryable, it needs verifying in the portal by hand.
export const POINT_OF_NO_RETURN = "capturing_order_no";

/**
 * What the portal actually resolved at a step.
 *
 * A bare step name says an address was checked; this says WHICH address matched.
 * The portal's ranked search can resolve a typed address to a neighbouring unit,
 * so the agent needs the resolved value while the submit is still running.
 */
export interface StageDetail {
  value: string;
  // `skipped` and `not_applicable` are deliberately separate. A Business package
  // has no Winback Tagging field at all (not_applicable, unremarkable), which is
  // a different thing from the field being on the form and left on
  // "---Please select---" (skipped, worth an amber flag). Collapsing them puts a
  // false warning on every Business order.
  outcome: "ok" | "failed" | "skipped" | "not_applicable";
  note?: string;
}

/** Resolved values by step key, as far as the run has got. */
export type StageDetails = Record<string, StageDetail>;

/**
 * The stage that reports the page-1 screenshot's R2 key.
 *
 * Not a step in SUBMIT_STEPS — it is an artefact of the run, not a milestone the
 * checklist ticks, and it is emitted once Winback Tagging resolves.
 */
export const PAGE1_SCREENSHOT_STAGE = "page1_captured";

/** A step whose portal field was left unset reads as a warning, never a tick. */
export const isUnsetStep = (d: StageDetail | undefined): boolean =>
  d?.outcome === "skipped";

/**
 * An order that exists in the portal but never completed.
 *
 * The portal mints the order number before the device is even selectable, so a
 * mid-flow failure always strands a real order. These need voiding by hand —
 * flagging them is what stops them being quietly forgotten.
 */
export const needsVoiding = (o: {
  status: string;
  orderId?: string | null;
}): boolean => !!o.orderId && (o.status === "warning" || o.status === "failed");

// Coarse stage keys older scraper builds emit, mapped onto the step they begin.
// Vercel and the droplet deploy separately, so a BizzFlow that is ahead of the
// scraper must still show sensible progress instead of falling off the list.
const STAGE_ALIASES: Record<string, string> = {
  order_entered: "checking_address",
  feasibility: "checking_address",
  new_connection_page1: "installation_contact",
  subproduct_tabs: "selecting_device",
  customer_order_info: "uploading_attachments",
};

/**
 * Index of the step a stage key refers to, or -1 when the key is unknown.
 *
 * An unknown key is not an error: the scraper may be AHEAD of this deploy and
 * emitting a stage added later. Callers render those as a generic "Working…"
 * rather than dropping progress or throwing.
 */
export function stepIndexForStage(stage: string | null | undefined): number {
  if (!stage) return -1;
  const key = STAGE_ALIASES[stage] ?? stage;
  return SUBMIT_STEPS.findIndex((s) => s.key === key);
}

/**
 * Human label for any stage key the scraper might emit.
 *
 * A raw `customer_order_info` in the timeline is a leak, not information. Coarse
 * aliases resolve to the step they begin, and a key this build has never seen is
 * humanised rather than printed verbatim — the scraper deploys separately and
 * WILL be ahead of us sometimes.
 */
export function labelForStage(stage: string | null | undefined): string {
  if (!stage) return "";
  const key = STAGE_ALIASES[stage] ?? stage;
  const step = SUBMIT_STEPS.find((s) => s.key === key);
  if (step) return step.label;
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail panel derivations.
//
// These live here rather than in order-history.ts because that module imports
// Prisma — pulling it into a client component would drag the server client into
// the browser bundle. Everything below takes plain values for the same reason.
// ─────────────────────────────────────────────────────────────────────────────

/** The run's colour family, driving the hero tint and every status accent. */
export type RunTone = "running" | "submitted" | "warning" | "failed" | "draft";

export function toneForStatus(status: string): RunTone {
  if (status === "submitting") return "running";
  if (status === "submitted" || status === "order_entered") return "submitted";
  if (status === "warning") return "warning";
  if (status === "failed") return "failed";
  return "draft";
}

/**
 * Up to two initials for the avatar.
 *
 * First and LAST token, not the first two: Malaysian names here run long
 * ("MUHAMMAD SAHINU BIN INSANU"), and the first two words are frequently a
 * given-name pair that collides across different customers.
 */
export function initialsFor(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** What the hero card leads with. */
export interface HeroContent {
  value: string;
  /** True when `value` is a portal order number — renders tabular + copyable. */
  isOrderNumber: boolean;
  tone: RunTone;
}

/**
 * The hero shows the Customer Order Number, because that is the value an agent
 * copies out of this panel and pastes into the portal or a chat.
 *
 * Before the portal mints one there is nothing to copy, so it falls back to the
 * status word rather than showing an empty card or a placeholder dash.
 */
export function heroFor(order: {
  status: string;
  orderId?: string | null;
}): HeroContent {
  const tone = toneForStatus(order.status);
  const id = order.orderId?.trim();
  if (id) return { value: id, isOrderNumber: true, tone };
  const words: Record<RunTone, string> = {
    running: "Submitting",
    submitted: "Submitted",
    warning: "Needs checking",
    failed: "Failed",
    draft: "Draft",
  };
  return { value: words[tone], isOrderNumber: false, tone };
}

/**
 * How many of the 16 steps a run actually reached.
 *
 * Counts DISTINCT known step keys: a stage is reported twice (bare, then with
 * its resolved detail) and coarse aliases collapse onto the step they begin, so
 * a naive length would over-count and could exceed the total.
 */
export function stepsCompleted(stages: (string | null | undefined)[]): number {
  const seen = new Set<number>();
  for (const s of stages) {
    const i = stepIndexForStage(s);
    if (i >= 0) seen.add(i);
  }
  return seen.size;
}

/**
 * Compact elapsed label ("4m 12s", "38s", "1h 2m").
 *
 * `null` when the run has no end yet — the caller shows a live ticker instead of
 * a frozen number, which would otherwise read as a finished run.
 */
export function elapsedLabel(from: string, to: string | null): string | null {
  if (!to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return formatDuration(ms);
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export interface OrderListItem {
  id: string;
  fullName: string;
  idType: string;
  idNumber: string;
  offerName: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  state: string | null;
  // The portal's own concatAddress, written back when the address was confirmed
  // against Unifi — its presence (with addressId) is what "verified" means here.
  addressFull: string | null;
  addressId: string | null;
  status: string; // draft | submitting | order_entered | submitted | warning | failed
  orderId: string | null;
  errorMessage: string | null;
  stage: string | null; // last submit stage key seen — drives the step checklist
  reference: string | null; // ORD-0042 — quotable before the portal issues a number
  deviceName: string | null;
  deviceCode: string | null;
  remarks: string | null;
  attempt: number; // how many submit runs this draft has had
  // R2 key of the latest attempt's page-1 screenshot — presence means evidence
  // exists; the per-attempt frames are read from the status trail.
  screenshotUrl: string | null;
  docCount: number;
  createdAt: string;
  createdByEmail?: string | null; // only populated for superadmins (all-drafts view)
}
