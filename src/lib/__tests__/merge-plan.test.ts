import { describe, it, expect } from "vitest";
import {
  buildMergeItems,
  pendingGenerationTypes,
  generationCreditCost,
  reconcileMergeItems,
  moveMergeItem,
  mergeItemUrl,
  type MergeCase,
  type MergeItem,
} from "@/lib/bill-generator/merge-plan";

function caseRow(overrides: Partial<MergeCase> = {}): MergeCase {
  return {
    case_no: "202624115",
    full_name: "MUHAMMAD SAHINU BIN INSANU",
    id_no: "970815125312",
    internet_bill_url: "https://r2/internet.pdf",
    utility_bill_url: "https://r2/utility.pdf",
    ...overrides,
  };
}

describe("buildMergeItems", () => {
  it("groups a case's documents together, in selection order", () => {
    const items = buildMergeItems(
      [caseRow({ case_no: "A" }), caseRow({ case_no: "B" })],
      ["internet", "time"]
    );
    expect(items.map((i) => i.id)).toEqual([
      "A::internet",
      "A::time",
      "B::internet",
      "B::time",
    ]);
  });

  it("orders types consistently no matter how the checkboxes were ticked", () => {
    const ticked = buildMergeItems([caseRow()], ["time", "internet", "utility"]);
    expect(ticked.map((i) => i.type)).toEqual(["internet", "utility", "time"]);
  });

  it("includes an ungenerated bill, marking it as one to generate first", () => {
    const items = buildMergeItems(
      [caseRow({ internet_bill_url: null, utility_bill_url: null })],
      ["internet", "utility", "time"]
    );
    // Not unavailable: the merge generates these rather than refusing them.
    expect(items.find((i) => i.type === "internet")?.unavailable).toBeNull();
    expect(items.find((i) => i.type === "internet")?.needsGeneration).toBe(true);
    expect(items.find((i) => i.type === "utility")?.needsGeneration).toBe(true);
    // The TIME invoice is produced per request and never stored.
    expect(items.find((i) => i.type === "time")?.unavailable).toBeNull();
    expect(items.find((i) => i.type === "time")?.needsGeneration).toBe(false);
  });

  it("does not ask to generate a bill the case already has", () => {
    const items = buildMergeItems([caseRow()], ["internet", "utility"]);
    expect(items.every((i) => i.needsGeneration)).toBe(false);
    expect(items.some((i) => i.needsGeneration)).toBe(false);
  });

  it("marks the letter unavailable when the case has no ID number", () => {
    // The route itself refuses this case, so the row says so before the fetch.
    const blank = buildMergeItems([caseRow({ id_no: "  " })], ["letter"]);
    expect(blank[0].unavailable).toBe("Case has no ID number");
    expect(buildMergeItems([caseRow()], ["letter"])[0].unavailable).toBeNull();
  });

  it("labels a row with its case, customer and document type", () => {
    const [item] = buildMergeItems([caseRow({ case_no: "999", full_name: "ALI" })], ["utility"]);
    expect(item.label).toBe("999 · ALI — Utility Bill");
  });

  it("omits the customer from the label when the case has no name", () => {
    const [item] = buildMergeItems([caseRow({ case_no: "999", full_name: null })], ["utility"]);
    expect(item.label).toBe("999 — Utility Bill");
  });

  it("returns nothing when no type is selected", () => {
    expect(buildMergeItems([caseRow()], [])).toEqual([]);
  });
});

describe("mergeItemUrl", () => {
  const [internet, utility, letter, time, chat] = buildMergeItems(
    [caseRow({ case_no: "20/26" })],
    ["internet", "utility", "letter", "time", "chat"]
  );

  it("points each type at its own endpoint and escapes the case number", () => {
    expect(mergeItemUrl(internet)).toBe("/api/bills/download?case_no=20%2F26&type=internet");
    expect(mergeItemUrl(utility)).toBe("/api/bills/download?case_no=20%2F26&type=utility");
    expect(mergeItemUrl(letter)).toBe("/api/bills/authorization-letter?case_no=20%2F26");
    expect(mergeItemUrl(time)).toBe("/api/bills/time-invoice?case_no=20%2F26");
  });

  it("gives the closing script no URL — it is captured in the browser", () => {
    // A caller that fetched this would request the dashboard page and merge HTML.
    expect(mergeItemUrl(chat)).toBeNull();
  });
});

describe("the closing script as a merge document", () => {
  it("is always available: it is drawn from the case, not fetched", () => {
    const bare = buildMergeItems(
      [caseRow({ internet_bill_url: null, utility_bill_url: null, id_no: null })],
      ["chat"]
    );
    expect(bare[0].unavailable).toBeNull();
  });

  it("comes last in the default order", () => {
    const items = buildMergeItems([caseRow()], ["chat", "internet", "time"]);
    expect(items.map((i) => i.type)).toEqual(["internet", "time", "chat"]);
  });
});

describe("reconcileMergeItems", () => {
  const A = buildMergeItems([caseRow({ case_no: "A" })], ["internet", "utility"]);

  it("keeps the order the agent arranged when a type is added", () => {
    const reordered = [A[1], A[0]]; // utility first
    const next = buildMergeItems([caseRow({ case_no: "A" })], ["internet", "utility", "time"]);
    expect(reconcileMergeItems(reordered, next).map((i) => i.id)).toEqual([
      "A::utility",
      "A::internet",
      "A::time",
    ]);
  });

  it("drops rows whose type was unticked", () => {
    const next = buildMergeItems([caseRow({ case_no: "A" })], ["utility"]);
    expect(reconcileMergeItems(A, next).map((i) => i.id)).toEqual(["A::utility"]);
  });

  it("does not resurrect a row the agent removed by hand", () => {
    const afterRemoval = A.filter((i) => i.type !== "internet");
    const next = buildMergeItems([caseRow({ case_no: "A" })], ["internet", "utility"]);
    // "internet" is still ticked, but it was removed from the list — appending it
    // again would undo the removal on every unrelated checkbox change.
    const result = reconcileMergeItems(afterRemoval, next);
    expect(result.map((i) => i.id)).toEqual(["A::utility", "A::internet"]);
  });

  it("takes fresh availability from the new derivation", () => {
    const stale: MergeItem[] = A.map((i) => ({ ...i, unavailable: "Not generated yet" }));
    const next = buildMergeItems([caseRow({ case_no: "A" })], ["internet", "utility"]);
    expect(reconcileMergeItems(stale, next).every((i) => i.unavailable === null)).toBe(true);
  });
});

describe("moveMergeItem", () => {
  const items = buildMergeItems([caseRow({ case_no: "A" })], ["internet", "utility", "time"]);

  it("moves a row down", () => {
    expect(moveMergeItem(items, 0, 2).map((i) => i.type)).toEqual(["utility", "time", "internet"]);
  });

  it("moves a row up", () => {
    expect(moveMergeItem(items, 2, 0).map((i) => i.type)).toEqual(["time", "internet", "utility"]);
  });

  it("leaves the list untouched for a no-op or an out-of-range index", () => {
    expect(moveMergeItem(items, 1, 1)).toBe(items);
    expect(moveMergeItem(items, 0, 9)).toBe(items);
    expect(moveMergeItem(items, -1, 0)).toBe(items);
  });
});

describe("pendingGenerationTypes", () => {
  it("names the bills to generate, in the canonical order", () => {
    const items = buildMergeItems(
      [caseRow({ internet_bill_url: null, utility_bill_url: null })],
      ["time", "utility", "internet"]
    );
    expect(pendingGenerationTypes(items)).toEqual(["internet", "utility"]);
  });

  it("is empty when every ticked document already exists or is made on the fly", () => {
    expect(pendingGenerationTypes(buildMergeItems([caseRow()], ["internet", "letter"]))).toEqual([]);
  });

  it("never asks to generate a row that cannot be included at all", () => {
    // A letter with no IC is refused by its route; it is not a bill either way.
    const items = buildMergeItems([caseRow({ id_no: "" })], ["letter"]);
    expect(pendingGenerationTypes(items)).toEqual([]);
  });
});

describe("generationCreditCost", () => {
  it("costs one credit when the case has no bill at all", () => {
    const c = caseRow({ internet_bill_url: null, utility_bill_url: null });
    // Two bills still cost one: the route charges per case, not per bill.
    expect(generationCreditCost(c, ["internet", "utility"])).toBe(1);
    expect(generationCreditCost(c, ["internet"])).toBe(1);
  });

  it("costs nothing when the case has already been charged for a bill", () => {
    expect(generationCreditCost(caseRow({ internet_bill_url: null }), ["internet"])).toBe(0);
  });

  it("costs nothing when there is nothing to generate", () => {
    expect(generationCreditCost(caseRow(), [])).toBe(0);
  });
});
