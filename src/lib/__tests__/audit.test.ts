/**
 * The audit trail's two safety properties.
 *
 * Everything else about it is a plain insert; these two are the rules whose
 * violation would be invisible until it mattered: a secret in the trail, or an
 * admin action failing because the trail was down.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { adminAuditLog: { create: (...a: unknown[]) => create(...a), findMany: (...a: unknown[]) => findMany(...a) } },
}));

const { recordAudit, listAudit, ADMIN_ACTOR } = await import("@/lib/audit");

beforeEach(() => vi.clearAllMocks());

describe("recordAudit", () => {
  it("writes the row it was given", async () => {
    create.mockResolvedValue({});
    await recordAudit({ actor: ADMIN_ACTOR, action: "order_entry_enabled", targetUser: "u1" });
    expect(create.mock.calls[0][0].data).toMatchObject({
      actor: "admin", action: "order_entry_enabled", targetUser: "u1",
      targetOrder: null, detail: null,
    });
  });

  it("NEVER throws — an audit outage must not take the action down", async () => {
    create.mockRejectedValue(new Error("table on fire"));
    await expect(
      recordAudit({ actor: ADMIN_ACTOR, action: "user_deleted", targetUser: "u1" }),
    ).resolves.toBeUndefined();
  });
});

describe("what reaches the trail from a password change", () => {
  it("admin-users writes the field NAME, never the value", async () => {
    // Pinned at the source: the updateUser hook maps password -> the word, and
    // drops passwordRaw entirely rather than naming a second secret store.
    const src = (await import("fs")).readFileSync("src/actions/admin-users.ts", "utf8");
    const hook = src.slice(src.indexOf("Which fields changed"), src.indexOf("user_updated") + 400);
    expect(hook).toContain('k === "passwordRaw" ? null');
    expect(hook).not.toContain("data.password");
  });
});

describe("listAudit", () => {
  it("reads newest first and caps the page", async () => {
    findMany.mockResolvedValue([]);
    await listAudit(20);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      orderBy: { createdAt: "desc" }, take: 20,
    });
  });
});
