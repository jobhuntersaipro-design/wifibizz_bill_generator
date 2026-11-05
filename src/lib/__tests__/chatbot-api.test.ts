import { afterEach, describe, expect, it, vi } from "vitest";

const orderCreate = vi.fn(async (..._a: unknown[]) => ({ id: "o1", reference: "ORD-0100" }));
const orderFind = vi.fn();
const orderUpdate = vi.fn(async (..._a: unknown[]) => ({}));
const userFind = vi.fn();
const upload = vi.fn(async (..._a: unknown[]) => undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { create: (...a: unknown[]) => orderCreate(...a), findFirst: (...a: unknown[]) => orderFind(...a), update: (...a: unknown[]) => orderUpdate(...a) },
    user: { findUnique: (...a: unknown[]) => userFind(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("@/lib/order-history", () => ({ nextOrderReference: async () => "ORD-0100" }));
vi.mock("@/lib/r2", () => ({ uploadToR2: (...a: unknown[]) => upload(...a) }));

import { attachChatDocument, createChatDraft, refuseCaller } from "@/lib/chatbot-api";

const req = (auth?: string) => new Request("https://x/api/chatbot/accounts", { headers: auth ? { authorization: auth } : {} });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("refuseCaller", () => {
  it("is off without a secret", () => {
    vi.stubEnv("CHATBOT_API_SECRET", "");
    expect(refuseCaller(req("Bearer x"))?.status).toBe(503);
  });
  it("refuses a wrong or missing token", () => {
    vi.stubEnv("CHATBOT_API_SECRET", "s3cret");
    expect(refuseCaller(req())?.status).toBe(401);
    expect(refuseCaller(req("Bearer nope"))?.status).toBe(401);
  });
  it("lets the right token in", () => {
    vi.stubEnv("CHATBOT_API_SECRET", "s3cret");
    expect(refuseCaller(req("Bearer s3cret"))).toBeNull();
  });
});

describe("createChatDraft", () => {
  it("refuses an account without Order Entry", async () => {
    userFind.mockResolvedValueOnce({ id: "u1", email: "a@b", orderEntryEnabled: false });
    const res = await createChatDraft({ accountId: "u1", waId: "60123456789", name: "x" });
    expect(res.ok).toBe(false);
    expect(orderCreate).not.toHaveBeenCalled();
  });
  it("splits a Malaysian number and uppercases the name", async () => {
    userFind.mockResolvedValueOnce({ id: "u1", email: "a@b", orderEntryEnabled: true });
    const res = await createChatDraft({ accountId: "u1", waId: "60123456789", name: " ali bin abu " });
    expect(res).toEqual({ ok: true, data: { id: "o1", reference: "ORD-0100", email: "a@b" } });
    const data = (orderCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ userId: "u1", status: "draft", fullName: "ALI BIN ABU", mobilePrefix: "60", mobile: "123456789", remarks: "From WhatsApp +60123456789" });
  });
});

describe("attachChatDocument", () => {
  const draft = { id: "o1", userId: "u1", status: "draft", mobile: "123456789", mobilePrefix: "60", remarks: "From WhatsApp +60123456789", documents: [] };
  it("refuses other file types", async () => {
    expect((await attachChatDocument("o1", "text/html", Buffer.from("x"))).ok).toBe(false);
  });
  it("refuses an order that did not come from WhatsApp", async () => {
    orderFind.mockResolvedValueOnce({ ...draft, remarks: "manual" });
    const res = await attachChatDocument("o1", "image/png", Buffer.from("x"));
    expect(res).toMatchObject({ ok: false, status: 404 });
    expect(upload).not.toHaveBeenCalled();
  });
  it("uploads and appends the document", async () => {
    orderFind.mockResolvedValueOnce(draft);
    const res = await attachChatDocument("o1", "image/png", Buffer.from("x"));
    expect(res.ok).toBe(true);
    const docs = (orderUpdate.mock.calls[0][0] as { data: { documents: { filename: string; key: string }[] } }).data.documents;
    expect(docs).toHaveLength(1);
    expect(docs[0].filename).toBe("whatsapp_1.png");
    expect(docs[0].key).toMatch(/^orders\/u1\/60123456789_whatsapp_1-[0-9a-f]{6}\/whatsapp_1\.png$/);
  });
});
