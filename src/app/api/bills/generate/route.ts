import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { uploadToR2 } from "@/lib/r2";
import { execFile } from "child_process";
import { readFile, unlink } from "fs/promises";
import path from "path";

function runPythonScript(
  scriptPath: string,
  caseNo: string,
  caseData: string,
  retries = 3
): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    function tryRun() {
      attempt++;
      const child = execFile(
        "python3",
        [scriptPath, caseNo],
        { timeout: 30000, maxBuffer: 10 * 1024 * 1024, env: { ...process.env } },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve();
          } else if (error.signal === "SIGTERM" && attempt < retries) {
            tryRun();
          } else {
            reject(new Error(stderr?.trim() || _stdout?.trim() || error.message));
          }
        }
      );
      // Pipe customer data via stdin so Python skips DB query
      child.stdin?.write(caseData);
      child.stdin?.end();
    }
    tryRun();
  });
}

const MAX_BATCH = 20;

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
    const billType: "internet" | "utility" = body.type === "utility" ? "utility" : "internet";

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
      select: { id: true },
    });

    if (!wifibizzUser) {
      return NextResponse.json(
        { success: false, error: "WifiBizz account not linked" },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Fetch all case data upfront in a single query
    const casesData = await sql`
      SELECT case_no, full_name, full_address, mobile
      FROM wifibizz_cases
      WHERE case_no = ANY(${caseNos}) AND user_id = ${wifibizzUser.id}
    `;

    const caseDataMap = new Map(
      casesData.map((c) => [
        c.case_no,
        JSON.stringify({
          case_no: c.case_no,
          full_name: c.full_name,
          full_address: c.full_address,
          mobile: c.mobile,
        }),
      ])
    );

    const scriptName = billType === "utility" ? "generate-utility-bill.py" : "generate-internet-bill.py";
    const scriptPath = path.resolve(process.cwd(), "bill_generator", scriptName);
    const outputDir = path.resolve(process.cwd(), "bill_generator", "output");
    const r2Prefix = billType === "utility" ? "utility_bill" : "internet_bill";
    const wifibizzUserId = wifibizzUser.id;

    const results: { caseNo: string; status: string; url?: string; error?: string }[] = [];

    async function processCase(caseNo: string) {
      const caseJson = caseDataMap.get(caseNo);
      if (!caseJson) {
        return { caseNo, status: "error", error: "Case not found or not owned" };
      }

      const outputPath = path.join(outputDir, `${r2Prefix}_${caseNo}.pdf`);

      try {
        await runPythonScript(scriptPath, caseNo, caseJson);

        const pdfBuffer = await readFile(outputPath);

        const r2Key = `bills/${wifibizzUserId}/${caseNo}/${r2Prefix}.pdf`;
        const publicUrl = await uploadToR2(r2Key, pdfBuffer, "application/pdf");

        if (billType === "utility") {
          await sql`
            UPDATE wifibizz_cases
            SET utility_bill_url = ${publicUrl}
            WHERE case_no = ${caseNo} AND user_id = ${wifibizzUserId}
          `;
        } else {
          await sql`
            UPDATE wifibizz_cases
            SET internet_bill_url = ${publicUrl}
            WHERE case_no = ${caseNo} AND user_id = ${wifibizzUserId}
          `;
        }

        return { caseNo, status: "success", url: publicUrl } as const;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed";
        console.error(`Bill generation failed for ${caseNo}:`, message);
        return { caseNo, status: "error", error: message } as const;
      } finally {
        try {
          await unlink(outputPath);
        } catch {
          // File may not exist if generation failed
        }
      }
    }

    // Process cases concurrently in chunks of 5
    const CONCURRENCY = 5;
    for (let i = 0; i < caseNos.length; i += CONCURRENCY) {
      const chunk = caseNos.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(processCase));
      results.push(...chunkResults);
    }

    const successCount = results.filter((r) => r.status === "success").length;

    return NextResponse.json({
      success: true,
      generated: successCount,
      total: caseNos.length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Bill generation error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
