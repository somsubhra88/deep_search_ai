import { NextRequest, NextResponse } from "next/server";
import { chatCompletion } from "@/lib/llm";

type GmailMessage = {
  id: string;
  threadId: string;
};

type GmailMessageDetail = {
  id: string;
  snippet: string;
  labelIds: string[];
  internalDate: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    mimeType: string;
    body?: { data?: string; size?: number };
    parts?: Array<{ mimeType: string; body?: { data?: string } }>;
  };
};

function getHeader(msg: GmailMessageDetail, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodeBase64Url(data: string): string {
  try {
    const padded = data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function extractBody(msg: GmailMessageDetail): string {
  if (msg.payload.body?.data) {
    return decodeBase64Url(msg.payload.body.data);
  }
  if (msg.payload.parts) {
    const textPart = msg.payload.parts.find((p) => p.mimeType === "text/plain");
    if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);
    const htmlPart = msg.payload.parts.find((p) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) {
      const html = decodeBase64Url(htmlPart.body.data);
      return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
  }
  return msg.snippet || "";
}

async function gmailFetch<T>(endpoint: string, accessToken: string): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) throw new Error("Gmail token expired or invalid. Please reconnect Gmail.");
    throw new Error(`Gmail API error: ${res.status} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, access_token, refresh_token, query, user_message } = body as {
      action: string;
      access_token: string;
      refresh_token?: string;
      query?: string;
      user_message?: string;
    };

    if (!access_token) {
      return NextResponse.json({ error: "No access token provided. Connect Gmail first." }, { status: 401 });
    }

    let token = access_token;

    const testAccess = async () => {
      try {
        await gmailFetch("profile", token);
        return true;
      } catch {
        return false;
      }
    };

    if (!(await testAccess()) && refresh_token) {
      const refreshed = await refreshAccessToken(refresh_token);
      if (refreshed) {
        token = refreshed.access_token;
      } else {
        return NextResponse.json({ error: "Gmail token expired. Please reconnect Gmail.", new_token: null }, { status: 401 });
      }
    }

    switch (action) {
      case "fetch_unread": {
        const list = await gmailFetch<{ messages?: GmailMessage[]; resultSizeEstimate?: number }>(
          "messages?q=is:unread&maxResults=20",
          token
        );
        const messageIds = list.messages || [];
        if (messageIds.length === 0) {
          return NextResponse.json({
            emails: [],
            summary: "Your inbox is clean — no unread emails!",
            count: 0,
            new_token: token !== access_token ? token : undefined,
          });
        }

        const details = await Promise.all(
          messageIds.slice(0, 20).map((m) =>
            gmailFetch<GmailMessageDetail>(`messages/${m.id}?format=full`, token)
          )
        );

        const emails = details.map((msg) => ({
          id: msg.id,
          from: getHeader(msg, "From"),
          subject: getHeader(msg, "Subject"),
          date: getHeader(msg, "Date"),
          snippet: msg.snippet,
          labels: msg.labelIds,
          body: extractBody(msg).slice(0, 500),
        }));

        return NextResponse.json({
          emails,
          count: emails.length,
          total_estimate: list.resultSizeEstimate,
          new_token: token !== access_token ? token : undefined,
        });
      }

      case "summarize": {
        const list = await gmailFetch<{ messages?: GmailMessage[] }>(
          "messages?q=is:unread&maxResults=20",
          token
        );
        const messageIds = list.messages || [];
        if (messageIds.length === 0) {
          return NextResponse.json({
            summary: "Your inbox is clean — no unread emails to summarise!",
            new_token: token !== access_token ? token : undefined,
          });
        }

        const details = await Promise.all(
          messageIds.slice(0, 15).map((m) =>
            gmailFetch<GmailMessageDetail>(`messages/${m.id}?format=full`, token)
          )
        );

        const emailText = details
          .map((msg, i) => {
            const from = getHeader(msg, "From");
            const subject = getHeader(msg, "Subject");
            const date = getHeader(msg, "Date");
            const body = extractBody(msg).slice(0, 300);
            return `Email ${i + 1}:\nFrom: ${from}\nSubject: ${subject}\nDate: ${date}\nBody: ${body}\n`;
          })
          .join("\n---\n");

        const summary = await chatCompletion(
          `You are an email assistant. Summarise the user's unread emails concisely. For each email, provide a 1-line summary. At the end, highlight any URGENT items (deadlines, important senders, action required). Use markdown formatting with bold for emphasis.`,
          `I have ${details.length} unread emails:\n\n${emailText}`
        );

        return NextResponse.json({
          summary,
          count: details.length,
          new_token: token !== access_token ? token : undefined,
        });
      }

      case "clean": {
        const list = await gmailFetch<{ messages?: GmailMessage[] }>(
          "messages?q=is:unread&maxResults=30",
          token
        );
        const messageIds = list.messages || [];
        if (messageIds.length === 0) {
          return NextResponse.json({
            summary: "No unread emails to analyse for cleaning.",
            new_token: token !== access_token ? token : undefined,
          });
        }

        const details = await Promise.all(
          messageIds.slice(0, 20).map((m) =>
            gmailFetch<GmailMessageDetail>(`messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe`, token)
          )
        );

        const emailList = details
          .map((msg) => {
            const from = getHeader(msg, "From");
            const subject = getHeader(msg, "Subject");
            const hasUnsubscribe = !!getHeader(msg, "List-Unsubscribe");
            return `From: ${from} | Subject: ${subject} | Newsletter: ${hasUnsubscribe ? "YES" : "no"}`;
          })
          .join("\n");

        const analysis = await chatCompletion(
          `You are an inbox organiser. Categorise these emails into: IMPORTANT (needs response), INFORMATIONAL (read later), NEWSLETTER (can unsubscribe), LOW PRIORITY (can archive). Use markdown with headers for each category. Be specific about which emails go where.`,
          emailList
        );

        return NextResponse.json({
          summary: analysis,
          count: details.length,
          new_token: token !== access_token ? token : undefined,
        });
      }

      case "search": {
        const q = query || "is:unread";
        const list = await gmailFetch<{ messages?: GmailMessage[] }>(
          `messages?q=${encodeURIComponent(q)}&maxResults=10`,
          token
        );
        const messageIds = list.messages || [];
        if (messageIds.length === 0) {
          return NextResponse.json({
            summary: `No emails found matching: "${query}"`,
            emails: [],
            new_token: token !== access_token ? token : undefined,
          });
        }

        const details = await Promise.all(
          messageIds.map((m) =>
            gmailFetch<GmailMessageDetail>(`messages/${m.id}?format=full`, token)
          )
        );

        const emails = details.map((msg) => ({
          id: msg.id,
          from: getHeader(msg, "From"),
          subject: getHeader(msg, "Subject"),
          date: getHeader(msg, "Date"),
          snippet: msg.snippet,
          body: extractBody(msg).slice(0, 400),
        }));

        // Use LLM to provide an intelligent summary of search results
        let summary: string | undefined;
        if (user_message && emails.length > 0) {
          try {
            const emailContext = emails
              .map((e, i) => `Email ${i + 1}:\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nBody: ${e.body}\n`)
              .join("\n---\n");
            summary = await chatCompletion(
              `You are an email assistant. The user searched their inbox and found the emails below. Answer the user's question based on these emails. Be concise and helpful. Use markdown formatting.`,
              `User's request: "${user_message}"\n\nSearch results (${emails.length} emails):\n\n${emailContext}`
            );
          } catch {
            // LLM summary failed, return raw results
          }
        }

        return NextResponse.json({
          emails,
          count: emails.length,
          summary,
          new_token: token !== access_token ? token : undefined,
        });
      }

      case "ask": {
        // General email question — fetch recent emails and let LLM answer
        const list = await gmailFetch<{ messages?: GmailMessage[] }>(
          "messages?maxResults=15",
          token
        );
        const messageIds = list.messages || [];
        if (messageIds.length === 0) {
          return NextResponse.json({
            summary: "Your inbox appears to be empty.",
            new_token: token !== access_token ? token : undefined,
          });
        }

        const details = await Promise.all(
          messageIds.slice(0, 15).map((m) =>
            gmailFetch<GmailMessageDetail>(`messages/${m.id}?format=full`, token)
          )
        );

        const emailContext = details
          .map((msg, i) => {
            const from = getHeader(msg, "From");
            const subject = getHeader(msg, "Subject");
            const date = getHeader(msg, "Date");
            const body = extractBody(msg).slice(0, 300);
            return `Email ${i + 1}:\nFrom: ${from}\nSubject: ${subject}\nDate: ${date}\nLabels: ${msg.labelIds?.join(", ") || "none"}\nBody: ${body}\n`;
          })
          .join("\n---\n");

        const answer = await chatCompletion(
          `You are an email assistant with access to the user's recent emails. Answer the user's question based on the email data provided. If the question cannot be answered from the available emails, say so. Be concise, specific, and use markdown formatting.`,
          `User's question: "${user_message || query || "Tell me about my emails"}"\n\nRecent emails (${details.length}):\n\n${emailContext}`
        );

        return NextResponse.json({
          summary: answer,
          count: details.length,
          new_token: token !== access_token ? token : undefined,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
