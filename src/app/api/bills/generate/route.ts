import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { uploadToR2 } from "@/lib/r2";
import { execFile } from "child_process";
import { readFile, unlink } from "fs/promises";
import path from "path";

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

    // Get user's wifibizz_user id
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
    const scriptPath = path.resolve(process.cwd(), "bill_generator", "generate-internet-bill.py");
    const outputDir = path.resolve(process.cwd(), "bill_generator", "output");

    const results: { caseNo: string; status: string; url?: string; error?: string }[] = [];

    for (const caseNo of caseNos) {
      // Verify case belongs to user
      const caseCheck = await sql`
        SELECT case_no FROM wifibizz_cases
        WHERE case_no = ${caseNo} AND user_id = ${wifibizzUser.id}
      `;

      if (caseCheck.length === 0) {
        results.push({ caseNo, status: "error", error: "Case not found or not owned" });
        continue;
      }

      const outputPath = path.join(outputDir, `utility_bill_${caseNo}.pdf`);

      try {
        // Run Python script
        await new Promise<void>((resolve, reject) => {
          execFile(
            "python3",
            [scriptPath, caseNo],
            { timeout: 30000, env: { ...process.env } },
            (error, _stdout, stderr) => {
              if (error) {
                reject(new Error(stderr || error.message));
              } else {
                resolve();
              }
            }
          );
        });

        // Read generated PDF
        const pdfBuffer = await readFile(outputPath);

        // Upload to R2
        const r2Key = `bills/${wifibizzUser.id}/${caseNo}/internet_bill.pdf`;
        const publicUrl = await uploadToR2(r2Key, pdfBuffer, "application/pdf");

        // Update DB with bill URL
        await sql`
          UPDATE wifibizz_cases
          SET internet_bill_url = ${publicUrl}
          WHERE case_no = ${caseNo} AND user_id = ${wifibizzUser.id}
        `;

        results.push({ caseNo, status: "success", url: publicUrl });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed";
        console.error(`Bill generation failed for ${caseNo}:`, message);
        results.push({ caseNo, status: "error", error: message });
      } finally {
        // Clean up local file
        try {
          await unlink(outputPath);
        } catch {
          // File may not exist if generation failed
        }
      }
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
