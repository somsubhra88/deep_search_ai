import { NextResponse } from "next/server";

const backendBaseUrl =
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${backendBaseUrl}/api/models/registry`, {
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(`Failed to fetch model registry: HTTP ${res.status}`);
      return NextResponse.json({ catalog: {} }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error fetching model registry:", error);
    return NextResponse.json({ catalog: {} }, { status: 500 });
  }
}
