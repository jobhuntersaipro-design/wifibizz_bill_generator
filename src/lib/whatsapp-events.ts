import { prisma } from "@/lib/prisma";
import { whatsappFixtureEnabled, whatsappFixtureEvents } from "@/lib/whatsapp-inbox-fixture";
import { buildInbox, unreadFor, type ChatSummary, type ConversationState, type InboxMessage, type Label } from "@/lib/whatsapp-inbox";
import { ingestWebhook, listChatSummaries, listThread } from "@/lib/whatsapp-store";
import { directionLabel, extractWhatsappEvent, type WhatsappExtract } from "@/lib/whatsapp-webhook";


export interface WhatsappEventView extends WhatsappExtract {
  id: string;
  receivedAt: string;
  direction: string;
  rawBody: string;
}

/**
 * Local fixture only: replies and chat state live in memory so the inbox can
 * be exercised without a database or the WhatsApp gateway. Gone on restart. Held on
 * globalThis because the dev server loads this module separately for server
 * actions and route handlers.
 */
const fixtureMemory = globalThis as unknown as {
  whatsappFixtureSent?: WhatsappEventView[];
  whatsappFixtureState?: Map<string, ConversationState>;
};
const fixtureSent = (fixtureMemory.whatsappFixtureSent ??= []);
const fixtureState = (fixtureMemory.whatsappFixtureState ??= new Map());

/**
 * Store a reply sent through the API. The webhook never echoes API sends (only
 * their statuses arrive), so without this row the reply would not exist in the
 * inbox. It is shaped as a `message_echoes` payload under field `api_send`, so
 * `buildInbox` reads it exactly like a reply typed on the phone.
 */
export async function appendApiSend(input: {
  to: string;
  wamid: string;
  text: string;
  /** Written by the Claude auto-reply, so the timeline labels it "AI". */
  byAi?: boolean;
}): Promise<void> {
  const nowMs = Date.now();
  const item: Record<string, unknown> = {
    to: input.to,
    id: input.wamid,
    timestamp: String(Math.floor(nowMs / 1000)),
    type: "text",
    text: { body: input.text },
  };
  const body = {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "api_send", value: { message_echoes: [item] } }] }],
  };
  const rawBody = JSON.stringify(body);
  const extracted = extractWhatsappEvent(body);

  if (whatsappFixtureEnabled()) {
    fixtureSent.unshift({
      id: `fixture_send_${nowMs}`,
      receivedAt: new Date(nowMs).toISOString(),
      direction: directionLabel(extracted.field),
      rawBody,
      ...extracted,
    });
    return;
  }
  await prisma.whatsappWebhookEvent.create({ data: { ...extracted, rawBody } });
  await ingestWebhook(body);
  if (input.byAi) await prisma.whatsappMessage.update({ where: { messageId: input.wamid }, data: { byAi: true } });
}

/** Fixture chats: built from the fixture events like the old inbox, plus in-memory CRM state. */
type FixtureCrm = Pick<ChatSummary, "stageId" | "folderId" | "tagIds" | "stageBy" | "folderBy" | "tagsBy" | "aiReason" | "intent" | "signupChance" | "insightBy">;
const fixtureCrm = ((fixtureMemory as { whatsappFixtureCrm?: Map<string, FixtureCrm> }).whatsappFixtureCrm ??= new Map());

function fixtureEvents() {
  return [...fixtureSent, ...whatsappFixtureEvents()];
}

export async function listChats(q = ""): Promise<ChatSummary[]> {
  if (!whatsappFixtureEnabled()) return listChatSummaries(q);
  const needle = q.trim().toLowerCase();
  return buildInbox(fixtureEvents())
    .filter((chat) => !needle || chat.customer.includes(needle) || chat.messages.some((m) => m.text.toLowerCase().includes(needle)))
    .map((chat) => {
      const state = fixtureState.get(chat.customer);
      return {
        customer: chat.customer,
        name: chat.customer === "15551110001" ? "Fixture Customer" : null,
        lastAt: chat.lastAt,
        preview: chat.preview,
        lastInboundAt: chat.lastInboundAt,
        unread: unreadFor(chat, state),
        closedAt: state?.closedAt ?? null,
        lastReadAt: state?.lastReadAt ?? null,
        stageId: null,
        folderId: null,
        tagIds: [],
        stageBy: null,
        folderBy: null,
        tagsBy: null,
        aiReason: null,
        intent: null,
        signupChance: null,
        insightBy: null,
        ...fixtureCrm.get(chat.customer),
      };
    });
}

export async function getThread(waId: string): Promise<InboxMessage[]> {
  if (!whatsappFixtureEnabled()) return listThread(waId);
  return buildInbox(fixtureEvents()).find((chat) => chat.customer === waId)?.messages ?? [];
}

const FIXTURE_LABELS: Label[] = [
  { id: "stage_new_lead", kind: "stage", name: "🆕 New Lead", description: "First contact.", color: "gray", sort: 0 },
  { id: "stage_plan_selected", kind: "stage", name: "⬆️ Plan Selected", description: "Picked a plan.", color: "blue", sort: 1 },
  { id: "seed_folder_home", kind: "folder", name: "Home Fibre", description: "Residential internet.", color: "blue", sort: 0 },
  { id: "seed_tag_price", kind: "tag", name: "Price question", description: "Asks how much a plan costs.", color: "blue", sort: 0 },
];

function toLabel(row: { id: string; kind: string; name: string; description: string; color: string; sort: number }): Label {
  return { ...row, kind: row.kind === "folder" ? "folder" : row.kind === "tag" ? "tag" : "stage" };
}

export async function listLabels(): Promise<Label[]> {
  if (whatsappFixtureEnabled()) return FIXTURE_LABELS;
  const rows = await prisma.whatsappLabel.findMany({ orderBy: [{ kind: "asc" }, { sort: "asc" }, { name: "asc" }] });
  return rows.map(toLabel);
}

export type CrmPatch = Partial<Pick<ChatSummary, "stageId" | "folderId" | "tagIds" | "stageBy" | "folderBy" | "tagsBy" | "aiReason" | "intent" | "signupChance" | "insightBy">> & {
  classifiedAt?: Date | null;
};

export async function updateCrm(waId: string, patch: CrmPatch): Promise<void> {
  if (whatsappFixtureEnabled()) {
    const { classifiedAt: _ignored, ...rest } = patch;
    void _ignored;
    fixtureCrm.set(waId, { ...(fixtureCrm.get(waId) ?? { stageId: null, folderId: null, tagIds: [], stageBy: null, folderBy: null, tagsBy: null, aiReason: null, intent: null, signupChance: null, insightBy: null }), ...rest });
    return;
  }
  await prisma.whatsappConversation.upsert({ where: { waId }, create: { waId, ...patch }, update: patch });
}

export async function listConversations(): Promise<Record<string, ConversationState>> {
  if (whatsappFixtureEnabled()) return Object.fromEntries(fixtureState);
  const rows = await prisma.whatsappConversation.findMany();
  return Object.fromEntries(
    rows.map((row) => [
      row.waId,
      { closedAt: row.closedAt?.toISOString() ?? null, lastReadAt: row.lastReadAt?.toISOString() ?? null },
    ]),
  );
}

export async function updateConversation(
  waId: string,
  patch: { closedAt?: Date | null; lastReadAt?: Date },
): Promise<void> {
  if (whatsappFixtureEnabled()) {
    const prev = fixtureState.get(waId) ?? { closedAt: null, lastReadAt: null };
    fixtureState.set(waId, {
      closedAt: patch.closedAt === undefined ? prev.closedAt : patch.closedAt?.toISOString() ?? null,
      lastReadAt: patch.lastReadAt?.toISOString() ?? prev.lastReadAt,
    });
    return;
  }
  await prisma.whatsappConversation.upsert({
    where: { waId },
    create: { waId, ...patch },
    update: patch,
  });
}
