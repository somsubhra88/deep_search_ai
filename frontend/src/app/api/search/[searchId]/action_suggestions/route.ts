import { NextRequest, NextResponse } from "next/server";

const backendBaseUrl =
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ searchId: string }> }
) {
  const { searchId } = await params;
  const body = await req.json().catch(() => ({}));
  const res = await fetch(
    `${backendBaseUrl}/api/search/${encodeURIComponent(searchId)}/action_suggestions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    }
  );
  const data = await res.json().catch(() => []);
  return NextResponse.json(data, { status: res.status });
}
