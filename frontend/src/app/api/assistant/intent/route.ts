import { NextRequest, NextResponse } from "next/server";
import { chatCompletion } from "@/lib/llm";

export async function POST(req: NextRequest) {
  try {
    const { message, skill, context } = (await req.json()) as {
      message: string;
      skill: "email" | "calendar";
      context?: Record<string, unknown>;
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: "No message provided" }, { status: 400 });
    }

    if (skill === "email") {
      const systemPrompt = `You are an intent classifier for an email assistant. Given the user's message, determine what email action they want.

Return a JSON object with these fields:
- "action": one of "fetch_unread", "summarize", "clean", "search", "draft_reply", "unknown"
- "query": if action is "search", extract the search query string (what to search for). For other actions, set to null.
- "reasoning": one short sentence explaining why you chose this action.

Action descriptions:
- "fetch_unread": user wants to see/list their unread emails without summarization
- "summarize": user wants a summary/overview of their unread emails or inbox
- "clean": user wants to triage, categorize, identify newsletters, or clean up their inbox
- "search": user wants to find specific emails by sender, subject, date, keyword, etc.
- "draft_reply": user wants to compose/draft/reply to an email
- "unknown": the request doesn't relate to email operations

Examples:
- "Show me emails from John" → {"action": "search", "query": "from:John", "reasoning": "User wants to find emails from a specific sender"}
- "Find invoices from last month" → {"action": "search", "query": "invoice", "reasoning": "User wants to search for invoice emails"}
- "What's in my inbox?" → {"action": "summarize", "query": null, "reasoning": "User wants an overview of their inbox"}
- "Clean up my inbox" → {"action": "clean", "query": null, "reasoning": "User wants to triage their inbox"}
- "Search for emails about the project deadline" → {"action": "search", "query": "project deadline", "reasoning": "User wants to find emails about a specific topic"}
- "Show me unread emails" → {"action": "fetch_unread", "query": null, "reasoning": "User wants to see their unread emails"}
- "Do I have any emails from Amazon?" → {"action": "search", "query": "from:Amazon", "reasoning": "User wants to check for emails from Amazon"}
- "Reply to the latest email from Sarah" → {"action": "draft_reply", "query": null, "reasoning": "User wants to draft a reply"}
- "Star important emails" → {"action": "unknown", "query": null, "reasoning": "Starring emails is not supported"}

Reply with ONLY the JSON object, no other text.`;

      const result = await chatCompletion(systemPrompt, message, { maxTokens: 256 });
      const parsed = extractJson(result);
      return NextResponse.json(parsed || { action: "summarize", query: null, reasoning: "Could not parse intent" });
    }

    if (skill === "calendar") {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const tomorrowDate = new Date(now);
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowStr = tomorrowDate.toISOString().slice(0, 10);
      const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });

      const systemPrompt = `You are an intent classifier for a calendar assistant. Today is ${dayOfWeek}, ${todayStr}.

Given the user's message, determine what calendar action they want.

Return a JSON object with these fields:
- "action": one of "create_event", "list_today", "list_week", "search", "free_slots", "delete_event", "unknown"
- "event_data": if action is "create_event", provide {"title": "...", "date": "YYYY-MM-DD", "time": "HH:MM" (24h format), "duration": minutes_number, "description": "..."}. For other actions, set to null.
- "query": if action is "search", the search query. For other actions, set to null.
- "reasoning": one short sentence explaining your interpretation.

IMPORTANT for create_event:
- Always extract the time in 24-hour HH:MM format. "3pm" = "15:00", "9am" = "09:00", "noon" = "12:00", "midnight" = "00:00"
- "tomorrow" = ${tomorrowStr}
- "today" = ${todayStr}
- If no date is specified, default to today: ${todayStr}
- If no time is specified, set time to null (will create all-day event)
- If no duration specified, default to 60 minutes
- For "next Monday", "this Friday", etc., calculate the actual date

IMPORTANT for other actions:
- "What's on my calendar today?" → list_today
- "Show my schedule this week" → list_week
- "When am I free?" → free_slots
- "Find meetings about X" → search with query "X"
- "Cancel my 3pm meeting" → delete_event

Examples:
- "Add a meeting with John tomorrow at 2pm" → {"action": "create_event", "event_data": {"title": "Meeting with John", "date": "${tomorrowStr}", "time": "14:00", "duration": 60, "description": null}, "query": null, "reasoning": "User wants to create a meeting tomorrow at 2pm"}
- "Schedule team standup at 9:30am" → {"action": "create_event", "event_data": {"title": "Team standup", "date": "${todayStr}", "time": "09:30", "duration": 30, "description": null}, "query": null, "reasoning": "User wants to schedule a standup today at 9:30am"}
- "Add dentist appointment on 2026-03-15 at 4pm for 90 minutes" → {"action": "create_event", "event_data": {"title": "Dentist appointment", "date": "2026-03-15", "time": "16:00", "duration": 90, "description": null}, "query": null, "reasoning": "User wants a 90-min dentist appointment"}
- "What meetings do I have today?" → {"action": "list_today", "event_data": null, "query": null, "reasoning": "User wants to see today's schedule"}

Reply with ONLY the JSON object, no other text.`;

      const result = await chatCompletion(systemPrompt, message, { maxTokens: 512 });
      const parsed = extractJson(result);
      return NextResponse.json(parsed || { action: "list_today", event_data: null, query: null, reasoning: "Could not parse intent" });
    }

    return NextResponse.json({ error: `Unknown skill: ${skill}` }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.trim();
  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch { /* continue */ }
  // Try extracting from code block
  const codeBlock = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1].trim());
    } catch { /* continue */ }
  }
  // Try finding JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch { /* continue */ }
  }
  return null;
}
