/**
 * The admin topbar's title and back target.
 *
 * On mobile this strip is the only navigation on screen — the sidebar is a
 * hidden drawer — so a wrong back target does not merely look untidy, it
 * strands whoever pressed it.
 */
import { describe, it, expect } from "vitest";
import { adminNavContext } from "@/lib/admin-nav";

describe("top-level sections", () => {
  it("names the page and offers the drawer, not a back button", () => {
    expect(adminNavContext("/admin")).toEqual({ title: "Users", back: null });
    expect(adminNavContext("/admin/orders")).toEqual({ title: "Orders", back: null });
    expect(adminNavContext("/admin/plans")).toEqual({ title: "Plan Settings", back: null });
  });

  it("is not confused by a trailing slash", () => {
    expect(adminNavContext("/admin/orders/")).toEqual({ title: "Orders", back: null });
    expect(adminNavContext("/admin/")).toEqual({ title: "Users", back: null });
  });
});

describe("detail pages", () => {
  it("sends an order back to the orders list", () => {
    expect(adminNavContext("/admin/orders/cmt2n3sgx00026hot")).toEqual({
      title: "Order", back: "/admin/orders",
    });
  });

  it("sends an agent back to Users, where agents are listed", () => {
    // There is no /admin/agents index — Users is the list.
    expect(adminNavContext("/admin/agents/cmno2x3sf0000")).toEqual({
      title: "Agent", back: "/admin",
    });
  });
});

describe("routes nobody has mapped", () => {
  it("falls back to the drawer rather than guessing a back target", () => {
    // A guessed back button silently sends you somewhere unrelated, which is
    // worse than not offering one.
    expect(adminNavContext("/admin/something-new")).toEqual({
      title: "Administration", back: null,
    });
  });

  it("keeps the section name for a deeper page under a known section", () => {
    expect(adminNavContext("/admin/plans/anything")).toEqual({
      title: "Plan Settings", back: null,
    });
  });

  it("never lets /admin shadow a longer section path", () => {
    expect(adminNavContext("/admin/orders").title).toBe("Orders");
    expect(adminNavContext("/admin/plans").title).toBe("Plan Settings");
  });
});
