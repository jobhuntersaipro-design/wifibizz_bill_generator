import { test } from "node:test";
import assert from "node:assert/strict";
import { customerWaId, envelope, historyBatches, phoneOf, toCloudItem, toStatus } from "./convert.mjs";

test("customer number from a phone JID, the LID alt, or nothing for groups", () => {
  assert.equal(customerWaId({ remoteJid: "60123456789@s.whatsapp.net" }), "60123456789");
  assert.equal(customerWaId({ remoteJid: "1234@lid", remoteJidAlt: "60123456789@s.whatsapp.net" }), "60123456789");
  assert.equal(customerWaId({ remoteJid: "1234@lid" }), null);
  assert.equal(customerWaId({ remoteJid: "120363@g.us" }), null);
  assert.equal(customerWaId({ remoteJid: "status@broadcast" }), null);
  assert.equal(phoneOf("60198765432:12@s.whatsapp.net"), "60198765432");
});

test("inbound text and a reply typed on the phone keep the inbox's from/to convention", () => {
  const inbound = toCloudItem(
    { key: { id: "A1", fromMe: false }, messageTimestamp: 1760000000, message: { conversation: "hi" } },
    "60123456789",
    "60198765432",
  );
  assert.deepEqual(inbound.item, { id: "A1", timestamp: "1760000000", from: "60123456789", to: "60198765432", type: "text", text: { body: "hi" } });

  const echo = toCloudItem(
    { key: { id: "B1", fromMe: true }, messageTimestamp: { toNumber: () => 1760000060 }, message: { extendedTextMessage: { text: "ok" } } },
    "60123456789",
    "60198765432",
  );
  assert.equal(echo.item.from, "60198765432");
  assert.equal(echo.item.to, "60123456789");
  assert.equal(echo.item.timestamp, "1760000060");
});

test("images and documents carry a media id; wrappers are unwrapped; reactions are dropped", () => {
  const img = toCloudItem(
    { key: { id: "IMG1" }, messageTimestamp: 1, message: { ephemeralMessage: { message: { imageMessage: { mimetype: "image/jpeg", caption: "bill" } } } } },
    "601",
    "602",
  );
  assert.equal(img.media, "imageMessage");
  assert.deepEqual(img.item.image, { id: "IMG1", mime_type: "image/jpeg", caption: "bill" });

  const doc = toCloudItem(
    { key: { id: "D1" }, messageTimestamp: 1, message: { documentWithCaptionMessage: { message: { documentMessage: { mimetype: "application/pdf", fileName: "x.pdf" } } } } },
    "601",
    "602",
  );
  assert.equal(doc.item.document.filename, "x.pdf");

  assert.equal(toCloudItem({ key: { id: "R" }, message: { reactionMessage: { text: "👍" } } }, "601", "602"), null);
  assert.equal(toCloudItem({ key: { id: "E" }, message: null }, "601", "602"), null);
});

test("delivery receipts map to Cloud API statuses, only for our own messages", () => {
  assert.equal(toStatus({ id: "B1", fromMe: true }, { status: 2 }, "601").status, "sent");
  assert.equal(toStatus({ id: "B1", fromMe: true }, { status: 3 }, "601").status, "delivered");
  assert.equal(toStatus({ id: "B1", fromMe: true }, { status: 4 }, "601").status, "read");
  assert.equal(toStatus({ id: "B1", fromMe: true }, { status: 0 }, "601").status, "failed");
  assert.equal(toStatus({ id: "B1", fromMe: true }, { status: 1 }, "601"), null);
  assert.equal(toStatus({ id: "A1", fromMe: false }, { status: 4 }, "601"), null);
});

test("envelope is the shape the BizzFlow inbox parses", () => {
  assert.deepEqual(envelope("messages", "messages", [{ id: "x" }]), {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { messages: [{ id: "x" }] } }] }],
  });
});

test("history keeps the last N days, resolves LID chats, names chats, drops media ids", () => {
  const now = 1760000000;
  const [body, ...rest] = historyBatches(
    {
      messages: [
        { key: { id: "OLD", remoteJid: "60111222333@s.whatsapp.net" }, messageTimestamp: now - 20 * 86400, message: { conversation: "old" } },
        { key: { id: "H1", remoteJid: "999@lid" }, messageTimestamp: now - 3600, pushName: "Ali", message: { conversation: "price?" } },
        { key: { id: "H2", remoteJid: "999@lid", fromMe: true }, messageTimestamp: now - 60, message: { conversation: "RM129" } },
        { key: { id: "H3", remoteJid: "60222333444@s.whatsapp.net" }, messageTimestamp: now, message: { imageMessage: { mimetype: "image/jpeg" } } },
        { key: { id: "G", remoteJid: "120363@g.us" }, messageTimestamp: now, message: { conversation: "group" } },
      ],
      contacts: [{ id: "60222333444@s.whatsapp.net", notify: "Siti" }],
      lidPnMappings: [{ lid: "999@lid", pn: "60999888777@s.whatsapp.net" }],
    },
    "60198765432",
    now - 14 * 86400,
  );
  assert.equal(rest.length, 0);
  const change = body.entry[0].changes[0];
  assert.equal(change.field, "history");
  assert.deepEqual(change.value.messages.map((m) => m.id), ["H1", "H3"]);
  assert.deepEqual(change.value.message_echoes.map((m) => [m.id, m.to]), [["H2", "60999888777"]]);
  assert.equal(change.value.messages[1].image.id, undefined);
  assert.deepEqual(
    change.value.contacts.sort((a, b) => a.wa_id.localeCompare(b.wa_id)),
    [{ wa_id: "60222333444", profile: { name: "Siti" } }, { wa_id: "60999888777", profile: { name: "Ali" } }],
  );
});

test("history is split into batches", () => {
  const messages = Array.from({ length: 250 }, (_, i) => ({ key: { id: `M${i}`, remoteJid: "60111222333@s.whatsapp.net" }, messageTimestamp: 100, message: { conversation: "x" } }));
  assert.equal(historyBatches({ messages }, "602", 0).length, 3);
});
