import { NextResponse } from "next/server";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.labels",
].join(" ");

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || `http://localhost:${process.env.FRONTEND_PORT || 3000}/assistant/email-callback`;

  if (!clientId) {
    return NextResponse.json(
      {
        error: "GOOGLE_CLIENT_ID is not configured",
        setup: [
          "1. Go to https://console.cloud.google.com/apis/credentials",
          "2. Create an OAuth 2.0 Client ID (type: Web application)",
          '3. Add authorized redirect URI: "' + redirectUri + '"',
          "4. Enable the Gmail API at https://console.cloud.google.com/apis/library/gmail.googleapis.com",
          "5. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file",
          "6. Restart the frontend",
        ],
      },
      { status: 400 }
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return NextResponse.json({ url });
}
