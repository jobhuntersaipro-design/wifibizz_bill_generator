import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractWhatsappEvent, signatureOk, verifyChallenge } from "@/lib/whatsapp-webhook";

export const dynamic = "force-dynamic";

/**
 * Public. 360dialog calls this; there is no session. The path is outside the
 * auth proxy matcher in src/proxy.ts, so a logged-in agent is not required.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const result = verifyChallenge(url.searchParams, process.env.WHATSAPP_VERIFY_TOKEN);
  if (!result.ok) {
    return new NextResponse("forbidden", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return new NextResponse(result.challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  const raw = Buffer.from(await req.arrayBuffer());
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret) {
    if (!signatureOk(raw, req.headers.get("x-hub-signature-256"), secret)) {
      return new NextResponse("forbidden", {
        status: 403,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }

  const text = raw.toString("utf8");
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }
  const extracted = parsed === null ? extractWhatsappEvent(null) : extractWhatsappEvent(parsed);

  try {
    await prisma.whatsappWebhookEvent.create({
      data: { ...extracted, rawBody: text },
    });
  } catch (error) {
    console.error(
      "[whatsapp/webhook] store failed:",
      error instanceof Error ? error.name : "unknown",
    );
    return new NextResponse("store_failed", { status: 500 });
  }

  return new NextResponse("EVENT_RECEIVED", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
