import { describe, it, expect } from "vitest";
import { formatAddress } from "@/components/order-entry/OrderRow";
import type { OrderListItem } from "@/lib/order-types";

// Only the fields formatAddress reads matter; the rest are inert padding.
function order(over: Partial<OrderListItem>): OrderListItem {
  return {
    id: "x",
    reference: null,
    fullName: "TEST",
    idType: "MyKad",
    idNumber: "920505034434",
    mobilePrefix: "60",
    mobile: "148893212",
    email: null,
    gender: null,
    birthday: null,
    race: null,
    idExpiry: null,
    street: "",
    postcode: "",
    city: "",
    state: "",
    addressId: null,
    addressFull: null,
    offerName: "",
    deviceName: null,
    deviceCode: null,
    remarks: null,
    documents: [],
    status: "draft",
    orderId: null,
    submitError: null,
    installationDate: null,
    createdAt: new Date("2026-08-26T00:00:00Z").toISOString(),
    createdBy: null,
    ...over,
  } as unknown as OrderListItem;
}

describe("formatAddress", () => {
  it("prefers the portal's own concatAddress when present", () => {
    const o = order({ addressFull: "UNIT 1, PORTAL STREET", street: "IGNORED" });
    expect(formatAddress(o)).toBe("UNIT 1, PORTAL STREET");
  });

  // The bug this pins: the pasted Full Address already ends
  // "... SELANGOR MALAYSIA 40100", and the derived postcode/city/state were
  // appended again, duplicating the string's own tail.
  it("does NOT append derived parts when the paste already carries the postcode", () => {
    const paste =
      "1-6-1 JALAN SULTAN SALAHUDDIN ABDUL AZIZ SHAH 9/6 6 SRI PERMATA CONDOMINIUM SEKSYEN 9 SHAH ALAM SELANGOR MALAYSIA 40100";
    const o = order({ street: paste, postcode: "40100", city: "SHAH ALAM", state: "Selangor" });
    expect(formatAddress(o)).toBe(paste);
  });

  // Old drafts from before the paste-one-address form: street really was just
  // the street line, and the rebuild is what completes it.
  it("still rebuilds street + postcode city + state for a street-only draft", () => {
    const o = order({
      street: "1-6-1 JALAN SULTAN SALAHUDDIN",
      postcode: "40100",
      city: "SHAH ALAM",
      state: "Selangor",
    });
    expect(formatAddress(o)).toBe("1-6-1 JALAN SULTAN SALAHUDDIN, 40100 SHAH ALAM, Selangor");
  });

  it("rebuilds when the agent's edited postcode disagrees with the paste, so the disagreement shows", () => {
    const o = order({
      street: "NO 2 JALAN X TAMAN Y SELANGOR MALAYSIA 40100",
      postcode: "43500",
      city: "SEMENYIH",
      state: "Selangor",
    });
    expect(formatAddress(o)).toBe(
      "NO 2 JALAN X TAMAN Y SELANGOR MALAYSIA 40100, 43500 SEMENYIH, Selangor",
    );
  });

  it("returns empty for a draft with no address at all", () => {
    expect(formatAddress(order({}))).toBe("");
  });
});
