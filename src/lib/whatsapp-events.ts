import { prisma } from "@/lib/prisma";
import { whatsappFixtureEnabled, whatsappFixtureEvents } from "@/lib/whatsapp-inbox-fixture";
import { directionLabel, type WhatsappExtract } from "@/lib/whatsapp-webhook";

export const WHATSAPP_EVENT_LIMIT = 200;

export interface WhatsappEventView extends WhatsappExtract {
  id: string;
  receivedAt: string;
  direction: string;
  rawBody: string;
}

export async function listWhatsappEvents(): Promise<WhatsappEventView[]> {
  if (whatsappFixtureEnabled()) return whatsappFixtureEvents();
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
