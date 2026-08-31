/**
 * The clone's field line — everything is on one side of it on purpose.
 */
import { describe, it, expect } from "vitest";
import { CLONED_FIELDS, NEVER_CLONED, cloneOrderInput } from "@/lib/clone-order";

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
