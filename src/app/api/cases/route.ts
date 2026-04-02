import { NextResponse } from "next/server";
import { getCases } from "@/lib/crawler/db";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const email = url.searchParams.get("email");
    const limit = Math.min(Number(url.searchParams.get("limit") || "50"), 100);
    const offset = Number(url.searchParams.get("offset") || "0");

    if (!email) {
      return NextResponse.json(
        { success: false, error: "Email query parameter is required" },
        { status: 400 }
      );
    }

    const { data, count } = await getCases(email, limit, offset);

    return NextResponse.json({
      data,
      count,
      limit,
      offset,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Cases fetch error:", message);

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
