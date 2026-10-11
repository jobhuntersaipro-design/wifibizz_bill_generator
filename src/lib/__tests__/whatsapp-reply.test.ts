import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const upsert = vi.fn();
const audit = vi.fn();
const admin = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappWebhookEvent: { create: (...a: unknown[]) => create(...a), findMany: async () => [] },
    whatsappConversation: { upsert: (...a: unknown[]) => upsert(...a), findMany: async () => [] },
  },
}));
vi.mock("@/lib/admin-gate", () => ({ requireAdmin: () => admin() }));
vi.mock("@/lib/audit", () => ({ ADMIN_ACTOR: "admin", recordAudit: (...a: unknown[]) => audit(...a) }));

import {
  buildInbox,
  chatInTab,
  formatRemaining,
  isClosed,
  phoneVariants,
  unreadFor,
  windowOpen,
  type InboxEvent,
} from "@/lib/whatsapp-inbox";
import { apiError, fetchMedia, sendRefusal, sendText, usableTemplates } from "@/lib/whatsapp-send";
import { sendWhatsappTemplate, sendWhatsappText } from "@/actions/whatsapp";

function event(id: string, receivedAt: string, field: string, value: unknown): InboxEvent {
  return { id, receivedAt, rawBody: JSON.stringify({ entry: [{ changes: [{ field, value }] }] }) };
}

const CUSTOMER = "60123456789";

function inbound(id: string, ts: number, text = "hi"): InboxEvent {
  return event(`in-${id}`, new Date(ts * 1000).toISOString(), "messages", {
    messages: [{ from: CUSTOMER, id, timestamp: String(ts), type: "text", text: { body: text } }],
  });
}

function status(id: string, value: string, extra: Record<string, unknown> = {}): InboxEvent {
  return event(`st-${id}-${value}`, "2026-01-01T00:00:00.000Z", "statuses", {
    statuses: [{ id, status: value, recipient_id: CUSTOMER, ...extra }],
  });
}

describe("buildInbox ticks and media", () => {
  it("puts the furthest status on the business message, whatever order webhooks arrive in", () => {
    const [chat] = buildInbox([
      status("wamid.R", "read"),
      status("wamid.R", "sent"),
      event("send", "2026-01-01T00:00:00.000Z", "api_send", {
        message_echoes: [{ to: CUSTOMER, id: "wamid.R", timestamp: "1760000100", type: "text", text: { body: "reply" } }],
      }),
      status("wamid.R", "delivered"),
      inbound("wamid.I", 1760000000),
    ]);
    expect(chat.messages.map((m) => [m.side, m.text, m.status])).toEqual([
      ["inbound", "hi", undefined],
      ["echo", "reply", "read"],
    ]);
  });

  it("carries the API's reason on a failed message", () => {
    const [chat] = buildInbox([
      event("send", "2026-01-01T00:00:00.000Z", "api_send", {
        message_echoes: [{ to: CUSTOMER, id: "wamid.F", timestamp: "1760000100", type: "text", text: { body: "late" } }],
      }),
      status("wamid.F", "failed", { errors: [{ code: 131047, title: "Re-engagement message", error_data: { details: "More than 24 hours have passed." } }] }),
    ]);
    expect(chat.messages[0]).toMatchObject({ status: "failed", error: "More than 24 hours have passed." });
  });

  it("gives an inbound image or document a media id, and nothing for a business echo", () => {
    const [chat] = buildInbox([
      event("m", "2026-01-01T00:00:00.000Z", "messages", {
        messages: [
          { from: CUSTOMER, id: "a", timestamp: "1760000000", type: "image", image: { id: "111", mime_type: "image/jpeg", caption: "bill" } },
          { from: CUSTOMER, id: "b", timestamp: "1760000001", type: "document", document: { id: "222", mime_type: "application/pdf", filename: "x.pdf" } },
          { from: CUSTOMER, id: "c", timestamp: "1760000002", type: "audio", audio: { id: "333" } },
        ],
      }),
    ]);
    expect(chat.messages.map((m) => m.media)).toEqual([
      { id: "111", kind: "image", mime: "image/jpeg" },
      { id: "222", kind: "document", mime: "application/pdf" },
      undefined,
    ]);
    expect(chat.lastInboundAt).toBe(new Date(1760000002 * 1000).toISOString());
  });
});

describe("reply window and chat state", () => {
  const last = "2026-01-01T00:00:00.000Z";
  const lastMs = Date.parse(last);

  it("is open for exactly 24 hours after the customer's last message", () => {
    expect(windowOpen(last, lastMs + 24 * 3600_000 - 1)).toBe(true);
    expect(windowOpen(last, lastMs + 24 * 3600_000)).toBe(false);
    expect(windowOpen(null, lastMs)).toBe(false);
  });

  it("reopens a closed chat when the customer writes again", () => {
    expect(isClosed(last, "2026-01-01T00:05:00.000Z")).toBe(true);
    expect(isClosed("2026-01-01T00:10:00.000Z", "2026-01-01T00:05:00.000Z")).toBe(false);
    expect(isClosed(last, null)).toBe(false);
  });

  it("counts unread customer messages only, against the shared read mark", () => {
    const [chat] = buildInbox([
      inbound("m1", 1760000000),
      event("e", "2026-01-01T00:00:00.000Z", "smb_message_echoes", {
        message_echoes: [{ to: CUSTOMER, id: "e1", timestamp: "1760000050", type: "text", text: { body: "ok" } }],
      }),
      inbound("m2", 1760000100),
    ]);
    expect(unreadFor(chat, undefined)).toBe(2);
    expect(unreadFor(chat, { closedAt: null, lastReadAt: new Date(1760000000 * 1000).toISOString() })).toBe(1);
    expect(chatInTab(chat, undefined, "unread")).toBe(true);
    expect(chatInTab(chat, { closedAt: new Date(1760000200 * 1000).toISOString(), lastReadAt: null }, "open")).toBe(false);
    expect(chatInTab(chat, { closedAt: new Date(1760000200 * 1000).toISOString(), lastReadAt: null }, "closed")).toBe(true);
  });

  it("formats the time left", () => {
    expect(formatRemaining(30_000)).toBe("under a minute");
    expect(formatRemaining(12 * 60_000)).toBe("12m");
    expect(formatRemaining((23 * 60 + 5) * 60_000)).toBe("23h 5m");
  });
});

describe("phoneVariants", () => {
  it("covers how orders and cases store a Malaysian number", () => {
    expect(phoneVariants("60123456789").sort()).toEqual(["+60123456789", "0123456789", "123456789", "60123456789"].sort());
  });
  it("leaves a foreign number alone", () => {
    expect(phoneVariants("15551110001").sort()).toEqual(["+15551110001", "15551110001"]);
  });
});

describe("360dialog client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses on preview deployments and without a key", () => {
    expect(sendRefusal("preview", "k")).toMatch(/preview/);
    expect(sendRefusal("production", null)).toMatch(/WHATSAPP_D360_API_KEY/);
    expect(sendRefusal("production", "k")).toBeNull();
  });

  it("keeps only approved templates that need no parameters", () => {
    const templates = usableTemplates({
      waba_templates: [
        { name: "b_ok", language: "en", status: "approved", category: "UTILITY", components: [{ type: "BODY", text: "Hello there" }] },
        { name: "a_ok", language: "ms", status: "APPROVED", components: [{ type: "HEADER", format: "TEXT", text: "Hi" }, { type: "BODY", text: "Body" }] },
        { name: "vars", language: "en", status: "approved", components: [{ type: "BODY", text: "Hi {{1}}" }] },
        { name: "image", language: "en", status: "approved", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "x" }] },
        { name: "url", language: "en", status: "approved", components: [{ type: "BODY", text: "x" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://a/{{1}}" }] }] },
        { name: "pending", language: "en", status: "pending", components: [{ type: "BODY", text: "x" }] },
      ],
    });
    expect(templates.map((t) => t.name)).toEqual(["a_ok", "b_ok"]);
    expect(templates[1]).toEqual({ name: "b_ok", language: "en", category: "UTILITY", body: "Hello there" });
  });

  it("prefers the Cloud API's details sentence", () => {
    expect(apiError({ error: { message: "(#131047) Re-engagement message", error_data: { details: "24 hours passed" } } }, 400)).toBe("24 hours passed");
    expect(apiError({ error: { message: "Invalid parameter" } }, 400)).toBe("Invalid parameter");
    expect(apiError(null, 502)).toBe("WhatsApp API answered 502.");
  });

  it("posts a text in Cloud API shape and returns the wamid", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendText("KEY", CUSTOMER, "hello")).toEqual({ ok: true, wamid: "wamid.OK" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://waba-v2.360dialog.io/messages");
    expect((init.headers as Record<string, string>)["D360-API-KEY"]).toBe("KEY");
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp", recipient_type: "individual", to: CUSTOMER, type: "text", text: { body: "hello", preview_url: false },
    });
  });

  it("only follows a media URL on Meta's lookaside host, and only for allowed types", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ url: "https://evil.example/x", mime_type: "image/jpeg" }))));
    expect(await fetchMedia("KEY", "1")).toEqual({ ok: false, status: 502 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/a?b=1", mime_type: "image/svg+xml" }))));
    expect(await fetchMedia("KEY", "1")).toEqual({ ok: false, status: 415 });

    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return calls.length === 1
        ? new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=9&hash=h", mime_type: "image/png" }))
        : new Response(new Uint8Array([1, 2, 3]));
    }));
    const media = await fetchMedia("KEY", "9");
    expect(media.ok && media.mime).toBe("image/png");
    expect(calls[1]).toBe("https://waba-v2.360dialog.io/whatsapp_business/attachments/?mid=9&hash=h");
  });
});

describe("send actions", () => {
  beforeEach(() => {
    create.mockReset();
    audit.mockReset();
    admin.mockResolvedValue(null);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("WHATSAPP_D360_API_KEY", "KEY");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses a non-admin before calling anyone", async () => {
    admin.mockResolvedValue({ success: false, error: "Unauthorized" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendWhatsappText(CUSTOMER, "hi")).toEqual({ success: false, error: "Unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never sends from a preview deployment", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendWhatsappText(CUSTOMER, "hi");
    expect(res.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores the sent reply so the inbox shows it, and audits it without the text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.NEW" }] }))));
    expect(await sendWhatsappText(CUSTOMER, "  your appointment is 10am  ")).toEqual({ success: true, data: undefined });
    const row = create.mock.calls[0][0].data as { rawBody: string; field: string; messageId: string };
    expect(row.field).toBe("api_send");
    expect(row.messageId).toBe("wamid.NEW");
    const [chat] = buildInbox([{ id: "r", receivedAt: "2026-01-01T00:00:00.000Z", rawBody: row.rawBody }]);
    expect(chat.customer).toBe(CUSTOMER);
    expect(chat.messages[0]).toMatchObject({ side: "echo", text: "your appointment is 10am" });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "whatsapp_message_sent" }));
    expect(JSON.stringify(audit.mock.calls[0])).not.toContain("appointment");
  });

  it("does not store anything when WhatsApp refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Re-engagement message" } }), { status: 400 })));
    expect(await sendWhatsappText(CUSTOMER, "hi")).toEqual({ success: false, error: "Re-engagement message" });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a bad number and an empty message", async () => {
    expect((await sendWhatsappText("abc", "hi")).success).toBe(false);
    expect((await sendWhatsappText(CUSTOMER, "   ")).success).toBe(false);
  });

  it("sends only a template the account actually lists, storing its body", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/v1/configs/templates")) {
        return new Response(JSON.stringify({ waba_templates: [{ name: "follow_up", language: "en", status: "approved", components: [{ type: "BODY", text: "Following up" }] }] }));
      }
      return new Response(JSON.stringify({ messages: [{ id: "wamid.T" }] }));
    }));
    expect((await sendWhatsappTemplate(CUSTOMER, "made_up", "en")).success).toBe(false);
    expect(calls.some((c) => c.endsWith("/messages"))).toBe(false);
    expect(await sendWhatsappTemplate(CUSTOMER, "follow_up", "en")).toEqual({ success: true, data: undefined });
    const row = create.mock.calls[0][0].data as { rawBody: string };
    expect(buildInbox([{ id: "r", receivedAt: "2026-01-01T00:00:00.000Z", rawBody: row.rawBody }])[0].messages[0].text).toBe("Following up");
  });
});
