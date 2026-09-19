import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { prisma } from "@/lib/prisma";
import { caseDateFilterBounds, isInvalidCaseDateRange, parseCaseDateField } from "@/lib/case-list-filters";

const SORTABLE_COLUMNS = new Set([
  "case_no", "order_no", "full_name", "company_name", "director_name", "full_address", "mobile",
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
    if (isInvalidCaseDateRange(dateFrom, dateTo)) {
      return NextResponse.json(
        { success: false, error: "date_to cannot be before date_from" },
        { status: 400 },
      );
    }
    const { createdFrom, createdTo, updatedFrom, updatedTo } = caseDateFilterBounds(
      parseCaseDateField(url.searchParams.get("date_field")),
      dateFrom,
      dateTo,
    );

    // Sorting — validated against whitelist so safe to interpolate
    const sortByParam = url.searchParams.get("sort_by")?.trim() ?? "";
    const sortDir = url.searchParams.get("sort_dir")?.trim() === "asc" ? "ASC" : "DESC";
    const sortBy = SORTABLE_COLUMNS.has(sortByParam) ? sortByParam : "case_created_at";
    // Residential rows store '' in the business columns, and '' sorts before any
    // company — so sorting by Company would open on a page of dashes. Blank is
    // treated as NULL for these two, and NULLS LAST sends it to the end.
    // (sortBy is whitelisted above, so interpolating it is safe.)
    const sortExpr = sortBy === "company_name" || sortBy === "director_name"
      ? `NULLIF(${sortBy}, '')`
      : sortBy;

    // Get the user's wifibizz_user id
    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
      select: { id: true, lastCrawlAt: true },
    });

    if (!wifibizzUser) {
      return NextResponse.json({ data: [], count: 0, limit, offset, last_crawl_at: null });
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
          OR order_no ILIKE ${searchPattern}
          OR mobile ILIKE ${searchPattern}
          OR email ILIKE ${searchPattern}
          OR provider ILIKE ${searchPattern}
          OR full_address ILIKE ${searchPattern}
        ))
        AND (${!status} OR status = ${status})
        AND (${!createdFrom} OR case_created_at >= ${createdFrom || '1970-01-01'}::timestamp)
        AND (${!createdTo} OR case_created_at <= (${createdTo || '9999-12-31'}::date + interval '1 day'))
        AND (${!updatedFrom} OR updated_at >= ${updatedFrom || '1970-01-01'}::timestamp)
        AND (${!updatedTo} OR updated_at <= (${updatedTo || '9999-12-31'}::date + interval '1 day'))
    `;

    // Dynamic ORDER BY using sql.unsafe() — sortBy is validated against SORTABLE_COLUMNS whitelist
    const rows = await sql`
      SELECT case_no, case_url, full_name, full_address, mobile, email, id_no,
             id_type, company_name, company_reg, director_name,
             provider, package, order_no, agent, agent_remark,
             status, internet_bill_url, utility_bill_url, case_created_at, updated_at
      FROM wifibizz_cases
      WHERE user_id = ${wifibizzUser.id}
        AND (${!search} OR (
          full_name ILIKE ${searchPattern}
          OR case_no ILIKE ${searchPattern}
          OR order_no ILIKE ${searchPattern}
          OR mobile ILIKE ${searchPattern}
          OR email ILIKE ${searchPattern}
          OR provider ILIKE ${searchPattern}
          OR full_address ILIKE ${searchPattern}
        ))
        AND (${!status} OR status = ${status})
        AND (${!createdFrom} OR case_created_at >= ${createdFrom || '1970-01-01'}::timestamp)
        AND (${!createdTo} OR case_created_at <= (${createdTo || '9999-12-31'}::date + interval '1 day'))
        AND (${!updatedFrom} OR updated_at >= ${updatedFrom || '1970-01-01'}::timestamp)
        AND (${!updatedTo} OR updated_at <= (${updatedTo || '9999-12-31'}::date + interval '1 day'))
      ORDER BY ${sql.unsafe(sortExpr)} ${sql.unsafe(sortDir)} NULLS LAST
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
      last_crawl_at: wifibizzUser.lastCrawlAt?.toISOString() ?? null,
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
