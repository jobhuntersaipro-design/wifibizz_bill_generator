import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";
import { d360Key, fetchMedia } from "@/lib/whatsapp-send";

export const dynamic = "force-dynamic";

/**
 * Admin-only proxy for inbound WhatsApp media, so the 360dialog key never
 * reaches the browser. Images and PDFs only; the type is from our allowlist.
 */
export async function GET(req: Request) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^\d{1,32}$/.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const key = d360Key();
  if (!key) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const media = await fetchMedia(key, id);
  if (!media.ok) return NextResponse.json({ error: "Unavailable" }, { status: media.status });
  return new NextResponse(media.bytes, {
    headers: {
      "Content-Type": media.mime,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
