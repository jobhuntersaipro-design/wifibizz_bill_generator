import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { prisma } from "@/lib/prisma";
import { caseDateFilterBounds, isInvalidCaseDateRange, parseCaseDateField } from "@/lib/case-list-filters";
import { caseSearchPattern } from "@/lib/case-search";

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
      return NextResponse.json({ case_nos: [], count: 0 });
    }

    const url = new URL(request.url);
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

    const sql = neon(process.env.DATABASE_URL!);
    const searchPattern = caseSearchPattern(search);

    const rows = await sql`
      SELECT case_no
      FROM wifibizz_cases
      WHERE user_id = ${wifibizzUser.id}
        AND (${!searchPattern} OR concat_ws(' ', case_no, full_name, mobile, email, id_no, id_type,
          company_name, company_reg, director_name, full_address, provider, package,
          order_no, agent, agent_remark, status) ILIKE ${searchPattern})
        AND (${!status} OR status = ${status})
        AND (${!createdFrom} OR case_created_at >= ${createdFrom || '1970-01-01'}::timestamp)
        AND (${!createdTo} OR case_created_at <= (${createdTo || '9999-12-31'}::date + interval '1 day'))
        AND (${!updatedFrom} OR updated_at >= ${updatedFrom || '1970-01-01'}::timestamp)
        AND (${!updatedTo} OR updated_at <= (${updatedTo || '9999-12-31'}::date + interval '1 day'))
      ORDER BY case_created_at DESC
    `;

    return NextResponse.json({
      case_nos: rows.map((r) => r.case_no as string),
      count: rows.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Cases IDs fetch error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
