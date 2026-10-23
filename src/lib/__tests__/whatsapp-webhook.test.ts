import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as adminList } from "@/app/api/admin/whatsapp/route";
import WhatsappAdminPage from "@/app/admin/(dashboard)/whatsapp/page";
import { GET, POST } from "@/app/api/whatsapp/webhook/route";
import {
  directionLabel,
  extractWhatsappEvent,
  formatKualaLumpur,
  signatureOk,
  verifyChallenge,
} from "@/lib/whatsapp-webhook";

const create = vi.fn();
const findMany = vi.fn();
const verifyAdmin = vi.fn();
const ingest = vi.fn();
const listChatSummaries = vi.fn();

vi.mock("@/lib/whatsapp-store", () => ({
  ingestWebhook: (...args: unknown[]) => ingest(...args),
  backfillFromEvents: async () => {},
  listChatSummaries: (...args: unknown[]) => listChatSummaries(...args),
  listThread: async () => [],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappWebhookEvent: {
      create: (...args: unknown[]) => create(...args),
      findMany: (...args: unknown[]) => findMany(...args),
    },
    whatsappConversation: {
      findMany: async () => [],
    },
    whatsappLabel: {
      findMany: async () => [],
    },
  },
}));

vi.mock("@/lib/admin-auth", () => ({
  verifyAdminSession: () => verifyAdmin(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

/** Attached sample: customer message (field messages). */
const INBOUND = {
  object: "whatsapp_business_account",
  entry: [{
    id: "000000000000000",
    changes: [{
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "15550000000", phone_number_id: "000000000000001" },
        contacts: [{ profile: { name: "Test Sender" }, wa_id: "15551110000" }],
        messages: [{
          from: "15551110000",
          id: "wamid.TEST_INBOUND_1",
          timestamp: "1791700000",
          type: "text",
          text: { body: "jk6 test: hi, what are your hours?" },
        }],
      },
      field: "messages",
    }],
  }],
};

/** Attached sample: app/AI echo (field smb_message_echoes). */
const ECHO = {
  object: "whatsapp_business_account",
  entry: [{
    id: "000000000000000",
    changes: [{
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "15550000000", phone_number_id: "000000000000001" },
        message_echoes: [{
          from: "15550000000",
          to: "15551110000",
          id: "wamid.TEST_ECHO_1",
          timestamp: "1791700005",
          type: "text",
          text: { body: "jk6 test: we are open 9-6." },
        }],
      },
      field: "smb_message_echoes",
    }],
  }],
};

function sign(secret: string, raw: string): string {
  return "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
}

function webhookGet(query: string) {
  return GET(new Request(`http://localhost/api/whatsapp/webhook?${query}`));
}

function webhookPost(body: string, headers?: Record<string, string>) {
  return POST(new Request("http://localhost/api/whatsapp/webhook", { method: "POST", body, headers }));
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_WEBHOOK_SECRET;
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL;
  delete process.env.WHATSAPP_INBOX_FIXTURE;
  create.mockResolvedValue({ id: "evt_1" });
  findMany.mockResolvedValue([]);
  verifyAdmin.mockResolvedValue(false);
});

describe("GET verification", () => {
  it("returns the challenge as plain text when mode and token match", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "expected-token";
    const res = await webhookGet("hub.mode=subscribe&hub.verify_token=expected-token&hub.challenge=918273");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("918273");
  });

  it("accepts a token that matches after the env value is trimmed", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "expected-token\n";
    const res = await webhookGet("hub.mode=subscribe&hub.verify_token=expected-token&hub.challenge=ok");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("rejects a wrong token", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "expected-token";
    const res = await webhookGet("hub.mode=subscribe&hub.verify_token=nope&hub.challenge=918273");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("forbidden");
  });

  it("rejects a wrong mode", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "expected-token";
    const res = await webhookGet("hub.mode=unsubscribe&hub.verify_token=expected-token&hub.challenge=918273");
    expect(res.status).toBe(403);
  });

  it("rejects when the verify token is unset", async () => {
    const res = await webhookGet("hub.mode=subscribe&hub.verify_token=&hub.challenge=918273");
    expect(res.status).toBe(403);
  });

  it("rejects a subscribe request with no challenge", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "expected-token";
    const params = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "expected-token" });
    expect(verifyChallenge(params, "expected-token")).toEqual({ ok: false });
  });
});

describe("extract", () => {
  it("reads an inbound customer message", () => {
    expect(extractWhatsappEvent(INBOUND)).toEqual({
      field: "messages",
      fromWaId: "15551110000",
      toWaId: null,
      messageId: "wamid.TEST_INBOUND_1",
      messageType: "text",
      textPreview: "jk6 test: hi, what are your hours?",
    });
    expect(directionLabel("messages")).toBe("Inbound");
  });

  it("reads an smb_message_echoes payload", () => {
    expect(extractWhatsappEvent(ECHO)).toEqual({
      field: "smb_message_echoes",
      fromWaId: "15550000000",
      toWaId: "15551110000",
      messageId: "wamid.TEST_ECHO_1",
      messageType: "text",
      textPreview: "jk6 test: we are open 9-6.",
    });
    expect(directionLabel("smb_message_echoes")).toBe("Echo");
  });

  it("reads a status and a history field", () => {
    expect(extractWhatsappEvent({
      entry: [{
        changes: [{
          field: "statuses",
          value: { statuses: [{ id: "wamid.S", status: "delivered", recipient_id: "15551110000" }] },
        }],
      }],
    })).toMatchObject({
      field: "statuses",
      toWaId: "15551110000",
      messageId: "wamid.S",
      messageType: "delivered",
      textPreview: "delivered",
    });
    expect(directionLabel("statuses")).toBe("Status");
    expect(extractWhatsappEvent({
      entry: [{ changes: [{ field: "history", value: { history: [{ threads: [] }] } }] }],
    })).toMatchObject({ field: "history", messageId: null, textPreview: null });
    expect(directionLabel("history")).toBe("History");
  });

  it("formats instants in Asia/Kuala_Lumpur", () => {
    expect(formatKualaLumpur("2026-10-11T02:30:00.000Z")).toContain("11 Oct 2026");
    expect(formatKualaLumpur("2026-10-11T02:30:00.000Z")).toContain("10:30:00");
  });
});

describe("POST", () => {
  it("stores the inbound sample", async () => {
    const raw = JSON.stringify(INBOUND);
    const res = await webhookPost(raw);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("EVENT_RECEIVED");
    expect(create).toHaveBeenCalledWith({
      data: {
        ...extractWhatsappEvent(INBOUND),
        rawBody: raw,
      },
    });
  });

  it("stores the smb_message_echoes sample", async () => {
    const raw = JSON.stringify(ECHO);
    const res = await webhookPost(raw);
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: { ...extractWhatsappEvent(ECHO), rawBody: raw },
    });
  });

  it("stores a non-JSON body without throwing", async () => {
    const res = await webhookPost("not-json");
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: {
        field: null,
        fromWaId: null,
        toWaId: null,
        messageId: null,
        messageType: null,
        textPreview: null,
        rawBody: "not-json",
      },
    });
  });

  it("checks the signature against the raw bytes when the secret is set", async () => {
    const raw = '{ "entry": [] }';
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    expect(signatureOk(Buffer.from(raw), sign("app-secret", raw), "app-secret")).toBe(true);

    const ok = await webhookPost(raw, { "x-hub-signature-256": sign("app-secret", raw) });
    expect(ok.status).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ rawBody: raw }),
    });

    create.mockClear();
    const bad = await webhookPost(raw, { "x-hub-signature-256": sign("other-secret", raw) });
    expect(bad.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a missing signature when the secret is set", async () => {
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    const res = await webhookPost(JSON.stringify(INBOUND));
    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts an unsigned body locally when VERCEL_ENV is unset", async () => {
    expect(process.env.VERCEL_ENV).toBeUndefined();
    const res = await webhookPost(JSON.stringify(INBOUND), { "x-hub-signature-256": "sha256=deadbeef" });
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalled();
  });

  it("accepts an unsigned body when VERCEL_ENV is development or empty", async () => {
    for (const env of ["development", ""]) {
      process.env.VERCEL_ENV = env;
      const res = await webhookPost(JSON.stringify(INBOUND));
      expect(res.status).toBe(200);
    }
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("rejects an unsigned preview post when neither secret is configured", async () => {
    process.env.VERCEL_ENV = "preview";
    const res = await webhookPost(JSON.stringify(INBOUND));
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an unsigned post for any other non-local VERCEL_ENV", async () => {
    process.env.VERCEL_ENV = "staging";
    const res = await webhookPost(JSON.stringify(INBOUND));
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a missing webhook secret and stores nothing", async () => {
    process.env.WHATSAPP_WEBHOOK_SECRET = "whsec";
    const res = await webhookPost(JSON.stringify(INBOUND));
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a wrong webhook secret and stores nothing", async () => {
    process.env.WHATSAPP_WEBHOOK_SECRET = "whsec";
    const res = await webhookPost(JSON.stringify(INBOUND), { "x-webhook-secret": "nope" });
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("stores the body when X-Webhook-Secret matches", async () => {
    process.env.WHATSAPP_WEBHOOK_SECRET = "whsec\n";
    const raw = JSON.stringify(INBOUND);
    const res = await webhookPost(raw, { "x-webhook-secret": "whsec" });
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: { ...extractWhatsappEvent(INBOUND), rawBody: raw },
    });
  });

  it("accepts the same secret on D360-Webhook-Secret", async () => {
    process.env.WHATSAPP_WEBHOOK_SECRET = "whsec";
    const res = await webhookPost(JSON.stringify(INBOUND), { "d360-webhook-secret": "whsec" });
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalled();
  });

  it("rejects in production when neither secret is configured", async () => {
    process.env.VERCEL_ENV = "production";
    const res = await webhookPost(JSON.stringify(INBOUND));
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("still accepts a matching secret header in production", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.WHATSAPP_WEBHOOK_SECRET = "whsec";
    const res = await webhookPost(JSON.stringify(INBOUND), { "x-webhook-secret": "whsec" });
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalled();
  });

  it("still rejects a missing or wrong secret header in production", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.WHATSAPP_WEBHOOK_SECRET = "whsec";
    const missing = await webhookPost(JSON.stringify(INBOUND));
    expect(missing.status).toBe(401);
    const wrong = await webhookPost(JSON.stringify(INBOUND), { "x-webhook-secret": "nope" });
    expect(wrong.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts either a valid hub signature or the webhook header when both secrets are set", async () => {
    const raw = '{ "entry": [] }';
    process.env.WHATSAPP_WEBHOOK_SECRET = "whsec";
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    const bySignature = await webhookPost(raw, { "x-hub-signature-256": sign("app-secret", raw) });
    expect(bySignature.status).toBe(200);
    create.mockClear();
    const byHeader = await webhookPost(raw, {
      "x-webhook-secret": "whsec",
      "x-hub-signature-256": "sha256=deadbeef",
    });
    expect(byHeader.status).toBe(200);
    expect(create).toHaveBeenCalled();
  });

  it("splits the body into message rows", async () => {
    const res = await webhookPost(JSON.stringify(INBOUND));
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith(INBOUND);
  });

  it("returns 500 when the insert fails and does not claim the event was received", async () => {
    create.mockRejectedValueOnce(new Error("db down"));
    const res = await webhookPost(JSON.stringify(INBOUND));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("store_failed");
  });
});

describe("admin list", () => {
  it("returns chats and labels by default and searches on the server", async () => {
    verifyAdmin.mockResolvedValue(true);
    listChatSummaries.mockResolvedValue([{ customer: "15551110000" }]);
    const res = await adminList(new Request("http://localhost/api/admin/whatsapp?q=hours"));
    expect(res.status).toBe(200);
    expect(listChatSummaries).toHaveBeenCalledWith("hours");
    expect(await res.json()).toEqual({ chats: [{ customer: "15551110000" }], labels: [] });
  });

  it("refuses a malformed chat id", async () => {
    verifyAdmin.mockResolvedValue(true);
    const res = await adminList(new Request("http://localhost/api/admin/whatsapp?chat=abc"));
    expect(res.status).toBe(400);
  });

  it("refuses a request without an admin session", async () => {
    const res = await adminList(new Request("http://localhost/api/admin/whatsapp?view=raw"));
    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("sends a non-admin away from the page", async () => {
    await expect(WhatsappAdminPage()).rejects.toThrow("REDIRECT /admin/login");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("renders the page for an admin", async () => {
    verifyAdmin.mockResolvedValue(true);
    const page = await WhatsappAdminPage();
    expect(page).toBeTruthy();
  });
});

describe("isolation", () => {
  it("keeps the webhook off the auth proxy matcher", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8");
    const matcher = proxy.slice(proxy.indexOf("matcher:"));
    expect(matcher).not.toContain("/api");
    expect(matcher).not.toContain("whatsapp");
  });

  it("writes only the webhook table", () => {
    const route = readFileSync("src/app/api/whatsapp/webhook/route.ts", "utf8");
    const list = readFileSync("src/lib/whatsapp-events.ts", "utf8");
    for (const src of [route, list]) {
      expect(src).toContain("whatsappWebhookEvent");
      expect(src).not.toMatch(/prisma\.(order|user|wifibizzCase|wifibizzUser|caseUsageLog|batchRun)\b/);
    }
  });
});
