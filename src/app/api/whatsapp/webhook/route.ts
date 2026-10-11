import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeWhatsappPost, extractWhatsappEvent, verifyChallenge } from "@/lib/whatsapp-webhook";

export const dynamic = "force-dynamic";

/**
 * Public. The WhatsApp gateway on the droplet calls this; there is no session. The path is outside the
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
  const allowed = authorizeWhatsappPost({
    vercelEnv: process.env.VERCEL_ENV,
    webhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    webhookHeader: req.headers.get("x-webhook-secret"),
    d360Header: req.headers.get("d360-webhook-secret"),
    hubSignature: req.headers.get("x-hub-signature-256"),
    raw,
  });
  if (!allowed.ok) {
    return new NextResponse(allowed.status === 401 ? "unauthorized" : "forbidden", {
      status: allowed.status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
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
