import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";
import { listWhatsappEvents } from "@/lib/whatsapp-events";

export const dynamic = "force-dynamic";

export async function GET() {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const events = await listWhatsappEvents();
  return NextResponse.json({ events });
}
