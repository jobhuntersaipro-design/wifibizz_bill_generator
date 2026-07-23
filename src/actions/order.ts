"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { uploadToR2 } from "@/lib/r2";
import { MAX_DOCS, type OrderDocument, type OrderListItem } from "@/lib/order-types";
import { MALAYSIA_STATES } from "@/lib/malaysia-states";

// ── Postcode -> city + state (Google Geocoding) ──────────────────────────────
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
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { success: false as const, error: "Geocoding is not configured." };
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      `${pc}, Malaysia`
    )}&region=my&key=${key}`;
    const resp = await fetch(url, { cache: "force-cache" });
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
const ALLOWED_DOC_EXT = new Set([
  "jpg", "jpeg", "png", "bmp", "pdf", "webp", "jfif",
]);

// docType -> filename slug. "id" uses the ID type (mykad/passport/…) passed in.
function docSlug(docType: string, idType: string): string {
  if (docType === "utility_bill") return "utilitybill";
  if (docType === "other") return "doc";
  return idType || "id"; // ID copy
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
  if (!ALLOWED_DOC_EXT.has(ext)) {
    return { success: false as const, error: `Unsupported file type .${ext}` };
  }

  const idNumber = String(formData.get("idNumber") || "").replace(/[^A-Za-z0-9]/g, "");
  const idType = String(formData.get("idType") || "id").toLowerCase().replace(/[^a-z0-9]/g, "");
  const docType = String(formData.get("docType") || "id");
  const seq = parseInt(String(formData.get("seq") || "1"), 10) || 1;
  if (!idNumber) return { success: false as const, error: "Enter the ID number first." };

  const filename = `${idNumber}_${docSlug(docType, idType)}_${seq}.${ext}`;

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const url = await uploadToR2(
      `orders/${filename}`,
      buf,
      file.type || "application/octet-stream"
    );
    return { success: true as const, url, filename, type: docType };
  } catch (e) {
    console.error("uploadOrderDocument error:", e instanceof Error ? e.message : e);
    return { success: false as const, error: "Upload failed. Try again." };
  }
}

// ── Save an order draft ──────────────────────────────────────────────────────
// Address is picked from the portal's QryNIGAddress search (see the dealer
// address-search endpoint), so we store the resourceInstId + structured fields
// rather than geocoding a postcode.
export interface OrderInput {
  id?: string; // present when updating an existing draft
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
  addressId?: string; // resourceInstId
  addressFull?: string;
  serviceCategory?: string;
  offerCategory?: string;
  offerName?: string;
  remarks?: string;
  documents?: OrderDocument[];
}

export async function saveOrder(input: OrderInput) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };

  if (!input.idType || !input.idNumber?.trim() || !input.fullName?.trim()) {
    return { success: false as const, error: "ID type, ID number, and name are required." };
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
    remarks: input.remarks || null,
    documents: (input.documents ?? []).slice(0, MAX_DOCS) as unknown as Prisma.InputJsonValue,
  };

  try {
    const order = input.id
      ? await prisma.order.update({
          where: { id: input.id, userId: session.user.id },
          data,
        })
      : await prisma.order.create({
          data: { ...data, userId: session.user.id, status: "draft" },
        });
    return { success: true as const, id: order.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("saveOrder error:", message);
    return { success: false as const, error: "Failed to save the order." };
  }
}

// ── List / submit / delete orders ────────────────────────────────────────────
export async function listOrders(): Promise<{
  success: boolean;
  error?: string;
  data: OrderListItem[];
}> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized", data: [] };

  const orders = await prisma.order.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return {
    success: true,
    data: orders.map((o) => ({
      id: o.id,
      fullName: o.fullName,
      idType: o.idType,
      idNumber: o.idNumber,
      offerName: o.offerName,
      city: o.city,
      state: o.state,
      status: o.status,
      orderId: o.orderId,
      errorMessage: o.errorMessage,
      docCount: Array.isArray(o.documents) ? (o.documents as unknown[]).length : 0,
      createdAt: o.createdAt.toISOString(),
    })),
  };
}

export async function deleteOrder(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };
  await prisma.order.deleteMany({ where: { id, userId: session.user.id } });
  return { success: true as const };
}

export async function submitOrder(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };

  const order = await prisma.order.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!order) return { success: false as const, error: "Order not found." };

  // TODO: wire to the Flask /orders endpoint -> enter_order() -> portal.
  // Until the portal submission path is built, this is intentionally a no-op so
  // the button exists but never sends a real (billable) order by accident.
  return {
    success: false as const,
    error: "Portal submission isn't wired up yet — coming next.",
  };
}
