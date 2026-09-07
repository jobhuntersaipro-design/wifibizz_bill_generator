import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getBytesFromR2, uploadToR2 } from "@/lib/r2";
import {
  MAX_COMBINED_BYTES,
  MAX_DOC_BYTES,
  combineOrderDocuments,
  combinedFilename,
  ownedOrderKey,
} from "@/lib/order-combine";
import { COMBINED_DOC_TYPE, MIN_COMBINE } from "@/lib/order-merge";
import { MAX_DOCS } from "@/lib/order-types";

export const maxDuration = 60;

const bodySchema = z.object({
  keys: z
    .array(z.string().min(1).max(512))
    .min(MIN_COMBINE)
    .max(MAX_DOCS),
  idNumber: z.string().trim().min(1).max(50),
  idType: z.string().max(40).optional(),
  seq: z.number().int().min(1).max(99),
});

/**
 * POST /api/orders/combine-documents
 *
 * Merge the caller's already-stored supporting documents into one PDF and
 * store it. The body is keys only — the bytes are read from R2 — so a PDF+JPG
 * combine cannot blow the Server Action / platform request limit the way the
 * old "merge in the browser, upload the result" path did.
 *
 * Nothing about the source objects is deleted. The form drops those rows only
 * after this returns success, same as before.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Select at least two documents to combine." },
        { status: 400 },
      );
    }

    const { keys, idNumber, seq } = parsed.data;
    const uniqueKeys = [...new Set(keys)];
    if (uniqueKeys.some((key) => !ownedOrderKey(session.user.id, key))) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    const sources: { filename: string; bytes: Uint8Array }[] = [];
    const missing: string[] = [];
    const prefix = `orders/${session.user.id}/`;

    for (const key of uniqueKeys) {
      const filename = key.slice(prefix.length);
      const bytes = await getBytesFromR2(key);
      if (!bytes || bytes.byteLength === 0) {
        missing.push(filename);
        continue;
      }
      if (bytes.byteLength > MAX_DOC_BYTES) {
        return NextResponse.json(
          { success: false, error: "File exceeds the 5MB limit." },
          { status: 400 },
        );
      }
      sources.push({ filename, bytes });
    }

    if (sources.length === 0) {
      return NextResponse.json(
        { success: false, error: "None of the documents could be read — nothing was changed." },
        { status: 400 },
      );
    }

    const merged = await combineOrderDocuments(sources);
    if (merged.bytes.byteLength > MAX_COMBINED_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: "The combined PDF is too large to attach — nothing was changed.",
        },
        { status: 400 },
      );
    }

    const filename = combinedFilename(idNumber, seq);
    const key = `orders/${session.user.id}/${filename}`;
    await uploadToR2(key, merged.bytes, "application/pdf");
    const url = `/api/orders/document?key=${encodeURIComponent(key)}`;

    return NextResponse.json({
      success: true,
      url,
      key,
      filename,
      type: COMBINED_DOC_TYPE,
      pageCount: merged.pageCount,
      failed: [...missing, ...merged.failed],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Combine failed";
    console.error("order combine error:", message);
    return NextResponse.json(
      { success: false, error: "The combined PDF could not be attached — nothing was changed." },
      { status: 500 },
    );
  }
}
