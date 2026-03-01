import { NextRequest, NextResponse } from "next/server";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.labels",
];

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || `http://localhost:${process.env.FRONTEND_PORT || 3001}/assistant/email-callback`;

  if (!clientId) {
    return NextResponse.json(
      {
        error: "GOOGLE_CLIENT_ID is not configured",
        setup: [
          "1. Go to https://console.cloud.google.com/apis/credentials",
          "2. Create an OAuth 2.0 Client ID (type: Web application)",
          '3. Add authorized redirect URI: "' + redirectUri + '"',
          "4. Enable the Gmail API at https://console.cloud.google.com/apis/library/gmail.googleapis.com",
          "5. Enable the Google Calendar API at https://console.cloud.google.com/apis/library/calendar-json.googleapis.com",
          "6. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file",
          "7. Restart the frontend",
        ],
      },
      { status: 400 }
    );
  }

  const service = req.nextUrl.searchParams.get("service");
  let scopes: string[];
  if (service === "calendar") {
    scopes = CALENDAR_SCOPES;
  } else if (service === "all") {
    scopes = [...GMAIL_SCOPES, ...CALENDAR_SCOPES];
  } else {
    scopes = GMAIL_SCOPES;
  }

  const state = service || "email";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return NextResponse.json({ url });
}
