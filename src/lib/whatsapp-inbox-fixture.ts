import type { WhatsappEventView } from "@/lib/whatsapp-events";
import { directionLabel, extractWhatsappEvent } from "@/lib/whatsapp-webhook";

/**
 * Local inbox proof only. Never a substitute for the table on Vercel or in a
 * production build. The dev server opts in with WHATSAPP_INBOX_FIXTURE=1.
 */
export function whatsappFixtureEnabled(): boolean {
  return process.env.WHATSAPP_INBOX_FIXTURE === "1"
    && process.env.NODE_ENV !== "production"
    && !process.env.VERCEL
    && !process.env.VERCEL_ENV;
}

const LONG_TEXT = "Can you check this bill for me? The amount looks wrong and I need the full breakdown before I pay, including tax, the previous balance, and every line item on the second page please.";

function row(id: string, receivedAt: string, body: unknown): WhatsappEventView {
  const rawBody = JSON.stringify(body);
  const extracted = extractWhatsappEvent(body);
  return {
    id,
    receivedAt,
    direction: directionLabel(extracted.field),
    rawBody,
    ...extracted,
  };
}

function envelope(field: string, value: Record<string, unknown>): unknown {
  return { object: "whatsapp_business_account", entry: [{ changes: [{ field, value }] }] };
}

/** Two fake customers. Newest activity first, matching the admin query. */
export function whatsappFixtureEvents(): WhatsappEventView[] {
  return [
    row("evt_b_echo", "2025-10-09T09:00:00.000Z", envelope("smb_message_echoes", {
      message_echoes: [{
        from: "15550000000",
        to: "15551110002",
        id: "wamid.B3",
        timestamp: "1760000400",
        type: "text",
        text: { body: "Tomorrow 10am." },
      }],
    })),
    row("evt_a_status", "2025-10-09T08:59:00.000Z", envelope("statuses", {
      statuses: [{ id: "wamid.A3", status: "delivered", recipient_id: "15551110001", timestamp: "1760000340" }],
    })),
    row("evt_a_image", "2025-10-09T08:58:20.000Z", envelope("messages", {
      messages: [{
        from: "15551110001",
        id: "wamid.A3",
        timestamp: "1760000300",
        type: "image",
        image: { caption: "front page", id: "media-1", mime_type: "image/jpeg" },
      }],
    })),
    row("evt_b_in", "2025-10-09T08:56:40.000Z", envelope("messages", {
      messages: [
        { from: "15551110002", id: "wamid.B1", timestamp: "1760000200", type: "text", text: { body: "When is installation?" } },
        { from: "15551110002", id: "wamid.B2", timestamp: "1760000205", type: "text", text: { body: "Morning or afternoon?" } },
      ],
    })),
    row("evt_a_echo", "2025-10-09T08:54:20.000Z", envelope("smb_message_echoes", {
      message_echoes: [{
        from: "15550000000",
        to: "15551110001",
        id: "wamid.A2",
        timestamp: "1760000060",
        type: "text",
        text: { body: "Sure. Send a photo of the bill and the account number." },
      }],
    })),
    row("evt_a_in", "2025-10-09T08:53:20.000Z", envelope("messages", {
      messages: [{
        from: "15551110001",
        id: "wamid.A1",
        timestamp: "1760000000",
        type: "text",
        text: { body: LONG_TEXT },
      }],
    })),
  ];
}

export const WHATSAPP_FIXTURE_LONG_TEXT = LONG_TEXT;
