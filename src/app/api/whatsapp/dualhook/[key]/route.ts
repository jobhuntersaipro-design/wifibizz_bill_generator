import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { screenDualhookBody, secretMatches } from "@/lib/dualhook-webhook";
import { extractWhatsappEvent, verifyChallenge } from "@/lib/whatsapp-webhook";
import { ingestWebhook } from "@/lib/whatsapp-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

const TEXT = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

function reply(body: string, status: number) {
  return new NextResponse(body, { status, headers: TEXT });
}

/** A wrong path segment looks the same as a route that does not exist. */
async function pathOk(ctx: Ctx): Promise<boolean> {
  const { key } = await ctx.params;
  return secretMatches(key, process.env.WHATSAPP_WEBHOOK_PATH_KEY);
}

/**
 * Public. Dualhook relays Meta's Coexistence webhooks here. The path is outside
 * the auth proxy matcher in src/proxy.ts. Other methods get Next's own 405.
 */
export async function GET(req: Request, ctx: Ctx) {
  if (!(await pathOk(ctx))) return reply("not found", 404);
  const result = verifyChallenge(new URL(req.url).searchParams, process.env.WHATSAPP_VERIFY_TOKEN);
  return result.ok ? reply(result.challenge, 200) : reply("forbidden", 403);
}

export async function POST(req: Request, ctx: Ctx) {
  if (!(await pathOk(ctx))) return reply("not found", 404);

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(await req.text()) as unknown;
  } catch {
    return reply("bad json", 400);
  }

  const screen = screenDualhookBody(parsed, {
    wabaId: process.env.WHATSAPP_WABA_ID,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  });
  if (!screen.ok) {
    console.warn("[whatsapp/dualhook] rejected:", screen.reason);
    return reply("forbidden", 403);
  }
  if (screen.dropped.length > 0) console.info("[whatsapp/dualhook] ignored fields:", screen.dropped.join(","));
  if (screen.kept === 0) return reply("EVENT_RECEIVED", 200);

  // Answer at once; store after the response. Messages are keyed on their id, so a replay adds nothing.
  after(async () => {
    try {
      await prisma.whatsappWebhookEvent.create({
        data: { ...extractWhatsappEvent(screen.body), rawBody: JSON.stringify(screen.body) },
      });
      await ingestWebhook(screen.body);
    } catch (error) {
      console.error("[whatsapp/dualhook] store failed:", error instanceof Error ? error.message : "unknown");
    }
  });
  return reply("EVENT_RECEIVED", 200);
}
