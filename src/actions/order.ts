"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { uploadToR2 } from "@/lib/r2";
import {
  MAX_DOCS,
  ADDRESS_SEARCH_STATES,
  type OrderDocument,
  type OrderListItem,
  type AddressResult,
} from "@/lib/order-types";
import { MALAYSIA_STATES } from "@/lib/malaysia-states";
import { ID_TYPES } from "@/lib/dealer-offers";
import MY_POSTCODES from "@/lib/malaysia-postcodes.json";
import { addressKey, validateMalaysianAddress } from "@/lib/malaysia-address";
import { reconcileStaleSubmits } from "@/lib/order-submit";
import { mandatoryGroupsFor } from "@/actions/plans";
import { getAppointmentPolicy } from "@/actions/admin-settings";
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
  documents: z.array(documentSchema).max(MAX_DOCS).optional(),
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
    ? await prisma.order.findUnique({ where: { id: input.id }, select: { userId: true } })
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
    where: superAdmin ? { id } : { id, userId: session.user.id },
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
    where: superAdmin ? {} : { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true } } },
  });

  return {
    success: true,
    isSuperAdmin: superAdmin,
    data: orders.map((o) => ({
      id: o.id,
      fullName: o.fullName,
      idType: o.idType,
      idNumber: o.idNumber,
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
      attempt: o.attempt,
      screenshotUrl: o.screenshotUrl,
      docCount: Array.isArray(o.documents) ? (o.documents as unknown[]).length : 0,
      createdAt: o.createdAt.toISOString(),
      createdByEmail: superAdmin ? o.user?.email ?? null : null,
    })),
  };
}

export async function deleteOrder(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };
  const superAdmin = await isSuperAdmin(session.user.id);
  const res = await prisma.order.deleteMany({
    where: superAdmin ? { id } : { id, userId: session.user.id },
  });
  if (res.count === 0) return { success: false as const, error: "Order not found." };
  return { success: true as const };
}

// ── Submit an order to the dealer portal (via the Flask service) ─────────────
const SCRAPER_API_URL = process.env.SCRAPER_API_URL ?? "http://localhost:5000";
const ORDER_TOKEN = process.env.ORDER_ENTRY_API_TOKEN ?? "";

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
  if (!ORDER_TOKEN) {
    return { success: false as const, error: "Order service is not configured." };
  }

  // Superadmins may submit any draft; it runs under THEIR own connected dealer
  // session (user_key below), regardless of who created the draft.
  const superAdmin = await isSuperAdmin(session.user.id);
  const order = await prisma.order.findFirst({
    where: superAdmin ? { id } : { id, userId: session.user.id },
  });
  if (!order) return { success: false as const, error: "Order not found." };

  // Each submit is its own attempt in the status history, so the timeline can
  // show "attempt 3 failed the same way attempt 1 did".
  const attempt = order.attempt + 1;
  await prisma.order.update({ where: { id: order.id }, data: { attempt } });
  const fatal = async (stage: string, msg: string) => {
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "failed", stage, errorMessage: msg },
    });
    await recordEvent({ orderId: order.id, attempt, status: "failed", stage, message: msg });
    return { success: false as const, error: msg };
  };
  await recordEvent({
    orderId: order.id, attempt, status: "submitting", stage: "validating_draft",
    message: "Submit started.",
  });

  // ── Step 1: validating_draft ──────────────────────────────────────────────
  // Feasibility needs a serviceable address (resourceInstId) to select "By Address
  // Id". Without it the portal can't check feasibility, so block early with a
  // clear message rather than failing deep in the flow.
  if (!order.addressId) {
    return fatal(
      "validating_draft",
      "Select a serviceable Service Address before submitting (search + pick it in the draft).",
    );
  }

  // ── Step 2: checking_session ──────────────────────────────────────────────
  // Read the stored expiry rather than calling the portal: it costs nothing and
  // catches the common case (an agent who never reconnected today). A session
  // that dies mid-run is still handled by the run itself.
  const dealer = await prisma.dealerAccount.findUnique({
    where: { userId: session.user.id },
    select: { sessionExpiresAt: true },
  });
  if (!dealer?.sessionExpiresAt || dealer.sessionExpiresAt.getTime() <= Date.now()) {
    return fatal(
      "checking_session",
      "Your dealer session has expired. Reconnect on the Order Entry page, then submit again.",
    );
  }

  const headers = {
    "Content-Type": "application/json",
    "X-Internal-Token": ORDER_TOKEN,
  };
  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: "submitting",
      errorMessage: null,
      stage: "creating_customer",
      stageAt: new Date(),
    },
  });

  // The mandatory offer-group names an admin recorded for this plan. The scraper
  // expands these groups by name instead of guessing at the portal's red "*".
  const offerGroups = await mandatoryGroupsFor(order.offerName);

  // The admin's appointment booking policy, carried per-job. In the payload
  // rather than in scraper config so changing it is a settings change, not a
  // droplet redeploy — which is the whole reason a fixed test date is workable.
  const appointment = await getAppointmentPolicy();

  // Send the raw order; the Flask side maps it to a portal payload.
  const reqOrder = {
    offerGroups,
    appointment,
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
    // Which run this is, so the scraper can file its page-1 screenshot against
    // this order AND attempt (`id` above already identifies the order). The user
    // id is deliberately NOT sent — the scraper takes it from the authenticated
    // user_key, so a request body can't redirect an upload into someone else's
    // R2 namespace.
    attempt,
  };

  async function fail(message: string) {
    await prisma.order.update({
      where: { id: order!.id },
      data: { status: "failed", errorMessage: message },
    });
    return { success: false as const, error: message };
  }

  try {
    // Full per-order flow: create the customer profile, then feasibility -> Order
    // -> attach the customer -> capture the order id. One dealer session.
    const startRes = await fetch(`${SCRAPER_API_URL}/orders`, {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify({
        order: reqOrder,
        user_key: session.user.id,
        full_order: true,
        // Real submit: the scraper defaults dry_run=true, so opt OUT explicitly to
        // actually click Order + drive the whole New Connection flow through Pay.
        dry_run: false,
        // do_pay clicks the REAL, billable Pay button. Default false (stops at the
        // Pay gate). Enable per-environment via ORDER_ENTRY_DO_PAY=true — so prod,
        // which never sets it, can never place a billable order by accident.
        do_pay: process.env.ORDER_ENTRY_DO_PAY === "true",
      }),
    });
    const start = (await startRes.json().catch(() => ({}))) as {
      job_id?: string;
      message?: string;
    };
    if (!startRes.ok || !start.job_id) {
      return fail(start.message || "Couldn't start the order job.");
    }

    // Hand the job id back and stop. The browser polls
    // GET /api/orders/[id]/progress from here; `listOrders` reconciles the run
    // if that browser goes away.
    await prisma.order.update({
      where: { id: order.id },
      data: { jobId: start.job_id },
    });
    return { success: true as const, jobId: start.job_id };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Order service unreachable.");
  }
}

// ── Address search (portal QryNIGAddress via the Flask service) ──────────────
// Read-only lookup of serviceable addresses for the order form's picker. Returns
// the resourceInstId (addressId) + structured fields the backend later uses to
// select the address "By Address Id". No order/customer is created.
type AddressQueryBy = "keyword" | "street" | "building" | "address_id";

export async function searchDealerAddress(
  state: string,
  value: string,
  queryBy: AddressQueryBy = "keyword",
): Promise<{ success: boolean; error?: string; addresses: AddressResult[] }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized", addresses: [] };
  if (!ORDER_TOKEN) {
    return { success: false, error: "Address service is not configured.", addresses: [] };
  }

  const st = (state || "").trim().toUpperCase();
  const val = (value || "").trim();
  if (!ADDRESS_SEARCH_STATES.includes(st as (typeof ADDRESS_SEARCH_STATES)[number])) {
    return { success: false, error: "Select a valid state.", addresses: [] };
  }
  if (val.length < 3) {
    return { success: false, error: "Enter at least 3 characters to search.", addresses: [] };
  }

  try {
    const res = await fetch(`${SCRAPER_API_URL}/dealer/address-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": ORDER_TOKEN },
      cache: "no-store",
      body: JSON.stringify({ user_key: session.user.id, state: st, value: val, query_by: queryBy }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      addresses?: AddressResult[];
      message?: string;
      error?: string;
    };
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.message || data.error || "Address search failed.",
        addresses: [],
      };
    }
    return { success: true, addresses: data.addresses ?? [] };
  } catch {
    return { success: false, error: "Address service unreachable.", addresses: [] };
  }
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
    where: superAdmin ? { id } : { id, userId: session.user.id },
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

