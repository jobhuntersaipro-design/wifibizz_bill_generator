import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFromR2 } from "@/lib/r2";

// Content-type is derived from the (allowlisted) extension, never from what was
// stored, and everything is served with nosniff so a document can't execute in
// the browser. Default disposition is attachment; `view=1` opts into inline so
// the detail page can render thumbnails and an iframe PDF preview — safe for
// exactly the same reason the screenshot route serves inline: the allowlist
// below holds only raster images and PDF (no SVG, no HTML), so there is nothing
// a browser could execute when told to display one.
const EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  bmp: "image/bmp",
  webp: "image/webp",
  pdf: "application/pdf",
};

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  const inline = url.searchParams.get("view") === "1";

  // Scope to the caller's own namespace — orders/<userId>/... — so ID scans
  // can't be read (or MyKad-based filenames enumerated) across tenants.
  const prefix = `orders/${session.user.id}/`;
  if (!key.startsWith(prefix) || key.includes("..")) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const ext = (key.split(".").pop() || "").toLowerCase();
  const contentType = EXT_CONTENT_TYPE[ext];
  if (!contentType) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  try {
    const stream = await getFromR2(key);
    if (!stream) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    // Quotes/backslashes stripped so the filename cannot break out of the
    // header value (same rule the screenshot route applies).
    const filename = key.slice(prefix.length).replace(/["\\]/g, "");
    return new Response(stream, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("order document download error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
}
