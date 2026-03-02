import { NextRequest, NextResponse } from "next/server";

type CalendarEvent = {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  description?: string;
  status?: string;
  htmlLink?: string;
};

type CalendarListResponse = {
  items?: CalendarEvent[];
  nextPageToken?: string;
};

async function calendarFetch<T>(endpoint: string, accessToken: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) throw new Error("Google token expired or invalid. Please reconnect Google Calendar.");
    throw new Error(`Calendar API error: ${res.status} — ${body.slice(0, 200)}`);
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

function formatEventTime(event: CalendarEvent): string {
  if (event.start.dateTime) {
    const d = new Date(event.start.dateTime);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }
  return "All day";
}

function formatEventDate(event: CalendarEvent): string {
  const dateStr = event.start.dateTime || event.start.date;
  if (!dateStr) return "Unknown";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, access_token, refresh_token, event_data, query, timezone } = body as {
      action: string;
      access_token: string;
      refresh_token?: string;
      event_data?: {
        title: string;
        date: string;
        time?: string;
        duration?: number;
        description?: string;
      };
      query?: string;
      timezone?: string;
    };

    if (!access_token) {
      return NextResponse.json({ error: "No access token provided. Connect Google Calendar first." }, { status: 401 });
    }

    let token = access_token;

    let tokenValid = false;
    try {
      await calendarFetch("calendars/primary", token);
      tokenValid = true;
    } catch {
      tokenValid = false;
    }

    if (!tokenValid && refresh_token) {
      const refreshed = await refreshAccessToken(refresh_token);
      if (refreshed) {
        token = refreshed.access_token;
      } else {
        return NextResponse.json({ error: "Google token expired. Please reconnect Google Calendar.", new_token: null }, { status: 401 });
      }
    } else if (!tokenValid) {
      return NextResponse.json({ error: "Google token expired. Please reconnect Google Calendar.", new_token: null }, { status: 401 });
    }

    const newToken = token !== access_token ? token : undefined;

    switch (action) {
      case "list_today": {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

        const params = new URLSearchParams({
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString(),
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "50",
        });

        const data = await calendarFetch<CalendarListResponse>(
          `calendars/primary/events?${params}`,
          token
        );

        const events = (data.items || []).map((e) => ({
          id: e.id,
          title: e.summary,
          time: formatEventTime(e),
          date: formatEventDate(e),
          description: e.description,
          link: e.htmlLink,
        }));

        return NextResponse.json({ events, count: events.length, new_token: newToken });
      }

      case "list_week": {
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);

        const params = new URLSearchParams({
          timeMin: startOfWeek.toISOString(),
          timeMax: endOfWeek.toISOString(),
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "100",
        });

        const data = await calendarFetch<CalendarListResponse>(
          `calendars/primary/events?${params}`,
          token
        );

        const events = (data.items || []).map((e) => ({
          id: e.id,
          title: e.summary,
          time: formatEventTime(e),
          date: formatEventDate(e),
          description: e.description,
          link: e.htmlLink,
        }));

        return NextResponse.json({ events, count: events.length, new_token: newToken });
      }

      case "create_event": {
        if (!event_data?.title) {
          return NextResponse.json({ error: "Event title is required" }, { status: 400 });
        }

        // Use the user's timezone from the frontend, not the server's
        const userTimeZone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

        // Google Calendar API accepts RFC3339 dateTime WITH timezone offset,
        // OR a dateTime string + separate timeZone field.
        // Using the timeZone field approach: send "YYYY-MM-DDTHH:MM:SS" (no Z, no offset)
        // and let Google interpret it in the specified timeZone.
        let eventBody: Record<string, unknown>;

        if (event_data.time) {
          let normalizedTime = event_data.time.trim();
          // Normalize to HH:MM format
          if (/^\d{1,2}:\d{2}:\d{2}$/.test(normalizedTime)) {
            normalizedTime = normalizedTime.slice(0, 5);
          }
          if (/^\d{1,2}:\d{2}$/.test(normalizedTime)) {
            const [h, m] = normalizedTime.split(":");
            normalizedTime = `${h.padStart(2, "0")}:${m}`;
          }
          // Validate the time
          const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
          if (!timeRegex.test(normalizedTime)) {
            return NextResponse.json(
              { error: `Invalid time format: "${event_data.time}". Expected HH:MM (e.g. "14:30").` },
              { status: 400 }
            );
          }

          // Build local datetime strings WITHOUT converting to UTC
          // Google Calendar will interpret these in the provided timeZone
          const startLocal = `${event_data.date}T${normalizedTime}:00`;
          const durationMin = event_data.duration || 60;
          // Calculate end time by adding duration to hours/minutes directly
          const [startH, startM] = normalizedTime.split(":").map(Number);
          const totalMinutes = startH * 60 + startM + durationMin;
          const endH = Math.floor(totalMinutes / 60) % 24;
          const endM = totalMinutes % 60;
          const endLocal = `${event_data.date}T${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}:00`;

          eventBody = {
            summary: event_data.title,
            description: event_data.description || undefined,
            start: { dateTime: startLocal, timeZone: userTimeZone },
            end: { dateTime: endLocal, timeZone: userTimeZone },
          };
        } else {
          const nextDay = new Date(event_data.date + "T12:00:00Z");
          nextDay.setUTCDate(nextDay.getUTCDate() + 1);
          const endDate = nextDay.toISOString().slice(0, 10);

          eventBody = {
            summary: event_data.title,
            description: event_data.description || undefined,
            start: { date: event_data.date },
            end: { date: endDate },
          };
        }

        const created = await calendarFetch<CalendarEvent>(
          "calendars/primary/events",
          token,
          {
            method: "POST",
            body: JSON.stringify(eventBody),
          }
        );

        return NextResponse.json({
          event: {
            id: created.id,
            title: created.summary,
            time: formatEventTime(created),
            date: formatEventDate(created),
            link: created.htmlLink,
          },
          new_token: newToken,
        });
      }

      case "search": {
        const q = query || "";
        const now = new Date();
        const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        const threeMonthsAhead = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

        const params = new URLSearchParams({
          q,
          timeMin: threeMonthsAgo.toISOString(),
          timeMax: threeMonthsAhead.toISOString(),
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "20",
        });

        const data = await calendarFetch<CalendarListResponse>(
          `calendars/primary/events?${params}`,
          token
        );

        const events = (data.items || []).map((e) => ({
          id: e.id,
          title: e.summary,
          time: formatEventTime(e),
          date: formatEventDate(e),
          description: e.description,
          link: e.htmlLink,
        }));

        return NextResponse.json({ events, count: events.length, new_token: newToken });
      }

      case "free_slots": {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0);

        const params = new URLSearchParams({
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString(),
          singleEvents: "true",
          orderBy: "startTime",
        });

        const data = await calendarFetch<CalendarListResponse>(
          `calendars/primary/events?${params}`,
          token
        );

        const busySlots = (data.items || [])
          .filter((e) => e.start.dateTime && e.end?.dateTime)
          .map((e) => ({
            start: new Date(e.start.dateTime!).getHours(),
            end: new Date(e.end!.dateTime!).getHours(),
          }));

        const freeSlots: string[] = [];
        for (let h = 8; h < 18; h++) {
          const isBusy = busySlots.some((s) => h >= s.start && h < s.end);
          if (!isBusy) {
            freeSlots.push(`${h.toString().padStart(2, "0")}:00 — ${(h + 1).toString().padStart(2, "0")}:00`);
          }
        }

        return NextResponse.json({ free_slots: freeSlots, count: freeSlots.length, new_token: newToken });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
