/**
 * The clone's field line — everything is on one side of it on purpose.
 */
import { describe, it, expect } from "vitest";
import {
  CLONED_FIELDS, NEVER_CLONED, cloneDocumentKey, cloneOrderInput, documentContentType,
} from "@/lib/clone-order";
import { slugFromFilename } from "@/lib/order-documents";

describe("the clone line", () => {
  it("copies exactly the pinned fields and nothing else", () => {
    const source = Object.fromEntries(
      [...CLONED_FIELDS, ...NEVER_CLONED].map((f) => [f, `v_${f}`]),
    );
    const out = cloneOrderInput(source);
    for (const f of CLONED_FIELDS) expect(out[f as keyof typeof out]).toBe(`v_${f}`);
    for (const f of NEVER_CLONED) expect(f in out).toBe(false);
  });

  it("keeps the two lists disjoint — a field on both sides is a decision nobody made", () => {
    const overlap = CLONED_FIELDS.filter((f) => (NEVER_CLONED as readonly string[]).includes(f));
    expect(overlap).toEqual([]);
  });

  it("never clones documents — the R2 same-key trap made certain", () => {
    expect((NEVER_CLONED as readonly string[]).includes("documents")).toBe(true);
    expect((CLONED_FIELDS as readonly string[]).includes("documents")).toBe(false);
  });

  it("carries the portal address id — a same-address clone is the point", () => {
    expect((CLONED_FIELDS as readonly string[]).includes("addressId")).toBe(true);
  });

  it("tolerates a source missing optional fields", () => {
    const out = cloneOrderInput({ idNumber: "x", fullName: "y" });
    expect(out).toEqual({ idNumber: "x", fullName: "y" });
  });
});

describe("documents copied into a replication clone", () => {
  it("never reuses the source key, even cloning into the same account", () => {
    const source = "orders/u1/940728065051_mykad_front.png";
    const { key } = cloneDocumentKey("940728065051_mykad_front.png", "u1", "ab12");
    expect(key).not.toBe(source);
    expect(key).toBe("orders/u1/940728065051_mykad_front-cab12.png");
  });

  it("keeps the slug the form reads to know which kinds are attached", () => {
    const { filename } = cloneDocumentKey("940728065051_internet_bill_2.pdf", "u2", "zz");
    expect(slugFromFilename(filename)).toBe("internet_bill");
  });

  it("lands in the target account's namespace", () => {
    expect(cloneDocumentKey("x_a_1.pdf", "target", "t").key.startsWith("orders/target/")).toBe(true);
  });

  it("types documents from the extension", () => {
    expect(documentContentType("a_b_1.JPG")).toBe("image/jpeg");
    expect(documentContentType("a_b_1.pdf")).toBe("application/pdf");
    expect(documentContentType("a_b_1")).toBe("application/octet-stream");
  });

  it("does not carry the no-retry flag onward through an ordinary clone", () => {
    expect((NEVER_CLONED as readonly string[]).includes("autoRetryDisabled")).toBe(true);
  });
});
