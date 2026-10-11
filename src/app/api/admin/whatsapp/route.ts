import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";
import { listConversations, listWhatsappEvents } from "@/lib/whatsapp-events";

export const dynamic = "force-dynamic";

export async function GET() {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [events, conversations] = await Promise.all([listWhatsappEvents(), listConversations()]);
  return NextResponse.json({ events, conversations });
}
