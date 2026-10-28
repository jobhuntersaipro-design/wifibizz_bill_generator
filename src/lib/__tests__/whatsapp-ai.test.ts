import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  conversation: null as Record<string, unknown> | null,
  trigger: null as Record<string, unknown> | null,
  newer: 0,
  settings: null as Record<string, unknown> | null,
  updates: [] as unknown[],
  alerts: [] as unknown[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappConversation: {
      findUnique: vi.fn(async () => db.conversation),
      update: vi.fn(async (args: unknown) => { db.updates.push(args); }),
    },
    whatsappMessage: {
      findUnique: vi.fn(async () => db.trigger),
      count: vi.fn(async () => db.newer),
      findMany: vi.fn(async () => []),
    },
    whatsappCrmSettings: { findUnique: vi.fn(async () => db.settings) },
    whatsappAlert: { create: vi.fn(async (args: unknown) => { db.alerts.push(args); }) },
  },
}));

const sent = vi.hoisted(() => [] as { to: string; text: string }[]);
vi.mock("@/lib/dualhook", async (orig) => ({
  ...(await orig<typeof import("@/lib/dualhook")>()),
  dualhookConfig: () => ({ base: "https://x", key: "k", phoneNumberId: "P1" }),
  dualhookSendText: vi.fn(async (_c: unknown, to: string, text: string) => {
    sent.push({ to, text });
    return { ok: true, wamid: `wamid.${sent.length}` };
  }),
}));
vi.mock("@/lib/whatsapp-events", () => ({ appendApiSend: vi.fn(async () => {}) }));

import { autoReply, DOCS_ACK, isHandoffMessage, knowledgeBlock, replyTranscript } from "@/lib/whatsapp-ai";
import { windowOpen } from "@/lib/dualhook-window";
import { retentionCutoff } from "@/lib/whatsapp-retention";
import { mediaOf } from "@/lib/whatsapp-inbox";

const NOW = new Date();

beforeEach(() => {
  db.conversation = { waId: "60123456789", name: "Ali", aiEnabled: true, lastInboundAt: NOW };
  db.trigger = { messageId: "m1", waId: "60123456789", fromMe: false, type: "image", sentAt: NOW };
  db.newer = 0;
  db.settings = null;
  db.updates = [];
  db.alerts = [];
  sent.length = 0;
});

describe("24-hour window", () => {
  it("is open under 24h and closed after", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    expect(windowOpen(new Date("2026-10-27T12:00:01Z"), now)).toBe(true);
    expect(windowOpen(new Date("2026-10-27T12:00:00Z"), now)).toBe(false);
    expect(windowOpen(null, now)).toBe(false);
  });
});

describe("retention", () => {
  it("cuts off 3 months back", () => {
    expect(retentionCutoff(new Date("2026-10-28T03:00:00Z")).toISOString()).toBe("2026-07-28T03:00:00.000Z");
  });
});

describe("reply helpers", () => {
  it("treats images and documents as a handoff", () => {
    expect(isHandoffMessage("image")).toBe(true);
    expect(isHandoffMessage("document")).toBe(true);
    expect(isHandoffMessage("text")).toBe(false);
    expect(isHandoffMessage("audio")).toBe(false);
  });

  it("masks IC numbers in the transcript", () => {
    const text = replyTranscript([{ fromMe: false, text: "my ic 900101-14-5678", at: new Date("2026-10-28T01:00:00Z") }]);
    expect(text).toContain("Customer: my ic [ID]");
    expect(text).not.toContain("5678");
  });

  it("sends a PDF as a base64 document and text as a text document", () => {
    expect(knowledgeBlock({ name: "a.pdf", mime: "application/pdf", data: "QUJD" }).source).toEqual({ type: "base64", media_type: "application/pdf", data: "QUJD" });
    expect(knowledgeBlock({ name: null, mime: "text/plain", data: "x" }).source.type).toBe("text");
  });

  it("reads audio as playable media", () => {
    expect(mediaOf({ type: "audio", audio: { id: "A1", mime_type: "audio/ogg" } })).toEqual({ id: "A1", kind: "audio", mime: "audio/ogg" });
  });
});

describe("autoReply", () => {
  it("acknowledges documents once, pauses and alerts the team (AC8)", async () => {
    expect(await autoReply("60123456789", "m1")).toBe("handoff");
    expect(sent).toEqual([{ to: "60123456789", text: DOCS_ACK }]);
    expect(db.updates).toHaveLength(1);
    expect(JSON.stringify(db.updates[0])).toContain('"aiPausedReason":"documents"');
    expect(db.alerts).toHaveLength(1);
  });

  it("stays silent when the AI is off for the chat (AC9)", async () => {
    db.conversation = { ...db.conversation, aiEnabled: false };
    expect(await autoReply("60123456789", "m1")).toBe("skipped");
    expect(sent).toHaveLength(0);
  });

  it("never sends outside the 24-hour window", async () => {
    db.conversation = { ...db.conversation, lastInboundAt: new Date(Date.now() - 25 * 3600_000) };
    expect(await autoReply("60123456789", "m1")).toBe("skipped");
    expect(sent).toHaveLength(0);
  });

  it("skips a message that is no longer the newest", async () => {
    db.newer = 1;
    expect(await autoReply("60123456789", "m1")).toBe("skipped");
    expect(sent).toHaveLength(0);
  });

  it("does not answer text without a knowledge document", async () => {
    db.trigger = { ...db.trigger, type: "text" };
    expect(await autoReply("60123456789", "m1")).toBe("skipped");
    expect(sent).toHaveLength(0);
  });
});
