"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { verifyAdminSession } from "@/lib/admin-auth";
import { checkPlanDetail, cleanPlanName, type PlanDetailInput, type PlanDetailView } from "@/lib/plan-detail";

type Result<T = undefined> = { success: true; data: T } | { success: false; error: string };

const toView = (r: { id: string; name: string; price: { toFixed(n: number): string }; contractMonths: number }): PlanDetailView => ({
  id: r.id,
  name: r.name,
  price: r.price.toFixed(2),
  contractMonths: r.contractMonths,
});

export async function adminListPlanDetails(): Promise<Result<PlanDetailView[]>> {
  if (!(await verifyAdminSession())) return { success: false, error: "Unauthorized" };
  const rows = await prisma.planDetail.findMany({ orderBy: { name: "asc" } });
  return { success: true, data: rows.map(toView) };
}

/** Create a row (no id) or update one. A name already used by another row, ignoring case, is refused. */
export async function adminSavePlanDetail(id: string | null, input: PlanDetailInput): Promise<Result<PlanDetailView>> {
  if (!(await verifyAdminSession())) return { success: false, error: "Unauthorized" };
  const check = checkPlanDetail(input);
  if (!check.ok) return { success: false, error: check.error };
  const clash = await prisma.planDetail.findFirst({
    where: { name: { equals: check.name, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) },
    select: { id: true },
  });
  if (clash) return { success: false, error: "A plan with this name is already on the list." };
  const data = { name: check.name, price: check.price, contractMonths: check.contractMonths };
  const row = id
    ? await prisma.planDetail.update({ where: { id }, data })
    : await prisma.planDetail.create({ data });
  return { success: true, data: toView(row) };
}

export async function adminDeletePlanDetail(id: string): Promise<Result> {
  if (!(await verifyAdminSession())) return { success: false, error: "Unauthorized" };
  await prisma.planDetail.deleteMany({ where: { id } });
  return { success: true, data: undefined };
}

/** Price and contract months for the consent chat, matched by plan name (case and spacing ignored). */
export async function getPlanDetailTerms(pkg: string | null): Promise<{ fee: string; months: string } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const name = cleanPlanName(pkg ?? "");
  if (!name) return null;
  const row = await prisma.planDetail.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { price: true, contractMonths: true },
  });
  return row ? { fee: row.price.toFixed(2), months: String(row.contractMonths) } : null;
}
