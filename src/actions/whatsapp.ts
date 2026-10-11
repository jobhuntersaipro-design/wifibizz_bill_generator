"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-gate";
import { ADMIN_ACTOR, recordAudit } from "@/lib/audit";
import { appendApiSend, updateConversation } from "@/lib/whatsapp-events";
import { whatsappFixtureEnabled } from "@/lib/whatsapp-inbox-fixture";
import { phoneVariants } from "@/lib/whatsapp-inbox";
import { STATUS_LABELS } from "@/lib/order-types";
import {
  d360Key,
  listTemplates,
  sendRefusal,
  sendTemplate,
  sendText,
  type SendResult,
  type TemplateView,
} from "@/lib/whatsapp-send";

type Result<T = undefined> = { success: true; data: T } | { success: false; error: string };

const WA_ID = /^\d{6,15}$/;
const MAX_TEXT = 4096;

const FIXTURE_TEMPLATES: TemplateView[] = [
  { name: "follow_up", language: "en", category: "UTILITY", body: "Hi, following up on your Unifi application. Reply here when you are free." },
  { name: "installation_reminder", language: "en", category: "UTILITY", body: "Reminder: your installation appointment is coming up. Reply to reschedule." },
];

/** The key, or why sending is off. The local fixture sends nowhere. */
function sender(): { key: string | null; fixture: boolean; refusal: string | null } {
  const fixture = whatsappFixtureEnabled();
  const key = d360Key();
  if (fixture && !key) return { key: null, fixture, refusal: null };
  return { key, fixture, refusal: sendRefusal(process.env.VERCEL_ENV, key) };
}

async function deliver(to: string, send: (key: string) => Promise<SendResult>): Promise<SendResult> {
  const { key, fixture, refusal } = sender();
  if (refusal) return { ok: false, error: refusal };
  if (fixture && !key) return { ok: true, wamid: `wamid.fixture.${Date.now()}` };
  return send(key as string);
}

export async function sendWhatsappText(to: string, text: string): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = text.trim();
  if (!WA_ID.test(to)) return { success: false, error: "Invalid WhatsApp number." };
  if (!body) return { success: false, error: "Type a message first." };
  if (body.length > MAX_TEXT) return { success: false, error: `Messages are limited to ${MAX_TEXT} characters.` };

  const sent = await deliver(to, (key) => sendText(key, to, body));
  if (!sent.ok) return { success: false, error: sent.error };
  try {
    await appendApiSend({ to, wamid: sent.wamid, type: "text", text: body });
  } catch (e) {
    console.error("[whatsapp] sent but not stored:", sent.wamid, e);
    return { success: false, error: "Sent, but it could not be saved to the inbox. Do not send it again." };
  }
  await recordAudit({ actor: ADMIN_ACTOR, action: "whatsapp_message_sent", detail: `Replied to ${to} on WhatsApp.` });
  return { success: true, data: undefined };
}

export async function getWhatsappTemplates(): Promise<Result<TemplateView[]>> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { key, fixture, refusal } = sender();
  if (refusal) return { success: false, error: refusal };
  if (fixture && !key) return { success: true, data: FIXTURE_TEMPLATES };
  const listed = await listTemplates(key as string);
  return listed.ok ? { success: true, data: listed.templates } : { success: false, error: listed.error };
}

export async function sendWhatsappTemplate(to: string, name: string, language: string): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!WA_ID.test(to)) return { success: false, error: "Invalid WhatsApp number." };

  // Re-read the list so only an approved, parameter-free template can be sent,
  // and so the stored text is the template's real body.
  const templates = await getWhatsappTemplates();
  if (!templates.success) return templates;
  const template = templates.data.find((t) => t.name === name && t.language === language);
  if (!template) return { success: false, error: "That template is not available." };

  const sent = await deliver(to, (key) => sendTemplate(key, to, name, language));
  if (!sent.ok) return { success: false, error: sent.error };
  try {
    await appendApiSend({
      to,
      wamid: sent.wamid,
      type: "template",
      text: template.body || `Template · ${name}`,
      template: { name, language },
    });
  } catch (e) {
    console.error("[whatsapp] template sent but not stored:", sent.wamid, e);
    return { success: false, error: "Sent, but it could not be saved to the inbox. Do not send it again." };
  }
  await recordAudit({ actor: ADMIN_ACTOR, action: "whatsapp_message_sent", detail: `Sent template ${name} to ${to} on WhatsApp.` });
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
