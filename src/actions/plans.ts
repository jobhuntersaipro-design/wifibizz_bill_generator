"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { verifyAdminSession } from "@/lib/admin-auth";
import { DEALER_OFFERS } from "@/lib/dealer-offers";
import {
  nestOfferItems,
  normalizeBandwidth,
  normalizePlanName,
  splitPlanOffer,
  toOfferGroupKind,
  OFFER_GROUP_KINDS,
  type OfferGroupKind,
  type OfferItemRow,
  type PlanOfferSplit,
  type PlanView,
} from "@/lib/plan-offer";

export type {
  OfferGroupKind,
  OfferGroupView,
  OfferItemOptionView,
  OfferItemView,
  PlanView,
} from "@/lib/plan-offer";

/**
 * Make sure every package in the static catalogue exists as a Plan row.
 *
 * Seeding on read rather than in a migration keeps the two in step: when
 * DEALER_OFFERS gains a package, it shows up for the admin without a deploy
 * step. Existing rows are never touched, so publish state and offer groups
 * survive.
 */
async function seedPlans(): Promise<void> {
  // Every row, hidden ones included — a plan an admin removed must not be
  // re-created by the next page load.
  const existing = await prisma.plan.findMany({ select: { name: true } });
  const have = new Set(existing.map((p) => p.name));
  const missing = DEALER_OFFERS.filter((o) => !have.has(o.name));
  if (missing.length === 0) return;
  await prisma.plan.createMany({
    data: missing.map((o) => ({
      name: o.name,
      category: o.category,
      bandwidth: o.bandwidth || null,
    })),
    skipDuplicates: true,
  });
}

function toView(p: {
  id: string;
  name: string;
  category: string;
  bandwidth: string | null;
  published: boolean;
  notes: string | null;
  offerGroups: {
    id: string;
    name: string;
    mandatory: boolean;
    kind: string;
    items: OfferItemRow[];
  }[];
}): PlanView {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    bandwidth: p.bandwidth,
    published: p.published,
    notes: p.notes,
    offerGroups: p.offerGroups.map((g) => ({
      id: g.id,
      name: g.name,
      mandatory: g.mandatory,
      kind: toOfferGroupKind(g.kind),
      items: nestOfferItems(g.items),
    })),
  };
}

// ── Admin ────────────────────────────────────────────────────────────────────

/** Every plan, for the admin Plan Details tab. Admin-gated. */
export async function adminListPlans(): Promise<{
  success: boolean;
  error?: string;
  plans: PlanView[];
}> {
  if (!(await verifyAdminSession())) return { success: false, error: "Unauthorized", plans: [] };
  await seedPlans();
  const plans = await prisma.plan.findMany({
    where: { hidden: false },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: {
      offerGroups: {
        orderBy: { sortOrder: "asc" },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  return { success: true, plans: plans.map(toView) };
}

/**
 * Record a plan the static catalogue does not carry.
 *
 * `DEALER_OFFERS` is a transcription of the portal's Subscription Plan List, so
 * it goes stale the moment the portal adds a package — until now that meant a
 * deploy before an agent could sell it. The row is created UNPUBLISHED: nothing
 * is sellable until its offer groups are recorded, which the publish gate
 * already enforces.
 *
 * A name that belongs to a plan an admin REMOVED restores that plan instead of
 * failing. Removal is a `hidden` flag with no restore button, so a bare
 * "already exists" would be an error the admin has no way to act on — and the
 * offer groups recorded against it are still there, which is the whole reason
 * removal was built as a flag.
 */
export async function adminCreatePlan(rawName: string, rawCategory: string, rawBandwidth: string) {
  if (!(await verifyAdminSession())) return { success: false as const, error: "Unauthorized" };

  const { name, error } = normalizePlanName(rawName);
  if (error) return { success: false as const, error };

  const category = rawCategory.replace(/\s+/g, " ").trim();
  if (category.length < 3) {
    return { success: false as const, error: "Choose the portal offer category this plan sits in." };
  }
  const bandwidth = normalizeBandwidth(rawBandwidth);

  const existing = await prisma.plan.findUnique({
    where: { name },
    select: { id: true, hidden: true },
  });
  if (existing) {
    if (!existing.hidden) {
      return { success: false as const, error: "That plan is already on this page." };
    }
    // Restore it as typed — the category or speed may be what the admin is
    // correcting — but never as published: its groups have not been re-checked.
    await prisma.plan.update({
      where: { id: existing.id },
      data: { hidden: false, published: false, category, bandwidth },
    });
    return { success: true as const, restored: true, name };
  }

  await prisma.plan.create({ data: { name, category, bandwidth } });
  return { success: true as const, restored: false, name };
}

export async function adminSetPlanPublished(id: string, published: boolean) {
  if (!(await verifyAdminSession())) return { success: false as const, error: "Unauthorized" };

  // Publishing asserts "this plan's offer groups are confirmed", so it must not
  // be possible while none are recorded — that is exactly the state that led to
  // orders being placed against groups nobody had verified.
  if (published) {
    const count = await prisma.planOfferGroup.count({
      where: { planId: id, mandatory: true },
    });
    if (count === 0) {
      return {
        success: false as const,
        error: "Add at least one mandatory offer group before publishing this plan.",
      };
    }
  }
  await prisma.plan.update({ where: { id }, data: { published } });
  return { success: true as const };
}

/**
 * Remove a plan from the Plan Details page.
 *
 * Marks it hidden instead of deleting it: `seedPlans` re-creates every package
 * in DEALER_OFFERS on read, so a deleted row would be back on the next load.
 * The plan is unpublished at the same time — a removed plan must not stay
 * sellable — and its offer groups are kept, so restoring the row restores
 * everything recorded against it.
 */
export async function adminDeletePlan(id: string) {
  if (!(await verifyAdminSession())) return { success: false as const, error: "Unauthorized" };
  await prisma.plan.update({ where: { id }, data: { hidden: true, published: false } });
  return { success: true as const };
}

export async function adminAddOfferGroup(
  planId: string,
  rawName: string,
  mandatory: boolean,
  kind: OfferGroupKind = "device",
) {
  if (!(await verifyAdminSession())) return { success: false as const, error: "Unauthorized" };

  // The portal renders the "*" outside the group name; the admin copies the row
  // verbatim, so strip a trailing marker rather than storing it in the name that
  // has to match the dialog text.
  const name = rawName.replace(/[*\s]+$/, "").trim();
  if (name.length < 5) {
    return { success: false as const, error: "Enter the full offer group name." };
  }
  try {
    const last = await prisma.planOfferGroup.findFirst({
      where: { planId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    await prisma.planOfferGroup.create({
      data: { planId, name, mandatory, kind: toOfferGroupKind(kind), sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
    return { success: true as const };
  } catch {
    return { success: false as const, error: "That offer group is already on this plan." };
  }
}

/**
 * Re-tag an existing group.
 *
 * Needed because every group recorded before this shipped is `device` or
 * `discount` — the Netflix / Max OTT groups have to be moved to `channel` by
 * hand, and they are the reason the picker was offering a channel bundle as a
 * device.
 */
export async function adminSetOfferGroupKind(id: string, kind: OfferGroupKind) {
  if (!(await verifyAdminSession())) return { success: false as const, error: "Unauthorized" };
  if (!OFFER_GROUP_KINDS.includes(kind)) {
    return { success: false as const, error: "Unknown group kind." };
  }
  await prisma.planOfferGroup.update({ where: { id }, data: { kind } });
  return { success: true as const };
}

export async function adminDeleteOfferGroup(id: string) {
  if (!(await verifyAdminSession())) return { success: false as const, error: "Unauthorized" };
  const group = await prisma.planOfferGroup.delete({ where: { id } });
  // Removing the last mandatory group means the plan is no longer verified, so
  // it must not stay sellable.
  const left = await prisma.planOfferGroup.count({
    where: { planId: group.planId, mandatory: true },
  });
  if (left === 0) {
    await prisma.plan.update({ where: { id: group.planId }, data: { published: false } });
  }
  return { success: true as const, unpublished: left === 0 };
}

// ── Agents ───────────────────────────────────────────────────────────────────

/**
 * Published plans, for the agent's package picker and the Plan Details tab.
 *
 * Unpublished plans are withheld entirely: an unpublished plan is one whose
 * offer groups nobody has confirmed against the portal.
 */
export async function getPublishedPlans(): Promise<{
  success: boolean;
  plans: PlanView[];
}> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, plans: [] };
  const plans = await prisma.plan.findMany({
    where: { published: true, hidden: false },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: {
      offerGroups: {
        orderBy: { sortOrder: "asc" },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  return { success: true, plans: plans.map(toView) };
}

/**
 * The mandatory offer-group names for one plan — used by the submit payload.
 *
 * Two lists, not one. `all` is what the scraper expands in the Offer dialog and
 * must stay complete, or a group's rows never become readable. `devices` is the
 * subset the substitution logic may pick a REPLACEMENT device from when the
 * portal refuses the agent's choice: without it, a refused TV could be
 * "substituted" with the plan's Netflix bundle and that order submitted.
 */
export async function mandatoryGroupsFor(
  offerName: string | null | undefined,
): Promise<{ all: string[]; devices: string[] }> {
  const empty = { all: [], devices: [] };
  if (!offerName) return empty;
  const plan = await prisma.plan.findUnique({
    where: { name: offerName },
    include: { offerGroups: { where: { mandatory: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!plan || plan.hidden) return empty;
  return {
    all: plan.offerGroups.map((g) => g.name),
    devices: plan.offerGroups
      .filter((g) => toOfferGroupKind(g.kind) === "device")
      .map((g) => g.name),
  };
}

// ── Offer items ──────────────────────────────────────────────────────────────

/**
 * Add one selectable row to a group — a device the agent may pick, or a discount
 * the order will carry automatically.
 *
 * `code` is optional: the scraper matches on it first and falls back to the
 * name, which is unique within a group.
 */
export async function adminAddOfferItem(
  groupId: string,
  rawName: string,
  code: string,
  monthly: string,
  /** Set to nest this row under an existing item — a Netflix tier, say. */
  parentId?: string | null,
  /** True for the child the portal auto-ticks. */
  included = false,
) {
  if (!(await verifyAdminSession())) return { success: false as const, error: "Unauthorized" };

  const name = rawName.trim();
  if (name.length < 3) {
    return { success: false as const, error: "Enter the item name as it appears in the portal." };
  }
  // Blank is fine (not every row shows a charge); a value must be a number so
  // "RM20" doesn't end up stored as text the UI can't format.
  const cleaned = monthly.replace(/[^\d.-]/g, "").trim();
  if (monthly.trim() && !/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return { success: false as const, error: "Monthly charge must be a number, e.g. 20 or -10." };
  }
  // A child belongs to its parent's group by construction: taking the group
  // from the parent rather than from the caller is what stops a tier being
  // recorded against a different group than the item it sits under.
  let targetGroupId = groupId;
  if (parentId) {
    const parent = await prisma.planOfferItem.findUnique({
      where: { id: parentId },
      select: { groupId: true, parentId: true },
    });
    if (!parent) return { success: false as const, error: "That item no longer exists." };
    if (parent.parentId) {
      return { success: false as const, error: "The portal's offer tree is only two levels deep." };
    }
    targetGroupId = parent.groupId;
  }

  try {
    const last = await prisma.planOfferItem.findFirst({
      where: { groupId: targetGroupId, parentId: parentId ?? null },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    await prisma.planOfferItem.create({
      data: {
        groupId: targetGroupId,
        parentId: parentId ?? null,
        included,
        name,
        code: code.trim() || null,
        monthly: cleaned ? Number(cleaned) : null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    return { success: true as const };
  } catch {
    return { success: false as const, error: "That item is already in this group." };
  }
}

export async function adminDeleteOfferItem(id: string) {
  if (!(await verifyAdminSession())) return { success: false as const, error: "Unauthorized" };
  await prisma.planOfferItem.delete({ where: { id } });
  return { success: true as const };
}

/**
 * What a plan offers, split by what the agent may do with it.
 *
 * Devices come from the mandatory DEVICE groups and are the only rows the
 * picker lists. Channels (Netflix, Max) and discounts are returned separately
 * because the agent never chooses them: the portal ticks them itself, and they
 * are shown read-only so the order can be understood without being mis-picked.
 */
export async function getPlanOffer(offerName: string): Promise<PlanOfferSplit> {
  const empty: PlanOfferSplit = { devices: [], channels: [], discounts: [], known: false };
  const session = await auth();
  if (!session?.user?.id) return empty;

  const plan = await prisma.plan.findUnique({
    where: { name: offerName },
    include: {
      offerGroups: {
        where: { mandatory: true },
        orderBy: { sortOrder: "asc" },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  if (!plan || !plan.published || plan.hidden) return empty;

  return splitPlanOffer(
    plan.offerGroups.map((g) => ({
      id: g.id,
      name: g.name,
      mandatory: g.mandatory,
      kind: toOfferGroupKind(g.kind),
      items: nestOfferItems(g.items),
    })),
  );
}
