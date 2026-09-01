import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";
import { getFromR2 } from "@/lib/r2";

/**
 * The types a capture may be stored as, and what to serve them back as.
 *
 * The same allowlist the agent-facing route carries, and for the same reason:
 * captures are JPEG today, every frame taken before that change is a PNG, and
 * the e-RF is a PDF — all three are still referenced by their status events.
 */
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
};

/**
 * Serve one capture to an ADMIN, for any agent's order.
 *
 * `/api/orders/screenshot` cannot do this: it resolves keys against the
 * CALLER's own R2 namespace (`order-screenshots/<their user id>/`), and admin is
 * not a NextAuth user and has no namespace at all. So the admin timeline printed
 * `order-screenshots/…/submit-7-failure.jpg` as text, and reading the one frame
 * that said why an order failed eight times meant a hand-written S3 script.
 *
 * Dropping the namespace scope is the whole point and is deliberate — admin
 * oversight is cross-agent by design, the same asymmetry the admin order queries
 * already have. Every OTHER guard the agent route applies is kept:
 *
 *   - the `order-screenshots/` prefix, so this cannot be walked onto customer
 *     documents (which live under `orders/`) or anything else in the bucket;
 *   - `..` rejected outright rather than normalised;
 *   - the Content-Type comes from the extension allowlist, never from what was
 *     stored, with `nosniff` so the browser does not second-guess it.
 *
 * These frames carry the customer's name, address, mobile and email, which is
 * why the gate is the admin session and not merely "hard to guess".
 */
export async function GET(request: Request) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const key = new URL(request.url).searchParams.get("key") || "";
  const contentType = CONTENT_TYPES[key.split(".").pop()?.toLowerCase() ?? ""];
  if (!key.startsWith("order-screenshots/") || key.includes("..") || !contentType) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const filename = (key.split("/").pop() ?? "capture").replace(/["\\]/g, "");

  try {
    const stream = await getFromR2(key);
    if (!stream) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    return new Response(stream, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("admin screenshot error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
}
