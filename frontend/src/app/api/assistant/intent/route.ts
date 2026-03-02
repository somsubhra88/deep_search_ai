import { NextRequest, NextResponse } from "next/server";
import { chatCompletion } from "@/lib/llm";
import { extractJson } from "@/lib/json";

export async function POST(req: NextRequest) {
  try {
    const { message, skill, context } = (await req.json()) as {
      message: string;
      skill: "email" | "calendar" | "tasks" | "files" | "research" | "actions";
      context?: Record<string, unknown>;
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: "No message provided" }, { status: 400 });
    }

    if (skill === "email") {
      const systemPrompt = `You are an intent classifier for an email assistant. Given the user's message, determine what email action they want.

Return a JSON object with these fields:
- "action": one of "fetch_unread", "summarize", "clean", "search", "ask", "draft_reply", "unknown"
- "query": if action is "search", extract the Gmail search query string. For "ask", set to null. For other actions, set to null.
- "reasoning": one short sentence explaining why you chose this action.

Action descriptions:
- "fetch_unread": user wants to see/list their unread emails without AI analysis
- "summarize": user wants a summary/overview of their unread emails or inbox
- "clean": user wants to triage, categorize, identify newsletters, or clean up their inbox
- "search": user wants to find specific emails by sender, subject, date, keyword, etc. The query should be a Gmail search query.
- "ask": user is asking a question about their emails that requires reading and understanding them (e.g. "did anyone email me about X?", "what was the last email from Y about?", "any important emails today?")
- "draft_reply": user wants to compose/draft/reply to an email
- "unknown": the request doesn't relate to email operations at all

Gmail search query syntax for "search" action:
- from:sender — emails from a specific sender
- to:recipient — emails to a specific recipient
- subject:word — emails with word in subject
- has:attachment — emails with attachments
- after:YYYY/MM/DD, before:YYYY/MM/DD — date filters
- is:unread, is:starred, is:important — status filters
- label:name — emails with a specific label
- Combine with spaces: "from:john subject:meeting after:2026/01/01"

Examples:
- "Show me emails from John" → {"action": "search", "query": "from:John", "reasoning": "User wants to find emails from a specific sender"}
- "Find invoices from last month" → {"action": "search", "query": "invoice after:2026/02/01 before:2026/03/01", "reasoning": "User wants to search for invoice emails from last month"}
- "What's in my inbox?" → {"action": "summarize", "query": null, "reasoning": "User wants an overview of their inbox"}
- "Clean up my inbox" → {"action": "clean", "query": null, "reasoning": "User wants to triage their inbox"}
- "Search for emails about the project deadline" → {"action": "search", "query": "project deadline", "reasoning": "User wants to find emails about a specific topic"}
- "Show me unread emails" → {"action": "fetch_unread", "query": null, "reasoning": "User wants to see their unread emails"}
- "Do I have any emails from Amazon?" → {"action": "search", "query": "from:Amazon", "reasoning": "User wants to check for emails from Amazon"}
- "What did Sarah say about the budget?" → {"action": "ask", "query": null, "reasoning": "User is asking a question that requires reading email content"}
- "Did anyone email me about the meeting?" → {"action": "ask", "query": null, "reasoning": "User wants to know about a specific topic in their emails"}
- "Any important emails I should respond to?" → {"action": "ask", "query": null, "reasoning": "User wants AI analysis of which emails need responses"}
- "Reply to the latest email from Sarah" → {"action": "draft_reply", "query": null, "reasoning": "User wants to draft a reply"}
- "Show me emails with attachments" → {"action": "search", "query": "has:attachment", "reasoning": "User wants to find emails with attachments"}
- "Emails from this week" → {"action": "search", "query": "newer_than:7d", "reasoning": "User wants recent emails"}

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

    if (skill === "tasks") {
      const systemPrompt = `You are an intent classifier for a task/todo assistant. Given the user's message, determine what they want to do.

Return a JSON object with these fields:
- "action": one of "add_task", "complete_task", "show_tasks", "clear_completed", "prioritize", "ask"
- "task_text": if action is "add_task", extract the task description (clean, concise). For "complete_task", extract which task to complete. For others, set to null.
- "reasoning": one short sentence explaining your interpretation.

Action descriptions:
- "add_task": user wants to create/add a new task or todo item
- "complete_task": user wants to mark a task as done/complete/finished
- "show_tasks": user wants to see/list their tasks
- "clear_completed": user wants to remove completed tasks
- "prioritize": user wants advice on what to work on next
- "ask": user is asking a general question about their tasks or productivity

IMPORTANT: Be generous with "add_task" — if the user mentions something they need to do, want to do, or should remember, treat it as adding a task.

Examples:
- "I need to buy groceries" → {"action": "add_task", "task_text": "Buy groceries", "reasoning": "User mentioned something they need to do"}
- "Add task: finish the report" → {"action": "add_task", "task_text": "Finish the report", "reasoning": "Explicit task creation"}
- "Remind me to call the dentist" → {"action": "add_task", "task_text": "Call the dentist", "reasoning": "User wants a reminder, treated as task"}
- "Done with the groceries" → {"action": "complete_task", "task_text": "groceries", "reasoning": "User completed a task"}
- "I finished the report" → {"action": "complete_task", "task_text": "report", "reasoning": "User says they finished something"}
- "What do I need to do?" → {"action": "show_tasks", "task_text": null, "reasoning": "User wants to see their tasks"}
- "Show my todos" → {"action": "show_tasks", "task_text": null, "reasoning": "User wants to list tasks"}
- "What should I focus on?" → {"action": "prioritize", "task_text": null, "reasoning": "User wants prioritization advice"}
- "Clean up my task list" → {"action": "clear_completed", "task_text": null, "reasoning": "User wants to tidy up completed tasks"}
- "How productive was I today?" → {"action": "ask", "task_text": null, "reasoning": "General question about tasks"}

Reply with ONLY the JSON object, no other text.`;

      const result = await chatCompletion(systemPrompt, message, { maxTokens: 256 });
      const parsed = extractJson(result);
      return NextResponse.json(parsed || { action: "show_tasks", task_text: null, reasoning: "Could not parse intent" });
    }

    if (skill === "files") {
      const systemPrompt = `You are an intent classifier for a file management assistant. The user has scanned a local folder and wants to manage their files.

Return a JSON object with these fields:
- "action": one of "scan", "organize", "find_large", "remove_large", "find_duplicates", "remove_duplicates", "find_old", "archive_old", "list_by_type", "analyze", "trash_file", "ask"
- "file_type": if action is "list_by_type", what type of files (e.g. "csv", "pdf", "images", "documents", "code", "spreadsheets"). For others, set to null.
- "file_name": if action is "trash_file", the file name to trash. For others, set to null.
- "reasoning": one short sentence explaining your interpretation.

Action descriptions:
- "scan": user wants to scan/select a new folder
- "organize": user wants to sort/organize files into categorized subfolders
- "find_large": user wants to see the largest files
- "remove_large": user wants to delete/remove large files (generates script)
- "find_duplicates": user wants to see duplicate files
- "remove_duplicates": user wants to remove duplicate files (generates script)
- "find_old": user wants to see old/stale files
- "archive_old": user wants to archive or remove old files (generates script)
- "list_by_type": user wants to list files of a specific type
- "analyze": user wants a general breakdown/analysis of the folder
- "trash_file": user wants to delete/trash a specific file
- "ask": user is asking a general question about their files

Examples:
- "What's taking up the most space?" → {"action": "find_large", "file_type": null, "file_name": null, "reasoning": "User wants to find large files"}
- "Help me clean this folder" → {"action": "organize", "file_type": null, "file_name": null, "reasoning": "User wants organization help"}
- "Show me all the PDFs" → {"action": "list_by_type", "file_type": "pdf", "file_name": null, "reasoning": "User wants to list PDF files"}
- "Are there any duplicate files?" → {"action": "find_duplicates", "file_type": null, "file_name": null, "reasoning": "User wants to check for duplicates"}
- "Delete the large files" → {"action": "remove_large", "file_type": null, "file_name": null, "reasoning": "User wants to remove large files"}
- "What kind of files do I have?" → {"action": "analyze", "file_type": null, "file_name": null, "reasoning": "User wants a folder analysis"}
- "Any files I haven't touched in a while?" → {"action": "find_old", "file_type": null, "file_name": null, "reasoning": "User wants to find stale files"}
- "Get rid of old files" → {"action": "archive_old", "file_type": null, "file_name": null, "reasoning": "User wants to archive old files"}
- "Show me the images" → {"action": "list_by_type", "file_type": "images", "file_name": null, "reasoning": "User wants to see image files"}
- "Trash report.pdf" → {"action": "trash_file", "file_type": null, "file_name": "report.pdf", "reasoning": "User wants to delete a specific file"}
- "How much space is this folder using?" → {"action": "analyze", "file_type": null, "file_name": null, "reasoning": "User wants folder size info"}

Reply with ONLY the JSON object, no other text.`;

      const result = await chatCompletion(systemPrompt, message, { maxTokens: 256 });
      const parsed = extractJson(result);
      return NextResponse.json(parsed || { action: "analyze", file_type: null, file_name: null, reasoning: "Could not parse intent" });
    }

    if (skill === "research") {
      const systemPrompt = `You are an intent classifier for a research assistant. The user has past research sessions and wants to query their findings.

Return a JSON object with these fields:
- "action": one of "summarize", "key_findings", "compare", "ask"
- "question": if action is "ask" or "compare", the specific question to answer. For others, set to null.
- "reasoning": one short sentence explaining your interpretation.

Action descriptions:
- "summarize": user wants a summary of their recent research sessions
- "key_findings": user wants the main findings/takeaways from their research
- "compare": user wants to compare/contrast topics from different research sessions
- "ask": user is asking a specific question that should be answered using their research data

Examples:
- "Summarize my research" → {"action": "summarize", "question": null, "reasoning": "User wants a research summary"}
- "What were the key findings?" → {"action": "key_findings", "question": null, "reasoning": "User wants main takeaways"}
- "Compare the topics I researched" → {"action": "compare", "question": "Compare and contrast the topics", "reasoning": "User wants cross-topic analysis"}
- "What did I learn about AI?" → {"action": "ask", "question": "What did I learn about AI?", "reasoning": "User asking specific question about research"}
- "Any common themes across my research?" → {"action": "compare", "question": "What are the common themes?", "reasoning": "User wants to find patterns"}

Reply with ONLY the JSON object, no other text.`;

      const result = await chatCompletion(systemPrompt, message, { maxTokens: 256 });
      const parsed = extractJson(result);
      return NextResponse.json(parsed || { action: "summarize", question: null, reasoning: "Could not parse intent" });
    }

    if (skill === "actions") {
      const systemPrompt = `You are an intent classifier for a computer actions assistant that can perform real actions on the user's computer (list files, read/write files, run shell commands, create notes, etc.).

Given the user's message, determine if they want to perform an action or just ask a question.

Return a JSON object with these fields:
- "action": one of "execute", "question"
- "reasoning": one short sentence explaining your interpretation.

- "execute": user wants to DO something on their computer (list files, read a file, create a note, run a command, etc.)
- "question": user is asking a general question, chatting, or asking about capabilities — no real action needed

Examples:
- "List my files" → {"action": "execute", "reasoning": "User wants to list files"}
- "What can you do?" → {"action": "question", "reasoning": "User asking about capabilities"}
- "Create a note about meeting" → {"action": "execute", "reasoning": "User wants to create a note"}
- "How does this work?" → {"action": "question", "reasoning": "User asking a general question"}

Reply with ONLY the JSON object, no other text.`;

      const result = await chatCompletion(systemPrompt, message, { maxTokens: 128 });
      const parsed = extractJson(result);
      return NextResponse.json(parsed || { action: "execute", reasoning: "Could not parse intent" });
    }

    return NextResponse.json({ error: `Unknown skill: ${skill}` }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

