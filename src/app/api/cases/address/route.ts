import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { fillMissingAddresses } from "@/lib/crawler/lazy-address";

const MAX_BATCH = 20;

/**
 * POST /api/cases/address
 * Body: { caseNos: string[] }
 *
 * Resolves installation addresses on demand for cases that were crawled
 * list-only (blank full_address), persists them, and returns the resolved
 * addresses. Used before generating the WhatsApp closing script — same lazy
 * fill the bill generator performs.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const caseNos: string[] = body.caseNos;

    if (!Array.isArray(caseNos) || caseNos.length === 0) {
      return NextResponse.json(
        { success: false, error: "caseNos must be a non-empty array" },
        { status: 400 }
      );
    }
    if (caseNos.length > MAX_BATCH) {
      return NextResponse.json(
        { success: false, error: `Maximum ${MAX_BATCH} cases per batch` },
        { status: 400 }
      );
    }

    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        wifibizzEmail: true,
        wifibizzPasswordEnc: true,
        lastCrawlAt: true,
        googleSheetId: true,
      },
    });

    if (!wifibizzUser) {
      return NextResponse.json(
        { success: false, error: "WifiBizz account not linked" },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT case_no, full_address, case_url
      FROM wifibizz_cases
      WHERE case_no = ANY(${caseNos}) AND user_id = ${wifibizzUser.id}
    `;

    const cases = rows.map((r) => ({
      case_no: r.case_no as string,
      full_address: r.full_address as string | null,
      case_url: r.case_url as string | null,
    }));

    // Already-known addresses come back too, so the caller can just read the map.
    const addresses: Record<string, string> = {};
    for (const c of cases) {
      if (c.full_address && c.full_address.trim()) addresses[c.case_no] = c.full_address.trim();
    }

    const resolved = await fillMissingAddresses(wifibizzUser, cases);
    Object.assign(addresses, resolved);

    return NextResponse.json({ success: true, addresses });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Address resolution error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
