/**
 * Every case document prints the installation address. When WifiBizz has none —
 * stored or scraped — no document is generated for the case (user's rule,
 * 2026-10-02). Client-safe: no server imports.
 */
export const NO_ADDRESS_ERROR =
  "This case has no installation address in WifiBizz, so no document can be generated. Add the address in WifiBizz, then try again.";

export function hasAddress(address: string | null | undefined): boolean {
  return !!address && address.trim().length > 0;
}
