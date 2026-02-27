"use client";

import { useEffect, useRef } from "react";
import { DebateMessage, PersonaConfig } from "./types";

type Props = {
  messages: DebateMessage[];
  personaA: PersonaConfig;
  personaB: PersonaConfig;
  isDark: boolean;
  onScrollToMessage?: (messageId: string) => void;
};

export default function DebateChatTimeline({ messages, personaA, personaB, isDark, onScrollToMessage }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const scrollTo = (mid: string) => {
    const el = messageRefs.current[mid];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-violet-400");
      setTimeout(() => el.classList.remove("ring-2", "ring-violet-400"), 2000);
    }
    onScrollToMessage?.(mid);
  };

  const getPersona = (agentId: string) => agentId === "A" ? personaA : personaB;

  return (
    <div className={`rounded-2xl border p-4 ${isDark ? "border-slate-700/60 bg-slate-800/30" : "border-slate-200 bg-white/80"}`}>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        {messages.map((msg) => {
          const isA = msg.agentId === "A";
          const persona = getPersona(msg.agentId);
          const accentBg = isA
            ? isDark ? "bg-emerald-500/10 border-emerald-500/30" : "bg-emerald-50 border-emerald-200"
            : isDark ? "bg-rose-500/10 border-rose-500/30" : "bg-rose-50 border-rose-200";
          const accentAvatar = isA ? "bg-emerald-500" : "bg-rose-500";
          const alignment = isA ? "mr-8" : "ml-8";

          const phaseLabel =
            msg.phase === "cross_exam_question" ? "Cross-Exam Q" :
            msg.phase === "cross_exam_answer" ? "Cross-Exam A" : null;
          const phasePillColor =
            msg.phase === "cross_exam_question" ? "bg-amber-500/15 text-amber-400" :
            msg.phase === "cross_exam_answer" ? "bg-sky-500/15 text-sky-400" : "";

          return (
            <div
              key={msg.messageId}
              ref={(el) => { messageRefs.current[msg.messageId] = el; }}
              className={`rounded-xl border p-3 transition-all ${accentBg} ${alignment}`}
            >
              {/* Reply thread preview */}
              {msg.replyToMessageId && (
                <button
                  onClick={() => scrollTo(msg.replyToMessageId!)}
                  className="mb-2 flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300"
                >
                  <span className="font-medium">↩ Replying to {msg.replyToMessageId}:</span>
                  <span className="truncate max-w-[200px]">
                    {messages.find((m) => m.messageId === msg.replyToMessageId)?.text?.slice(0, 80) || "..."}
                  </span>
                </button>
              )}

              {/* Header */}
              <div className="mb-2 flex items-center gap-2">
                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white ${accentAvatar}`}>
                  {msg.agentId}
                </div>
                <div className="flex flex-1 items-center gap-2">
                  <span className="text-xs font-semibold">
                    Agent {msg.agentId}
                  </span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${isA ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
                    {messages.length > 0 && (isA ? "FOR" : "AGAINST")}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {persona.profession}
                  </span>
                  {phaseLabel && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${phasePillColor}`}>
                      {phaseLabel}
                    </span>
                  )}
                </div>
                <span className="text-[9px] tabular-nums text-slate-500">{msg.messageId}</span>
              </div>

              {/* Message text */}
              <div className="text-sm leading-relaxed text-slate-300 whitespace-pre-wrap">
                {msg.text}
                {msg.isStreaming && (
                  <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-violet-400" />
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
