"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-gate";
import { ADMIN_ACTOR, recordAudit } from "@/lib/audit";
import { appendApiSend, updateConversation, updateCrm, type CrmPatch } from "@/lib/whatsapp-events";
import { whatsappFixtureEnabled } from "@/lib/whatsapp-inbox-fixture";
import { LABEL_COLORS, phoneVariants, type LabelKind } from "@/lib/whatsapp-inbox";
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

const KINDS: LabelKind[] = ["stage", "folder", "tag"];
const KIND_WORD: Record<LabelKind, string> = { stage: "stage", folder: "folder", tag: "tag" };

function fixtureRefusal(): Result | null {
  return whatsappFixtureEnabled() ? { success: false, error: "Editing lists needs the database (fixture mode)." } : null;
}

/** Add or edit a stage, folder or tag. */
export async function saveWhatsappLabel(input: {
  id?: string;
  kind: LabelKind;
  name: string;
  description: string;
  color: string;
}): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const refused = fixtureRefusal();
  if (refused) return refused;
  const name = input.name.trim().replace(/\s+/g, " ");
  const description = input.description.trim();
  if (!KINDS.includes(input.kind)) return { success: false, error: "Invalid list." };
  if (!name || name.length > 40) return { success: false, error: "Name must be 1–40 characters." };
  if (description.length > 300) return { success: false, error: "Description is limited to 300 characters." };
  const color = input.color in LABEL_COLORS ? input.color : "gray";
  try {
    if (input.id) {
      await prisma.whatsappLabel.update({ where: { id: input.id }, data: { name, description, color } });
    } else {
      const last = await prisma.whatsappLabel.findFirst({ where: { kind: input.kind }, orderBy: { sort: "desc" } });
      await prisma.whatsappLabel.create({ data: { kind: input.kind, name, description, color, sort: (last?.sort ?? -1) + 1 } });
    }
  } catch (e) {
    const code = (e as { code?: string }).code;
    return { success: false, error: code === "P2002" ? `A ${KIND_WORD[input.kind]} with that name already exists.` : "Could not save." };
  }
  await recordAudit({
    actor: ADMIN_ACTOR,
    action: "whatsapp_label_saved",
    detail: `${input.id ? "Edited" : "Added"} WhatsApp ${KIND_WORD[input.kind]} "${name}".`,
  });
  return { success: true, data: undefined };
}

/** Move a label one place up or down in its list. */
export async function moveWhatsappLabel(id: string, direction: -1 | 1): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const refused = fixtureRefusal();
  if (refused) return refused;
  const label = await prisma.whatsappLabel.findUnique({ where: { id } });
  if (!label) return { success: false, error: "Not found." };
  const list = await prisma.whatsappLabel.findMany({ where: { kind: label.kind }, orderBy: [{ sort: "asc" }, { name: "asc" }] });
  const from = list.findIndex((l) => l.id === id);
  const to = from + direction;
  if (to < 0 || to >= list.length) return { success: true, data: undefined };
  [list[from], list[to]] = [list[to], list[from]];
  await prisma.$transaction(list.map((l, sort) => prisma.whatsappLabel.update({ where: { id: l.id }, data: { sort } })));
  return { success: true, data: undefined };
}

/** Delete a label and clear it from every chat in the same transaction. */
export async function deleteWhatsappLabel(id: string): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const refused = fixtureRefusal();
  if (refused) return refused;
  const label = await prisma.whatsappLabel.findUnique({ where: { id } });
  if (!label) return { success: false, error: "Not found." };
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE whatsapp_conversations SET stage_id = NULL, stage_by = NULL WHERE stage_id = ${id}`,
    prisma.$executeRaw`UPDATE whatsapp_conversations SET folder_id = NULL, folder_by = NULL WHERE folder_id = ${id}`,
    prisma.$executeRaw`UPDATE whatsapp_conversations SET tag_ids = array_remove(tag_ids, ${id}) WHERE ${id} = ANY(tag_ids)`,
    prisma.whatsappLabel.delete({ where: { id } }),
  ]);
  await recordAudit({ actor: ADMIN_ACTOR, action: "whatsapp_label_deleted", detail: `Deleted WhatsApp ${KIND_WORD[label.kind as LabelKind] ?? "label"} "${label.name}".` });
  return { success: true, data: undefined };
}

/** How many chats use a label, for the delete confirmation. */
export async function countWhatsappLabelUse(id: string): Promise<Result<number>> {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (whatsappFixtureEnabled()) return { success: true, data: 0 };
  const count = await prisma.whatsappConversation.count({
    where: { OR: [{ stageId: id }, { folderId: id }, { tagIds: { has: id } }] },
  });
  return { success: true, data: count };
}

export type CrmField = "stage" | "folder" | "tags" | "insight";

/** An admin sets a chat's stage, folder or tags. Claude leaves that field alone afterwards. */
export async function setWhatsappChatLabel(
  waId: string,
  field: CrmField,
  value: string | string[] | null,
): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!WA_ID.test(waId)) return { success: false, error: "Invalid WhatsApp number." };
  if (field === "insight") return { success: false, error: "Use setWhatsappChatInsight." };
  const ids = field === "tags" ? (Array.isArray(value) ? value : []) : typeof value === "string" ? [value] : [];
  if (!whatsappFixtureEnabled() && ids.length > 0) {
    const kind = field === "tags" ? "tag" : field;
    const found = await prisma.whatsappLabel.count({ where: { id: { in: ids }, kind } });
    if (found !== new Set(ids).size) return { success: false, error: "That label no longer exists. Refresh the page." };
  }
  const patch: CrmPatch =
    field === "stage" ? { stageId: ids[0] ?? null, stageBy: "admin" }
    : field === "folder" ? { folderId: ids[0] ?? null, folderBy: "admin" }
    : { tagIds: [...new Set(ids)], tagsBy: "admin" };
  try {
    await updateCrm(waId, patch);
  } catch {
    return { success: false, error: "Could not update the chat." };
  }
  await recordAudit({ actor: ADMIN_ACTOR, action: "whatsapp_chat_labelled", detail: `Set the ${field} of WhatsApp chat ${waId}.` });
  return { success: true, data: undefined };
}

/** Hand a field back to Claude; the next sorting run decides it again. */
export async function releaseWhatsappChatLabel(waId: string, field: CrmField): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!WA_ID.test(waId)) return { success: false, error: "Invalid WhatsApp number." };
  const patch: CrmPatch =
    field === "stage" ? { stageBy: null }
    : field === "folder" ? { folderBy: null }
    : field === "insight" ? { insightBy: null }
    : { tagsBy: null };
  try {
    await updateCrm(waId, { ...patch, classifiedAt: null });
  } catch {
    return { success: false, error: "Could not update the chat." };
  }
  return { success: true, data: undefined };
}

/** An admin overwrites the intent and sign-up chance; Claude leaves both alone afterwards. */
export async function setWhatsappChatInsight(waId: string, intent: string, signupChance: number | null): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!WA_ID.test(waId)) return { success: false, error: "Invalid WhatsApp number." };
  if (signupChance !== null && !(Number.isInteger(signupChance) && signupChance >= 0 && signupChance <= 100)) {
    return { success: false, error: "Sign-up chance is a whole number from 0 to 100." };
  }
  try {
    await updateCrm(waId, { intent: intent.trim().slice(0, 120) || null, signupChance, insightBy: "admin" });
  } catch {
    return { success: false, error: "Could not update the chat." };
  }
  await recordAudit({ actor: ADMIN_ACTOR, action: "whatsapp_chat_labelled", detail: `Set the intent of WhatsApp chat ${waId}.` });
  return { success: true, data: undefined };
}

/** The model that sorts chats. Blank = the default (Haiku 5.5 unless WHATSAPP_CRM_MODEL is set). */
export async function getWhatsappCrmModel(): Promise<Result<string | null>> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const row = await prisma.whatsappCrmSettings.findUnique({ where: { id: 1 } }).catch(() => null);
  return { success: true, data: row?.model ?? null };
}

export async function saveWhatsappCrmModel(model: string | null): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const clean = model?.trim() || null;
  if (clean && !/^claude-[a-z0-9.-]{1,60}$/.test(clean)) return { success: false, error: "That is not a Claude model id." };
  try {
    await prisma.whatsappCrmSettings.upsert({ where: { id: 1 }, create: { id: 1, model: clean }, update: { model: clean } });
  } catch {
    return { success: false, error: "Could not save the model." };
  }
  await recordAudit({ actor: ADMIN_ACTOR, action: "whatsapp_crm_model", detail: `WhatsApp sorting model set to ${clean ?? "default"}.` });
  return { success: true, data: undefined };
}
