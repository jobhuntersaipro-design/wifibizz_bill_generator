import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";
import { fetchAvatar, gatewayConfig } from "@/lib/whatsapp-send";

export const dynamic = "force-dynamic";

/** Admin-only proxy for a contact's WhatsApp profile picture; 404 when they have none or hide it. */
export async function GET(req: Request) {
  if (!(await verifyAdminSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const wa = new URL(req.url).searchParams.get("wa") ?? "";
  if (!/^\d{6,15}$/.test(wa)) return NextResponse.json({ error: "Invalid number" }, { status: 400 });
  const config = gatewayConfig();
  const bytes = config ? await fetchAvatar(config, wa) : null;
  if (!bytes) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, max-age=3600" } });
  return new NextResponse(bytes, {
    headers: { "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=21600" },
  });
}
