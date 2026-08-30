/**
 * Which orders an agent-facing query may see.
 *
 * Deleting an order is a soft delete — the row and its whole status history
 * survive so admin oversight can show what was deleted. That only works if
 * every agent-facing read excludes them, and there are ~15 such reads across
 * the actions, the retry library and the API routes.
 *
 * Held here rather than spelled out at each call site so "which queries exclude
 * deleted orders" has one grep and one answer. A site that forgets it does not
 * fail loudly — it quietly shows an agent an order they deleted, or worse,
 * re-submits one.
 *
 * **Admin queries deliberately do NOT use this.** `src/actions/admin-orders.ts`
 * is the only place that sees deleted rows, and that asymmetry is the feature.
 */
export const ACTIVE_ORDER = { deletedAt: null } as const;
