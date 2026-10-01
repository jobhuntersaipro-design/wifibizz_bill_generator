import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { prisma } from "@/lib/prisma";
import { toCsv } from "@/lib/admin-search";

/** POST { caseNos } → CSV of those cases (the caller's own only). */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { caseNos } = (await request.json().catch(() => ({}))) as { caseNos?: unknown };
  if (!Array.isArray(caseNos) || caseNos.length === 0 || !caseNos.every((c) => typeof c === "string")) {
    return NextResponse.json({ error: "caseNos must be a non-empty array" }, { status: 400 });
  }

  const wifibizzUser = await prisma.wifibizzUser.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!wifibizzUser) return NextResponse.json({ error: "WifiBizz account not linked" }, { status: 400 });

  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT case_no, order_no, status, full_name, company_name, company_reg, director_name, id_no,
           email, full_address, mobile, provider, package, agent, agent_remark,
           case_created_at, updated_at
    FROM wifibizz_cases
    WHERE user_id = ${wifibizzUser.id} AND case_no = ANY(${caseNos as string[]})
    ORDER BY case_created_at DESC
  `;

  const header = [
    "case_no", "order_id", "status", "full_name", "company", "company_reg", "director", "id_no",
    "email", "full_address", "mobile", "provider", "package", "agent", "agent_remark",
    "created_at", "updated_at",
  ];
  const keys = [
    "case_no", "order_no", "status", "full_name", "company_name", "company_reg", "director_name", "id_no",
    "email", "full_address", "mobile", "provider", "package", "agent", "agent_remark",
    "case_created_at", "updated_at",
  ];
  const cell = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | number | null) ?? null);
  // Streamed in slices so a large selection is not one buffered body.
  const enc = new TextEncoder();
  const SLICE = 2000;
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (i === 0) controller.enqueue(enc.encode(toCsv(header, [])));
      if (i >= rows.length) return controller.close();
      // toCsv with an empty header yields "\r\n" + the rows, ready to append.
      const slice = rows.slice(i, i + SLICE).map((r) => keys.map((k) => cell(r[k])));
      controller.enqueue(enc.encode(toCsv([], slice)));
      i += SLICE;
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cases_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
