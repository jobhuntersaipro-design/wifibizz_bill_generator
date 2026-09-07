import { describe, it, expect } from "vitest";
import { makeRng } from "@/lib/bill-generator/owner-identity";
import {
  createDocumentParties,
  parsePartiesSeed,
  rngFromSeed,
} from "@/lib/bill-generator/document-parties";

const TENANT = "NOR AZZAWANI FIZATULAZIRA BINTI ZULKEPELI";
const NOW = new Date("2026-09-05T12:00:00+08:00");

describe("createDocumentParties", () => {
  it("invents a Malay landlord and two distinct witnesses", () => {
    const p = createDocumentParties(NOW, makeRng(5), TENANT);
    expect(p.landlord.name).toMatch(/\b(BIN|BINTI)\b/);
    expect(p.landlordWitness.name).toMatch(/\b(BIN|BINTI)\b/);
    expect(p.tenantWitness.name).toMatch(/\b(BIN|BINTI)\b/);
    expect(p.landlord.nric).toMatch(/^\d{6}-\d{2}-\d{4}$/);
    expect(new Set([p.landlord.name, p.landlordWitness.name, p.tenantWitness.name]).size).toBe(3);
  });

  it("is stable for one seed and different across seeds", () => {
    const a = createDocumentParties(NOW, makeRng(9), TENANT);
    const b = createDocumentParties(NOW, makeRng(9), TENANT);
    const c = createDocumentParties(NOW, makeRng(10), TENANT);
    expect(b).toEqual(a);
    expect(c.landlord.name).not.toBe(a.landlord.name);
  });
});

describe("parsePartiesSeed", () => {
  it("accepts a finite number and ignores junk", () => {
    expect(parsePartiesSeed("42")).toBe(42);
    expect(parsePartiesSeed(7)).toBe(7);
    expect(parsePartiesSeed("")).toBeUndefined();
    expect(parsePartiesSeed("nope")).toBeUndefined();
  });
});

describe("rngFromSeed", () => {
  it("replays the same sequence for one seed", () => {
    const a = rngFromSeed(12);
    const b = rngFromSeed(12);
    expect([a(), a()]).toEqual([b(), b()]);
  });
});
