import { randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { phoneVariants } from "@/lib/whatsapp-inbox";
import { MAX_DOCS, STATUS_LABELS, type OrderDocument } from "@/lib/order-types";
import { nextOrderReference } from "@/lib/order-history";
import { uploadToR2 } from "@/lib/r2";

/**
 * The API that aichatbot.bizzflow.top calls (src/lib/bizzflow.ts in that repo).
 * Both apps share CHATBOT_API_SECRET. No secret set means the API is off.
 */

export const CHATBOT_ACTOR = "aichatbot";
const WA_ID = /^\d{6,15}$/;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
export const MAX_DOCUMENT_BYTES = 4_000_000;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** A refusal Response, or null when the bearer token matches the secret. */
export function refuseCaller(req: Request): Response | null {
  const secret = (process.env.CHATBOT_API_SECRET ?? "").trim();
  if (!secret) return json({ error: "The chatbot API is off (CHATBOT_API_SECRET is not set)." }, 503);
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return json({ error: "Unauthorized." }, 401);
  return null;
}

/** Orders and WifiBizz cases whose mobile is one of these spellings. */
export async function contactRecords(phones: string[]) {
  const variants = [...new Set(phones.flatMap((p) => phoneVariants(p)))].slice(0, 40);
  if (variants.length === 0) return { orders: [], cases: [] };
  const [orders, cases] = await Promise.all([
    prisma.order.findMany({
      where: { mobile: { in: variants } },
      select: { id: true, reference: true, fullName: true, status: true, offerName: true, createdAt: true, deletedAt: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.wifibizzCase.findMany({
      where: { mobile: { in: variants } },
      select: { caseNo: true, fullName: true, status: true, provider: true, caseCreatedAt: true },
      orderBy: { caseCreatedAt: "desc" },
      take: 10,
    }),
  ]);
  return {
    orders: orders.map((o) => ({
      id: o.id,
      reference: o.reference,
      name: o.fullName,
      status: STATUS_LABELS[o.status] ?? o.status,
      offer: o.offerName,
      createdAt: o.createdAt.toISOString(),
      deleted: o.deletedAt !== null,
    })),
    cases: cases.map((c) => ({
      caseNo: c.caseNo,
      name: c.fullName,
      status: c.status,
      provider: c.provider,
      createdAt: c.caseCreatedAt?.toISOString() ?? null,
    })),
  };
}

/** Order Entry accounts. No password columns. */
export async function orderEntryAccounts() {
  const users = await prisma.user.findMany({
    where: { orderEntryEnabled: true },
    select: { id: true, email: true, name: true },
    orderBy: [{ isSuperAdmin: "desc" }, { email: "asc" }],
  });
  return users.map((u) => ({ id: u.id, email: u.email ?? "", name: u.name }));
}

type Outcome<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/** A draft in that account with the customer's name and number. */
export async function createChatDraft(input: unknown): Promise<Outcome<{ id: string; reference: string | null; email: string }>> {
  const i = (input ?? {}) as { accountId?: unknown; waId?: unknown; name?: unknown };
  const accountId = typeof i.accountId === "string" ? i.accountId : "";
  const waId = typeof i.waId === "string" ? i.waId : "";
  const name = typeof i.name === "string" ? i.name.trim().toUpperCase().slice(0, 200) : "";
  if (!WA_ID.test(waId)) return { ok: false, status: 400, error: "Invalid WhatsApp number." };
  const target = accountId
    ? await prisma.user.findUnique({ where: { id: accountId }, select: { id: true, email: true, orderEntryEnabled: true } })
    : null;
  if (!target?.orderEntryEnabled) return { ok: false, status: 400, error: "That account does not have Order Entry." };

  const order = await prisma.order.create({
    data: {
      userId: target.id,
      status: "draft",
      reference: await nextOrderReference(),
      idType: "MyKad",
      idNumber: "",
      fullName: name,
      mobilePrefix: waId.startsWith("60") ? "60" : "",
      mobile: waId.startsWith("60") ? waId.slice(2) : waId,
      remarks: `From WhatsApp +${waId}`,
      documents: [],
    },
    select: { id: true, reference: true },
  });
  await recordAudit({
    actor: CHATBOT_ACTOR,
    action: "whatsapp_pushed_to_order_entry",
    targetUser: target.id,
    targetOrder: order.id,
    detail: `Draft ${order.reference} for ${target.email} from WhatsApp +${waId} (AI chatbot).`,
  });
  return { ok: true, data: { id: order.id, reference: order.reference, email: target.email ?? "" } };
}

/** Add one file to a draft that came from WhatsApp. */
export async function attachChatDocument(orderId: string, mime: string, bytes: Buffer): Promise<Outcome<{ key: string }>> {
  const ext = EXT[mime];
  if (!ext) return { ok: false, status: 415, error: "Only JPEG, PNG, WEBP and PDF files are accepted." };
  if (bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES) return { ok: false, status: 413, error: "The file is empty or larger than 4 MB." };
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, userId: true, status: true, mobile: true, mobilePrefix: true, remarks: true, documents: true },
  });
  if (!order || order.status !== "draft" || !order.remarks?.startsWith("From WhatsApp +")) {
    return { ok: false, status: 404, error: "No WhatsApp draft with that id." };
  }
  const docs = (Array.isArray(order.documents) ? order.documents : []) as unknown as OrderDocument[];
  if (docs.length >= MAX_DOCS) return { ok: false, status: 409, error: `The draft already holds ${MAX_DOCS} documents.` };

  const n = docs.length + 1;
  const filename = `whatsapp_${n}.${ext}`;
  const waId = `${order.mobilePrefix ?? ""}${order.mobile ?? ""}`;
  const key = `orders/${order.userId}/${waId}_whatsapp_${n}-${randomBytes(3).toString("hex")}/${filename}`;
  await uploadToR2(key, bytes, mime);
  const doc: OrderDocument = { type: "other", key, filename, url: `/api/orders/document?key=${encodeURIComponent(key)}` };
  await prisma.order.update({ where: { id: order.id }, data: { documents: [...docs, doc] as unknown as object } });
  return { ok: true, data: { key } };
}
