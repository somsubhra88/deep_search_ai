import { NextRequest, NextResponse } from "next/server";
import { chatCompletion } from "@/lib/llm";

export async function POST(req: NextRequest) {
  try {
    const { system, message } = (await req.json()) as {
      system?: string;
      message: string;
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: "No message provided" }, { status: 400 });
    }

    const systemPrompt = system || "You are a helpful assistant. Be concise and use markdown formatting.";
    const result = await chatCompletion(systemPrompt, message, { maxTokens: 1024 });
    return NextResponse.json({ response: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
