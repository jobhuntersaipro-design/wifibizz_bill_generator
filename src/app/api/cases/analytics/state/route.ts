import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { prisma } from "@/lib/prisma";
import { extractState } from "@/lib/malaysia-states";

interface CaseRow {
  full_address: string;
  status: string | null;
  provider: string | null;
  package: string | null;
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    if (!wifibizzUser) {
      return NextResponse.json({ total: 0, byStatus: [], byProvider: [], byPackage: [] });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const userId = wifibizzUser.id;

    const url = new URL(request.url);
    const stateName = url.searchParams.get("state")?.trim() || null;
    if (!stateName) {
      return NextResponse.json({ success: false, error: "state parameter required" }, { status: 400 });
    }

    const filterStatus = url.searchParams.get("status")?.trim() || null;
    const dateFrom = url.searchParams.get("date_from")?.trim() || null;
    const dateTo = url.searchParams.get("date_to")?.trim() || null;
    const filterProvider = url.searchParams.get("provider")?.trim() || null;
    const filterPackage = url.searchParams.get("package")?.trim() || null;

    const rows = await sql`
      SELECT full_address, status, provider, package
      FROM wifibizz_cases
      WHERE user_id = ${userId}
        AND full_address IS NOT NULL
        AND (${filterStatus}::text IS NULL OR status = ${filterStatus})
        AND (${filterProvider}::text IS NULL OR provider = ${filterProvider})
        AND (${filterPackage}::text IS NULL OR package = ${filterPackage})
        AND (${dateFrom}::text IS NULL OR case_created_at >= ${dateFrom}::timestamp)
        AND (${dateTo}::text IS NULL OR case_created_at < (${dateTo}::date + interval '1 day'))
    `;

    // Filter to the requested state(s) — "Selangor" includes KL + Putrajaya
    const targetStates = new Set([stateName]);
    if (stateName === "Selangor") {
      targetStates.add("Kuala Lumpur");
      targetStates.add("Putrajaya");
    }

    const matching: CaseRow[] = [];
    for (const row of rows) {
      const extracted = extractState(row.full_address as string);
      if (extracted && targetStates.has(extracted)) {
        matching.push(row as CaseRow);
      }
    }

    // Group by status
    const statusCounts = new Map<string, number>();
    const providerCounts = new Map<string, number>();
    const packageCounts = new Map<string, number>();

    for (const c of matching) {
      const s = c.status?.replace(/<[^>]*>/g, "").trim() || "Unknown";
      statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);

      if (c.provider) {
        providerCounts.set(c.provider, (providerCounts.get(c.provider) ?? 0) + 1);
      }
      if (c.package) {
        packageCounts.set(c.package, (packageCounts.get(c.package) ?? 0) + 1);
      }
    }

    const toSorted = (m: Map<string, number>) =>
      Array.from(m.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

    return NextResponse.json({
      total: matching.length,
      byStatus: toSorted(statusCounts),
      byProvider: toSorted(providerCounts),
      byPackage: toSorted(packageCounts),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("State analytics error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
