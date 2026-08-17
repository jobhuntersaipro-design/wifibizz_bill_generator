"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { verifyAdminSession } from "@/lib/admin-auth";
import { DEALER_OFFERS } from "@/lib/dealer-offers";

export interface OfferItemView {
  id: string;
  name: string;
  code: string | null;
  monthly: number | null;
}

export interface OfferGroupView {
  id: string;
  name: string;
  mandatory: boolean;
  /**
   * True when this group holds discounts rather than devices.
   *
   * Derived from the portal's own naming ("… With Device Discount[Pick 0-1]"),
   * the same rule the scraper uses to tell a discount row from a device row.
   * Discounts are applied automatically; only device groups are offered to the
   * agent.
   */
  isDiscount: boolean;
  items: OfferItemView[];
}

/**
 * Portal convention: discount groups say so in their name.
 *
 * Not exported — a "use server" module may only export async functions, and the
 * derived flag already travels to the client on OfferGroupView.isDiscount.
 */
function isDiscountGroupName(name: string): boolean {
  return /discount/i.test(name || "");
}

export interface PlanView {
  id: string;
  name: string;
  category: string;
  bandwidth: string | null;
  published: boolean;
  notes: string | null;
  offerGroups: OfferGroupView[];
}

/**
 * Make sure every package in the static catalogue exists as a Plan row.
 *
 * Seeding on read rather than in a migration keeps the two in step: when
 * DEALER_OFFERS gains a package, it shows up for the admin without a deploy
 * step. Existing rows are never touched, so publish state and offer groups
 * survive.
 */
async function seedPlans(): Promise<void> {
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
    items: { id: string; name: string; code: string | null; monthly: number | null }[];
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
      isDiscount: isDiscountGroupName(g.name),
      items: g.items,
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

export async function adminAddOfferGroup(planId: string, rawName: string, mandatory: boolean) {
  if (!(await verifyAdminSession())) return { success: false as const, error: "Unauthorized" };

  // The portal renders the "*" outside the group name; the admin copies the row
  // verbatim, so strip a trailing marker rather than storing it in the name that
  // has to match the dialog text.
  const name = rawName.replace(/[*\s]+$/, "").trim();
  if (name.length < 5) {
    return { success: false as const, error: "Enter the full offer group name." };
  }
  if (!/\[\s*Pick\s+\d+\s*-\s*[\dN]+\s*\]/i.test(name)) {
    return {
      success: false as const,
      error:
        "That doesn't look like an offer group name — it should end with its pick range, " +
        'e.g. "…Premium Value With Device[Pick 0-1]".',
    };
  }
  try {
    const last = await prisma.planOfferGroup.findFirst({
      where: { planId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    await prisma.planOfferGroup.create({
      data: { planId, name, mandatory, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
    return { success: true as const };
  } catch {
    return { success: false as const, error: "That offer group is already on this plan." };
  }
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
    where: { published: true },
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

/** The mandatory offer-group names for one plan — used by the submit payload. */
export async function mandatoryGroupsFor(offerName: string | null | undefined): Promise<string[]> {
  if (!offerName) return [];
  const plan = await prisma.plan.findUnique({
    where: { name: offerName },
    include: { offerGroups: { where: { mandatory: true }, orderBy: { sortOrder: "asc" } } },
  });
  return plan?.offerGroups.map((g) => g.name) ?? [];
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
  try {
    const last = await prisma.planOfferItem.findFirst({
      where: { groupId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    await prisma.planOfferItem.create({
      data: {
        groupId,
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
 * The devices an agent may pick for a plan, and the discounts it carries.
 *
 * Devices come from the mandatory NON-discount groups. Discounts are returned
 * separately because the agent never chooses them — they are applied during the
 * order and shown for information only.
 */
export async function getPlanOffer(offerName: string): Promise<{
  devices: OfferItemView[];
  discounts: OfferItemView[];
  known: boolean;
}> {
  const session = await auth();
  if (!session?.user?.id) return { devices: [], discounts: [], known: false };

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
  if (!plan || !plan.published) return { devices: [], discounts: [], known: false };

  const devices: OfferItemView[] = [];
  const discounts: OfferItemView[] = [];
  for (const g of plan.offerGroups) {
    (isDiscountGroupName(g.name) ? discounts : devices).push(...g.items);
  }
  // `known` distinguishes "this plan offers no devices" from "nobody has
  // recorded its items yet" — the picker falls back to the static catalogue
  // only in the second case.
  return { devices, discounts, known: devices.length > 0 };
}
