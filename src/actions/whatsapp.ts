"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-gate";
import { ADMIN_ACTOR, recordAudit } from "@/lib/audit";
import { appendApiSend, updateConversation } from "@/lib/whatsapp-events";
import { whatsappFixtureEnabled } from "@/lib/whatsapp-inbox-fixture";
import { phoneVariants } from "@/lib/whatsapp-inbox";
import { STATUS_LABELS } from "@/lib/order-types";
import {
  gatewayAction,
  gatewayConfig,
  gatewayState,
  sendRefusal,
  sendText,
  type GatewayConfig,
  type GatewayState,
  type SendResult,
} from "@/lib/whatsapp-send";

type Result<T = undefined> = { success: true; data: T } | { success: false; error: string };

const WA_ID = /^\d{6,15}$/;
const MAX_TEXT = 4096;

/** The gateway, or why sending is off. The local fixture without a gateway sends nowhere. */
function sender(): { config: GatewayConfig | null; fixture: boolean; refusal: string | null } {
  const fixture = whatsappFixtureEnabled();
  const config = gatewayConfig();
  if (fixture && !config) return { config: null, fixture, refusal: null };
  return { config, fixture, refusal: sendRefusal(process.env.VERCEL_ENV, config) };
}

async function deliver(send: (config: GatewayConfig) => Promise<SendResult>): Promise<SendResult> {
  const { config, fixture, refusal } = sender();
  if (refusal) return { ok: false, error: refusal };
  if (fixture && !config) return { ok: true, wamid: `fixture${Date.now()}` };
  return send(config as GatewayConfig);
}

export async function sendWhatsappText(to: string, text: string): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = text.trim();
  if (!WA_ID.test(to)) return { success: false, error: "Invalid WhatsApp number." };
  if (!body) return { success: false, error: "Type a message first." };
  if (body.length > MAX_TEXT) return { success: false, error: `Messages are limited to ${MAX_TEXT} characters.` };

  const sent = await deliver((config) => sendText(config, to, body));
  if (!sent.ok) return { success: false, error: sent.error };
  try {
    await appendApiSend({ to, wamid: sent.wamid, text: body });
  } catch (e) {
    console.error("[whatsapp] sent but not stored:", sent.wamid, e);
    return { success: false, error: "Sent, but it could not be saved to the inbox. Do not send it again." };
  }
  await recordAudit({ actor: ADMIN_ACTOR, action: "whatsapp_message_sent", detail: `Replied to ${to} on WhatsApp.` });
  return { success: true, data: undefined };
}

/** The linked device: QR to scan, or the connected number. */
export async function getWhatsappConnection(): Promise<Result<GatewayState>> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { config, fixture } = sender();
  if (fixture && !config) return { success: true, data: { status: "open", qr: null, me: "15550000000", error: null } };
  if (!config) return { success: false, error: "WhatsApp is not set up (WHATSAPP_GATEWAY_URL / WHATSAPP_GATEWAY_TOKEN are missing)." };
  const res = await gatewayState(config);
  return res.ok ? { success: true, data: res.state } : { success: false, error: res.error };
}

/** "connect" asks for a fresh QR after one expired; "logout" unlinks the number. */
export async function whatsappConnectionAction(action: "connect" | "logout"): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (action !== "connect" && action !== "logout") return { success: false, error: "Invalid action." };
  const config = gatewayConfig();
  if (!config) return { success: false, error: "WhatsApp is not set up." };
  const res = await gatewayAction(config, action);
  if (!res.ok) return { success: false, error: res.error };
  if (action === "logout") {
    await recordAudit({ actor: ADMIN_ACTOR, action: "whatsapp_unlinked", detail: "Unlinked the WhatsApp number from BizzFlow." });
  }
  return { success: true, data: undefined };
}

export async function setWhatsappClosed(waId: string, closed: boolean): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!WA_ID.test(waId)) return { success: false, error: "Invalid WhatsApp number." };
  try {
    await updateConversation(waId, { closedAt: closed ? new Date() : null });
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "Could not update the chat." };
  }
}

export async function markWhatsappRead(waId: string, at: string): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const when = new Date(at);
  if (!WA_ID.test(waId) || Number.isNaN(when.getTime())) return { success: false, error: "Invalid input." };
  try {
    await updateConversation(waId, { lastReadAt: when });
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "Could not mark the chat read." };
  }
}

export interface WhatsappContact {
  orders: { id: string; reference: string | null; name: string; status: string; offer: string | null; createdAt: string; deleted: boolean }[];
  cases: { caseNo: string; name: string | null; status: string | null; provider: string | null; createdAt: string | null }[];
}

/** BizzFlow records for this number. Read-only. */
export async function getWhatsappContact(waId: string): Promise<Result<WhatsappContact>> {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!WA_ID.test(waId)) return { success: false, error: "Invalid WhatsApp number." };
  if (whatsappFixtureEnabled()) {
    return {
      success: true,
      data: waId === "15551110001"
        ? {
            orders: [{ id: "fixture", reference: "ORD-0001", name: "FIXTURE CUSTOMER", status: STATUS_LABELS.submitted ?? "Submitted", offer: "Unifi Home 300Mbps", createdAt: "2025-10-08T02:00:00.000Z", deleted: false }],
            cases: [],
          }
        : { orders: [], cases: [] },
    };
  }
  const variants = phoneVariants(waId);
  try {
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
      success: true,
      data: {
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
      },
    };
  } catch {
    return { success: false, error: "Could not look up this number." };
  }
}
