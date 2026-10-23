import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { chatUpdates, parseWebhook } from "@/lib/whatsapp-store";
import {
  applyClassification,
  classificationSchema,
  classifyPrompt,
  maskSensitive,
  parseClassification,
  type CurrentCrm,
} from "@/lib/whatsapp-crm";
import { matchesFilter, summaryInTab, type ChatSummary, type Label } from "@/lib/whatsapp-inbox";

function body(field: string, value: Record<string, unknown>) {
  return { object: "whatsapp_business_account", entry: [{ changes: [{ field, value }] }] };
}

describe("parseWebhook", () => {
  it("keeps every message in a batch, with its source, name and media", () => {
    const parsed = parseWebhook(body("history", {
      messages: [
        { from: "60111222333", id: "H1", timestamp: "1760000000", type: "text", text: { body: "price?" } },
        { from: "60111222333", id: "H2", timestamp: "1760000100", type: "image", image: { caption: "my bill" } },
      ],
      message_echoes: [{ from: "60100000000", to: "60111222333", id: "H3", timestamp: "1760000200", type: "text", text: { body: "RM129" } }],
      contacts: [{ wa_id: "60111222333", profile: { name: "  Ali  " } }],
    }));
    expect(parsed.messages.map((m) => [m.messageId, m.fromMe, m.source, m.text])).toEqual([
      ["H1", false, "history", "price?"],
      ["H2", false, "history", "Image · my bill"],
      ["H3", true, "history", "RM129"],
    ]);
    expect(parsed.messages[1].media).toBeNull();
    expect(parsed.names.get("60111222333")).toBe("Ali");
  });

  it("labels BizzFlow sends and keeps inbound media ids", () => {
    const sent = parseWebhook(body("api_send", { message_echoes: [{ to: "60111222333", id: "S1", timestamp: "1", type: "text", text: { body: "hi" } }] }));
    expect(sent.messages[0]).toMatchObject({ source: "bizzflow", fromMe: true, waId: "60111222333" });
    const live = parseWebhook(body("messages", { messages: [{ from: "60111222333", id: "I1", timestamp: "1", type: "image", image: { id: "I1", mime_type: "image/jpeg" } }] }));
    expect(live.messages[0]).toMatchObject({ source: "live", media: { id: "I1", kind: "image", mime: "image/jpeg" } });
  });

  it("reads statuses and ignores junk", () => {
    const parsed = parseWebhook(body("statuses", {
      statuses: [
        { id: "S1", status: "read" },
        { id: "S2", status: "failed", errors: [{ title: "Not on WhatsApp" }] },
        { id: "S3", status: "weird" },
      ],
    }));
    expect(parsed.statuses).toEqual([
      { id: "S1", status: "read", error: null },
      { id: "S2", status: "failed", error: "Not on WhatsApp" },
    ]);
    expect(parseWebhook(null).messages).toEqual([]);
    expect(parseWebhook({ entry: "x" }).messages).toEqual([]);
  });
});

describe("chatUpdates", () => {
  it("one summary per chat: newest preview, newest inbound, history counted as read", () => {
    const updates = chatUpdates(parseWebhook(body("history", {
      messages: [
        { from: "60111222333", id: "A", timestamp: "200", type: "text", text: { body: "second" } },
        { from: "60111222333", id: "B", timestamp: "100", type: "text", text: { body: "first" } },
        { from: "60999888777", id: "C", timestamp: "50", type: "text", text: { body: "other" } },
      ],
      message_echoes: [{ to: "60111222333", id: "D", timestamp: "300", type: "text", text: { body: "reply" } }],
    })));
    const ali = updates.find((u) => u.waId === "60111222333");
    expect(ali).toMatchObject({ preview: "reply", lastMessageAt: new Date(300_000), lastInboundAt: new Date(200_000), readUpTo: new Date(200_000) });
    expect(updates).toHaveLength(2);
  });

  it("live messages do not mark anything read", () => {
    const [u] = chatUpdates(parseWebhook(body("messages", { messages: [{ from: "60111222333", id: "A", timestamp: "1", type: "text", text: { body: "hi" } }] })));
    expect(u.readUpTo).toBeNull();
  });
});

const LABELS: Label[] = [
  { id: "s1", kind: "stage", name: "New", description: "", color: "gray", sort: 0 },
  { id: "s2", kind: "stage", name: "Interested", description: "Asked about price", color: "blue", sort: 1 },
  { id: "f1", kind: "folder", name: "Home Fibre", description: "", color: "blue", sort: 0 },
  { id: "t1", kind: "tag", name: "Price question", description: "", color: "blue", sort: 0 },
  { id: "t2", kind: "tag", name: "Complaint", description: "", color: "red", sort: 1 },
];

const EMPTY: CurrentCrm = { stageId: null, folderId: null, tagIds: [], stageBy: null, folderBy: null, tagsBy: null };

describe("classification", () => {
  it("maps names to ids and marks them AI-set", () => {
    const patch = applyClassification({ stage: "Interested", folder: "Home Fibre", tags: ["Price question", "Price question"], reason: "Asked for RM129 plan.", intent: " Wants 300Mbps price ", signupChance: 72.4 }, LABELS, EMPTY);
    expect(patch).toEqual({ aiReason: "Asked for RM129 plan.", stageId: "s2", stageBy: "ai", folderId: "f1", folderBy: "ai", tagIds: ["t1"], tagsBy: "ai", intent: "Wants 300Mbps price", signupChance: 72, insightBy: "ai" });
  });

  it("never touches a field an admin set", () => {
    const patch = applyClassification(
      { stage: "New", folder: "Home Fibre", tags: ["Complaint"], reason: "x", intent: "y", signupChance: 150 },
      LABELS,
      { stageId: "s2", folderId: null, tagIds: ["t1"], stageBy: "admin", folderBy: null, tagsBy: "admin", insightBy: "admin" },
    );
    expect(patch).toEqual({ aiReason: "x", folderId: "f1", folderBy: "ai" });
  });

  it("drops invented names and does not clear on an empty answer", () => {
    const patch = applyClassification(
      { stage: "VIP", folder: "", tags: ["Made up"], reason: "", intent: "", signupChance: 150 },
      LABELS,
      { ...EMPTY, stageId: "s1", stageBy: "ai", tagIds: ["t2"], tagsBy: "ai" },
    );
    expect(patch).toEqual({ aiReason: null, intent: null, signupChance: 100, insightBy: "ai" });
  });

  it("schema enums are the admin's lists", () => {
    const schema = classificationSchema(LABELS) as { properties: Record<string, { enum?: string[]; items?: { enum: string[] } }> };
    expect(schema.properties.stage.enum).toEqual(["", "New", "Interested"]);
    expect(schema.properties.tags.items?.enum).toEqual(["Price question", "Complaint"]);
    expect((classificationSchema([]) as typeof schema).properties.tags.items?.enum).toEqual([""]);
  });

  it("masks IC and passport numbers before the text leaves BizzFlow", () => {
    expect(maskSensitive("IC 900101-14-5678 and 900101145678, passport A12345678, phone 0123456789"))
      .toBe("IC [ID] and [ID], passport [ID], phone 0123456789");
    const prompt = classifyPrompt(LABELS, [{ fromMe: false, text: "my ic 900101-14-5678", at: new Date(0) }], { ...EMPTY, stageId: "s2" });
    expect(prompt).not.toContain("900101");
    expect(prompt).toContain("Customer: my ic [ID]");
    expect(prompt).toContain("stage=Interested");
    expect(prompt).toContain("- Interested: Asked about price");
  });

  it("parses the model's JSON defensively", () => {
    expect(parseClassification('{"stage":"New","folder":"","tags":["a",1],"reason":"r","intent":"i","signup_chance":40}'))
      .toEqual({ stage: "New", folder: "", tags: ["a"], reason: "r", intent: "i", signupChance: 40 });
    expect(parseClassification('{"stage":"New","signup_chance":"high"}')?.signupChance).toBe(0);
    expect(parseClassification("not json")).toBeNull();
  });
});

describe("chat list filters", () => {
  const chat: ChatSummary = {
    customer: "60111222333", name: null, lastAt: "2026-10-20T00:00:00Z", preview: "", lastInboundAt: "2026-10-20T00:00:00Z",
    unread: 2, closedAt: null, lastReadAt: null, stageId: "s2", folderId: "f1", tagIds: ["t1"],
    stageBy: "ai", folderBy: "ai", tagsBy: "ai", aiReason: null,
  };
  it("folder, stage and tag narrow the list", () => {
    expect(matchesFilter(chat, { folderId: "f1", stageId: "s2", tagId: "t1" })).toBe(true);
    expect(matchesFilter(chat, { folderId: null, stageId: "s1", tagId: null })).toBe(false);
    expect(matchesFilter(chat, { folderId: null, stageId: null, tagId: "t2" })).toBe(false);
  });
  it("tabs use the server's unread count and the closed rule", () => {
    expect(summaryInTab(chat, "unread")).toBe(true);
    expect(summaryInTab({ ...chat, closedAt: "2026-10-21T00:00:00Z" }, "closed")).toBe(true);
    expect(summaryInTab({ ...chat, closedAt: "2026-10-19T00:00:00Z" }, "open")).toBe(true);
  });
});
