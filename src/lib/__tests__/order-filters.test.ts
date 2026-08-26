import { describe, expect, it } from "vitest";
import {
  DATE_PRESETS,
  EMPTY_FILTERS,
  activeFilterCount,
  createdParts,
  filterOptions,
  filterOrders,
  formatCreated,
  formatCreatedFull,
  formatDateInput,
  formatPhone,
  fromDateInput,
  presetRange,
  toDateInput,
  type OrderListItem,
} from "../order-types";

/** A minimal row; every test overrides only what it is about. */
function order(over: Partial<OrderListItem> = {}): OrderListItem {
  return {
    id: "1",
    fullName: "TUCK KEE LEE",
    idType: "MyKad",
    idNumber: "970815125312",
    phone: "+60 13-708 9093",
    offerName: "Unifi Home 500Mbps",
    street: null,
    postcode: null,
    city: null,
    state: null,
    addressFull: null,
    addressId: null,
    status: "draft",
    orderId: null,
    errorMessage: null,
    errorCode: null,
    stage: null,
    reference: "ORD-0012",
    deviceName: null,
    deviceCode: null,
    remarks: null,
    attempt: 0,
    screenshotUrl: null,
    docCount: 0,
    documents: [],
    createdAt: "2026-08-18T10:00:00.000Z",
    createdByEmail: null,
    ...over,
  };
}

describe("formatPhone", () => {
  it("groups a 9-digit mobile behind its country code", () => {
    expect(formatPhone("60", "137089093")).toBe("+60 13-708 9093");
  });

  it("groups a 10-digit mobile", () => {
    expect(formatPhone("60", "1112345678")).toBe("+60 11-1234 5678");
  });

  it("strips punctuation the agent typed", () => {
    expect(formatPhone("+60", "13-708 9093")).toBe("+60 13-708 9093");
  });

  it("leaves an unexpected length UNGROUPED rather than reshaping it", () => {
    // Inventing a grouping for a number we don't recognise would make a wrong
    // value look authoritative. The digits must survive untouched.
    expect(formatPhone("60", "12345")).toBe("+60 12345");
  });

  it("returns null when there is no number", () => {
    expect(formatPhone("60", null)).toBeNull();
    expect(formatPhone("60", "")).toBeNull();
    expect(formatPhone(null, null)).toBeNull();
  });

  it("omits the country code when there isn't one", () => {
    expect(formatPhone(null, "137089093")).toBe("13-708 9093");
  });
});

describe("formatCreated", () => {
  it("renders DD-MM-YYYY HH:MM, zero-padded and 24-hour", () => {
    // Built from a LOCAL-time date so the assertion does not depend on the
    // machine's timezone — the function renders local time by design.
    const d = new Date(2026, 7, 5, 9, 4); // 5 Aug 2026, 09:04 local
    expect(formatCreated(d.toISOString())).toBe("05-08-2026 09:04");
  });

  it("is day-first, so 08-09 is never read as September the 8th", () => {
    const d = new Date(2026, 8, 8, 13, 0); // 8 Sep 2026
    expect(formatCreated(d.toISOString())).toBe("08-09-2026 13:00");
  });

  it("degrades to a dash rather than 'Invalid Date'", () => {
    expect(formatCreated(null)).toBe("—");
    expect(formatCreated("not a date")).toBe("—");
  });
});

describe("formatCreatedFull", () => {
  it("adds seconds in the same fixed shape as the cell", () => {
    const d = new Date(2026, 7, 5, 9, 4, 7);
    expect(formatCreatedFull(d.toISOString())).toBe("05-08-2026 09:04:07");
  });

  it("is empty, not 'Invalid Date', for an unusable value", () => {
    expect(formatCreatedFull("nonsense")).toBe("");
    expect(formatCreatedFull(null)).toBe("");
  });
});

describe("filterOptions", () => {
  it("lists distinct packages and devices, sorted", () => {
    const { offers, devices } = filterOptions([
      order({ offerName: "Unifi 800Mbps", deviceName: "SAMSUNG TV 55" }),
      order({ offerName: "Unifi 500Mbps", deviceName: "SAMSUNG TV 55" }),
      order({ offerName: "Unifi 500Mbps", deviceName: null }),
    ]);
    expect(offers).toEqual(["Unifi 500Mbps", "Unifi 800Mbps"]);
    expect(devices).toEqual(["SAMSUNG TV 55"]);
  });

  it("ignores blank values instead of offering an empty option", () => {
    const { offers, devices } = filterOptions([
      order({ offerName: "   ", deviceName: "" }),
    ]);
    expect(offers).toEqual([]);
    expect(devices).toEqual([]);
  });
});

describe("filterOrders", () => {
  it("returns everything when nothing is filtered", () => {
    const rows = [order({ id: "a" }), order({ id: "b" })];
    expect(filterOrders(rows, EMPTY_FILTERS)).toHaveLength(2);
  });

  it("filters by status", () => {
    const rows = [order({ id: "a", status: "draft" }), order({ id: "b", status: "failed" })];
    const out = filterOrders(rows, { ...EMPTY_FILTERS, status: "failed" });
    expect(out.map((o) => o.id)).toEqual(["b"]);
  });

  it("filters by package and by device", () => {
    const rows = [
      order({ id: "a", offerName: "Unifi 500Mbps", deviceName: "TV" }),
      order({ id: "b", offerName: "Unifi 800Mbps", deviceName: "TV" }),
    ];
    expect(
      filterOrders(rows, { ...EMPTY_FILTERS, offerName: "Unifi 800Mbps" }).map((o) => o.id),
    ).toEqual(["b"]);
    expect(
      filterOrders(rows, { ...EMPTY_FILTERS, deviceName: "TV" }),
    ).toHaveLength(2);
  });

  it("filters by an explicit from/to range", () => {
    const rows = [
      order({ id: "aug05", createdAt: new Date(2026, 7, 5, 9, 0).toISOString() }),
      order({ id: "aug18", createdAt: new Date(2026, 7, 18, 9, 0).toISOString() }),
      order({ id: "jul01", createdAt: new Date(2026, 6, 1, 9, 0).toISOString() }),
    ];
    const out = filterOrders(rows, {
      ...EMPTY_FILTERS,
      dateFrom: "2026-08-01",
      dateTo: "2026-08-10",
    });
    expect(out.map((o) => o.id)).toEqual(["aug05"]);
  });

  it("includes the WHOLE of the To day, not just its midnight", () => {
    // The off-by-a-day that reads as "my draft vanished": an order created at
    // 17:47 on the 18th must survive a To of the 18th.
    const rows = [
      order({ id: "late", createdAt: new Date(2026, 7, 18, 17, 47).toISOString() }),
    ];
    expect(
      filterOrders(rows, { ...EMPTY_FILTERS, dateFrom: "2026-08-18", dateTo: "2026-08-18" }),
    ).toHaveLength(1);
  });

  it("includes the whole of the From day from its midnight", () => {
    const rows = [
      order({ id: "early", createdAt: new Date(2026, 7, 18, 0, 5).toISOString() }),
    ];
    expect(
      filterOrders(rows, { ...EMPTY_FILTERS, dateFrom: "2026-08-18" }),
    ).toHaveLength(1);
  });

  it("treats each end as unbounded when it is null", () => {
    const rows = [
      order({ id: "old", createdAt: new Date(2020, 0, 1).toISOString() }),
      order({ id: "new", createdAt: new Date(2026, 7, 18).toISOString() }),
    ];
    expect(
      filterOrders(rows, { ...EMPTY_FILTERS, dateTo: "2026-08-18" }).map((o) => o.id),
    ).toEqual(["old", "new"]);
    expect(
      filterOrders(rows, { ...EMPTY_FILTERS, dateFrom: "2026-01-01" }).map((o) => o.id),
    ).toEqual(["new"]);
  });

  it("KEEPS a row whose timestamp can't be parsed", () => {
    // Hiding a real draft to satisfy a filter about time is worse than showing
    // it: a row you cannot see is a row you cannot fix.
    const rows = [order({ id: "broken", createdAt: "nonsense" })];
    expect(
      filterOrders(rows, { ...EMPTY_FILTERS, dateFrom: "2026-08-18" }),
    ).toHaveLength(1);
  });

  it("searches name, ID number, phone and reference", () => {
    const rows = [order({ id: "a" })];
    for (const q of ["tuck", "970815", "708", "ORD-0012"]) {
      expect(filterOrders(rows, { ...EMPTY_FILTERS, query: q })).toHaveLength(1);
    }
    expect(filterOrders(rows, { ...EMPTY_FILTERS, query: "zzz" })).toHaveLength(0);
  });

  it("combines filters — every one must pass", () => {
    const rows = [
      order({ id: "a", status: "failed", offerName: "Unifi 500Mbps" }),
      order({ id: "b", status: "failed", offerName: "Unifi 800Mbps" }),
      order({ id: "c", status: "draft", offerName: "Unifi 800Mbps" }),
    ];
    const out = filterOrders(
      rows,
      { ...EMPTY_FILTERS, status: "failed", offerName: "Unifi 800Mbps" },
    );
    expect(out.map((o) => o.id)).toEqual(["b"]);
  });

  it("does not mutate the input array", () => {
    const rows = [order({ id: "a" }), order({ id: "b", status: "failed" })];
    filterOrders(rows, { ...EMPTY_FILTERS, status: "failed" });
    expect(rows).toHaveLength(2);
  });
});

describe("activeFilterCount", () => {
  it("is zero for the empty filter set", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it("ignores a whitespace-only query", () => {
    expect(activeFilterCount({ ...EMPTY_FILTERS, query: "   " })).toBe(0);
  });

  it("counts each engaged filter", () => {
    expect(
      activeFilterCount({
        query: "lee",
        status: "failed",
        dateFrom: "2026-08-01",
        dateTo: "2026-08-18",
        offerName: "Unifi 500Mbps",
        deviceName: "TV",
      }),
    ).toBe(5);
  });

  it("counts a date range ONCE however many ends are set", () => {
    // "Clear 2 filters" for one range would be counting inputs, not filters.
    expect(activeFilterCount({ ...EMPTY_FILTERS, dateFrom: "2026-08-01" })).toBe(1);
    expect(
      activeFilterCount({ ...EMPTY_FILTERS, dateFrom: "2026-08-01", dateTo: "2026-08-18" }),
    ).toBe(1);
  });
});

describe("date inputs", () => {
  it("round-trips a local date without shifting the day", () => {
    // toISOString() would move 1 Aug 00:00 in +08 back to 31 Jul — the classic
    // way a date picker shows yesterday.
    const d = new Date(2026, 7, 1);
    expect(toDateInput(d)).toBe("2026-08-01");
    expect(fromDateInput("2026-08-01")?.getDate()).toBe(1);
    expect(fromDateInput("2026-08-01")?.getMonth()).toBe(7);
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    expect(fromDateInput("01-08-2026")).toBeNull();
    expect(fromDateInput("")).toBeNull();
    expect(fromDateInput(null)).toBeNull();
  });

  it("formats for display day-first", () => {
    expect(formatDateInput("2026-08-01")).toBe("01-08-2026");
    expect(formatDateInput(null)).toBeNull();
  });
});

describe("presetRange", () => {
  it("spans N days INCLUSIVE of today", () => {
    const now = new Date(2026, 7, 18);
    // 7 days ending today = the 12th through the 18th, not the 11th.
    expect(presetRange(7, now)).toEqual({
      dateFrom: "2026-08-12",
      dateTo: "2026-08-18",
    });
  });

  it("every preset offers a positive span", () => {
    for (const p of DATE_PRESETS) expect(p.days).toBeGreaterThan(0);
  });
});

describe("createdParts", () => {
  it("splits into a day-first date and a 24-hour time", () => {
    const d = new Date(2026, 7, 5, 9, 4);
    expect(createdParts(d.toISOString())).toEqual({
      date: "05-08-2026",
      time: "09:04",
    });
  });

  it("is null for an unusable value, so the cell can show a dash", () => {
    expect(createdParts("nonsense")).toBeNull();
    expect(createdParts(null)).toBeNull();
  });
});
