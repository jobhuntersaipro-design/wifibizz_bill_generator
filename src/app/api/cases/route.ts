import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { prisma } from "@/lib/prisma";

const SORTABLE_COLUMNS = new Set([
  "case_no", "order_no", "full_name", "full_address", "mobile",
  "provider", "package", "agent_remark", "status", "case_created_at", "updated_at",
]);

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || "10"), 100);
    const offset = Number(url.searchParams.get("offset") || "0");
    const search = url.searchParams.get("search")?.trim() ?? "";
    const status = url.searchParams.get("status")?.trim() ?? "";
    const dateFrom = url.searchParams.get("date_from")?.trim() ?? "";
    const dateTo = url.searchParams.get("date_to")?.trim() ?? "";

    // Sorting — validated against whitelist so safe to interpolate
    const sortByParam = url.searchParams.get("sort_by")?.trim() ?? "";
    const sortDir = url.searchParams.get("sort_dir")?.trim() === "asc" ? "ASC" : "DESC";
    const sortBy = SORTABLE_COLUMNS.has(sortByParam) ? sortByParam : "case_created_at";

    // Get the user's wifibizz_user id
    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    if (!wifibizzUser) {
      return NextResponse.json({ data: [], count: 0, limit, offset });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const searchPattern = search ? `%${search}%` : "";

    const countResult = await sql`
      SELECT COUNT(*)::int as count
      FROM wifibizz_cases
      WHERE user_id = ${wifibizzUser.id}
        AND (${!search} OR (
          full_name ILIKE ${searchPattern}
          OR case_no ILIKE ${searchPattern}
          OR mobile ILIKE ${searchPattern}
          OR email ILIKE ${searchPattern}
          OR provider ILIKE ${searchPattern}
          OR full_address ILIKE ${searchPattern}
        ))
        AND (${!status} OR status = ${status})
        AND (${!dateFrom} OR case_created_at >= ${dateFrom || '1970-01-01'}::timestamp)
        AND (${!dateTo} OR case_created_at <= (${dateTo || '9999-12-31'}::date + interval '1 day'))
    `;

    // Dynamic ORDER BY using sql.unsafe() — sortBy is validated against SORTABLE_COLUMNS whitelist
    const rows = await sql`
      SELECT case_no, case_url, full_name, full_address, mobile, email, id_no,
             provider, package, order_no, agent, agent_remark,
             status, case_created_at, updated_at
      FROM wifibizz_cases
      WHERE user_id = ${wifibizzUser.id}
        AND (${!search} OR (
          full_name ILIKE ${searchPattern}
          OR case_no ILIKE ${searchPattern}
          OR mobile ILIKE ${searchPattern}
          OR email ILIKE ${searchPattern}
          OR provider ILIKE ${searchPattern}
          OR full_address ILIKE ${searchPattern}
        ))
        AND (${!status} OR status = ${status})
        AND (${!dateFrom} OR case_created_at >= ${dateFrom || '1970-01-01'}::timestamp)
        AND (${!dateTo} OR case_created_at <= (${dateTo || '9999-12-31'}::date + interval '1 day'))
      ORDER BY ${sql.unsafe(sortBy)} ${sql.unsafe(sortDir)} NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `;

    // Get distinct statuses for filter dropdown
    const statuses = await sql`
      SELECT DISTINCT status FROM wifibizz_cases
      WHERE user_id = ${wifibizzUser.id}
      ORDER BY status
    `;

    // Strip any HTML tags from status values (legacy data may contain raw HTML)
    const cleanRows = rows.map((row: Record<string, unknown>) => ({
      ...row,
      status: typeof row.status === "string"
        ? row.status.replace(/<[^>]*>/g, "").trim()
        : row.status,
    }));

    const cleanStatuses = statuses.map((s) => {
      const raw = s.status as string;
      return raw.replace(/<[^>]*>/g, "").trim();
    });

    return NextResponse.json({
      data: cleanRows,
      count: countResult[0]?.count ?? 0,
      limit,
      offset,
      statuses: cleanStatuses,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Cases fetch error:", message);

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
