import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { prisma } from "@/lib/prisma";
import { extractState } from "@/lib/malaysia-states";

const VALID_GRANULARITIES = new Set(["day", "week", "month", "quarter", "year"]);

const GRANULARITY_FORMAT: Record<string, string> = {
  day: "YYYY-MM-DD",
  week: "IYYY-\"W\"IW",
  month: "YYYY-MM",
  quarter: "YYYY-\"Q\"Q",
  year: "YYYY",
};

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    if (!wifibizzUser) {
      return NextResponse.json({
        totalCases: 0,
        byStatus: [],
        byProvider: [],
        timeSeriesByStatus: [],
        statusKeys: [],
        byState: [],
        allStatuses: [],
        allProviders: [],
        allPackages: [],
      });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const userId = wifibizzUser.id;

    const url = new URL(request.url);
    const granularity = VALID_GRANULARITIES.has(url.searchParams.get("granularity") ?? "")
      ? url.searchParams.get("granularity")!
      : "month";
    const chartProvider = url.searchParams.get("chart_provider")?.trim() || null;

    // State map filters — use null for empty values to avoid Postgres cast errors
    const stateStatus = url.searchParams.get("state_status")?.trim() || null;
    const stateDateFrom = url.searchParams.get("state_date_from")?.trim() || null;
    const stateDateTo = url.searchParams.get("state_date_to")?.trim() || null;
    const stateProvider = url.searchParams.get("state_provider")?.trim() || null;
    const statePackage = url.searchParams.get("state_package")?.trim() || null;

    const dateFormat = GRANULARITY_FORMAT[granularity];

    const [totalResult, byStatus, byProvider, timeSeriesByStatusRaw, addresses, allStatuses, allProviders, allPackages] =
      await Promise.all([
        sql`SELECT COUNT(*)::int as count FROM wifibizz_cases WHERE user_id = ${userId}`,
        sql`
          SELECT status as name, COUNT(*)::int as value
          FROM wifibizz_cases
          WHERE user_id = ${userId}
          GROUP BY status
          ORDER BY value DESC
        `,
        sql`
          SELECT provider as name, COUNT(*)::int as value
          FROM wifibizz_cases
          WHERE user_id = ${userId} AND provider IS NOT NULL
          GROUP BY provider
          ORDER BY value DESC
          LIMIT 8
        `,
        sql`
          SELECT
            TO_CHAR(case_created_at, ${dateFormat}) as period,
            status,
            COUNT(*)::int as cases
          FROM wifibizz_cases
          WHERE user_id = ${userId}
            AND case_created_at IS NOT NULL
            AND (${chartProvider}::text IS NULL OR provider = ${chartProvider})
          GROUP BY period, status
          ORDER BY period ASC
        `,
        sql`
          SELECT full_address FROM wifibizz_cases
          WHERE user_id = ${userId}
            AND full_address IS NOT NULL
            AND (${stateStatus}::text IS NULL OR status = ${stateStatus})
            AND (${stateProvider}::text IS NULL OR provider = ${stateProvider})
            AND (${statePackage}::text IS NULL OR package = ${statePackage})
            AND (${stateDateFrom}::text IS NULL OR case_created_at >= ${stateDateFrom}::timestamp)
            AND (${stateDateTo}::text IS NULL OR case_created_at < (${stateDateTo}::date + interval '1 day'))
        `,
        sql`
          SELECT DISTINCT status FROM wifibizz_cases
          WHERE user_id = ${userId} ORDER BY status
        `,
        sql`
          SELECT DISTINCT provider FROM wifibizz_cases
          WHERE user_id = ${userId} AND provider IS NOT NULL ORDER BY provider
        `,
        sql`
          SELECT DISTINCT package FROM wifibizz_cases
          WHERE user_id = ${userId} AND package IS NOT NULL ORDER BY package
        `,
      ]);

    // Extract states from addresses
    const stateCounts = new Map<string, number>();
    for (const row of addresses) {
      const state = extractState(row.full_address as string);
      if (state) {
        stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1);
      }
    }
    const byState = Array.from(stateCounts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Clean HTML from status values
    const cleanByStatus = byStatus.map((row) => ({
      name: typeof row.name === "string"
        ? row.name.replace(/<[^>]*>/g, "").trim()
        : row.name ?? "Unknown",
      value: row.value as number,
    }));

    const cleanAllStatuses = allStatuses.map((s) =>
      (s.status as string).replace(/<[^>]*>/g, "").trim()
    );

    // Pivot time series by status for multi-series chart
    const statusKeysSet = new Set<string>();
    const pivotMap = new Map<string, Record<string, number>>();
    for (const row of timeSeriesByStatusRaw) {
      const period = row.period as string;
      const status = typeof row.status === "string"
        ? row.status.replace(/<[^>]*>/g, "").trim()
        : "Unknown";
      statusKeysSet.add(status);
      if (!pivotMap.has(period)) pivotMap.set(period, {});
      pivotMap.get(period)![status] = row.cases as number;
    }
    const statusKeys = Array.from(statusKeysSet).sort();
    const timeSeriesByStatus = Array.from(pivotMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, statuses]) => ({ period, ...statuses }));

    return NextResponse.json({
      totalCases: totalResult[0]?.count ?? 0,
      byStatus: cleanByStatus,
      byProvider: byProvider.map((r) => ({
        name: r.name as string,
        value: r.value as number,
      })),
      timeSeriesByStatus,
      statusKeys,
      byState,
      allStatuses: cleanAllStatuses,
      allProviders: allProviders.map((r) => r.provider as string),
      allPackages: allPackages.map((r) => r.package as string),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Analytics fetch error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
