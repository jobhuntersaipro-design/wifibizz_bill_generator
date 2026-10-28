import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { screenDualhookBody, secretMatches } from "@/lib/dualhook-webhook";
import { parseWebhook } from "@/lib/whatsapp-store";

const ENV = { wabaId: "WABA1", phoneNumberId: "PN1" };

function body(changes: unknown[], wabaId = "WABA1") {
  return { object: "whatsapp_business_account", entry: [{ id: wabaId, changes }] };
}

const inbound = {
  field: "messages",
  value: {
    metadata: { phone_number_id: "PN1" },
    contacts: [{ wa_id: "60123456789", profile: { name: "Ali" } }],
    messages: [{ from: "60123456789", id: "wamid.1", timestamp: "1793000000", type: "text", text: { body: "hi" } }],
  },
};

describe("screenDualhookBody", () => {
  it("keeps a good message body", () => {
    const r = screenDualhookBody(body([inbound]), ENV);
    expect(r.ok && r.kept).toBe(1);
  });

  it("rejects a wrong WABA id", () => {
    expect(screenDualhookBody(body([inbound], "OTHER"), ENV)).toEqual({ ok: false, reason: "waba_mismatch" });
  });

  it("rejects a wrong phone_number_id, even beside a good change", () => {
    const bad = { field: "messages", value: { metadata: { phone_number_id: "PN2" }, messages: [] } };
    expect(screenDualhookBody(body([inbound, bad]), ENV)).toEqual({ ok: false, reason: "phone_mismatch" });
  });

  it("rejects messages with no phone_number_id", () => {
    expect(screenDualhookBody(body([{ field: "messages", value: {} }]), ENV).ok).toBe(false);
  });

  it("rejects a wrong object and fails closed when env is missing", () => {
    expect(screenDualhookBody({ ...body([inbound]), object: "page" }, ENV).ok).toBe(false);
    expect(screenDualhookBody(body([inbound]), { wabaId: "WABA1", phoneNumberId: "" })).toEqual({
      ok: false,
      reason: "env_missing",
    });
  });

  it("drops an unknown field and names it", () => {
    const r = screenDualhookBody(body([{ field: "account_update", value: {} }, inbound]), ENV);
    expect(r.ok && r.dropped).toEqual(["account_update"]);
    expect(r.ok && r.kept).toBe(1);
  });
});

describe("secretMatches", () => {
  it("never matches an unset secret", () => {
    expect(secretMatches("", undefined)).toBe(false);
    expect(secretMatches("abc", "abc")).toBe(true);
    expect(secretMatches("abd", "abc")).toBe(false);
  });
});

describe("parseWebhook with Coexistence shapes", () => {
  it("reads history threads, both directions", () => {
    const parsed = parseWebhook(
      body([
        {
          field: "history",
          value: {
            history: [
              {
                threads: [
                  {
                    id: "60123456789",
                    messages: [
                      { from: "60123456789", id: "h1", timestamp: "1793000000", type: "text", text: { body: "hello" } },
                      { from: "60111111111", id: "h2", timestamp: "1793000060", type: "text", text: { body: "hi there" } },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ]),
    );
    expect(parsed.messages.map((m) => [m.messageId, m.waId, m.fromMe, m.source])).toEqual([
      ["h1", "60123456789", false, "history"],
      ["h2", "60123456789", true, "history"],
    ]);
  });

  it("reads a phone-app echo as from me", () => {
    const parsed = parseWebhook(
      body([
        {
          field: "smb_message_echoes",
          value: {
            message_echoes: [{ from: "60111111111", to: "60123456789", id: "e1", timestamp: "1793000000", type: "text", text: { body: "ok" } }],
          },
        },
      ]),
    );
    expect(parsed.messages[0]).toMatchObject({ messageId: "e1", waId: "60123456789", fromMe: true });
  });

  it("reads contact sync names", () => {
    const parsed = parseWebhook(
      body([
        {
          field: "smb_app_state_sync",
          value: { state_sync: [{ type: "contact", action: "add", contact: { full_name: "Siti", phone_number: "+60 12-345 6789" } }] },
        },
      ]),
    );
    expect(parsed.names.get("60123456789")).toBe("Siti");
  });
});
