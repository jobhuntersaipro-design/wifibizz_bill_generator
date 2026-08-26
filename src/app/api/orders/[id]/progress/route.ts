/**
 * Live progress for one in-flight order submit.
 *
 * The browser polls this while a row is submitting. Each call advances the
 * order's persisted stage and, once the scraper's job finishes, writes the
 * final status — so the run is finalized by whoever polls, not by whoever
 * started it. That is what makes closing the tab mid-submit survivable.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { pollOrderProgress } from "@/lib/order-submit";
import { pollCancelProgress } from "@/lib/order-cancel";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  // Same visibility rule as submitting: superadmins may follow any order, and
  // everyone else only their own.
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isSuperAdmin: true },
  });
  const order = await prisma.order.findFirst({
    where: me?.isSuperAdmin ? { id } : { id, userId: session.user.id },
    select: { id: true, status: true },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A cancelling row's job is a portal-cancel run — same pipeline, different
  // finalizer (only the cancel poll may ever produce "cancelled").
  const state =
    order.status === "cancelling"
      ? await pollCancelProgress(id)
      : await pollOrderProgress(id);
  if (!state) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(state, {
    headers: { "Cache-Control": "no-store" },
  });
}
