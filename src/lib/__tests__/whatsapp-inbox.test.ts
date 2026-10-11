import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInbox, filterInbox, openedAtAfterViewing, unreadCount, type InboxEvent } from "@/lib/whatsapp-inbox";
import { WHATSAPP_FIXTURE_LONG_TEXT, whatsappFixtureEnabled, whatsappFixtureEvents } from "@/lib/whatsapp-inbox-fixture";

function event(id: string, receivedAt: string, body: unknown): InboxEvent {
  return { id, receivedAt, rawBody: JSON.stringify(body) };
}

function messages(items: unknown[]): unknown {
  return { entry: [{ changes: [{ field: "messages", value: { messages: items } }] }] };
}

describe("buildInbox", () => {
  it("groups inbound on from and echoes on to, newest chat first", () => {
    const chats = buildInbox([
      event("e1", "2026-01-01T00:00:00.000Z", messages([
        { from: "15551110001", id: "m1", timestamp: "1760000000", type: "text", text: { body: "hello from one" } },
      ])),
      event("e2", "2026-01-01T00:01:00.000Z", {
        entry: [{ changes: [{ field: "smb_message_echoes", value: { message_echoes: [
          { from: "15550000000", to: "15551110001", id: "m2", timestamp: "1760000060", type: "text", text: { body: "reply to one" } },
        ] } }] }],
      }),
      event("e3", "2026-01-01T00:02:00.000Z", messages([
        { from: "15551110002", id: "m3", timestamp: "1760000200", type: "text", text: { body: "hello from two" } },
      ])),
    ]);

    expect(chats.map((chat) => chat.customer)).toEqual(["15551110002", "15551110001"]);
    expect(chats[1].messages).toEqual([
      { id: "e1:m1", side: "inbound", at: "2025-10-09T08:53:20.000Z", text: "hello from one" },
      { id: "e2:m2", side: "echo", at: "2025-10-09T08:54:20.000Z", text: "reply to one" },
    ]);
    expect(chats[1].preview).toBe("reply to one");
    expect(chats[1].lastAt).toBe("2025-10-09T08:54:20.000Z");
    expect(chats.map((chat) => chat.customer)).not.toContain("15550000000");
  });

  it("keeps every message in a payload, in order, including text past 160 characters", () => {
    const long = "x".repeat(180);
    const chats = buildInbox([
      event("e1", "2026-01-02T00:00:00.000Z", messages([
        { from: "15551110001", id: "m1", timestamp: "1760000000", type: "text", text: { body: long } },
        { from: "15551110001", id: "m2", timestamp: "1760000000", type: "text", text: { body: "second" } },
        { from: "15551110001", id: "m3", timestamp: "1760000001", type: "text", text: { body: "third" } },
      ])),
    ]);

    expect(chats).toEqual([{
      customer: "15551110001",
      lastAt: "2025-10-09T08:53:21.000Z",
      preview: "third",
      lastInboundAt: "2025-10-09T08:53:21.000Z",
      messages: [
        { id: "e1:m1", side: "inbound", at: "2025-10-09T08:53:20.000Z", text: long },
        { id: "e1:m2", side: "inbound", at: "2025-10-09T08:53:20.000Z", text: "second" },
        { id: "e1:m3", side: "inbound", at: "2025-10-09T08:53:21.000Z", text: "third" },
      ],
    }]);
    expect(chats[0].messages[0].text.length).toBe(180);
  });

  it("drops status events and labels media without a download", () => {
    const chats = buildInbox([
      event("status", "2026-01-01T00:00:00.000Z", {
        entry: [{ changes: [{ field: "statuses", value: { statuses: [
          { id: "wamid.S", status: "read", recipient_id: "15551110001", timestamp: "1760000000" },
        ] } }] }],
      }),
      event("mixed", "2026-01-01T00:01:00.000Z", {
        entry: [{ changes: [{ field: "messages", value: {
          messages: [
            { from: "15551110001", id: "t", timestamp: "1760000100", type: "text", text: { body: "hi" } },
            { from: "15551110001", id: "i", timestamp: "1760000101", type: "image", image: { caption: "front page" } },
            { from: "15551110001", id: "v", timestamp: "1760000102", type: "video", video: { caption: "clip" } },
            { from: "15551110001", id: "a", timestamp: "1760000103", type: "audio", audio: { id: "aud" } },
            { from: "15551110001", id: "d", timestamp: "1760000104", type: "document", document: { filename: "bill.pdf", caption: "invoice" } },
            { from: "15551110001", id: "s", timestamp: "1760000105", type: "sticker", sticker: { id: "stk" } },
            { from: "15551110001", id: "l", timestamp: "1760000106", type: "location", location: { name: "Office", address: "Kuala Lumpur" } },
          ],
          statuses: [{ id: "t", status: "delivered", recipient_id: "15551110001" }],
        } }] }],
      }),
    ]);

    expect(chats.map((chat) => chat.customer)).toEqual(["15551110001"]);
    expect(chats[0].messages.map((message) => message.text)).toEqual([
      "hi",
      "Image · front page",
      "Video · clip",
      "Audio",
      "Document · bill.pdf · invoice",
      "Sticker",
      "Location · Office · Kuala Lumpur",
    ]);
  });

  it("filters by number or message text", () => {
    const chats = buildInbox([
      event("e1", "2026-01-01T00:00:00.000Z", messages([
        { from: "15551110001", id: "m1", timestamp: "1760000000", type: "text", text: { body: "front page of the bill" } },
      ])),
      event("e2", "2026-01-01T00:01:00.000Z", messages([
        { from: "15551110002", id: "m2", timestamp: "1760000200", type: "text", text: { body: "Morning or afternoon?" } },
      ])),
    ]);

    expect(filterInbox(chats, "15551110002").map((chat) => chat.customer)).toEqual(["15551110002"]);
    expect(filterInbox(chats, "AFTERNOON").map((chat) => chat.customer)).toEqual(["15551110002"]);
    expect(filterInbox(chats, "  ")).toEqual(chats);
    expect(filterInbox(chats, "nope")).toEqual([]);
  });

  it("counts messages newer than the last open", () => {
    const messagesAt = [
      { at: "2025-10-09T08:53:20.000Z" },
      { at: "2025-10-09T08:54:20.000Z" },
    ];
    expect(unreadCount(messagesAt, null)).toBe(2);
    expect(unreadCount(messagesAt, "2025-10-09T08:53:20.000Z")).toBe(1);
    expect(unreadCount(messagesAt, "2025-10-09T08:54:20.000Z")).toBe(0);
    expect(openedAtAfterViewing(messagesAt, "2020-01-01T00:00:00.000Z")).toBe("2025-10-09T08:54:20.000Z");
    expect(unreadCount(messagesAt, openedAtAfterViewing(messagesAt, "2020-01-01T00:00:00.000Z"))).toBe(0);
    expect(unreadCount(
      [...messagesAt, { at: "2025-10-09T09:00:00.000Z" }],
      "2025-10-09T08:54:20.000Z",
    )).toBe(1);
    expect(openedAtAfterViewing(messagesAt, "2026-01-01T00:00:00.000Z")).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("local fixture", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off in production and on Vercel", () => {
    vi.stubEnv("WHATSAPP_INBOX_FIXTURE", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    expect(whatsappFixtureEnabled()).toBe(false);

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "1");
    expect(whatsappFixtureEnabled()).toBe(false);

    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(whatsappFixtureEnabled()).toBe(false);

    vi.stubEnv("VERCEL_ENV", "");
    expect(whatsappFixtureEnabled()).toBe(true);
  });

  it("seeds two customers with inbound, echo, image, and no status bubble", () => {
    const chats = buildInbox(whatsappFixtureEvents());
    expect(chats.map((chat) => chat.customer)).toEqual(["15551110002", "15551110001"]);
    expect(chats[0].messages).toEqual([
      { id: "evt_b_in:wamid.B1", side: "inbound", at: "2025-10-09T08:56:40.000Z", text: "When is installation?" },
      { id: "evt_b_in:wamid.B2", side: "inbound", at: "2025-10-09T08:56:45.000Z", text: "Morning or afternoon?" },
      { id: "evt_b_echo:wamid.B3", side: "echo", at: "2025-10-09T09:00:00.000Z", text: "Tomorrow 10am." },
    ]);
    expect(chats[1].messages.map((message) => message.text)).toEqual([
      WHATSAPP_FIXTURE_LONG_TEXT,
      "Sure. Send a photo of the bill and the account number.",
      "Image · front page",
    ]);
    expect(chats[1].messages.map((message) => message.side)).toEqual(["inbound", "echo", "inbound"]);
    expect(WHATSAPP_FIXTURE_LONG_TEXT.length).toBe(182);
    expect(chats[1].preview).toBe("Image · front page");
    expect(chats.flatMap((chat) => chat.messages.map((message) => message.text))).not.toContain("delivered");
  });
});
