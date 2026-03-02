import { NextRequest, NextResponse } from "next/server";

const backendBaseUrl =
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const email_connected = searchParams.get("email_connected") === "true";
  const calendar_connected = searchParams.get("calendar_connected") === "true";
  const url = new URL(`${backendBaseUrl}/api/assistant/personas`);
  url.searchParams.set("email_connected", String(email_connected));
  url.searchParams.set("calendar_connected", String(calendar_connected));
  const res = await fetch(url.toString(), { cache: "no-store" });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
