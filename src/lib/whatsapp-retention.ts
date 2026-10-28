import { prisma } from "@/lib/prisma";

/** PDPA: WhatsApp chats and their media are kept 3 months, then deleted. */
export const RETENTION_MONTHS = 3;

/** The instant before which chat data is deleted. Pure. */
export function retentionCutoff(now = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
  return cutoff;
}

export interface RetentionRun {
  cutoff: string;
  messages: number;
  events: number;
  alerts: number;
  conversations: number;
}

/**
 * Delete messages, raw webhook bodies and alerts older than the cutoff, then
 * chats with no message left. Media is not stored here (it is fetched from
 * WhatsApp by id), so deleting the message removes the only link to it.
 * Documents already pushed to an Order Entry draft belong to that order.
 */
export async function purgeOldWhatsapp(now = new Date()): Promise<RetentionRun> {
  const cutoff = retentionCutoff(now);
  const messages = await prisma.whatsappMessage.deleteMany({ where: { sentAt: { lt: cutoff } } });
  const events = await prisma.whatsappWebhookEvent.deleteMany({ where: { receivedAt: { lt: cutoff } } });
  const alerts = await prisma.whatsappAlert.deleteMany({ where: { createdAt: { lt: cutoff } } });
  const conversations = await prisma.$executeRaw`
    DELETE FROM whatsapp_conversations c
    WHERE (c.last_message_at IS NULL OR c.last_message_at < ${cutoff})
      AND NOT EXISTS (SELECT 1 FROM whatsapp_messages m WHERE m.wa_id = c.wa_id)`;
  return { cutoff: cutoff.toISOString(), messages: messages.count, events: events.count, alerts: alerts.count, conversations };
}
