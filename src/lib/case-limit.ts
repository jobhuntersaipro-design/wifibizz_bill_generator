import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";

export interface CaseUsage {
  casesUsed: number;
  limit: number;
  remaining: number;
  isAtLimit: boolean;
  internetBills: number;
  utilityBills: number;
  totalCases: number;
}

export async function getUserCaseUsage(userId: string): Promise<CaseUsage> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { caseLimit: true, wifibizzUser: { select: { id: true } } },
  });

  const limit = user?.caseLimit ?? 10;
  const wifibizzUserId = user?.wifibizzUser?.id;

  if (!wifibizzUserId) {
    return { casesUsed: 0, limit, remaining: limit, isAtLimit: false, internetBills: 0, utilityBills: 0, totalCases: 0 };
  }

  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT
      COUNT(*)::int as total_cases,
      COUNT(*) FILTER (WHERE internet_bill_url IS NOT NULL)::int as internet_count,
      COUNT(*) FILTER (WHERE utility_bill_url IS NOT NULL)::int as utility_count,
      COUNT(*) FILTER (WHERE internet_bill_url IS NOT NULL OR utility_bill_url IS NOT NULL)::int as cases_used
    FROM wifibizz_cases WHERE user_id = ${wifibizzUserId}
  `;

  const totalCases = rows[0]?.total_cases ?? 0;
  const internetBills = rows[0]?.internet_count ?? 0;
  const utilityBills = rows[0]?.utility_count ?? 0;
  const casesUsed = rows[0]?.cases_used ?? 0;

  return {
    casesUsed,
    limit,
    remaining: Math.max(0, limit - casesUsed),
    isAtLimit: casesUsed >= limit,
    internetBills,
    utilityBills,
    totalCases,
  };
}
