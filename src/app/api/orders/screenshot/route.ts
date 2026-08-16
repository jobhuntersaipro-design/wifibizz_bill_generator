import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFromR2 } from "@/lib/r2";

/**
 * Serve a submit's page-1 screenshot.
 *
 * Separate from /api/orders/document for two reasons: that route forces
 * `Content-Disposition: attachment` (so an <img> against it downloads instead of
 * rendering), and screenshots live under their own `order-screenshots/` prefix so
 * a 90-day R2 lifecycle rule can expire them without touching customer documents,
 * which must not expire.
 *
 * These frames carry the customer's name, installation address, mobile and email,
 * so reads are scoped to the caller's own namespace — the same rule the document
 * route applies.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const key = new URL(request.url).searchParams.get("key") || "";

  // Scope to the caller's own namespace so order ids can't be scanned across
  // tenants. `..` is rejected outright rather than normalised.
  const prefix = `order-screenshots/${session.user.id}/`;
  if (!key.startsWith(prefix) || key.includes("..") || !key.endsWith(".png")) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  try {
    const stream = await getFromR2(key);
    if (!stream) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    return new Response(stream, {
      headers: {
        "Content-Type": "image/png",
        // Inline so the detail panel can render it as a thumbnail. Safe here
        // because the type is fixed by the .png guard above, never taken from
        // what was stored, and nosniff stops the browser second-guessing it.
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("order screenshot error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
}
