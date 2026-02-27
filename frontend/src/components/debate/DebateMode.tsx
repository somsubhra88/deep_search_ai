"use client";

import { useState, useCallback, useRef } from "react";
import { Scale, StopCircle, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import DebateSettingsPanel from "./DebateSettingsPanel";
import DebateChatTimeline from "./DebateChatTimeline";
import DebateArtifactsPanel from "./DebateArtifactsPanel";
import EvidenceCardsPanel from "./EvidenceCardsPanel";
import {
  DebateMessage,
  DebateArtifacts,
  DebateStatus,
  PersonaConfig,
  AgentProfile,
  DebateConfig,
  EvidenceCard,
} from "./types";

type Props = {
  topic: string;
  perspectiveDial: number;
  modelId: string;
  modelName: string;
  isDark: boolean;
};

export default function DebateMode({ topic, perspectiveDial, modelId, modelName, isDark }: Props) {
  const [status, setStatus] = useState<DebateStatus>("configuring");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [artifacts, setArtifacts] = useState<DebateArtifacts | null>(null);
  const [personaA, setPersonaA] = useState<PersonaConfig>({ gender: "neutral", profession: "", attitude: "logical", style: "formal" });
  const [personaB, setPersonaB] = useState<PersonaConfig>({ gender: "neutral", profession: "", attitude: "logical", style: "formal" });
  const [artifactStep, setArtifactStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forCards, setForCards] = useState<EvidenceCard[]>([]);
  const [againstCards, setAgainstCards] = useState<EvidenceCard[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const startDebate = useCallback(async (payload: {
    topic: string;
    perspective_dial: number;
    model_id: string;
    model_name: string;
    agent_a: AgentProfile;
    agent_b: AgentProfile;
    config: DebateConfig;
  }) => {
    setStatus("running");
    setMessages([]);
    setArtifacts(null);
    setError(null);
    setArtifactStep(null);
    setForCards([]);
    setAgainstCards([]);
    setEvidenceLoading(false);
    setPersonaA(payload.agent_a.persona);
    setPersonaB(payload.agent_b.persona);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/debate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
              continue;
            }
            if (!line.startsWith("data: ")) continue;

            try {
              const data = JSON.parse(line.slice(6));

              switch (currentEvent) {
                case "debate.started":
                  setSessionId(data.sessionId);
                  break;

                case "evidence.started":
                  setEvidenceLoading(true);
                  break;

                case "evidence.ready":
                  setEvidenceLoading(false);
                  if (data.cards) {
                    setForCards(data.cards.for || []);
                    setAgainstCards(data.cards.against || []);
                  }
                  break;

                case "evidence.error":
                  setEvidenceLoading(false);
                  break;

                case "message.started":
                  setMessages((prev) => [
                    ...prev,
                    {
                      messageId: data.messageId,
                      agentId: data.agentId,
                      phase: data.phase,
                      text: "",
                      isStreaming: true,
                      replyToMessageId: data.replyToMessageId,
                      challengesMessageId: data.challengesMessageId,
                      answersQuestionId: data.answersQuestionId,
                    },
                  ]);
                  break;

                case "message.delta":
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.messageId === data.messageId
                        ? { ...m, text: m.text + data.delta }
                        : m
                    )
                  );
                  break;

                case "message.final":
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.messageId === data.messageId
                        ? { ...m, text: data.fullText, isStreaming: false, createdAt: data.createdAt }
                        : m
                    )
                  );
                  break;

                case "artifacts.generating":
                  setArtifactStep(data.step);
                  break;

                case "artifacts.ready":
                  setArtifacts({
                    summary: data.summary,
                    judge: data.judge,
                    argumentGraph: data.argumentGraph,
                    coverageGaps: data.coverageGaps,
                  });
                  setArtifactStep(null);
                  break;

                case "debate.finished":
                  setStatus(data.status === "cancelled" ? "cancelled" : "completed");
                  if (data.status === "completed") toast.success("Debate completed!");
                  break;

                case "debate.error":
                  setStatus("error");
                  setError(data.error);
                  toast.error(`Debate error: ${data.error}`);
                  break;
              }
            } catch {
              // skip unparseable SSE chunks
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setStatus("cancelled");
        return;
      }
      const msg = e instanceof Error ? e.message : "Debate failed";
      setError(msg);
      setStatus("error");
      toast.error(msg);
    } finally {
      abortRef.current = null;
    }
  }, []);

  const cancelDebate = useCallback(async () => {
    abortRef.current?.abort();
    if (sessionId) {
      try {
        await fetch(`/api/debate/${sessionId}/cancel`, { method: "POST" });
      } catch { /* ignore */ }
    }
    setStatus("cancelled");
    toast.info("Debate cancelled");
  }, [sessionId]);

  const resetDebate = useCallback(() => {
    setStatus("configuring");
    setSessionId(null);
    setMessages([]);
    setArtifacts(null);
    setError(null);
    setArtifactStep(null);
    setForCards([]);
    setAgainstCards([]);
    setEvidenceLoading(false);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Scale className="h-5 w-5 text-violet-400" /> Debate Mode
        </h2>
        {status !== "configuring" && (
          <div className="flex items-center gap-2">
            {status === "running" && (
              <button onClick={cancelDebate}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10"
              >
                <StopCircle className="h-3.5 w-3.5" /> Stop
              </button>
            )}
            {(status === "completed" || status === "cancelled" || status === "error") && (
              <button onClick={resetDebate}
                className="flex items-center gap-1.5 rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs font-medium text-violet-400 hover:bg-violet-500/10"
              >
                <RotateCcw className="h-3.5 w-3.5" /> New Debate
              </button>
            )}
          </div>
        )}
      </div>

      {/* Settings */}
      {status === "configuring" && (
        <DebateSettingsPanel
          topic={topic}
          perspectiveDial={perspectiveDial}
          modelId={modelId}
          modelName={modelName}
          isDark={isDark}
          onStart={startDebate}
        />
      )}

      {/* Running / Completed */}
      {(status === "running" || status === "completed" || status === "cancelled" || status === "error") && (
        <div className="space-y-4">
          {/* Evidence loading indicator */}
          {evidenceLoading && (
            <div className={`flex items-center gap-2 rounded-xl border p-4 ${isDark ? "border-sky-500/30 bg-sky-500/5" : "border-sky-200 bg-sky-50"}`}>
              <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
              <span className="text-sm text-sky-400">Retrieving evidence from web sources...</span>
            </div>
          )}

          {/* Evidence cards */}
          {(forCards.length > 0 || againstCards.length > 0) && (
            <EvidenceCardsPanel forCards={forCards} againstCards={againstCards} isDark={isDark} />
          )}

          {/* Chat */}
          {messages.length > 0 && (
            <DebateChatTimeline
              messages={messages}
              personaA={personaA}
              personaB={personaB}
              isDark={isDark}
            />
          )}

          {/* Artifact generation progress */}
          {status === "running" && artifactStep && (
            <div className={`flex items-center gap-2 rounded-xl border p-4 ${isDark ? "border-violet-500/30 bg-violet-500/5" : "border-violet-200 bg-violet-50"}`}>
              <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
              <span className="text-sm text-violet-400">
                Generating {artifactStep.replace(/_/g, " ")}...
              </span>
            </div>
          )}

          {/* Artifacts */}
          {artifacts && sessionId && (
            <DebateArtifactsPanel
              artifacts={artifacts}
              messages={messages}
              sessionId={sessionId}
              isDark={isDark}
              onScrollToMessage={() => {}}
            />
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
