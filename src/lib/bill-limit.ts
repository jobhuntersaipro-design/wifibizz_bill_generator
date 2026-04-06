import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";

export interface BillUsage {
  billsGenerated: number;
  limit: number;
  remaining: number;
  isAtLimit: boolean;
  internetBills: number;
  utilityBills: number;
  totalCases: number;
}

export async function getUserBillUsage(userId: string): Promise<BillUsage> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { billLimit: true, wifibizzUser: { select: { id: true } } },
  });

  const limit = user?.billLimit ?? 10;
  const wifibizzUserId = user?.wifibizzUser?.id;

  if (!wifibizzUserId) {
    return { billsGenerated: 0, limit, remaining: limit, isAtLimit: false, internetBills: 0, utilityBills: 0, totalCases: 0 };
  }

  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT
      COUNT(*)::int as total_cases,
      COUNT(*) FILTER (WHERE internet_bill_url IS NOT NULL)::int as internet_count,
      COUNT(*) FILTER (WHERE utility_bill_url IS NOT NULL)::int as utility_count
    FROM wifibizz_cases WHERE user_id = ${wifibizzUserId}
  `;

  const totalCases = rows[0]?.total_cases ?? 0;
  const internetBills = rows[0]?.internet_count ?? 0;
  const utilityBills = rows[0]?.utility_count ?? 0;
  const billsGenerated = internetBills + utilityBills;

  return {
    billsGenerated,
    limit,
    remaining: Math.max(0, limit - billsGenerated),
    isAtLimit: billsGenerated >= limit,
    internetBills,
    utilityBills,
    totalCases,
  };
}
