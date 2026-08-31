/**
 * Search, CSV, and the alert window — each a place where a silent miss looks
 * exactly like a hit.
 */
import { describe, it, expect } from "vitest";
import { inAlertWindow, matchesOrderSearch, toCsv } from "@/lib/admin-search";

const row = (over: Partial<Parameters<typeof matchesOrderSearch>[0]> = {}) => ({
  fullName: "MUHAMMAD SAHINU BIN INSANU",
  idNumber: "940811034224",
  reference: "ORD-0042",
  orderId: "2608000121750632",
  ...over,
});

describe("matchesOrderSearch", () => {
  it("matches each of the four fields somebody arrives holding", () => {
    expect(matchesOrderSearch(row(), "sahinu")).toBe(true);
    expect(matchesOrderSearch(row(), "940811034224")).toBe(true);
    expect(matchesOrderSearch(row(), "ORD-0042")).toBe(true);
    expect(matchesOrderSearch(row(), "2608000121750632")).toBe(true);
  });

  it("finds an IC typed with separators against one stored without", () => {
    // ICs are written both ways interchangeably; missing on punctuation
    // silently reports "no such order".
    expect(matchesOrderSearch(row(), "940811-03-4224")).toBe(true);
    expect(matchesOrderSearch(row({ idNumber: "940811-03-4224" }), "940811034224")).toBe(true);
  });

  it("is case-insensitive on names and references", () => {
    expect(matchesOrderSearch(row(), "ord-0042")).toBe(true);
    expect(matchesOrderSearch(row(), "muhammad")).toBe(true);
  });

  it("does not match what is not there", () => {
    expect(matchesOrderSearch(row({ reference: null, orderId: null }), "ORD-0042")).toBe(false);
    expect(matchesOrderSearch(row(), "zzz")).toBe(false);
  });

  it("an empty query matches everything — a blank box filters nothing out", () => {
    expect(matchesOrderSearch(row(), "")).toBe(true);
    expect(matchesOrderSearch(row(), "   ")).toBe(true);
  });

  it("a punctuation-only query matches nothing rather than everything", () => {
    // strip("-") is "", and an empty stripped needle would substring-match
    // every row — the least useful possible answer to searching for "-".
    expect(matchesOrderSearch(row(), "-")).toBe(false);
  });
});

describe("toCsv", () => {
  it("quotes commas, quotes and newlines — the certainties at fifty agents", () => {
    const csv = toCsv(["name", "note"], [['LIM, AH "KOW"', "line1\nline2"]]);
    expect(csv).toBe('"name","note"\r\n"LIM, AH ""KOW""","line1\nline2"');
  });

  it("renders null as empty and keeps the header on an empty set", () => {
    expect(toCsv(["a"], [[null]])).toBe('"a"\r\n""');
    expect(toCsv(["a", "b"], [])).toBe('"a","b"');
  });
});

describe("inAlertWindow", () => {
  it("fires only in the one tick after the cap is crossed", () => {
    expect(inAlertWindow(1799, 1800)).toBe(false); // not stuck yet
    expect(inAlertWindow(1801, 1800)).toBe(true);  // just crossed — mail
    expect(inAlertWindow(1800 + 360, 1800)).toBe(true);  // inside cap+sweep+slack
    expect(inAlertWindow(1800 + 361, 1800)).toBe(false); // later ticks stay silent
  });

  it("never fires below the cap, however long the window", () => {
    expect(inAlertWindow(1800, 1800)).toBe(false);
    expect(inAlertWindow(100, 1800, 999999)).toBe(false);
  });
});
