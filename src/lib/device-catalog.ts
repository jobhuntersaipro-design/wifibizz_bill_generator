// Presentation helpers for the dealer device/add-on catalog (113 entries).
//
// The flat list is unusable in a dropdown: 49 of the entries are tablets, and
// 35 of those are two iPad models repeated across colour × monthly price. Worse,
// the catalog is not all "devices" — it also carries Smart Home kit, add-on
// packs, and pure line items (Stamp Duty, Promo Discount) that must never be
// picked by accident.
//
// So: bucket by category (the chips), then group repeated models under one
// header so only the varying part shows on each row.
import { DEALER_DEVICES, type DealerDevice } from "@/lib/dealer-devices";

export const DEVICE_CATEGORIES = [
  "Tablet",
  "TV",
  "Smart Home",
  "Mesh Wi-Fi",
  "Laptop & PC",
  "Gaming",
  "Add-on packs",
  "Charges & discounts",
] as const;

export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];

/**
 * Category of a catalog entry, from its portal name.
 *
 * Order matters. Gaming is tested before TV so the "PlayStation 5 + SHARP TV"
 * bundles file as Gaming, and the charge/discount line items are pulled out
 * before anything else can claim them.
 */
export function deviceCategory(name: string): DeviceCategory {
  const u = (name || "").toUpperCase();
  if (/STAMP DUTY|PROMO DISCOUNT|PROFESSIONAL CHARGE/.test(u)) return "Charges & discounts";
  if (u.includes("HOME SHIELD")) return "Add-on packs";
  if (u.startsWith("SMART HOME")) return "Smart Home";
  if (/PLAYSTATION|PS5/.test(u)) return "Gaming";
  if (u.includes("MESH")) return "Mesh Wi-Fi";
  if (u.includes("TV")) return "TV";
  if (/IPAD|\bTAB\b/.test(u)) return "Tablet";
  if (/EXPERTBOOK|TUF|ALLY/.test(u)) return "Laptop & PC";
  return "Add-on packs";
}

/**
 * Split a name into the repeated model and the bit that varies.
 *
 * "Apple 11-inch iPad Wi-Fi 256GB – Blue (RM31)"
 *   → { family: "Apple 11-inch iPad Wi-Fi 256GB", variant: "Blue (RM31)" }
 * "SHARP 55inch TV (24mth contract)"
 *   → { family: "SHARP 55inch TV", variant: "24mth contract" }
 */
export function deviceFamily(name: string): { family: string; variant: string } {
  const n = (name || "").trim();
  // "<model> – <colour> (RMxx)" — only when a price marks the tail as a variant.
  const dash = n.split(/\s+[–-]\s+/);
  if (dash.length >= 2 && /\(RM/.test(n)) {
    const [first, ...rest] = dash as [string, ...string[]];
    return { family: first.trim(), variant: rest.join(" - ").trim() };
  }
  // "<model> (24mth contract)" / "<model> (RM59)"
  const paren = /^(.*?)\s*(\([^()]*\)(?:\s*\([^()]*\))*)\s*$/.exec(n);
  if (paren?.[1] && paren[2]) {
    return { family: paren[1].trim(), variant: paren[2].replace(/^\(|\)$/g, "").trim() };
  }
  return { family: n, variant: "" };
}

/**
 * Row label for a variant. The monthly price has its own column, so drop the
 * "(RM31)" the portal bakes into the name — but keep any other parenthetical
 * such as the contract term: "Blue (RM10)(36M)" → "Blue (36M)".
 */
export function variantLabel(variant: string, monthly: number | null): string {
  if (monthly === null) return variant;
  const stripped = variant.replace(/\(\s*RM[\d.]+\s*\)/gi, " ").replace(/\s+/g, " ").trim();
  return stripped || variant;
}

export interface DeviceGroup {
  /** Model name for a repeated family, or the singles bucket label. */
  header: string;
  /** True for the catch-all bucket — rows there show their full name. */
  singles: boolean;
  items: DealerDevice[];
}

/** Cheapest first; unpriced entries last (they're one-off or per-package). */
function byMonthly(a: DealerDevice, b: DealerDevice): number {
  if (a.monthly === b.monthly) return a.name.localeCompare(b.name);
  if (a.monthly === null) return 1;
  if (b.monthly === null) return -1;
  return a.monthly - b.monthly;
}

/**
 * Group devices for display: families with 2+ variants get their own header,
 * everything else collects in one "Individual models" bucket at the end so the
 * list isn't 38 one-row headers.
 */
export function groupDevices(devices: DealerDevice[]): DeviceGroup[] {
  const families = new Map<string, DealerDevice[]>();
  const order: string[] = [];
  for (const d of devices) {
    const { family } = deviceFamily(d.name);
    const list = families.get(family);
    if (list) list.push(d);
    else {
      families.set(family, [d]);
      order.push(family);
    }
  }
  const groups: DeviceGroup[] = [];
  const singles: DealerDevice[] = [];
  for (const family of order) {
    const items = families.get(family)!;
    if (items.length > 1) groups.push({ header: family, singles: false, items: [...items].sort(byMonthly) });
    else singles.push(items[0]!);
  }
  groups.sort((a, b) => b.items.length - a.items.length);
  if (singles.length) {
    groups.push({ header: "Individual models", singles: true, items: singles.sort(byMonthly) });
  }
  return groups;
}

/** Entry counts per category, for the chip labels. */
export const DEVICE_CATEGORY_COUNTS: Record<string, number> = (() => {
  const counts: Record<string, number> = {};
  for (const d of DEALER_DEVICES) {
    const c = deviceCategory(d.name);
    counts[c] = (counts[c] ?? 0) + 1;
  }
  return counts;
})();

/**
 * Names that appear more than once in the whole catalog — the portal
 * distinguishes them only by code (six "Solar Outdoor Camera" rows, some
 * differing only by a non-breaking space). Show the code on these so the
 * agent's choice is at least explicit and repeatable.
 */
export const AMBIGUOUS_DEVICE_NAMES: ReadonlySet<string> = (() => {
  const seen = new Map<string, number>();
  for (const d of DEALER_DEVICES) {
    const key = d.name.replace(/\s+/g, " ").trim().toUpperCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
})();

/** True when this entry's name is shared with another catalog entry. */
export function isAmbiguousDevice(name: string): boolean {
  return AMBIGUOUS_DEVICE_NAMES.has(name.replace(/\s+/g, " ").trim().toUpperCase());
}
