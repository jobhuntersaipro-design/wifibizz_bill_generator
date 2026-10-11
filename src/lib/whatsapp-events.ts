import { prisma } from "@/lib/prisma";
import { whatsappFixtureEnabled, whatsappFixtureEvents } from "@/lib/whatsapp-inbox-fixture";
import type { ConversationState } from "@/lib/whatsapp-inbox";
import { directionLabel, extractWhatsappEvent, type WhatsappExtract } from "@/lib/whatsapp-webhook";

export const WHATSAPP_EVENT_LIMIT = 200;

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

export async function listWhatsappEvents(): Promise<WhatsappEventView[]> {
  if (whatsappFixtureEnabled()) return [...fixtureSent, ...whatsappFixtureEvents()];
  const rows = await prisma.whatsappWebhookEvent.findMany({
    orderBy: { receivedAt: "desc" },
    take: WHATSAPP_EVENT_LIMIT,
  });
  return rows.map((row) => ({
    id: row.id,
    receivedAt: row.receivedAt.toISOString(),
    field: row.field,
    direction: directionLabel(row.field),
    fromWaId: row.fromWaId,
    toWaId: row.toWaId,
    messageId: row.messageId,
    messageType: row.messageType,
    textPreview: row.textPreview,
    rawBody: row.rawBody,
  }));
}

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
