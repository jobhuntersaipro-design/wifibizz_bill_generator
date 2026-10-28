import { NextResponse } from "next/server";
import { purgeOldWhatsapp } from "@/lib/whatsapp-retention";

/** Deletes WhatsApp chats older than 3 months. Vercel Cron, once a day. */

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET ?? "";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const run = await purgeOldWhatsapp();
    console.info("[cron/whatsapp-retention]", JSON.stringify(run));
    return NextResponse.json({ ok: true, ...run });
  } catch (e) {
    console.error("[cron/whatsapp-retention] failed:", e);
    return NextResponse.json({ error: "retention_failed" }, { status: 500 });
  }
}
