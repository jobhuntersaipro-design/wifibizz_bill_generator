// Baileys events → the WhatsApp Cloud API webhook shape BizzFlow already stores
// and reads (src/lib/whatsapp-inbox.ts). Keeping that shape means the inbox and
// the webhook route did not change when the transport did.

/** Customer phone digits for a 1:1 chat, or null for groups, broadcasts, channels. */
export function customerWaId(key) {
  let jid = key?.remoteJid ?? "";
  // Newer WhatsApp addresses some chats by an opaque LID; the phone JID rides alongside.
  if (jid.endsWith("@lid")) jid = key?.remoteJidAlt ?? "";
  if (!jid.endsWith("@s.whatsapp.net")) return null;
  const digits = jid.split("@")[0].split(":")[0];
  return /^\d{6,15}$/.test(digits) ? digits : null;
}

/** "60123456789:12@s.whatsapp.net" → "60123456789". */
export function phoneOf(jid) {
  const digits = (jid ?? "").split("@")[0].split(":")[0];
  return /^\d+$/.test(digits) ? digits : null;
}

function seconds(ts) {
  if (ts == null) return Math.floor(Date.now() / 1000);
  if (typeof ts === "object" && typeof ts.toNumber === "function") return ts.toNumber();
  const n = Number(ts);
  return Number.isFinite(n) ? n : Math.floor(Date.now() / 1000);
}

/** Wrappers WhatsApp puts around the real content. */
function unwrap(message) {
  let m = message ?? null;
  for (let i = 0; i < 4 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ??
      m.viewOnceMessage?.message ??
      m.viewOnceMessageV2?.message ??
      m.documentWithCaptionMessage?.message ??
      m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

/** Media the inbox can show and the gateway stores. */
export const MEDIA_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/**
 * One Cloud-API message item, or null for things that are not chat bubbles
 * (reactions, receipts, protocol messages, polls updates).
 * `media` names the Baileys field to download when the item carries a file.
 */
export function toCloudItem(msg, waId, me) {
  const m = unwrap(msg?.message);
  const id = msg?.key?.id;
  if (!m || !id) return null;
  const fromMe = Boolean(msg.key.fromMe);
  const base = {
    id,
    timestamp: String(seconds(msg.messageTimestamp)),
    from: fromMe ? me : waId,
    to: fromMe ? waId : me,
  };
  if (m.reactionMessage || m.protocolMessage || m.senderKeyDistributionMessage || m.pollUpdateMessage) return null;

  const text = m.conversation ?? m.extendedTextMessage?.text;
  if (typeof text === "string") return { item: { ...base, type: "text", text: { body: text } } };

  if (m.imageMessage) {
    const im = m.imageMessage;
    return {
      item: { ...base, type: "image", image: { id, mime_type: im.mimetype ?? null, caption: im.caption ?? undefined } },
      media: "imageMessage",
    };
  }
  if (m.documentMessage) {
    const dm = m.documentMessage;
    return {
      item: {
        ...base,
        type: "document",
        document: { id, mime_type: dm.mimetype ?? null, filename: dm.fileName ?? undefined, caption: dm.caption ?? undefined },
      },
      media: "documentMessage",
    };
  }
  if (m.stickerMessage) {
    return { item: { ...base, type: "sticker", sticker: { id, mime_type: m.stickerMessage.mimetype ?? null } }, media: "stickerMessage" };
  }
  if (m.videoMessage) return { item: { ...base, type: "video", video: { caption: m.videoMessage.caption ?? undefined } } };
  if (m.audioMessage) return { item: { ...base, type: "audio", audio: {} } };
  if (m.locationMessage) {
    const l = m.locationMessage;
    return { item: { ...base, type: "location", location: { name: l.name ?? undefined, address: l.address ?? undefined } } };
  }
  if (m.contactMessage) return { item: { ...base, type: "contacts", text: { body: `Contact · ${m.contactMessage.displayName ?? ""}`.trim() } } };
  return { item: { ...base, type: "unsupported", text: { body: "Unsupported message" } } };
}

/** WebMessageInfo.Status → Cloud API status word. */
const STATUS = { 0: "failed", 2: "sent", 3: "delivered", 4: "read", 5: "read" };

export function toStatus(key, update, waId) {
  const status = STATUS[update?.status];
  if (!status || !key?.fromMe || !key.id) return null;
  return { id: key.id, status, recipient_id: waId, timestamp: String(Math.floor(Date.now() / 1000)) };
}

/** The webhook body. `field` is what the raw-events view labels the row with. */
export function envelope(field, valueKey, items) {
  return { object: "whatsapp_business_account", entry: [{ changes: [{ field, value: { [valueKey]: items } }] }] };
}
