import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pickRandomUmobileImage } from "@/lib/bill-generator/umobile-modem";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const exclude = new URL(request.url).searchParams.get("exclude") || undefined;
  const pick = await pickRandomUmobileImage(exclude);
  return NextResponse.json({
    success: true,
    id: pick?.id ?? null,
    filename: pick?.filename ?? null,
  });
}
