/**
 * The duplicate-IC hint's lookup — the rules are scoping and forgiveness of
 * punctuation, both places where a wrong answer looks like a right one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const auth = vi.fn();

vi.mock("@/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findMany: (...a: unknown[]) => findMany(...a) },
    user: { findUnique: vi.fn() },
  },
}));

const { ordersForIc } = await import("@/actions/order");

const rows = [
  { id: "a", idNumber: "940811034224", userId: "me", reference: "ORD-0042", status: "submitted" },
  { id: "b", idNumber: "940811-03-4224", userId: "me", reference: "ORD-0051", status: "draft" },
  { id: "c", idNumber: "940811034224", userId: "someone-else", reference: "ORD-0007", status: "failed" },
  { id: "d", idNumber: "999999999999", userId: "me", reference: "ORD-0001", status: "draft" },
];

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "me" } });
  findMany.mockResolvedValue(rows);
});

describe("ordersForIc", () => {
  it("matches separator-insensitively on BOTH sides", async () => {
    const res = await ordersForIc("940811-03-4224");
    expect(res.mine.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  it("names only MY orders and counts the others", async () => {
    // Another agent's customer list is not mine to browse; the count says
    // "someone else is already working this IC" without handing me their book.
    const res = await ordersForIc("940811034224");
    expect(res.mine.every((m) => ["a", "b"].includes(m.id))).toBe(true);
    expect(res.othersCount).toBe(1);
    expect(JSON.stringify(res)).not.toContain("ORD-0007");
  });

  it("excludes the order being edited or cloned", async () => {
    await ordersForIc("940811034224", "a");
    expect(findMany.mock.calls[0][0].where.id).toEqual({ not: "a" });
  });

  it("answers empty for a blank or punctuation-only IC", async () => {
    expect((await ordersForIc("")).mine).toEqual([]);
    expect((await ordersForIc("--")).mine).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("only sees ACTIVE orders — a deleted order is not a duplicate", async () => {
    await ordersForIc("940811034224");
    expect(findMany.mock.calls[0][0].where.deletedAt).toBeNull();
  });
});
