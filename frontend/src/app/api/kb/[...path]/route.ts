import { NextRequest, NextResponse } from "next/server";

const backendBaseUrl =
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const upstream = await fetch(`${backendBaseUrl}/api/kb/${path.join("/")}`, {
    cache: "no-store",
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const contentType = req.headers.get("content-type") || "";
  const upstreamUrl = `${backendBaseUrl}/api/kb/${(await params).path.join("/")}`;

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      body: formData,
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  }

  const body = await req.text();
  const upstream = await fetch(upstreamUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const upstream = await fetch(`${backendBaseUrl}/api/kb/${path.join("/")}`, {
    method: "DELETE",
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
