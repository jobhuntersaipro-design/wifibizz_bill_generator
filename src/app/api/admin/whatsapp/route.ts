import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";
import { getThread, listChats, listLabels } from "@/lib/whatsapp-events";
import { whatsappFixtureEnabled } from "@/lib/whatsapp-inbox-fixture";
import { backfillFromEvents } from "@/lib/whatsapp-store";

export const dynamic = "force-dynamic";

const WA_ID = /^\d{6,15}$/;

/** `?view=raw` returns the raw event log; `?chat=<wa_id>` returns that chat's thread; otherwise the chat list (`?q=` searches) and the CRM labels. */
export async function GET(req: Request) {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const view = url.searchParams.get("view");
  if (view === "labels") return NextResponse.json({ labels: await listLabels() });
  const chat = url.searchParams.get("chat");
  if (chat !== null) {
    if (!WA_ID.test(chat)) return NextResponse.json({ error: "Invalid chat" }, { status: 400 });
    return NextResponse.json({ messages: await getThread(chat) });
  }
  if (!whatsappFixtureEnabled()) await backfillFromEvents();
  const [chats, labels] = await Promise.all([listChats(url.searchParams.get("q") ?? ""), listLabels()]);
  return NextResponse.json({ chats, labels });
}
