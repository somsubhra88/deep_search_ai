import { NextRequest, NextResponse } from "next/server";

const backendBaseUrl =
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

export async function GET(req: NextRequest) {
  const threshold = req.nextUrl.searchParams.get("threshold");
  const qs = threshold ? `?threshold=${encodeURIComponent(threshold)}` : "";
  const upstream = await fetch(
    `${backendBaseUrl}/api/memory/graph${qs}`,
    { cache: "no-store" },
  );

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "Failed to fetch memory graph" },
      { status: upstream.status },
    );
  }

  const data = await upstream.json();
  return NextResponse.json(data);
}
