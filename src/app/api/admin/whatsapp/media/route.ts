import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";
import { fetchMedia, gatewayConfig } from "@/lib/whatsapp-send";

export const dynamic = "force-dynamic";

/**
 * Admin-only proxy for inbound WhatsApp media, so the gateway token never
 * reaches the browser. Images and PDFs only; the type is from our allowlist.
 */
export async function GET(req: Request) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9]{1,64}$/.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const config = gatewayConfig();
  if (!config) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const media = await fetchMedia(config, id);
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
