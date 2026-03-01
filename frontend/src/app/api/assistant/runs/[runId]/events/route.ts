import { NextRequest } from "next/server";

const backendBaseUrl =
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(runId)) {
    return new Response(JSON.stringify({ error: "Invalid runId" }), { status: 400 });
  }
  const res = await fetch(
    `${backendBaseUrl}/api/assistant/runs/${runId}/events`,
    { cache: "no-store" }
  );
  if (!res.body) {
    return new Response(null, { status: 502 });
  }
  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
