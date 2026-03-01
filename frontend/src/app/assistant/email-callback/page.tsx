"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { compressAndStore } from "@/lib/storage";

const GMAIL_TOKENS_KEY = "deep-search-gmail-tokens";
const GCAL_TOKENS_KEY = "deep-search-gcal-tokens";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"exchanging" | "success" | "error">("exchanging");
  const [errorMsg, setErrorMsg] = useState("");
  const [service, setService] = useState("email");

  useEffect(() => {
    const code = searchParams.get("code");
    const error = searchParams.get("error");
    const state = searchParams.get("state") || "email";
    setService(state);

    if (error) {
      setStatus("error");
      setErrorMsg(`Google OAuth denied: ${error}`);
      return;
    }

    if (!code) {
      setStatus("error");
      setErrorMsg("No authorization code received from Google.");
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/assistant/email/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(body.error || body.detail || `Token exchange failed (${res.status})`);
        }

        const tokens = await res.json();
        const tokenData = {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
        };

        if (state === "calendar") {
          compressAndStore(GCAL_TOKENS_KEY, tokenData);
        } else if (state === "all") {
          compressAndStore(GMAIL_TOKENS_KEY, tokenData);
          compressAndStore(GCAL_TOKENS_KEY, tokenData);
        } else {
          compressAndStore(GMAIL_TOKENS_KEY, tokenData);
        }

        setStatus("success");
        setTimeout(() => router.push("/assistant"), 1500);
      } catch (e) {
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : "Failed to exchange token");
      }
    })();
  }, [searchParams, router]);

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center shadow-2xl">
      {status === "exchanging" && (
        <>
          <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-blue-400" />
          <h2 className="text-lg font-bold">Connecting Gmail...</h2>
          <p className="mt-2 text-sm text-slate-400">Exchanging authorization code for access token</p>
        </>
      )}
      {status === "success" && (
        <>
          <CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-emerald-400" />
          <h2 className="text-lg font-bold">{service === "calendar" ? "Google Calendar" : service === "all" ? "Google Services" : "Gmail"} Connected!</h2>
          <p className="mt-2 text-sm text-slate-400">Redirecting to assistant...</p>
        </>
      )}
      {status === "error" && (
        <>
          <XCircle className="mx-auto mb-4 h-10 w-10 text-red-400" />
          <h2 className="text-lg font-bold">Connection Failed</h2>
          <p className="mt-2 text-sm text-red-300">{errorMsg}</p>
          <button
            onClick={() => router.push("/assistant")}
            className="mt-4 rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700"
          >
            Back to Assistant
          </button>
        </>
      )}
    </div>
  );
}

export default function EmailCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950/30 to-slate-950 text-white">
      <Suspense
        fallback={
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center shadow-2xl">
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-blue-400" />
            <h2 className="text-lg font-bold">Connecting Gmail...</h2>
          </div>
        }
      >
        <CallbackHandler />
      </Suspense>
    </div>
  );
}
