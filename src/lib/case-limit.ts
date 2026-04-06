import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";

export interface CaseUsage {
  current: number;
  limit: number;
  remaining: number;
  isAtLimit: boolean;
  billsGenerated: number;
  billsTotal: number;
  internetBills: number;
  utilityBills: number;
}

export async function getUserCaseUsage(userId: string): Promise<CaseUsage> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { caseLimit: true, wifibizzUser: { select: { id: true } } },
  });

  const limit = user?.caseLimit ?? 10;
  const wifibizzUserId = user?.wifibizzUser?.id;

  if (!wifibizzUserId) {
    return { current: 0, limit, remaining: limit, isAtLimit: false, billsGenerated: 0, billsTotal: 0, internetBills: 0, utilityBills: 0 };
  }

  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT COUNT(*)::int as count FROM wifibizz_cases WHERE user_id = ${wifibizzUserId}
  `;
  const current = rows[0]?.count ?? 0;

  const billRows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE internet_bill_url IS NOT NULL)::int as internet_count,
      COUNT(*) FILTER (WHERE utility_bill_url IS NOT NULL)::int as utility_count
    FROM wifibizz_cases WHERE user_id = ${wifibizzUserId}
  `;
  const internetBills = billRows[0]?.internet_count ?? 0;
  const utilityBills = billRows[0]?.utility_count ?? 0;

  return {
    current,
    limit,
    remaining: Math.max(0, limit - current),
    isAtLimit: current >= limit,
    billsGenerated: internetBills + utilityBills,
    billsTotal: current * 2,
    internetBills,
    utilityBills,
  };
}
