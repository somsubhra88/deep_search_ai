import { NextRequest, NextResponse } from "next/server";

const backendBaseUrl =
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider_id: string }> }
) {
  try {
    const { provider_id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const apiKey = searchParams.get("api_key");
    const forceRefresh = searchParams.get("force_refresh");

    let url = `${backendBaseUrl}/api/models/${provider_id}`;
    const queryParams = new URLSearchParams();

    if (apiKey) queryParams.append("api_key", apiKey);
    if (forceRefresh) queryParams.append("force_refresh", forceRefresh);

    if (queryParams.toString()) {
      url += `?${queryParams.toString()}`;
    }

    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!res.ok) {
      console.error(`Failed to fetch models for ${provider_id}: HTTP ${res.status}`);
      const errorData = await res.json().catch(() => ({ error: "Failed to fetch models", models: [] }));
      return NextResponse.json({ ...errorData, models: [] }, { status: res.status });
    }

    const data = await res.json();
    console.log(`Successfully fetched ${data.models?.length || 0} models for ${provider_id}`);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error fetching models:", error);
    return NextResponse.json(
      { error: "Failed to fetch models", models: [] },
      { status: 500 }
    );
  }
}
