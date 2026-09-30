/**
 * The admin assistant's guard rails. Each rule here fails silently when broken:
 * a guard that lets everything through, a masked ID that is not masked, or a
 * link that points off-site all LOOK like a working chatbot.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const orderFindFirst = vi.fn();
const eventsFindMany = vi.fn();
const convFindUnique = vi.fn();
const convUpdate = vi.fn();
const escCreate = vi.fn();
const escUpdate = vi.fn();
const sendEmail = vi.fn();
const umobileCount = vi.fn();
const umobileFind = vi.fn();
const landlordCount = vi.fn();
const landlordFind = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findFirst: (...a: unknown[]) => orderFindFirst(...a), findMany: vi.fn() },
    orderStatusEvent: { findMany: (...a: unknown[]) => eventsFindMany(...a) },
    adminChatConversation: {
      findUnique: (...a: unknown[]) => convFindUnique(...a),
      update: (...a: unknown[]) => convUpdate(...a),
    },
    adminChatEscalation: {
      create: (...a: unknown[]) => escCreate(...a),
      update: (...a: unknown[]) => escUpdate(...a),
    },
    user: { findFirst: vi.fn() },
    plan: { findMany: vi.fn() },
    umobileModemImage: { count: (...a: unknown[]) => umobileCount(...a), findMany: (...a: unknown[]) => umobileFind(...a) },
    landlordSignatureImage: {
      count: (...a: unknown[]) => landlordCount(...a),
      findMany: (...a: unknown[]) => landlordFind(...a),
    },
  },
}));
vi.mock("@/actions/admin-orders", () => ({ adminLiveJobs: vi.fn(), adminOrderStats: vi.fn() }));
vi.mock("@/lib/notifications/resend", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

const { checkMessage, applyStrike, isLocked, lockRemaining, clientKeyFrom, utcDayStart } = await import(
  "@/lib/admin-chat/guard"
);
const { parseChatMarkdown, parseInline, isSafeAdminHref } = await import("@/lib/admin-chat/markdown");
const { classifyOrderLookup, maskPhone, orderSummary, orderDetail, toolResult, MAX_TOOL_RESULT_CHARS, explainError } =
  await import("@/lib/admin-chat/format");
const { CHAT_TOOLS, toolDefinitions, runTool } = await import("@/lib/admin-chat/tools");
const { systemPrompt, dateBlock, DEFAULT_INSTRUCTIONS, SAFETY_BLOCK } = await import("@/lib/admin-chat/prompt");
const { normalizeChatSettings, disabledToolsNamedIn, chatSettingsFromRow } = await import(
  "@/lib/admin-chat/settings-rules"
);
const { CHAT_LIMITS } = await import("@/lib/admin-chat/config");

beforeEach(() => vi.clearAllMocks());

const ctx = () => ({
  conversationId: "c1",
  handoffName: "Sofie",
  handoffEmail: "sofie@example.com",
  events: {} as { escalationId?: string; struck?: boolean; locked?: boolean },
});

describe("checkMessage", () => {
  it("trims and accepts a normal question", () => {
    expect(checkMessage("  why did ORD-0001 fail? ")).toEqual({ ok: true, text: "why did ORD-0001 fail?" });
  });
  it("refuses empty, whitespace and non-strings", () => {
    expect(checkMessage("   ").ok).toBe(false);
    expect(checkMessage(undefined).ok).toBe(false);
    expect(checkMessage({ text: "x" }).ok).toBe(false);
  });
  it("refuses over-long input", () => {
    expect(checkMessage("a".repeat(CHAT_LIMITS.maxMessageChars + 1)).ok).toBe(false);
    expect(checkMessage("a".repeat(CHAT_LIMITS.maxMessageChars)).ok).toBe(true);
  });
  it("drops control characters but keeps newlines", () => {
    expect(checkMessage("a\u0000b\nc")).toEqual({ ok: true, text: "ab\nc" });
  });
});

describe("strikes and locks", () => {
  const now = new Date("2026-09-30T00:00:00Z");
  it("locks on the third strike, not before", () => {
    expect(applyStrike(0, now)).toEqual({ strikes: 1, lockedUntil: null });
    expect(applyStrike(1, now).lockedUntil).toBeNull();
    const third = applyStrike(2, now);
    expect(third.strikes).toBe(3);
    expect(third.lockedUntil?.getTime()).toBe(now.getTime() + CHAT_LIMITS.lockMs);
  });
  it("a lock holds until its time, then lifts", () => {
    const until = new Date(now.getTime() + 60_000);
    expect(isLocked(until, now)).toBe(true);
    expect(isLocked(until, new Date(until.getTime() + 1))).toBe(false);
    expect(isLocked(null, now)).toBe(false);
  });
  it("never says 'in 0 minutes'", () => {
    expect(lockRemaining(new Date(now.getTime() + 5_000), now)).toBe("in 1 minute");
    expect(lockRemaining(new Date(now.getTime() + 42 * 60_000), now)).toBe("in 42 minutes");
  });
  it("the daily window starts at UTC midnight", () => {
    expect(utcDayStart(new Date("2026-09-30T15:30:00Z")).toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });
  it("keys on the first forwarded hop", () => {
    expect(clientKeyFrom(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientKeyFrom(new Headers())).toBe("unknown");
  });
});

describe("chat markdown", () => {
  it("links only inside /admin/", () => {
    expect(isSafeAdminHref("/admin/orders/abc")).toBe(true);
    expect(isSafeAdminHref("https://evil.example")).toBe(false);
    expect(isSafeAdminHref("javascript:alert(1)")).toBe(false);
    expect(isSafeAdminHref("//evil.example/admin")).toBe(false);
    expect(isSafeAdminHref("/dashboard")).toBe(false);
  });
  it("an off-site link renders as plain text", () => {
    expect(parseInline("see [here](https://evil.example)")).toEqual([
      { kind: "text", text: "see " },
      { kind: "text", text: "here" },
    ]);
  });
  it("parses bold, code, links, bullets and numbered lists", () => {
    const blocks = parseChatMarkdown(
      "**ORD-0001** failed.\n\n- [ORD-0001](/admin/orders/x)\n- `device_out_of_stock`\n\n1. one\n2. two",
    );
    expect(blocks[0]).toEqual({
      kind: "para",
      parts: [{ kind: "bold", text: "ORD-0001" }, { kind: "text", text: " failed." }],
    });
    expect(blocks[1]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[1].kind === "list" && blocks[1].items[0][0]).toEqual({
      kind: "link", text: "ORD-0001", href: "/admin/orders/x",
    });
    expect(blocks[2]).toMatchObject({ kind: "list", ordered: true });
  });
  it("raw HTML stays text", () => {
    expect(parseChatMarkdown("<img src=x onerror=alert(1)>")).toEqual([
      { kind: "para", parts: [{ kind: "text", text: "<img src=x onerror=alert(1)>" }] },
    ]);
  });
});

describe("what the model is allowed to see", () => {
  const row = {
    id: "o1", reference: "ORD-0275", fullName: "ALI BIN ABU", idNumber: "940811-03-4224",
    status: "warning", orderId: "2609000125815472", errorCode: "address_already_has_service",
    offerName: "Unifi Home 500Mbps", attempt: 3, createdAt: new Date("2026-09-28T01:00:00Z"),
    deletedAt: null, user: { email: "agent@example.com" },
  };

  it("masks the IC to its last four digits", () => {
    const s = orderSummary(row);
    expect(s.idNumber).toBe("••••••-••-4224");
    expect(JSON.stringify(s)).not.toContain("940811");
    expect(s.link).toBe("/admin/orders/o1");
  });
  it("masks the phone to its last four digits", () => {
    expect(maskPhone("60", "123456789")).toBe("+60 •••••6789");
    expect(maskPhone("60", null)).toBe("");
  });
  it("detail drops screenshots, never includes street or e-mail, and keeps the error explanation", () => {
    const detail = orderDetail(
      {
        ...row, idType: "MyKad", mobilePrefix: "60", mobile: "123456789", postcode: "43500",
        city: "SEMENYIH", state: "SELANGOR", deviceName: null, errorMessage: "This address already has TM services",
        autoRetries: 0, autoRetryAt: null, stage: "attaching_customer", updatedAt: new Date("2026-09-28T02:00:00Z"),
      },
      [
        { id: "e1", attempt: 3, stage: "creating_customer", status: "submitting", message: null, errorCode: null, createdAt: new Date("2026-09-28T01:01:00Z") },
        { id: "e2", attempt: 3, stage: "capture_page1", status: "submitting", message: "order-screenshots/u/o/x.jpg", errorCode: null, createdAt: new Date("2026-09-28T01:02:00Z") },
        { id: "e3", attempt: 3, stage: "attaching_customer", status: "warning", message: "already has TM services", errorCode: "address_already_has_service", createdAt: new Date("2026-09-28T01:03:00Z") },
      ],
    );
    const json = JSON.stringify(detail);
    expect(json).not.toContain("order-screenshots");
    expect(json).not.toContain("123456789");
    expect(detail.area).toBe("43500 SEMENYIH SELANGOR");
    expect(detail.recentAttempts[0].events).toHaveLength(2);
    expect(detail.recentAttempts[0].events[0].step).toBe("Creating customer profile");
    expect(detail.errorExplanation?.code).toBe("address_already_has_service");
  });
  it("an unknown error code is still explained, not dropped", () => {
    const e = explainError("some_new_code");
    expect(e.known).toBe(false);
    expect(e.label).toBe("Some new code");
    expect(e.nextAction).toBeTruthy();
  });
  it("classifies a lookup", () => {
    expect(classifyOrderLookup("ORD-275")).toEqual({ by: "reference", value: "ORD-0275" });
    expect(classifyOrderLookup("ord 0275")).toEqual({ by: "reference", value: "ORD-0275" });
    expect(classifyOrderLookup("2609000125815472")).toEqual({ by: "portalOrderNo", value: "2609000125815472" });
    expect(classifyOrderLookup("cmulaf90i000204jn6m9frn2y")).toEqual({ by: "id", value: "cmulaf90i000204jn6m9frn2y" });
  });
  it("caps a huge tool result", () => {
    const out = toolResult({ big: "x".repeat(MAX_TOOL_RESULT_CHARS * 2) });
    expect(out.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    expect(JSON.parse(out).truncated).toBe(true);
  });
});

describe("the tool surface is read-only", () => {
  it("exposes exactly these tools", () => {
    expect(CHAT_TOOLS.map((t) => t.name)).toEqual([
      "search_orders", "get_order", "explain_error_code", "list_plans",
      "order_stats", "live_jobs", "list_image_pools", "escalate_to_human", "flag_off_topic",
    ]);
  });
  it("the tools module writes only the chatbot's own tables", () => {
    const src = readFileSync(path.resolve(__dirname, "../admin-chat/tools.ts"), "utf8");
    // Every prisma write in the file, by model.
    const writes = [...src.matchAll(/prisma\.(\w+)\.(create|update|updateMany|upsert|delete|deleteMany|createMany)\b/g)]
      .map((m) => m[1]);
    expect(new Set(writes)).toEqual(new Set(["adminChatEscalation", "adminChatConversation"]));
    for (const forbidden of ["adminPurge", "adminClone", "adminRelease", "startSubmit", "adminSetPlanPublished", "adminSubmit"]) {
      expect(src).not.toContain(forbidden);
    }
  });
  it("every definition is a JSON-schema object without $schema", () => {
    for (const d of toolDefinitions()) {
      expect(d.input_schema.type).toBe("object");
      expect(d.input_schema).not.toHaveProperty("$schema");
      expect(d.description?.length).toBeGreaterThan(20);
    }
  });
  it("rejects unknown tools and invalid input without running anything", async () => {
    expect((await runTool("adminPurgeOrder", {}, ctx())).isError).toBe(true);
    expect((await runTool("get_order", { order: "" }, ctx())).isError).toBe(true);
    expect(orderFindFirst).not.toHaveBeenCalled();
  });
  it("a failing lookup comes back as an error result, never a throw", async () => {
    orderFindFirst.mockRejectedValue(new Error("db down"));
    const r = await runTool("get_order", { order: "ORD-0001" }, ctx());
    expect(r.isError).toBe(true);
  });
});

describe("handoff and strikes", () => {
  it("escalate_to_human records the handoff to Sofie and e-mails her", async () => {
    orderFindFirst.mockResolvedValue({ id: "o1" });
    escCreate.mockResolvedValue({ id: "h1" });
    sendEmail.mockResolvedValue({ sent: true });
    const c = ctx();
    const r = await runTool(
      "escalate_to_human",
      { summary: "Void order 2609 at Unifi", reason: "needs a portal action", orderRef: "ORD-0275" },
      c,
    );
    expect(r.isError).toBe(false);
    expect(escCreate.mock.calls[0][0].data).toMatchObject({ assignee: "Sofie", conversationId: "c1", orderRef: "ORD-0275" });
    expect(sendEmail.mock.calls[0][0].to).toBe("sofie@example.com");
    expect(escUpdate).toHaveBeenCalledWith({ where: { id: "h1" }, data: { emailed: true } });
    expect(c.events.escalationId).toBe("h1");
  });
  it("with no handoff address the row is still recorded and nothing is sent", async () => {
    escCreate.mockResolvedValue({ id: "h2" });
    const c = { ...ctx(), handoffEmail: "" };
    const r = await runTool("escalate_to_human", { summary: "Please look at this", reason: "unclear" }, c);
    expect(JSON.parse(r.content)).toMatchObject({ recorded: true, emailed: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it("the third off-topic strike locks the conversation", async () => {
    convFindUnique.mockResolvedValue({ strikes: 2 });
    const c = ctx();
    await runTool("flag_off_topic", { reason: "asked for a poem" }, c);
    const data = convUpdate.mock.calls[0][0].data;
    expect(data.strikes).toBe(3);
    expect(data.lockedUntil).toBeInstanceOf(Date);
    expect(c.events.locked).toBe(true);
  });
});

describe("the system prompt", () => {
  it("is byte-identical between calls, so it caches", () => {
    expect(systemPrompt("Sofie")).toBe(systemPrompt("Sofie"));
    expect(systemPrompt("Sofie")).toContain("Sofie");
    expect(systemPrompt("Sofie")).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it("the date block is Malaysia time", () => {
    expect(dateBlock(new Date("2026-09-30T20:30:00Z"))).toContain("2026-10-01 04:30");
  });
});

describe("API error shown to the admin", async () => {
  const { describeApiError } = await import("@/lib/admin-chat/api-error");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;

  it("names the API's own reason and request id, not just the status", () => {
    const e = Anthropic.APIError.generate(
      400,
      { type: "error", error: { type: "invalid_request_error", message: "fallbacks: Extra inputs are not permitted" } },
      undefined,
      new Headers({ "request-id": "req_011abc" }),
    );
    expect(e).toBeInstanceOf(Anthropic.BadRequestError);
    expect(describeApiError(e)).toBe(
      "The AI service refused the request (400): fallbacks: Extra inputs are not permitted Request req_011abc.",
    );
  });

  it("still says something when the body carries no message", () => {
    expect(describeApiError({ status: 500 })).toBe("The AI service refused the request (500).");
    expect(describeApiError({})).toBe("The AI service refused the request.");
  });

  it("caps a very long reason", () => {
    const long = "x".repeat(900);
    const out = describeApiError({ status: 400, error: { error: { message: long } } });
    expect(out.length).toBeLessThan(460);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("the API key as read from the environment", async () => {
  const { cleanApiKey, apiKeyProblem } = await import("@/lib/admin-chat/config");
  const { describeApiError } = await import("@/lib/admin-chat/api-error");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;

  it("strips the whitespace and quotes a paste adds", () => {
    expect(cleanApiKey('  "sk-ant-api03-abc"\n')).toBe("sk-ant-api03-abc");
    expect(cleanApiKey("'sk-ant-api03-abc'")).toBe("sk-ant-api03-abc");
    expect(cleanApiKey(undefined)).toBe("");
    // A quote on one side only is not a pair; left for the API to reject.
    expect(cleanApiKey('"sk-ant-api03-abc')).toBe('"sk-ant-api03-abc');
  });

  it("refuses the two wrong kinds of key by prefix, never echoing the key", () => {
    expect(apiKeyProblem("")).toMatch(/not set/);
    const admin = apiKeyProblem("sk-ant-admin01-SECRETPART");
    expect(admin).toMatch(/Admin API key/);
    expect(admin).not.toContain("SECRETPART");
    expect(apiKeyProblem("sk-ant-oat01-SECRETPART")).toMatch(/OAuth token/);
    expect(apiKeyProblem("sk-ant-api03-abc")).toBeNull();
    expect(apiKeyProblem("some-future-format")).toBeNull();
  });

  it("a 401 names the API's reason", () => {
    const e = Anthropic.APIError.generate(
      401,
      { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
      undefined,
      new Headers({ "request-id": "req_401" }),
    );
    expect(e).toBeInstanceOf(Anthropic.AuthenticationError);
    expect(describeApiError(e)).toBe("The AI service refused the request (401): invalid x-api-key Request req_401.");
  });
});

describe("the image pools tool", () => {
  it("reports both pools with their counts, pages and uses", async () => {
    umobileCount.mockResolvedValue(52);
    umobileFind.mockResolvedValue([{ filename: "modem.jpg", createdAt: new Date("2026-09-30T01:00:00Z") }]);
    landlordCount.mockResolvedValue(0);
    landlordFind.mockResolvedValue([]);
    const r = await runTool("list_image_pools", {}, ctx());
    expect(r.isError).toBe(false);
    const out = JSON.parse(r.content);
    expect(out.pools.map((p: { pool: string; total: number; page: string }) => [p.pool, p.total, p.page])).toEqual([
      ["Umobile Image", 52, "/admin/umobile-image"],
      ["Landlord Signature", 0, "/admin/landlord-signature"],
    ]);
    expect(out.pools[0].newest[0].filename).toBe("modem.jpg");
  });
  it("reads only the pool asked for", async () => {
    umobileCount.mockResolvedValue(1);
    umobileFind.mockResolvedValue([]);
    await runTool("list_image_pools", { pool: "umobile" }, ctx());
    expect(landlordCount).not.toHaveBeenCalled();
  });
});

describe("admin-edited settings", () => {
  const known = CHAT_TOOLS.map((t) => ({ name: t.name, description: t.description }));

  it("nothing saved gives exactly the built-in prompt", () => {
    expect(systemPrompt("Sofie", null)).toBe(systemPrompt("Sofie"));
    expect(systemPrompt("Sofie", "   ")).toBe(systemPrompt("Sofie"));
  });
  it("custom instructions replace the default, fill the handoff name, and keep the fixed parts", () => {
    const p = systemPrompt("Sofie", "You answer about orders only. Hand off to {{handoff_name}} when stuck, please.");
    expect(p).toContain("Hand off to Sofie when stuck");
    expect(p).not.toContain("{{handoff_name}}");
    expect(p).not.toContain(DEFAULT_INSTRUCTIONS.slice(0, 60));
    expect(p).toContain(SAFETY_BLOCK);
    expect(p).toContain("Order statuses (stored value → label)");
  });
  it("the default instructions cover the image pools", () => {
    expect(systemPrompt("Sofie")).toContain("/admin/umobile-image");
  });
  it("a disabled tool is not offered and cannot run", async () => {
    const defs = toolDefinitions({ disabledTools: ["get_order"], toolDescriptions: {} });
    expect(defs.map((d) => d.name)).not.toContain("get_order");
    expect(defs).toHaveLength(CHAT_TOOLS.length - 1);
    const r = await runTool("get_order", { order: "ORD-0001" }, ctx(), ["get_order"]);
    expect(r.isError).toBe(true);
    expect(orderFindFirst).not.toHaveBeenCalled();
  });
  it("a saved description replaces the built-in one; the schema is untouched", () => {
    const before = toolDefinitions().find((d) => d.name === "list_plans")!;
    const after = toolDefinitions({ disabledTools: [], toolDescriptions: { list_plans: "Plans and their offers, custom." } })
      .find((d) => d.name === "list_plans")!;
    expect(after.description).toBe("Plans and their offers, custom.");
    expect(after.input_schema).toEqual(before.input_schema);
  });
  it("saving the defaults stores nothing, so it is the same as never saving", () => {
    const res = normalizeChatSettings(
      {
        instructions: DEFAULT_INSTRUCTIONS + "\n",
        disabledTools: [],
        toolDescriptions: Object.fromEntries(known.map((t) => [t.name, t.description])),
      },
      known,
      DEFAULT_INSTRUCTIONS,
    );
    expect(res).toEqual({ ok: true, settings: { instructions: null, disabledTools: [], toolDescriptions: {} } });
  });
  it("refuses unknown tools, a gutted prompt and a too-short description", () => {
    expect(normalizeChatSettings({ instructions: null, disabledTools: ["adminPurge"], toolDescriptions: {} }, known, DEFAULT_INSTRUCTIONS).ok).toBe(false);
    expect(normalizeChatSettings({ instructions: "be nice", disabledTools: [], toolDescriptions: {} }, known, DEFAULT_INSTRUCTIONS).ok).toBe(false);
    expect(normalizeChatSettings({ instructions: null, disabledTools: [], toolDescriptions: { get_order: "short" } }, known, DEFAULT_INSTRUCTIONS).ok).toBe(false);
    expect(normalizeChatSettings({ instructions: null, disabledTools: [], toolDescriptions: { nope: "a long enough description here" } }, known, DEFAULT_INSTRUCTIONS).ok).toBe(false);
  });
  it("warns when the instructions name a switched-off tool, by whole word", () => {
    expect(disabledToolsNamedIn(DEFAULT_INSTRUCTIONS, ["flag_off_topic", "live_jobs"])).toEqual(["flag_off_topic"]);
  });
  it("a malformed row reads as defaults rather than throwing", () => {
    expect(chatSettingsFromRow({ instructions: "", disabledTools: ["live_jobs"], toolDescriptions: [1, 2] })).toEqual({
      instructions: null,
      disabledTools: ["live_jobs"],
      toolDescriptions: {},
    });
  });
});
