import { NextRequest } from "next/server";

const BACKEND =
  process.env.BACKEND_INTERNAL_URL || "http://localhost:8000";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const subpath = path.join("/");
  const backendUrl = `${BACKEND}/api/debate/${subpath}`;

  const backendRes = await fetch(backendUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: await req.text(),
  });

  const ct = backendRes.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    return new Response(backendRes.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  return new Response(backendRes.body, {
    status: backendRes.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const subpath = path.join("/");
  const backendUrl = `${BACKEND}/api/debate/${subpath}`;

  const backendRes = await fetch(backendUrl);
  return new Response(backendRes.body, {
    status: backendRes.status,
    headers: { "Content-Type": "application/json" },
  });
}
