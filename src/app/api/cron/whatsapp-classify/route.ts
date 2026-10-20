import { NextResponse } from "next/server";
import { classifyDueChats } from "@/lib/whatsapp-crm";
import { backfillFromEvents } from "@/lib/whatsapp-store";

/** Claude sorts WhatsApp chats with new customer messages into stage / folder / tags. Vercel Cron, every 5 minutes. */

export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET ?? "";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await backfillFromEvents();
    const run = await classifyDueChats();
    if (run.error) console.error("[cron/whatsapp-classify]", run.error);
    return NextResponse.json({ ok: true, ...run });
  } catch (e) {
    console.error("[cron/whatsapp-classify] failed:", e);
    return NextResponse.json({ error: "classify_failed" }, { status: 500 });
  }
}
