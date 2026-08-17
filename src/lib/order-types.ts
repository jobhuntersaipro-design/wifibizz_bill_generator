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

// ── Captures ─────────────────────────────────────────────────────────────────
// A submit photographs each of its detail screens and reports the R2 key of each
// as its own stage. None of them are steps in SUBMIT_STEPS: they are artefacts
// of the run, not milestones the checklist ticks.
//
// The stage key is `capture_<slot>`, matched by PREFIX rather than against a
// fixed list — sub-product slots come from the tab text the portal reports, and
// the scraper (droplet) deploys separately from BizzFlow (Vercel), so this build
// must render a slot it has never heard of rather than dropping the frame.

export const CAPTURE_STAGE_PREFIX = "capture_";

/** Phase 1 emitted exactly one capture, under its own name. Old rows persist. */
export const LEGACY_PAGE1_CAPTURE_STAGE = "page1_captured";

/** The slot whose frame stands in for the whole attempt on a collapsed row. */
export const PAGE1_CAPTURE_SLOT = "page1";

export const isCaptureStage = (stage: string | null | undefined): boolean =>
  !!stage &&
  (stage.startsWith(CAPTURE_STAGE_PREFIX) || stage === LEGACY_PAGE1_CAPTURE_STAGE);

/** The slot a capture stage documents, or null when it isn't a capture. */
export function captureSlot(stage: string | null | undefined): string | null {
  if (!stage) return null;
  if (stage === LEGACY_PAGE1_CAPTURE_STAGE) return PAGE1_CAPTURE_SLOT;
  if (!stage.startsWith(CAPTURE_STAGE_PREFIX)) return null;
  return stage.slice(CAPTURE_STAGE_PREFIX.length) || null;
}

/**
 * What each frame is worth looking at for.
 *
 * An unknown slot is humanised rather than dropped — see the prefix note above.
 */
const CAPTURE_SLOTS: Record<string, { label: string; caption: string }> = {
  page1: {
    label: "New Connection page 1",
    caption:
      "Order number, installation address, contact, main offer, account and winback tagging.",
  },
  broadband: {
    label: "Broadband tab",
    caption: "Service number and the device the portal actually accepted.",
  },
  voice: {
    label: "Voice tab",
    caption: "The voice number the portal assigned.",
  },
  tv: { label: "TV tab", caption: "TV service number." },
  order_info: {
    label: "Customer Order Information",
    caption: "Delivery contact number, email, the confirmed-with-customer flag and remarks.",
  },
  attachments: {
    label: "Attachments",
    caption: "The documents the portal accepted.",
  },
  appointment: {
    label: "Appointment",
    caption: "The installation date and time that was taken.",
  },
  delivery: {
    label: "Delivery terms",
    caption: "The terms and conditions the order was placed under.",
  },
  pay: {
    label: "Pay screen",
    caption: "The amount due and any advance payment, before the Pay click.",
  },
};

export function captureLabel(slot: string): string {
  const known = CAPTURE_SLOTS[slot];
  if (known) return known.label;
  const words = slot.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Portal screenshot";
}

export function captureCaption(slot: string): string {
  return CAPTURE_SLOTS[slot]?.caption ?? "As the portal rendered it.";
}

/**
 * Whether a capture stage's message is a real R2 key rather than a failure note.
 *
 * A failed capture records its REASON in the same field, so this is what stops
 * "Screenshot not stored" becoming a broken `<img>`. `.png` stays accepted:
 * every frame captured before Phase 3 is a PNG and those objects still exist.
 */
export const isScreenshotKey = (value: string | null | undefined): boolean =>
  !!value &&
  value.startsWith("order-screenshots/") &&
  /\.(png|jpe?g)$/i.test(value);

/**
 * How long a capture survives in R2, or null when nothing is known to delete.
 *
 * Deliberately opt-in. The countdown describes an R2 lifecycle rule that is
 * applied by hand on the bucket; until someone has applied it, nothing expires
 * and a rendered countdown would be asserting a policy that does not exist.
 * Silence is better than that. Set it to 90 once the rule is live.
 */
export const CAPTURE_RETENTION_DAYS: number | null = (() => {
  const n = Number(process.env.NEXT_PUBLIC_CAPTURE_RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? n : null;
})();

/** Amber below this — the frame is close enough to gone to save it now. */
export const CAPTURE_EXPIRY_WARN_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * Whole days a frame has left, counting the part-day it is in as one.
 *
 * Zero or negative means the object is gone from R2 — the caller must render a
 * note instead of the thumbnail, since the `<img>` would 404.
 */
export function daysUntilExpiry(
  capturedAt: string,
  retentionDays: number,
  now: number = Date.now(),
): number {
  const t = new Date(capturedAt).getTime();
  if (!Number.isFinite(t)) return retentionDays;
  return Math.ceil((t + retentionDays * DAY_MS - now) / DAY_MS);
}

/** "Expires in 87 days" / "Expires tomorrow" / "Expired". */
export function expiryLabel(daysLeft: number): string {
  if (daysLeft <= 0) return "Expired";
  if (daysLeft === 1) return "Expires tomorrow";
  return `Expires in ${daysLeft} days`;
}

/** One screen a submit attempt photographed. */
export interface CaptureFrame {
  id: string;
  slot: string;
  key: string;
  at: string;
}

/** The bit of a status event these derivations need. */
export interface TimelineEvent {
  id: string;
  stage: string | null;
  message: string | null;
  createdAt: string;
}

/**
 * Split an attempt's events into the steps it passed and the screens it shot.
 *
 * Captures must never render as timeline rows reading out an R2 key — they come
 * back as pictures instead, at the same position. A capture whose message is a
 * failure reason rather than a key is dropped from the frames but LEFT in the
 * steps, so the slot still says why it has no picture.
 */
export function partitionCaptures<T extends TimelineEvent>(
  events: T[],
): { steps: T[]; captures: CaptureFrame[] } {
  const steps: T[] = [];
  const captures: CaptureFrame[] = [];
  for (const e of events) {
    const slot = isCaptureStage(e.stage) ? captureSlot(e.stage) : null;
    if (slot && isScreenshotKey(e.message)) {
      captures.push({ id: e.id, slot, key: e.message!.trim(), at: e.createdAt });
    } else if (slot) {
      steps.push(e); // a failed capture — its reason is worth a row
    } else {
      steps.push(e);
    }
  }
  return { steps, captures };
}

/** A timeline entry: a step the run passed, or a screen it photographed. */
export type TimelineRow<T> =
  | { kind: "step"; at: string; event: T }
  | { kind: "shot"; at: string; capture: CaptureFrame };

/**
 * Interleave steps and captures into one chronological timeline.
 *
 * Both inputs are already in order, so this is a merge rather than a sort — and
 * on an equal timestamp the STEP wins, because a capture is always taken after
 * the step it documents even when the two land in the same second.
 */
export function mergeTimeline<T extends { createdAt: string }>(
  steps: T[],
  captures: CaptureFrame[],
): TimelineRow<T>[] {
  const out: TimelineRow<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < steps.length || j < captures.length) {
    const step = steps[i];
    const shot = captures[j];
    if (!shot) out.push({ kind: "step", at: step.createdAt, event: steps[i++] });
    else if (!step) out.push({ kind: "shot", at: shot.at, capture: captures[j++] });
    else if (step.createdAt <= shot.at)
      out.push({ kind: "step", at: step.createdAt, event: steps[i++] });
    else out.push({ kind: "shot", at: shot.at, capture: captures[j++] });
  }
  return out;
}

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
  // A capture only reaches this path when it FAILED — the successful ones are
  // partitioned out and rendered as pictures. It still deserves the screen's
  // name rather than "Capture voice", so the row reads as the frame that is
  // missing rather than as machinery.
  const slot = captureSlot(stage);
  if (slot) return captureLabel(slot);
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
  // exists; every other frame is read per attempt from the status trail.
  screenshotUrl: string | null;
  docCount: number;
  createdAt: string;
  createdByEmail?: string | null; // only populated for superadmins (all-drafts view)
}
