"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE_ORDER } from "@/lib/order-scope";
import { Prisma } from "@/generated/prisma/client";
import { uploadToR2 } from "@/lib/r2";
import {
  MAX_DOCS,
  hasIdentityDocument,
  hasSupportingDocument,
  type OrderDocument,
  formatPhone,
  canSubmit,
  type OrderListItem,
  STOPPED_MSG,
  SUBMIT_STOPPED,
} from "@/lib/order-types";
import { MALAYSIA_STATES } from "@/lib/malaysia-states";
import { ID_TYPES } from "@/lib/dealer-offers";
import MY_POSTCODES from "@/lib/malaysia-postcodes.json";
import { addressKey, validateMalaysianAddress } from "@/lib/malaysia-address";
import { reconcileStaleSubmits } from "@/lib/order-submit";
import { fillMissingInstallationDates } from "@/lib/installation-date";
import { batchOrderIds, finishBatch, reconcileBatch } from "@/lib/batch-submit";
import { mandatoryGroupsFor } from "@/actions/plans";
import {
  ORDER_TOKEN,
  SCRAPER_API_URL,
  SESSION_EXPIRED_MSG,
  buildOrderJobRequest,
  dealerSessionLive,
  startSubmitRun,
} from "@/lib/order-start";
import { MAX_LEAD_HOURS, MIN_LEAD_HOURS } from "@/lib/appointment-settings";
import {
  nextOrderReference,
  recordEvent,
  groupByAttempt,
  type AttemptView,
} from "@/lib/order-history";

// Static MY postcode -> [CITY, State] map (~2,900 postcodes). Reliable, offline,
// and instant — Google geocoding returns the state but rarely the city for bare
// Malaysian postcodes (e.g. 42610), so we resolve locally first.
const POSTCODES = MY_POSTCODES as unknown as Record<string, [string, string]>;

// ── Postcode -> city + state ─────────────────────────────────────────────────
// UX helper so the agent types the postcode and city/state auto-fill. The
// backend still resolves the exact serviceable address via the portal search.
function normalizeState(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const up = raw.toUpperCase().replace(/^WILAYAH PERSEKUTUAN\s+/, "").trim();
  return MALAYSIA_STATES.find((s) => up.includes(s.toUpperCase())) ?? raw;
}

export async function lookupPostcode(postcode: string) {
  const pc = (postcode || "").trim();
  if (!/^\d{5}$/.test(pc)) return { success: false as const, error: "Enter a 5-digit postcode" };

  // Static dataset first — resolves both city + state reliably, offline, no key.
  const local = POSTCODES[pc];
  if (local) {
    return { success: true as const, city: local[0], state: normalizeState(local[1]) };
  }

  // Fall back to Google geocode for any postcode not in the dataset.
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { success: false as const, error: "Postcode not found." };
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      `${pc}, Malaysia`
    )}&region=my&key=${key}`;
    // Revalidate daily rather than force-cache: the URL embeds the Maps API key,
    // and postcode data is cheap to refetch — no need to pin it indefinitely.
    const resp = await fetch(url, { next: { revalidate: 60 * 60 * 24 } });
    const data = await resp.json();
    if (data.status !== "OK" || !data.results?.length) {
      return { success: false as const, error: "Postcode not found." };
    }
    let city: string | undefined;
    let state: string | undefined;
    for (const c of data.results[0].address_components as Array<{
      long_name: string;
      types: string[];
    }>) {
      if (c.types.includes("administrative_area_level_1")) state = c.long_name;
      if (!city && (c.types.includes("locality") || c.types.includes("postal_town")))
        city = c.long_name;
      if (!city && c.types.includes("administrative_area_level_2")) city = c.long_name;
    }
    return { success: true as const, city, state: normalizeState(state) };
  } catch {
    return { success: false as const, error: "Postcode lookup failed." };
  }
}

// ── Document upload -> R2 ─────────────────────────────────────────────────────
// Up to 10 files per order. Filenames are keyed by ID number + type + sequence
// so two files of the same type never collide, e.g. two MyKad images become
// {idNumber}_mykad_1 and {idNumber}_mykad_2. Utility bills -> {idNumber}_utilitybill_n.
const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5MB/file (portal limit)
// Extension -> content-type. We derive the stored content-type from the
// (allowlisted) extension rather than trusting the client-supplied File.type,
// so a ".jpg" can't be stored as text/html and served as a script.
const EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  bmp: "image/bmp",
  webp: "image/webp",
  pdf: "application/pdf",
};

// docType -> filename slug. "id" uses the ID type (mykad/passport/…); "other"
// uses the agent-supplied label (e.g. "tenancy agreement" -> "tenancyagreement").
function docSlug(docType: string, idType: string, otherLabel?: string): string {
  if (docType === "utility_bill") return "utilitybill";
  if (docType === "im_conversation") return "imconversation";
  if (docType === "mykad") return "mykad";
  if (docType === "passport") return "passport";
  if (docType === "other") {
    const slug = (otherLabel || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    return slug || "doc";
  }
  return idType || "id"; // ID copy — slug is the ID type (mykad/passport/…)
}

export async function uploadOrderDocument(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false as const, error: "No file selected." };
  }
  if (file.size > MAX_DOC_BYTES) {
    return { success: false as const, error: "File exceeds the 5MB limit." };
  }
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const contentType = EXT_CONTENT_TYPE[ext];
  if (!contentType) {
    return { success: false as const, error: `Unsupported file type .${ext}` };
  }

  const idNumber = String(formData.get("idNumber") || "").replace(/[^A-Za-z0-9]/g, "");
  const idType = String(formData.get("idType") || "id").toLowerCase().replace(/[^a-z0-9]/g, "");
  const docType = String(formData.get("docType") || "id");
  const otherLabel = String(formData.get("otherLabel") || "");
  const seq = parseInt(String(formData.get("seq") || "1"), 10) || 1;
  // MyKad can be uploaded as two files — front/back designates the suffix instead
  // of a running sequence number (…_mykad_front / …_mykad_back).
  const side = String(formData.get("side") || "").toLowerCase();
  if (!idNumber) return { success: false as const, error: "Enter the ID number first." };

  const suffix = side === "front" || side === "back" ? side : String(seq);
  const filename = `${idNumber}_${docSlug(docType, idType, otherLabel)}_${suffix}.${ext}`;
  // Keys are namespaced per user so the authenticated proxy can scope access to
  // the owner and MyKad-based filenames can't be enumerated across tenants.
  const key = `orders/${session.user.id}/${filename}`;

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await uploadToR2(key, buf, contentType);
    const url = `/api/orders/document?key=${encodeURIComponent(key)}`;
    return { success: true as const, url, key, filename, type: docType };
  } catch (e) {
    console.error("uploadOrderDocument error:", e instanceof Error ? e.message : e);
    return { success: false as const, error: "Upload failed. Try again." };
  }
}

// ── Save an order draft ──────────────────────────────────────────────────────
// Address is picked from the portal's QryNIGAddress search (see the dealer
// address-search endpoint), so we store the resourceInstId + structured fields
// rather than geocoding a postcode.
const documentSchema = z.object({
  type: z.enum(["id", "im_conversation", "mykad", "passport", "utility_bill", "other"]),
  url: z.string().max(2048),
  key: z.string().max(512).regex(/^orders\//),
  filename: z.string().max(256),
});

// Server-side validation of the order payload. Server Actions are directly
// POST-able, so we enforce shape/enums here rather than trusting the client.
const orderInputSchema = z.object({
  id: z.string().min(1).optional(),
  idType: z.enum(ID_TYPES as unknown as [string, ...string[]]),
  idNumber: z.string().trim().min(1).max(50),
  idExpiry: z.string().max(20).optional(),
  fullName: z.string().trim().min(1).max(255),
  gender: z.enum(["", "Male", "Female"]).optional(),
  birthday: z.string().max(20).optional(),
  race: z.enum(["", "Malay", "Chinese", "Indian", "Others"]).optional(),
  nationality: z.string().max(60).optional(),
  mobilePrefix: z.string().regex(/^\d{0,3}$/).optional(),
  mobile: z.string().regex(/^\d{0,15}$/).optional(),
  email: z
    .string()
    .max(255)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    .optional()
    .or(z.literal("")),
  street: z.string().max(500).optional(),
  postcode: z.string().regex(/^\d{0,5}$/).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
  country: z.string().max(60).optional(),
  addressId: z.string().max(120).optional(),
  addressFull: z.string().max(500).optional(),
  serviceCategory: z.string().max(120).optional(),
  offerCategory: z.string().max(120).optional(),
  offerName: z.string().max(255).optional(),
  deviceCode: z.string().max(40).optional(),
  deviceName: z.string().max(255).optional(),
  remarks: z.string().max(2000).optional(),
  // How far ahead the installation slot must be, in hours. The agent's choice,
  // per order — it was a single global setting an admin kept for everyone.
  // Optional because a draft may predate the field; absent resolves to
  // DEFAULT_LEAD_HOURS when the job payload is built, never here, so "not set"
  // stays distinguishable from "the agent typed 12".
  appointmentLeadHours: z
    .number()
    .int()
    .min(MIN_LEAD_HOURS)
    .max(MAX_LEAD_HOURS)
    .optional(),
  // The ID copy is required: the portal's Personal Customer form marks it so, and
  // a draft without one dies mid-submit with the form filled and nothing saying
  // why. Enforced here rather than only in the form because Server Actions are
  // directly POST-able.
  documents: z
    .array(documentSchema)
    .max(MAX_DOCS)
    .optional()
    .refine(hasIdentityDocument, {
      message: "Attach the customer's MyKad or Passport before saving.",
    })
    // At least one supporting document is required too — the portal's Attachment
    // section expects the paperwork behind the order, and an order arriving with
    // nothing but an ID copy has to be chased afterwards.
    .refine(hasSupportingDocument, {
      message: "Attach at least one supporting document before saving.",
    }),
});

// Loose client-facing shape (friendly types at call sites). The zod schema
// above is the source of truth and validates at runtime, since Server Actions
// are directly POST-able.
export interface OrderInput {
  id?: string;
  idType: string;
  idNumber: string;
  idExpiry?: string;
  fullName: string;
  gender?: string;
  birthday?: string;
  race?: string;
  nationality?: string;
  mobilePrefix?: string;
  mobile?: string;
  email?: string;
  street?: string;
  postcode?: string;
  city?: string;
  state?: string;
  country?: string;
  addressId?: string;
  addressFull?: string;
  serviceCategory?: string;
  offerCategory?: string;
  offerName?: string;
  deviceCode?: string;
  deviceName?: string;
  remarks?: string;
  appointmentLeadHours?: number;
  documents?: OrderDocument[];
}

/**
 * The open draft (if any) that already holds this installation address.
 *
 * Compared two ways: the portal's own addressId is conclusive when both sides
 * have one, and otherwise the normalized address text — an agent may not have
 * confirmed the address yet, and typing differences must not hide a duplicate.
 *
 * Scoped to the draft's OWNER and to orders with no portal order id yet, so a
 * completed order never blocks a genuine re-order for the same premise, and an
 * agent is never blocked by a draft they cannot see or edit.
 */
async function findDuplicateAddress(
  input: z.infer<typeof orderInputSchema>,
  sessionUserId: string,
): Promise<{ id: string; fullName: string } | null> {
  const existing = input.id
    ? await prisma.order.findFirst({
        where: { id: input.id, ...ACTIVE_ORDER },
        select: { userId: true },
      })
    : null;
  const ownerId = existing?.userId ?? sessionUserId;

  const keys = new Set(
    [input.addressFull, input.street].map((a) => addressKey(a ?? "")).filter(Boolean),
  );
  const portalId = input.addressId?.trim();
  if (keys.size === 0 && !portalId) return null;

  const siblings = await prisma.order.findMany({
    where: {
      userId: ownerId,
      orderId: null,
      ...ACTIVE_ORDER,
      ...(input.id ? { id: { not: input.id } } : {}),
    },
    select: { id: true, fullName: true, street: true, addressFull: true, addressId: true },
  });

  return (
    siblings.find((s) => {
      if (portalId && s.addressId?.trim() === portalId) return true;
      return [s.addressFull, s.street]
        .map((a) => addressKey(a ?? ""))
        .some((k) => k && keys.has(k));
    }) ?? null
  );
}

export async function saveOrder(rawInput: OrderInput) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };

  const parsed = orderInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      success: false as const,
      error: first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid order.",
    };
  }
  const input = parsed.data;

  // Mirror the client's Full Address check — the client can be bypassed, and a
  // half-typed address is what makes the portal reject the customer profile as
  // "data incomplete" later, far from where it could still be fixed.
  const addrCheck = validateMalaysianAddress(input.street ?? "");
  if (!addrCheck.ok) {
    return { success: false as const, error: `Installation address — ${addrCheck.reason}` };
  }

  // Server-side half of the "cancelled is terminal / submitted is a portal
  // record" rule — the row menu already hides Edit for both, but the menu can
  // be bypassed and an edit here would desynchronise or resurrect the record.
  if (input.id) {
    const existing = await prisma.order.findFirst({
      where: { id: input.id, ...ACTIVE_ORDER },
      select: { status: true },
    });
    if (existing?.status === "cancelled" || existing?.status === "submitted") {
      return {
        success: false as const,
        error:
          existing.status === "cancelled"
            ? "This order is cancelled and can no longer be edited."
            : "This order was submitted to the portal and can no longer be edited.",
      };
    }
  }

  // One installation address may only sit on one open draft: the portal treats
  // a second order for the same premise as a duplicate, so catching it here
  // saves a dealer-session round trip and a rejected order.
  const dup = await findDuplicateAddress(input, session.user.id);
  if (dup) {
    return {
      success: false as const,
      error: `This installation address is already on a draft for ${dup.fullName}. Edit that draft instead of creating a second one.`,
    };
  }

  const data = {
    idType: input.idType,
    idNumber: input.idNumber.trim(),
    idExpiry: input.idExpiry || null,
    fullName: input.fullName.trim(),
    gender: input.gender || null,
    birthday: input.birthday || null,
    race: input.race || null,
    nationality: input.nationality || "Malaysia",
    mobilePrefix: input.mobilePrefix || "60",
    mobile: input.mobile || null,
    email: input.email || null,
    street: input.street || null,
    postcode: input.postcode || null,
    city: input.city || null,
    state: input.state || null,
    country: input.country || "Malaysia", // always Malaysia for the portal
    addressId: input.addressId || null,
    addressFull: input.addressFull || null,
    serviceCategory: input.serviceCategory || null,
    offerCategory: input.offerCategory || null,
    offerName: input.offerName || null,
    deviceCode: input.deviceCode || null,
    deviceName: input.deviceName || null,
    remarks: input.remarks || null,
    appointmentLeadHours: input.appointmentLeadHours ?? null,
    documents: (input.documents ?? []).slice(0, MAX_DOCS) as unknown as Prisma.InputJsonValue,
  };

  try {
    // Superadmins may edit any draft; everyone else only their own. Editing
    // leaves the draft's original owner intact.
    const superAdmin = input.id ? await isSuperAdmin(session.user.id) : false;
    const order = input.id
      ? await prisma.order.update({
          where: superAdmin ? { id: input.id } : { id: input.id, userId: session.user.id },
          data,
        })
      : await prisma.order.create({
          data: {
            ...data,
            userId: session.user.id,
            status: "draft",
            // Assigned at creation, not at submit: agents quote this in chat long
            // before the portal has issued an order number.
            reference: await nextOrderReference(),
          },
        });
    return { success: true as const, id: order.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("saveOrder error:", message);
    return { success: false as const, error: "Failed to save the order." };
  }
}

// Full order for editing an existing draft. Scoped to the owner.
export async function getOrder(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized", data: null };

  const superAdmin = await isSuperAdmin(session.user.id);
  const order = await prisma.order.findFirst({
    where: superAdmin ? { id, ...ACTIVE_ORDER } : { id, userId: session.user.id, ...ACTIVE_ORDER },
  });
  if (!order) return { success: false as const, error: "Order not found.", data: null };
  return { success: true as const, data: order };
}

// ── List / submit / delete orders ────────────────────────────────────────────
// A superadmin can view + manage every user's orders (Order Entry drafts).
async function isSuperAdmin(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperAdmin: true },
  });
  return !!u?.isSuperAdmin;
}

/**
 * Shapes one raw Prisma `Order` row into the `OrderListItem` the UI reads
 * everywhere — the list, and now a single order's detail page. Kept as one
 * function so the two callers can never drift into disagreeing about what a
 * row looks like.
 */
function toOrderListItem(
  o: Prisma.OrderGetPayload<{ include: { user: { select: { email: true } } } }>,
  opts: { superAdmin: boolean; installationDateOverride?: string | null },
): OrderListItem {
  return {
    id: o.id,
    fullName: o.fullName,
    idType: o.idType,
    idNumber: o.idNumber,
    phone: formatPhone(o.mobilePrefix, o.mobile),
    email: o.email,
    gender: o.gender,
    birthday: o.birthday,
    race: o.race,
    idExpiry: o.idExpiry,
    offerName: o.offerName,
    street: o.street,
    postcode: o.postcode,
    city: o.city,
    state: o.state,
    addressFull: o.addressFull,
    addressId: o.addressId,
    status: o.status,
    orderId: o.orderId,
    errorMessage: o.errorMessage,
    errorCode: o.errorCode,
    stage: o.stage,
    reference: o.reference,
    deviceName: o.deviceName,
    deviceCode: o.deviceCode,
    remarks: o.remarks,
    appointmentLeadHours: o.appointmentLeadHours,
    attempt: o.attempt,
    autoRetries: o.autoRetries,
    autoRetryAt: o.autoRetryAt ? o.autoRetryAt.toISOString() : null,
    screenshotUrl: o.screenshotUrl,
    // `o.installationDate` is what was already stored; an override carries
    // anything read from an e-RF a moment ago, which the freshly-loaded row
    // predates. Falling back the other way would show a dash on exactly the
    // load that first discovered the date.
    installationDate: opts.installationDateOverride ?? o.installationDate,
    docCount: Array.isArray(o.documents) ? (o.documents as unknown[]).length : 0,
    documents: Array.isArray(o.documents)
      ? (o.documents as unknown as OrderDocument[])
      : [],
    createdAt: o.createdAt.toISOString(),
    createdByEmail: opts.superAdmin ? o.user?.email ?? null : null,
  };
}

// Single order, already shaped as `OrderListItem` — what the detail page
// (`/dashboard/order-entry/orders/[orderId]`) reads. Scoped identically to
// `getOrder`/`getOrderHistory`: a superadmin can read any order, everyone
// else only their own.
export async function getOrderDetail(id: string): Promise<{
  success: boolean;
  error?: string;
  data: OrderListItem | null;
}> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized", data: null };

  const superAdmin = await isSuperAdmin(session.user.id);
  const order = await prisma.order.findFirst({
    where: superAdmin ? { id, ...ACTIVE_ORDER } : { id, userId: session.user.id, ...ACTIVE_ORDER },
    include: { user: { select: { email: true } } },
  });
  if (!order) return { success: false, error: "Order not found.", data: null };

  // Opening the detail IS seeing the outcome — for the OWNER. A superadmin
  // reading another agent's order does not clear that agent's badge: the
  // outcome is still news to the person whose customer it is.
  if (
    order.userId === session.user.id &&
    !order.outcomeSeenAt &&
    ["submitted", "failed", "warning"].includes(order.status)
  ) {
    await prisma.order.updateMany({
      where: { id: order.id, outcomeSeenAt: null },
      data: { outcomeSeenAt: new Date() },
    });
  }

  let installationDateOverride: string | null | undefined;
  try {
    const appointments = await fillMissingInstallationDates([order]);
    installationDateOverride = appointments[order.id];
  } catch (e) {
    console.error("[getOrderDetail] installation-date fill failed (returning anyway):", e);
  }

  return {
    success: true,
    data: toOrderListItem(order, { superAdmin, installationDateOverride }),
  };
}

export async function listOrders(): Promise<{
  success: boolean;
  error?: string;
  isSuperAdmin?: boolean;
  data: OrderListItem[];
}> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized", data: [] };

  const superAdmin = await isSuperAdmin(session.user.id);

  // Repair anything left mid-flight by a browser that went away, so an order
  // whose submitting tab was closed resolves the moment someone opens the list
  // instead of sitting in `submitting` forever.
  //
  // Strictly best-effort: reconciling is a side task, and listing the drafts is
  // the job. Letting it throw here once took the whole list down (a stale Prisma
  // client that didn't know `jobId`), so it can never be allowed to again.
  try {
    await reconcileStaleSubmits(superAdmin ? null : session.user.id);
  } catch (e) {
    console.error("[listOrders] reconcile failed (listing anyway):", e);
  }

  const orders = await prisma.order.findMany({
    // Superadmins see ALL drafts; everyone else only their own.
    where: superAdmin ? { ...ACTIVE_ORDER } : { userId: session.user.id, ...ACTIVE_ORDER },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true } } },
  });

  // Read the installation appointment out of the e-RF for any completed order
  // that has not been read yet, once each. Same best-effort contract as the
  // reconcile above and for the same reason: this is a column, and the job here
  // is listing the orders.
  let appointments: Record<string, string | null> = {};
  try {
    appointments = await fillMissingInstallationDates(orders);
  } catch (e) {
    console.error("[listOrders] installation-date fill failed (listing anyway):", e);
  }

  return {
    success: true,
    isSuperAdmin: superAdmin,
    data: orders.map((o) =>
      toOrderListItem(o, { superAdmin, installationDateOverride: appointments[o.id] }),
    ),
  };
}

/**
 * Manually mark a SUBMITTED order as cancelled.
 *
 * Terminal and one-way: nothing transitions out of "cancelled" — the row keeps
 * Details (the audit trail of a real paid order) and Delete, and refuses
 * submit/resubmit/edit. This is BizzFlow bookkeeping only: it does NOT void
 * the order at Unifi, and the appended history event says so in words, because
 * an agent reading the trail later must not mistake this for a portal void.
 */
export async function cancelOrder(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };
  const superAdmin = await isSuperAdmin(session.user.id);
  const order = await prisma.order.findFirst({
    where: superAdmin ? { id, ...ACTIVE_ORDER } : { id, userId: session.user.id, ...ACTIVE_ORDER },
    select: { id: true, status: true, attempt: true },
  });
  if (!order) return { success: false as const, error: "Order not found." };
  if (order.status === "cancelled") {
    return { success: false as const, error: "This order is already cancelled." };
  }
  if (order.status !== "submitted") {
    return { success: false as const, error: "Only a submitted order can be cancelled." };
  }
  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: "cancelled",
      statusEvents: {
        create: {
          attempt: order.attempt ?? 1,
          stage: null,
          status: "info",
          message:
            "Manually marked Cancelled by the agent. This does not void the order at Unifi — " +
            "the portal record stays live and must be voided there if required.",
        },
      },
    },
  });
  return { success: true as const };
}

export async function deleteOrder(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };
  const superAdmin = await isSuperAdmin(session.user.id);
  // Soft delete: the row and its whole status history survive so admin
  // oversight can show what was deleted. The agent's list stops showing it
  // because every agent-facing read carries ACTIVE_ORDER.
  //
  // `autoRetryAt` and `jobId` are cleared in the SAME write, and that is not
  // tidiness. `sweepPendingRetries` selects on autoRetryAt, status and
  // autoRetries alone — deletion does not enter that query — so a deleted order
  // with a retry owed would be picked up by the cron and submitted to the LIVE
  // portal, minting a real billable order for a draft the agent deleted, with
  // no row in their list to show it happened. The sweep also filters on
  // ACTIVE_ORDER; either guard alone is a single point of failure for an
  // expensive mistake.
  const res = await prisma.order.updateMany({
    where: superAdmin ? { id, ...ACTIVE_ORDER } : { id, userId: session.user.id, ...ACTIVE_ORDER },
    data: { deletedAt: new Date(), autoRetryAt: null, jobId: null },
  });
  if (res.count === 0) return { success: false as const, error: "Order not found." };
  return { success: true as const };
}

// ── Submit an order to the dealer portal (via the Flask service) ─────────────

/**
 * Is the scraper already running a browser job — anyone's?
 *
 * `/health` reports a bare count and needs no token (Caddy serves it publicly),
 * which is exactly enough: the UI only needs to know whether the single-browser
 * lock is held, never by whom or for what.
 *
 * **Fails OPEN.** An unreachable droplet reports `busy: false`, so a network
 * blip greys out nobody's Submit button. Blocking on "I could not ask" would
 * make a broken health check look like a permanently busy server, and the
 * submit itself gives a clear error if the droplet really is down.
 */
export async function scraperBusy() {
  const session = await auth();
  const idle = {
    busy: false, mine: false, slots: 0, capacity: 1,
    ageS: null, maxRuntimeS: null, reachable: false,
  };
  if (!session?.user?.id) return { success: false as const, ...idle };
  try {
    // GET /jobs, not /health: the UI needs to tell "a run on YOUR account" from
    // "every slot is busy", and those are different sentences. /health is served
    // publicly by Caddy and must never carry per-agent state, so the per-agent
    // answer comes from the auth-gated listing instead. This runs server-side in
    // a Server Action, so the token never reaches the browser.
    const res = await fetch(`${SCRAPER_API_URL}/jobs`, {
      cache: "no-store",
      headers: { "X-Internal-Token": ORDER_TOKEN },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { success: true as const, ...idle };
    const data = (await res.json()) as {
      jobs?: { user_key?: string | null; status?: string; age_s?: number }[];
      slots_in_use?: number;
      capacity?: number;
      max_job_runtime_s?: number | null;
      oldest_active_age_s?: number | null;
    };
    const capacity = typeof data.capacity === "number" ? data.capacity : 1;
    const slots = typeof data.slots_in_use === "number" ? data.slots_in_use : 0;
    const active = (data.jobs ?? []).filter(
      (j) => j.status === "queued" || j.status === "running",
    );
    const own = active.find((j) => j.user_key === session.user!.id);
    return {
      success: true as const,
      // Blocked either way, but for different reasons the caller must separate.
      busy: !!own || slots >= capacity,
      /** A run on THIS account — possibly started by someone else on a shared login. */
      mine: !!own,
      slots,
      capacity,
      // Their own run's age when there is one, else the oldest on the box —
      // the number shown must belong to the run being described.
      ageS: own
        ? (typeof own.age_s === "number" ? own.age_s : null)
        : (typeof data.oldest_active_age_s === "number" ? data.oldest_active_age_s : null),
      maxRuntimeS: typeof data.max_job_runtime_s === "number" ? data.max_job_runtime_s : null,
      reachable: true,
    };
  } catch {
    // Fails OPEN, exactly as before: a health read that could not be made must
    // never grey out a button. The submit itself gives a clear error if the
    // droplet really is down.
    return { success: true as const, ...idle };
  }
}


/**
 * Start a submit and return immediately with the scraper's job id.
 *
 * The run itself takes minutes; the browser follows it via
 * GET /api/orders/[id]/progress. Nothing here waits on the portal, so no server
 * action ever outlives a request timeout.
 */
export async function startSubmit(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };

  // Superadmins may submit any draft; it runs under THEIR own connected dealer
  // session (user_key), regardless of who created the draft.
  const superAdmin = await isSuperAdmin(session.user.id);
  const order = await prisma.order.findFirst({
    where: superAdmin ? { id, ...ACTIVE_ORDER } : { id, userId: session.user.id, ...ACTIVE_ORDER },
  });
  if (!order) return { success: false as const, error: "Order not found." };

  // Everything from here — the attempt bump, the session check, the hand-off —
  // is shared with the batch runner and the automatic retry, so a submit cannot
  // behave differently depending on which of the three started it. This call
  // also resets the automatic-retry budget: a person pressing Submit is a new
  // decision, and inheriting a spent budget would leave the order with no
  // retries for a failure nobody had seen yet.
  const run = await startSubmitRun(order, { userKey: session.user.id });
  return run.ok
    ? { success: true as const, jobId: run.jobId }
    : { success: false as const, error: run.error };
}


/**
 * Stop a submit that is running, on the droplet as well as here.
 *
 * The droplet drives ONE browser and a run takes minutes, so an agent who
 * realises mid-flight that the draft is wrong previously had no way out but to
 * watch it finish and then void whatever it created.
 *
 * **This is not bookkeeping — it really cancels the run.** The scraper's
 * `/jobs/<id>/cancel` cancels the job's asyncio task, which is the same
 * mechanism its own overall-timeout uses, so the run's `finally` tears the
 * browser down rather than leaking a headless_shell.
 *
 * The order lands on `failed`, NOT `cancelled`: a stop is a decision to try
 * again differently, and `cancelled` is a one-way door a mis-click could not
 * undo. It carries `submit_stopped`, which is terminal in `retry-policy`, so
 * the automatic retry cannot quietly undo what the agent just did.
 *
 * A droplet that refuses or cannot be reached leaves the order exactly where it
 * was — in flight. Writing "stopped" over a run that is still going would be
 * the worst possible lie: the browser would carry on submitting a real order
 * while the row invited a second one.
 */
export async function stopSubmit(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };
  const superAdmin = await isSuperAdmin(session.user.id);
  const order = await prisma.order.findFirst({
    where: superAdmin ? { id, ...ACTIVE_ORDER } : { id, userId: session.user.id, ...ACTIVE_ORDER },
    select: { id: true, status: true, attempt: true, jobId: true, stage: true },
  });
  if (!order) return { success: false as const, error: "Order not found." };
  if (order.status !== "submitting") {
    return { success: false as const, error: "This order is not running." };
  }
  if (!ORDER_TOKEN) {
    return { success: false as const, error: "Order service is not configured." };
  }
  if (!order.jobId) {
    // In flight with no job id: the hand-off failed before the droplet answered,
    // so there is nothing running to cancel and the row is merely stuck. Filing
    // it as stopped is then the whole fix.
    await finishAsStopped(order.id, order.attempt, order.stage);
    return { success: true as const };
  }

  try {
    const res = await fetch(`${SCRAPER_API_URL}/jobs/${order.jobId}/cancel`, {
      method: "POST",
      headers: { "X-Internal-Token": ORDER_TOKEN },
      cache: "no-store",
      // Cancelling is a flag and a `call_soon_threadsafe` — it never legitimately
      // takes long, and a wedged droplet must surface as an error the agent can
      // read rather than as a platform timeout.
      signal: AbortSignal.timeout(10_000),
    });
    // 404 means the droplet has already forgotten the job (it restarted, or the
    // run finished). Nothing is left to cancel, so stopping is still the right
    // thing to write — the alternative is a row stuck in `submitting` forever.
    if (!res.ok && res.status !== 404 && res.status !== 409) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return {
        success: false as const,
        error: body.message || "The order service refused to stop this run.",
      };
    }
  } catch {
    return {
      success: false as const,
      error:
        "Couldn't reach the order service, so the run was NOT stopped \u2014 it is " +
        "still going. Try again in a moment.",
    };
  }

  await finishAsStopped(order.id, order.attempt, order.stage);
  return { success: true as const };
}

/**
 * File a stopped run, in one write.
 *
 * `jobId` is cleared so no later poll re-opens it, and `autoRetryAt` so nothing
 * reads the row as owing a retry — `submit_stopped` would refuse one anyway,
 * but a pill claiming a retry that will never come is its own bug.
 */
async function finishAsStopped(id: string, attempt: number, stage: string | null) {
  await prisma.order.update({
    where: { id },
    data: {
      status: "failed",
      errorCode: SUBMIT_STOPPED,
      errorMessage: STOPPED_MSG,
      jobId: null,
      autoRetryAt: null,
    },
  });
  await recordEvent({
    orderId: id,
    attempt,
    status: "failed",
    stage,
    message: STOPPED_MSG,
    errorCode: SUBMIT_STOPPED,
  });
}


// ── Status history ───────────────────────────────────────────────────────────
/**
 * The full status trail for one order, grouped into submit attempts.
 *
 * The Order row only carries the latest state, so this is the only way to answer
 * "why did it fail, and did the previous attempt fail the same way?".
 */
export async function getOrderHistory(id: string): Promise<{
  success: boolean;
  error?: string;
  attempts: AttemptView[];
}> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized", attempts: [] };

  const superAdmin = await isSuperAdmin(session.user.id);
  const order = await prisma.order.findFirst({
    where: superAdmin ? { id, ...ACTIVE_ORDER } : { id, userId: session.user.id, ...ACTIVE_ORDER },
    select: { id: true },
  });
  if (!order) return { success: false, error: "Order not found.", attempts: [] };

  const events = await prisma.orderStatusEvent.findMany({
    where: { orderId: id },
    orderBy: { createdAt: "asc" },
    // Bounded: a pathological retry loop must not send an unbounded payload to
    // the browser. Oldest are dropped first, which keeps the latest attempts.
    take: 500,
  });

  return {
    success: true,
    attempts: groupByAttempt(
      events.map((e) => ({
        id: e.id,
        attempt: e.attempt,
        stage: e.stage,
        status: e.status,
        message: e.message,
        errorCode: e.errorCode,
        createdAt: e.createdAt.toISOString(),
      })),
    ),
  };
}


// ── Server-side batch submit ─────────────────────────────────────────────────
/**
 * Submitting several drafts, with the loop on the droplet instead of the tab.
 *
 * The batch loop used to live in `OrdersList.tsx`: the browser called
 * `startSubmit` for each selected draft and polled each job to completion. A
 * closed tab or a dropped connection mid-batch left every remaining order
 * unsubmitted with nobody told, and it processed rows in filtered display order
 * rather than by age.
 *
 * Now BizzFlow sorts, builds the payloads and hands the whole list to the
 * droplet, which runs them one at a time — one dealer session cannot drive two
 * portal flows at once, which is why the browser loop was sequential too.
 */

/**
 * A job id BizzFlow allocates, rather than one the droplet returns.
 *
 * This is the seam that lets the batch reuse every existing per-order path
 * unchanged: `Order.jobId` is written BEFORE the batch starts, so the progress
 * route, `pollOrderProgress` and `reconcileStaleSubmits` all work on a batch
 * member exactly as they do on a single submit. Waiting for the droplet to name
 * the ids instead would leave each order unpollable until the batch status was
 * fetched and matched back up.
 *
 * Hex, no dashes — the same shape as the `uuid4().hex` ids the scraper mints,
 * so nothing downstream has to care which side allocated one.
 */
function newJobId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function startBatchSubmit(ids: string[]) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };
  if (!ORDER_TOKEN) {
    return { success: false as const, error: "Order service is not configured." };
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return { success: false as const, error: "No orders selected." };
  }

  const superAdmin = await isSuperAdmin(session.user.id);
  const rows = await prisma.order.findMany({
    where: {
      id: { in: ids },
      ...ACTIVE_ORDER,
      ...(superAdmin ? {} : { userId: session.user.id }),
    },
    // Oldest created FIRST. The browser loop ran rows in whatever order the
    // filtered table happened to show them, so the same selection could run in
    // a different order twice; age is the one ordering an agent can predict.
    orderBy: { createdAt: "asc" },
  });

  // Only fresh drafts. A stranded order needs its own confirmation naming the
  // portal order number, one at a time — sweeping one into a batch is how a
  // real chargeable duplicate gets created without anyone deciding to.
  const targets = rows.filter((o) => canSubmit(o));
  if (targets.length === 0) {
    return { success: false as const, error: "None of the selected orders can be submitted." };
  }

  // Checked ONCE for the whole batch rather than per order: every member runs
  // under the same dealer session, so a dead session fails all of them
  // identically and there is nothing to learn from finding that out ten times.
  if (!(await dealerSessionLive(session.user.id))) {
    return { success: false as const, error: SESSION_EXPIRED_MSG };
  }

  // Cached per offer name: a batch of ten orders on one package would otherwise
  // make ten identical lookups.
  const groupCache = new Map<string, Awaited<ReturnType<typeof mandatoryGroupsFor>>>();

  const batch = await prisma.batchRun.create({
    data: {
      userId: session.user.id,
      orderIds: targets.map((o) => o.id),
      status: "running",
    },
  });

  const jobs: { jobId: string; order: ReturnType<typeof buildOrderJobRequest> }[] = [];
  for (const order of targets) {
    const key = order.offerName ?? "";
    if (!groupCache.has(key)) groupCache.set(key, await mandatoryGroupsFor(order.offerName));
    const attempt = order.attempt + 1;
    const jobId = newJobId();
    await prisma.order.update({
      where: { id: order.id },
      data: {
        attempt,
        jobId,
        status: "submitting",
        errorMessage: null,
        errorCode: null,
        // Cleared so this attempt gets its own email. The guard is per-send, not
        // per-order-lifetime — a resubmitted order is news again.
        notifiedAt: null,
        stage: "creating_customer",
        stageAt: new Date(),
        // A person pressing Submit Selected is a new decision, so every member
        // gets a full automatic-retry budget back — the same rule
        // `startSubmitRun` applies to a single manual submit.
        autoRetries: 0,
        autoRetryAt: null,
        // Whose dealer session this batch runs under (`user_key` below), which a
        // later automatic retry reuses rather than guessing at the draft's owner.
        lastSubmitUserId: session.user.id,
      },
    });
    await recordEvent({
      orderId: order.id, attempt, status: "submitting", stage: "validating_draft",
      message: `Submit started (batch of ${targets.length}).`,
    });
    jobs.push({ jobId, order: buildOrderJobRequest(order, attempt, groupCache.get(key)!) });
  }

  /** Put every member back where it was and close the batch out in words. */
  const abort = async (message: string) => {
    for (const order of targets) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: "failed", jobId: null, errorMessage: message },
      });
      await recordEvent({
        orderId: order.id, attempt: order.attempt + 1, status: "failed",
        stage: "creating_customer", message,
      });
    }
    await prisma.batchRun.update({
      where: { id: batch.id },
      data: { status: "finished", finishedAt: new Date(), errorMessage: message, results: [] },
    });
    return { success: false as const, error: message };
  };

  try {
    const res = await fetch(`${SCRAPER_API_URL}/orders/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": ORDER_TOKEN },
      cache: "no-store",
      // Same 10s bound as `startSubmit`: starting a batch is a payload handoff
      // and a thread spawn, never a long call. Without it, Node's fetch waits
      // forever and a wedged droplet surfaces as a platform timeout instead of
      // an error the agent can read.
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        batch_id: batch.id,
        user_key: session.user.id,
        full_order: true,
        dry_run: false,
        do_pay: process.env.ORDER_ENTRY_DO_PAY === "true",
        jobs,
      }),
    });
    const started = (await res.json().catch(() => ({}))) as {
      batch_job_id?: string;
      message?: string;
    };
    if (!res.ok || !started.batch_job_id) {
      return abort(started.message || "Couldn't start the batch on the order service.");
    }
    await prisma.batchRun.update({
      where: { id: batch.id },
      data: { scraperBatchId: started.batch_job_id },
    });
    return { success: true as const, batchRunId: batch.id, count: targets.length };
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      return abort(
        "The order service didn't respond within 10 seconds — it may be overloaded. Nothing was submitted.",
      );
    }
    return abort(e instanceof Error ? e.message : "Order service unreachable.");
  }
}

/**
 * One poll of a running batch, for the UI.
 *
 * Deliberately reconcile-only: it never decides that a batch is over. The
 * droplet's webhook is what closes a batch out and sends the summary, so a
 * closed tab changes nothing — this just refreshes what the open tab shows, and
 * marks the batch finished if every member is already terminal (which covers a
 * webhook that never arrived).
 */
export async function pollBatch(batchRunId: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };

  const superAdmin = await isSuperAdmin(session.user.id);
  const batch = await prisma.batchRun.findFirst({
    where: { id: batchRunId, ...(superAdmin ? {} : { userId: session.user.id }) },
    select: { id: true, status: true, orderIds: true, errorMessage: true },
  });
  if (!batch) return { success: false as const, error: "Batch not found." };

  const reconciled = await reconcileBatch(batch.id);
  const outcomes = reconciled?.outcomes ?? [];
  const done = batch.status === "finished" || !!reconciled?.allDone;

  // Only closes a batch the DROPLET has stopped reporting on. `allDone` means
  // every member is terminal, which is the same conclusion the webhook reaches;
  // doing it here as well is what stops a lost webhook leaving a finished batch
  // stuck on "running" forever. The summary email is NOT sent from here — a
  // browser poll must not become a second, tab-dependent trigger.
  if (done && batch.status === "running") {
    await finishBatch(batch.id);
  }

  return {
    success: true as const,
    status: done ? "finished" : "running",
    errorMessage: batch.errorMessage,
    results: outcomes,
    total: batchOrderIds(batch.orderIds).length,
    /** The member currently in flight, so the UI can highlight its row. */
    currentOrderId: outcomes.find((o) => o.status === "submitting")?.orderId ?? null,
  };
}

/**
 * The batch this user still has running, if any.
 *
 * Read on page load so a tab opened after the batch started — or reopened after
 * being closed — picks the progress display back up. The run survived the tab;
 * the UI should too.
 */
export async function activeBatch() {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };
  const batch = await prisma.batchRun.findFirst({
    where: { userId: session.user.id, status: "running" },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  return { success: true as const, batchRunId: batch?.id ?? null };
}

// ── Unseen outcomes — the in-app "finished while you were away" ─────────────

const TERMINAL_OUTCOME = ["submitted", "failed", "warning"] as const;

/**
 * Terminal orders no signed-in eye has seen yet.
 *
 * Owner-scoped even for superadmins, deliberately: an outcome belongs to the
 * DRAFT'S owner — a superadmin submitting another agent's draft is acting for
 * that agent, and the badge must nag the person whose customer it is, not
 * whoever happened to press the button.
 */
export async function unseenOutcomes() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false as const, count: 0, orders: [] as UnseenOutcome[] };
  }
  const rows = await prisma.order.findMany({
    where: {
      userId: session.user.id,
      status: { in: [...TERMINAL_OUTCOME] },
      outcomeSeenAt: null,
      attempt: { gt: 0 },
      ...ACTIVE_ORDER,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, reference: true, fullName: true, status: true, orderId: true,
      errorCode: true, errorMessage: true, autoRetries: true, autoRetryAt: true,
      updatedAt: true,
    },
  });
  return {
    success: true as const,
    count: rows.length,
    orders: rows.map((o): UnseenOutcome => ({
      id: o.id,
      reference: o.reference,
      fullName: o.fullName,
      status: o.status,
      orderId: o.orderId,
      errorCode: o.errorCode,
      errorMessage: o.errorMessage,
      autoRetries: o.autoRetries,
      autoRetryAt: o.autoRetryAt ? o.autoRetryAt.toISOString() : null,
      finishedAt: o.updatedAt.toISOString(),
    })),
  };
}

export interface UnseenOutcome {
  id: string;
  reference: string | null;
  fullName: string;
  status: string;
  orderId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  autoRetries: number;
  autoRetryAt: string | null;
  finishedAt: string;
}

/**
 * Mark outcomes seen — a dismiss, or Dismiss all.
 *
 * Owner-scoped and terminal-scoped in the WHERE, not trusted from the caller:
 * Server Actions are directly POST-able, and this must not be usable to blank
 * another agent's badge or to pre-mark an in-flight run as seen.
 */
export async function markOutcomeSeen(ids: string[]) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };
  if (!Array.isArray(ids) || ids.length === 0) return { success: true as const, marked: 0 };
  const res = await prisma.order.updateMany({
    where: {
      id: { in: ids },
      userId: session.user.id,
      status: { in: [...TERMINAL_OUTCOME] },
      outcomeSeenAt: null,
    },
    data: { outcomeSeenAt: new Date() },
  });
  return { success: true as const, marked: res.count };
}
