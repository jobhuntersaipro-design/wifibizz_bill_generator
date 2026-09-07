/**
 * What the admin topbar should show for a given route.
 *
 * Pure, and the single source for both the title and the back target, so a
 * page cannot end up labelled one thing while its back button goes somewhere
 * else. On mobile this strip is the ONLY navigation on screen — the sidebar is
 * a hidden drawer — so getting it wrong strands you.
 */

export interface AdminNavContext {
  /** Page name shown in the topbar. */
  title: string;
  /**
   * Where the back chevron goes, or null when this is a top-level section and
   * the strip should show the drawer toggle instead.
   *
   * A detail page shows back INSTEAD of the hamburger, not beside it: two
   * navigation controls competing in one 44px strip is how people press the
   * wrong one.
   */
  back: string | null;
}

/**
 * Sections used to name a deeper page under a known area.
 *
 * `/admin` is deliberately NOT here even though it is the Users page: as a
 * prefix it matches every admin route, so an unmapped page would be labelled
 * "Users" — confidently, and wrongly. The exact `/admin` match above handles it.
 */
const SECTIONS: { prefix: string; title: string }[] = [
  { prefix: "/admin/orders", title: "Orders" },
  { prefix: "/admin/plans", title: "Plan Settings" },
  { prefix: "/admin/agents", title: "Agents" },
  { prefix: "/admin/umobile-image", title: "umobile image" },
  { prefix: "/admin/landlord-signature", title: "landlord signature" },
];

export function adminNavContext(pathname: string): AdminNavContext {
  const path = pathname.replace(/\/+$/, "") || "/admin";

  if (path === "/admin/orders") return { title: "Orders", back: null };
  if (path === "/admin/plans") return { title: "Plan Settings", back: null };
  if (path === "/admin/umobile-image") return { title: "umobile image", back: null };
  if (path === "/admin/landlord-signature") return { title: "landlord signature", back: null };
  if (path === "/admin") return { title: "Users", back: null };

  // An order's detail page belongs to the orders list.
  if (path.startsWith("/admin/orders/")) return { title: "Order", back: "/admin/orders" };
  // An agent's page has no list of its own — Users is where agents are listed.
  if (path.startsWith("/admin/agents/")) return { title: "Agent", back: "/admin" };

  const section = SECTIONS.find((s) => path.startsWith(`${s.prefix}/`) || path === s.prefix);
  // Unknown route: the generic label and the DRAWER, never a back button. A
  // guessed back target on a page nobody has mapped is worse than no back
  // button, because it silently sends you somewhere unrelated.
  return { title: section?.title ?? "Administration", back: null };
}
