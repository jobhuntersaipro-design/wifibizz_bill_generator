// Shared order types/constants usable from both client components and the
// "use server" actions file (which may only export async functions).

export const MAX_DOCS = 10;

export interface OrderDocument {
  type: string; // id | utility_bill | other
  url: string; // authenticated proxy path (/api/orders/document?key=...)
  key: string; // R2 object key, namespaced by userId (orders/<userId>/<filename>)
  filename: string;
}

// The document types that count as the customer's ID copy. The portal's Personal
// Customer form marks the ID copy required, so a draft without one is a draft
// that cannot be submitted — `hasIdentityDocument` is the single rule enforced in
// the order form, in saveOrder, and in the bulk-create script.
//
// "other" is deliberately NOT here. It used to satisfy the form's hint, which
// meant a tenancy agreement filed under Others read as an attached MyKad.
export const IDENTITY_DOC_TYPES = ["mykad", "passport", "id"] as const;

export function hasIdentityDocument(docs: readonly { type: string }[] | null | undefined): boolean {
  return (docs ?? []).some((d) => (IDENTITY_DOC_TYPES as readonly string[]).includes(d.type));
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
  // The finish line. Downloading the e-RF and clicking the confirmation page's
  // Next both happen after the charge and are house-keeping, not milestones an
  // agent tracks — they used to be their own steps, which made a paid order sit
  // at 16/18 and read as unfinished. They now fold into this one via
  // STAGE_ALIASES, so the checklist ends where the order does.
  { key: "submitted", label: "Submitted" },
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
  customer_form: {
    label: "Customer profile form",
    caption:
      "Every field as it was typed and selected — name, ID, address, contact — before the Create click.",
  },
  offer_grid: {
    label: "Offer grid",
    caption:
      "The offers the portal listed for this address, with the chosen plan's row when selection succeeded.",
  },
  failure: {
    label: "At the moment of failure",
    caption: "The page exactly as the portal showed it when this attempt's failing step gave up.",
  },
  page1: {
    label: "New Connection page 1",
    caption:
      "Order number, installation address, contact, main offer, account and winback tagging.",
  },
  broadband: {
    label: "Broadband tab",
    caption: "Service number, service profile and bandwidth, as the tab opens.",
  },
  // Each sub-product tab is photographed twice: the portal scrolls its content
  // in an inner container, so one frame only ever holds the top. The bottom is
  // where the commercial detail lives, and where the disputes are.
  broadband_bottom: {
    label: "Broadband — Select Offer",
    caption:
      "Which discount and which device the portal actually attached, with their charges, plus Order Information.",
  },
  voice: {
    label: "Voice tab",
    caption: "The voice number the portal assigned.",
  },
  voice_bottom: {
    label: "Voice — Select Offer",
    caption: "The voice offer attached and its charges, plus Order Information.",
  },
  tv: { label: "TV tab", caption: "TV service number." },
  tv_bottom: {
    label: "TV — Select Offer",
    caption: "The TV offer attached and its charges, plus Order Information.",
  },
  order_info: {
    label: "Customer Order Information",
    caption: "Delivery contact number, email, the confirmed-with-customer flag and remarks.",
  },
  // The rest of that page. It is one long scroll and only its top was ever
  // photographed, so everything describing what the customer actually gets —
  // the devices, the delivery methods and the charges — went unrecorded.
  install_info: {
    label: "Install Information",
    caption: "The installation details as the portal recorded them.",
  },
  device_list: {
    label: "Device List",
    caption:
      "Every device on the order with its SKU and delivery method, plus the delivery address and contact.",
  },
  fee_preview: {
    label: "Fee Information Preview",
    caption:
      "The charge item list — price, tax, charge and discount per offer — with the OTC and recurring totals.",
  },
  order_items: {
    label: "Order Item List",
    caption: "Each ordered product with its service number, main offer and account number.",
  },
  attachments: {
    label: "Attachments",
    caption: "The documents the portal accepted.",
  },
  delivery: {
    label: "Delivery terms",
    caption: "The terms and conditions the order was placed under.",
  },
  pay: {
    label: "Pay screen",
    caption: "The amount due and any advance payment, before the Pay click.",
  },
  // Everything below happens only after a real payment.
  erf_page: {
    label: "Order confirmation",
    caption:
      "The service numbers the portal assigned, with the offer and accept date for each.",
  },
  erf_page_bottom: {
    label: "Order confirmation \u2014 services",
    caption: "The rest of the assigned services, below the fold of the confirmation page.",
  },
  erf: {
    label: "e-RF (Registration Form)",
    caption: "The registration form the portal generated for this order, as a PDF.",
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
  /\.(png|jpe?g|pdf)$/i.test(value);

/**
 * Is this capture a PDF rather than an image?
 *
 * The e-RF is a document, not a screen, but it is stored and reported through
 * exactly the same capture path so it lands on the timeline in its true
 * chronological place. Every renderer that would otherwise reach for an `<img>`
 * has to ask this first \u2014 including the carousel's `new Image()` preloader,
 * which fails silently on a PDF rather than visibly.
 */
export const isPdfCapture = (key: string | null | undefined): boolean =>
  !!key && /\.pdf$/i.test(key);

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

/**
 * The stage key the scraper emits when Next advanced the portal to a new page.
 *
 * Not a step: it marks a BOUNDARY between steps. The timeline renders it as a
 * divider naming the page reached, so a sixteen-step run reads as the sequence
 * of portal pages an agent would have clicked through by hand rather than as one
 * flat list.
 */
export const PAGE_BREAK_STAGE = "page_break";

export const isPageBreakStage = (stage: string | null | undefined): boolean =>
  stage === PAGE_BREAK_STAGE;

/** What a caller needs to know to render one frame's retention state. */
export interface CaptureExpiry {
  days: number;
  label: string;
  /** The object is gone from R2 — render a note, never an `<img>`. */
  expired: boolean;
  /** Close enough to gone to be worth saving now. */
  soon: boolean;
}

/**
 * How long this frame has left, or null when nothing is known to delete it.
 *
 * Shared by the timeline row and the carousel so both agree on the boundary —
 * two independent copies of "is this expired?" is exactly how one of them ends
 * up rendering a 404'd `<img>` while the other says it's gone.
 */
export function captureExpiry(
  capturedAt: string,
  now: number = Date.now(),
): CaptureExpiry | null {
  if (CAPTURE_RETENTION_DAYS === null) return null;
  const days = daysUntilExpiry(capturedAt, CAPTURE_RETENTION_DAYS, now);
  return {
    days,
    label: expiryLabel(days),
    expired: days <= 0,
    soon: days > 0 && days < CAPTURE_EXPIRY_WARN_DAYS,
  };
}

/**
 * How each order status is named in the UI, and which of them are worth
 * filtering by.
 *
 * Domain vocabulary, so it lives here rather than in whichever component
 * happened to need it first — the row and the filter must never disagree about
 * what "order_entered" is called. `submitting` is deliberately absent from the
 * filter list: it is a transient state, and a filter that empties itself a
 * minute after you pick it is a worse experience than not offering it.
 */
export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitting: "Submitting",
  order_entered: "Order Entered",
  submitted: "Submitted",
  warning: "Warning",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * A classified submit failure, in the agent's language.
 *
 * The scraper's `oe_errors` codes are the wire vocabulary; this is the only
 * place they become words a dealer reads. A code that isn't listed here renders
 * as the portal's raw message exactly as before — an unmapped failure must
 * degrade to the old behaviour, never to a blank panel.
 *
 * `fix` names the field to change. That is the whole point of classifying: the
 * portal's own wording says what is wrong but never what to do about it.
 */
export interface SubmitErrorCopy {
  title: string;
  /** What the portal's code actually means, in one sentence. */
  subtext: string;
  /** The action that clears it. */
  fix: string;
}

/**
 * The one error code BizzFlow raises itself rather than reading off the portal.
 *
 * Mirrors `ERF_NOT_DOWNLOADED` in scraper/oe_errors.py. Both ends can set it:
 * the scraper when a paid run fails to fetch the form or stops at the Pay gate,
 * BizzFlow when a result comes back with no `erf_key` at all.
 */
export const ERF_NOT_DOWNLOADED = "erf_not_downloaded";

export const SUBMIT_ERROR_CODES: Record<string, SubmitErrorCopy> = {
  address_no_tm_service: {
    title: "TM does not serve this address",
    subtext:
      "The portal knows this address but only other operators supply it \u2014 " +
      "there is no TM line to sell. Nothing about the customer, the package or " +
      "the device is wrong, and no Unifi order can be placed here at all.",
    fix:
      "Check the unit number with the customer first, since a neighbouring unit " +
      "in the same building is often serviceable. If the address is right, this " +
      "order cannot go ahead \u2014 delete the draft rather than resubmitting it.",
  },
  device_out_of_stock: {
    title: "Device out of stock",
    subtext:
      "The portal checks device stock when it leaves the Customer Order " +
      "Information page, and refused this order because Unifi has no stock of " +
      "the device on it. Nothing about the customer or the address is wrong.",
    fix: "Edit the order, choose a different device, then resubmit.",
  },
  voice_number_taken: {
    title: "Every voice number offered was already taken",
    subtext:
      "The Voice tab picks its number out of the portal's shared pool, and the " +
      "portal refused each one it offered with \u201cthe number is taken by " +
      "another order\u201d. The run tries ten different numbers before giving " +
      "up, so this means the pool was heavily contended at that moment \u2014 " +
      "nothing about the customer, address or package is wrong.",
    fix:
      "Submit again in a few minutes. The order already exists in the portal, " +
      "so check it there before creating a second one.",
  },
  pay_page_not_ready: {
    title: "Pay page never finished loading",
    subtext:
      "The portal showed its Pay button before the charges had loaded, so the " +
      "run stopped rather than click it. Nothing was paid \u2014 this happens " +
      "before the payment, not during it.",
    fix:
      "Submit again. The order already exists in the portal and is waiting at " +
      "the Pay step, so check it there first rather than creating a second one.",
  },
  pay_click_did_not_take: {
    title: "Payment unconfirmed",
    subtext:
      "Pay was clicked, but the portal was still showing the Pay page 30 " +
      "seconds later. The payment may or may not have gone through \u2014 the " +
      "portal never said.",
    fix:
      "Check this order in the Unifi portal before doing anything else. Only " +
      "resubmit once you have confirmed it was NOT paid.",
  },
  customer_ic_name_mismatch: {
    title: "That ID number belongs to a different customer",
    subtext:
      "Unifi already has this ID number registered, under a different name from " +
      "the one on this draft. One ID number belongs to one customer, so the run " +
      "stopped rather than finish an order it would have billed to the " +
      "registered customer's own account. The message below names both names.",
    fix:
      "Check the ID number on the draft first \u2014 a typo is the usual cause. If " +
      "the number is right, the customer is registered at Unifi under the other " +
      "name, so correct the name on the draft to match it. Either way the portal " +
      "already holds a part-made order under the number above: void it there " +
      "before submitting again.",
  },
  erf_not_downloaded: {
    title: "No e-RF (registration form)",
    subtext:
      "An order is only complete once its registration form has been " +
      "downloaded, and this run produced none. Either it stopped at the Pay " +
      "gate without paying, or it paid and the form could not be fetched \u2014 the " +
      "message below says which.",
    fix:
      "Check the order in the Unifi portal before doing anything else. If it " +
      "was paid, the form is on the order's confirmation page under Print e-RF.",
  },
};

export function submitErrorCopy(code: string | null | undefined): SubmitErrorCopy | null {
  return (code && SUBMIT_ERROR_CODES[code]) || null;
}

/**
 * The portal's own numeric code, e.g. `40300338` from
 * `[40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.`
 *
 * Derived from the stored message rather than kept in its own column: the code
 * is only ever meaningful as part of that message, and a second column could
 * drift out of step with it. Four digits minimum, so the portal's `[1]:LOGIN_ID`
 * field marker in the RESERVELOGIN error isn't mistaken for a code.
 */
/**
 * Does this look like a Customer Order Number the portal minted?
 *
 * The `capturing_order_no` stage reports the number on success and its own
 * explanation on failure ("Portal did not show a Customer Order Number") in the
 * same field, so the shape has to be checked before the value is trusted as an
 * order id — writing that sentence into `Order.orderId` would make the row claim
 * a portal order that does not exist.
 */
export function isPortalOrderNumber(value: string | null | undefined): boolean {
  return !!value && /^\d{10,20}$/.test(value.trim());
}

export function portalCodeFrom(message: string | null | undefined): string | null {
  return message?.match(/\[\s*(\d{4,})\s*\]/)?.[1] ?? null;
}

export const STATUS_FILTERS = [
  "all",
  "draft",
  "order_entered",
  "warning",
  "failed",
  "submitted",
  "cancelled",
];

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

/**
 * A draft that has never reached the portal, and so is safe to submit outright.
 *
 * Submittable until we actually have a portal order id — a customer profile may
 * be "entered" without the order id yet, so it must stay submittable. Only an
 * in-flight run or one that already has an order id is locked.
 */
export const canSubmit = (o: {
  status: string;
  orderId?: string | null;
}): boolean => !o.orderId && o.status !== "submitting";

/**
 * A stranded order: the portal minted a number, then the run failed.
 *
 * Running it again is legitimate — the agent voids the old order by hand first —
 * but it is NOT the same act as submitting a fresh draft, because a second run
 * against an un-voided order creates a genuine duplicate in the live portal.
 * That is why this is a separate predicate rather than a loosening of
 * `canSubmit`, and why its caller must confirm every time.
 *
 * A fully `submitted` order never qualifies: `needsVoiding` is false for it.
 */
export const canResubmit = (o: {
  status: string;
  orderId?: string | null;
}): boolean => needsVoiding(o) && o.status !== "submitting";

// Coarse stage keys older scraper builds emit, mapped onto the step they begin.
// Vercel and the droplet deploy separately, so a BizzFlow that is ahead of the
// scraper must still show sensible progress instead of falling off the list.
const STAGE_ALIASES: Record<string, string> = {
  order_entered: "checking_address",
  feasibility: "checking_address",
  new_connection_page1: "installation_contact",
  subproduct_tabs: "selecting_device",
  customer_order_info: "uploading_attachments",
  // Post-payment house-keeping the checklist no longer lists separately. They
  // are still emitted by the scraper, so they must resolve to something: the
  // final step, which is where the run has actually got to.
  erf: "submitted",
  order_complete: "submitted",
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
export type RunTone = "running" | "submitted" | "warning" | "failed" | "draft" | "cancelled";

export function toneForStatus(status: string): RunTone {
  if (status === "submitting") return "running";
  if (status === "submitted" || status === "order_entered") return "submitted";
  if (status === "warning") return "warning";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "draft";
}

/**
 * Only a fully submitted order can be manually cancelled, and cancelling is
 * terminal: nothing ever transitions out of "cancelled" — the row keeps
 * Details (the audit trail of a real paid order) and Delete, nothing else.
 * Cancelling here is BizzFlow bookkeeping only; it does NOT void the order at
 * Unifi, which is why the confirm dialog links the portal record.
 */
export const canCancel = (o: { status: string }): boolean => o.status === "submitted";

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
    cancelled: "Cancelled",
  };
  return { value: words[tone], isOrderNumber: false, tone };
}

/**
 * How far through the checklist a run got: the FURTHEST step it reached.
 *
 * The checklist is sequential, so reaching a step means the earlier ones
 * happened — counting only the stages that were emitted under-reports, because
 * not every step has a stage of its own. `checking_session` never does: it is
 * verified before the job is handed to the scraper, so a fully submitted,
 * charged order counted 16 of 17 and read as unfinished — which is the exact
 * complaint that shrank this list.
 *
 * Unknown keys and nulls are ignored (captures, a scraper deploy ahead of this
 * one), and coarse aliases resolve to the step they begin, so the result can
 * never exceed the number of steps.
 */
export function stepsCompleted(stages: (string | null | undefined)[]): number {
  let furthest = -1;
  for (const s of stages) {
    const i = stepIndexForStage(s);
    if (i > furthest) furthest = i;
  }
  return furthest + 1;
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
  // Display-ready "+60 13-708 9093", assembled in the loader from
  // mobilePrefix + mobile. Kept pre-formatted rather than as two raw columns:
  // every consumer wants the same one string, and formatting in the row would
  // put the same logic in the table and the card.
  phone: string | null;
  email: string | null;
  gender: string | null;
  birthday: string | null; // dd-mm-yyyy
  race: string | null;
  idExpiry: string | null; // dd-mm-yyyy (passport/foreigner IDs)
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
  // oe_errors classification of the last failure, when there was one. Null means
  // "unclassified" — show the message on its own, as before.
  errorCode: string | null;
  stage: string | null; // last submit stage key seen — drives the step checklist
  reference: string | null; // ORD-0042 — quotable before the portal issues a number
  deviceName: string | null;
  deviceCode: string | null;
  remarks: string | null;
  attempt: number; // how many submit runs this draft has had
  // R2 key of the latest attempt's page-1 screenshot — presence means evidence
  // exists; every other frame is read per attempt from the status trail.
  screenshotUrl: string | null;
  // The installation appointment as the order's e-RF prints it
  // ("2026-08-20 09:30-12:00"), read from the PDF. Only completed orders have
  // one — nothing before Pay produces an e-RF — so this is null on every draft,
  // every failure, and every run that stopped part-way.
  installationDate: string | null;
  docCount: number;
  // The attached documents themselves, for the detail page's Documents section.
  // Each `url` is the authenticated proxy path — note that route scopes to the
  // CALLER's R2 namespace, so a superadmin viewing another user's order sees
  // the list but cannot download the files (same as the edit form today).
  documents: OrderDocument[];
  createdAt: string;
  createdByEmail?: string | null; // only populated for superadmins (all-drafts view)
}

/* ── Drafts-table display helpers ─────────────────────────────────────────── */

/**
 * "+60 13-708 9093" from the stored prefix and number.
 *
 * Malaysian mobiles are grouped 2-3-4 after the leading 0-less operator digits,
 * which is how agents read them back to a customer. The grouping is cosmetic and
 * deliberately never changes the digits: an unrecognised length falls through
 * ungrouped rather than being reshaped into something that looks authoritative
 * and is wrong.
 */
export function formatPhone(
  prefix: string | null | undefined,
  mobile: string | null | undefined,
): string | null {
  const digits = (mobile ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const cc = (prefix ?? "").replace(/\D/g, "");
  // 137089093 → 13-708 9093 ; 1112345678 → 11-1234 5678
  const grouped =
    digits.length === 9 || digits.length === 10
      ? `${digits.slice(0, 2)}-${digits.slice(2, digits.length - 4)} ${digits.slice(-4)}`
      : digits;
  return cc ? `+${cc} ${grouped}` : grouped;
}

/**
 * "17-08-2026 17:47" — day-first, zero-padded, 24-hour.
 *
 * Built from the date parts by hand rather than via `toLocaleString`: the
 * locale-formatted output follows the VIEWER's locale, so the same draft reads
 * `17/08/2026` for one agent and `8/17/2026` for another, and 08-09 is then
 * genuinely ambiguous between August and September. A fixed DD-MM-YYYY is the
 * point of asking for one.
 *
 * Rendered in local time, matching every other timestamp in this app.
 */
export function formatCreated(iso: string | null | undefined): string {
  const parts = createdParts(iso);
  return parts ? `${parts.date} ${parts.time}` : "—";
}

/**
 * The date and the time separately, so a cell can stack them on two lines.
 *
 * Split here rather than in the row: the same two strings feed the table cell,
 * the mobile card and the tooltip, and re-deriving them per view is how the
 * three drift apart.
 */
export function createdParts(
  iso: string | null | undefined,
): { date: string; time: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

/**
 * The same timestamp to the second, for the Created At tooltip.
 *
 * Same fixed DD-MM-YYYY shape as `formatCreated` rather than `toLocaleString`:
 * a hover that reformats the date it is explaining, into an order the cell does
 * not use, is worse than showing nothing.
 */
export function formatCreatedFull(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/**
 * Quick spans offered inside the date-range picker.
 *
 * They set the same `dateFrom`/`dateTo` the calendar sets — they are shortcuts,
 * not a second filter with its own state. Two representations of "which dates"
 * is how a preset and a calendar end up disagreeing on screen.
 */
export const DATE_PRESETS: { label: string; days: number }[] = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

/** `YYYY-MM-DD` in LOCAL time — `toISOString()` would shift the day in +08. */
export function toDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parse `YYYY-MM-DD` as a LOCAL midnight, for the same reason. */
export function fromDateInput(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The preset's span as a concrete from/to pair, inclusive of today. */
export function presetRange(days: number, now: Date = new Date()): {
  dateFrom: string;
  dateTo: string;
} {
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return { dateFrom: toDateInput(from), dateTo: toDateInput(now) };
}

/** "05-08-2026", matching how every other date in this table reads. */
export function formatDateInput(v: string | null | undefined): string | null {
  const d = fromDateInput(v);
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export interface OrderFilters {
  query: string;
  status: string;
  /** `YYYY-MM-DD`, inclusive on both ends. Null means unbounded on that side. */
  dateFrom: string | null;
  dateTo: string | null;
  offerName: string;
  deviceName: string;
}

export const EMPTY_FILTERS: OrderFilters = {
  query: "",
  status: "all",
  dateFrom: null,
  dateTo: null,
  offerName: "all",
  deviceName: "all",
};

/** How many filters are actually narrowing the list, for the "Clear" affordance. */
export function activeFilterCount(f: OrderFilters): number {
  return (
    (f.query.trim() ? 1 : 0) +
    (f.status !== "all" ? 1 : 0) +
    // From and To are ONE filter however many ends are set — "Clear 2 filters"
    // for a single date range would be counting inputs, not filters.
    (f.dateFrom || f.dateTo ? 1 : 0) +
    (f.offerName !== "all" ? 1 : 0) +
    (f.deviceName !== "all" ? 1 : 0)
  );
}

/**
 * The distinct Package and Device values present in the loaded rows.
 *
 * Derived from the rows rather than from the package/device catalogue on
 * purpose: a filter offering a package no draft uses is noise, and worse, an
 * option that always yields an empty table reads as a broken filter.
 */
export function filterOptions(orders: OrderListItem[]): {
  offers: string[];
  devices: string[];
} {
  const offers = new Set<string>();
  const devices = new Set<string>();
  for (const o of orders) {
    if (o.offerName?.trim()) offers.add(o.offerName.trim());
    if (o.deviceName?.trim()) devices.add(o.deviceName.trim());
  }
  const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return { offers: sort(offers), devices: sort(devices) };
}

/**
 * Apply every filter at once. Pure, and therefore testable — which is the point:
 * filters that silently over-narrow look identical to "no matching drafts", and
 * this is exactly the shape of logic that fails invisibly in the browser.
 */
export function filterOrders(
  orders: OrderListItem[],
  f: OrderFilters,
): OrderListItem[] {
  const q = f.query.trim().toLowerCase();
  // Both ends are INCLUSIVE of the whole day: a To of the 18th must keep an
  // order created at 17:47 on the 18th. Comparing against midnight would drop
  // almost everything created on the last day of the range — the kind of
  // off-by-a-day that reads as "my draft vanished".
  const fromDay = fromDateInput(f.dateFrom);
  const from = fromDay ? fromDay.getTime() : null;
  const toDay = fromDateInput(f.dateTo);
  const to = toDay ? toDay.getTime() + 24 * 60 * 60 * 1000 - 1 : null;

  return orders.filter((o) => {
    if (f.status !== "all" && o.status !== f.status) return false;
    if (f.offerName !== "all" && (o.offerName ?? "").trim() !== f.offerName) return false;
    if (f.deviceName !== "all" && (o.deviceName ?? "").trim() !== f.deviceName) return false;
    if (from !== null || to !== null) {
      const t = new Date(o.createdAt).getTime();
      // An unparseable timestamp is KEPT. Dropping it would hide a real draft
      // to satisfy a filter about time, and a row you cannot see is a row you
      // cannot fix.
      if (Number.isFinite(t)) {
        if (from !== null && t < from) return false;
        if (to !== null && t > to) return false;
      }
    }
    if (!q) return true;
    return (
      (o.fullName ?? "").toLowerCase().includes(q) ||
      (o.idNumber ?? "").toLowerCase().includes(q) ||
      (o.phone ?? "").toLowerCase().includes(q) ||
      (o.reference ?? "").toLowerCase().includes(q)
    );
  });
}
