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

import { buildInbox, chatInTab, isClosed, phoneVariants, unreadFor, type InboxEvent } from "@/lib/whatsapp-inbox";
import { fetchMedia, gatewayConfig, gatewayState, sendRefusal, sendText } from "@/lib/whatsapp-send";
import { getWhatsappConnection, sendWhatsappText, whatsappConnectionAction } from "@/actions/whatsapp";

const GW = { url: "https://scraper.example/wa", token: "TOKEN" };

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

  it("shows a message stored twice as one bubble", () => {
    const [chat] = buildInbox([inbound("wamid.D", 1760000000, "once"), inbound("wamid.D", 1760000000, "once")]);
    expect(chat.messages.map((m) => m.text)).toEqual(["once"]);
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

describe("chat state", () => {
  const last = "2026-01-01T00:00:00.000Z";

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

});

describe("phoneVariants", () => {
  it("covers how orders and cases store a Malaysian number", () => {
    expect(phoneVariants("60123456789").sort()).toEqual(["+60123456789", "0123456789", "123456789", "60123456789"].sort());
  });
  it("leaves a foreign number alone", () => {
    expect(phoneVariants("15551110001").sort()).toEqual(["+15551110001", "15551110001"]);
  });
});

describe("gateway client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("is configured only with both the URL and the token, trailing slash dropped", () => {
    vi.stubEnv("WHATSAPP_GATEWAY_URL", "https://scraper.example/wa/");
    vi.stubEnv("WHATSAPP_GATEWAY_TOKEN", "");
    expect(gatewayConfig()).toBeNull();
    vi.stubEnv("WHATSAPP_GATEWAY_TOKEN", " TOKEN ");
    expect(gatewayConfig()).toEqual(GW);
  });

  it("refuses on preview deployments and without the gateway", () => {
    expect(sendRefusal("preview", GW)).toMatch(/preview/);
    expect(sendRefusal("production", null)).toMatch(/WHATSAPP_GATEWAY_URL/);
    expect(sendRefusal("production", GW)).toBeNull();
  });

  it("posts a text with the bearer token and returns the message id", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "3EB0ABC" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendText(GW, CUSTOMER, "hello")).toEqual({ ok: true, wamid: "3EB0ABC" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://scraper.example/wa/send");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
    expect(JSON.parse(init.body as string)).toEqual({ to: CUSTOMER, text: "hello" });
  });

  it("passes the gateway's own refusal through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "WhatsApp is not connected. Scan the QR on the WhatsApp tab." }), { status: 409 })));
    expect(await sendText(GW, CUSTOMER, "hi")).toEqual({ ok: false, error: "WhatsApp is not connected. Scan the QR on the WhatsApp tab." });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await sendText(GW, CUSTOMER, "hi")).toEqual({ ok: false, error: "Could not reach the WhatsApp gateway." });
  });

  it("reads the link state and only accepts a PNG data URL as the QR", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "qr", qr: "data:image/png;base64,AAAA", me: null }))));
    expect(await gatewayState(GW)).toEqual({ ok: true, state: { status: "qr", qr: "data:image/png;base64,AAAA", me: null, error: null } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "weird", qr: "javascript:alert(1)" }))));
    const odd = await gatewayState(GW);
    expect(odd.ok && odd.state).toEqual({ status: "starting", qr: null, me: null, error: null });
  });

  it("serves media only of an allowed type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/svg+xml" } })));
    expect(await fetchMedia(GW, "ABC")).toEqual({ ok: false, status: 415 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } })));
    const media = await fetchMedia(GW, "ABC");
    expect(media.ok && media.mime).toBe("image/png");
  });
});

describe("send actions", () => {
  beforeEach(() => {
    create.mockReset();
    audit.mockReset();
    admin.mockResolvedValue(null);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("WHATSAPP_GATEWAY_URL", GW.url);
    vi.stubEnv("WHATSAPP_GATEWAY_TOKEN", GW.token);
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
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "wamid.NEW" }))));
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
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "WhatsApp is not connected." }), { status: 409 })));
    expect(await sendWhatsappText(CUSTOMER, "hi")).toEqual({ success: false, error: "WhatsApp is not connected." });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a bad number and an empty message", async () => {
    expect((await sendWhatsappText("abc", "hi")).success).toBe(false);
    expect((await sendWhatsappText(CUSTOMER, "   ")).success).toBe(false);
  });

  it("reads the connection and audits an unlink", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.endsWith("/status")
        ? new Response(JSON.stringify({ status: "open", me: "60198765432" }))
        : new Response(JSON.stringify({ ok: true })),
    ));
    const res = await getWhatsappConnection();
    expect(res.success && res.data.status).toBe("open");
    expect(await whatsappConnectionAction("logout")).toEqual({ success: true, data: undefined });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "whatsapp_unlinked" }));
  });

  it("does not let a non-admin read the QR", async () => {
    admin.mockResolvedValue({ success: false, error: "Unauthorized" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getWhatsappConnection()).toEqual({ success: false, error: "Unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
