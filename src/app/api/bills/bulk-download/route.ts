import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { getFromR2 } from "@/lib/r2";
import archiver from "archiver";
import { PassThrough } from "stream";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const caseNos: string[] = body.caseNos;
    const type: string = body.type || "internet";

    if (!Array.isArray(caseNos) || caseNos.length === 0) {
      return NextResponse.json(
        { success: false, error: "caseNos must be a non-empty array" },
        { status: 400 }
      );
    }

    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    if (!wifibizzUser) {
      return NextResponse.json(
        { success: false, error: "WifiBizz account not linked" },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);
    const billColumn = type === "internet" ? "internet_bill_url" : "utility_bill_url";

    // Fetch all cases with bill URLs
    const rows = await sql`
      SELECT case_no, internet_bill_url, utility_bill_url, full_name, order_no
      FROM wifibizz_cases
      WHERE user_id = ${wifibizzUser.id}
        AND case_no = ANY(${caseNos})
    `;

    const casesWithBills = rows.filter(
      (r) => (r as Record<string, unknown>)[billColumn]
    );

    if (casesWithBills.length === 0) {
      return NextResponse.json(
        { success: false, error: "No generated bills found for selected cases" },
        { status: 404 }
      );
    }

    const publicUrlBase = process.env.R2_PUBLIC_URL!;

    // Create ZIP archive
    const passthrough = new PassThrough();
    const archive = archiver("zip", { zlib: { level: 5 } });
    archive.pipe(passthrough);

    // Set up the ReadableStream consumer BEFORE writing data to avoid
    // backpressure deadlock when the PassThrough buffer fills up
    const readable = new ReadableStream({
      start(controller) {
        passthrough.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        passthrough.on("end", () => controller.close());
        passthrough.on("error", (err) => controller.error(err));
      },
    });

    const filename = `internetBills_${new Date().toISOString().split("T")[0]}.zip`;

    // Populate the archive asynchronously — the response streams as data arrives
    (async () => {
      try {
        for (const row of casesWithBills) {
          const billUrl = (row as Record<string, unknown>)[billColumn] as string;
          const r2Key = billUrl.replace(`${publicUrlBase}/`, "");
          const stream = await getFromR2(r2Key);
          if (!stream) continue;

          const reader = stream.getReader();
          const chunks: Uint8Array[] = [];
          let done = false;
          while (!done) {
            const result = await reader.read();
            if (result.done) {
              done = true;
            } else {
              chunks.push(result.value);
            }
          }
          const buffer = Buffer.concat(chunks);

          const caseNo = (row as Record<string, unknown>).case_no as string;
          const orderNo = (row as Record<string, unknown>).order_no as string | null;
          const orderSuffix = orderNo ? `_${orderNo}` : "";
          archive.append(buffer, { name: `internetBill_${caseNo}${orderSuffix}.pdf` });
        }
        await archive.finalize();
      } catch (err) {
        archive.abort();
        passthrough.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return new Response(readable, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Bulk download error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
