"use client";

import { Sparkles, Award, Zap } from "lucide-react";
import { DebateMessage } from "./types";

type Props = {
  messages: DebateMessage[];
  isDark: boolean;
  onScrollToMessage: (messageId: string) => void;
};

export default function DebateHighlights({ messages, isDark, onScrollToMessage }: Props) {
  // Filter only debate phase messages (exclude cross-exam)
  const debateMessages = messages.filter((m) => m.phase === "debate");

  // Find opening statements (first 2 debate messages)
  const openingStatements = debateMessages.slice(0, 2);

  // Find longest arguments (usually most detailed rebuttals)
  const longestArguments = [...debateMessages]
    .sort((a, b) => (b.text?.length || 0) - (a.text?.length || 0))
    .slice(0, 2);

  // Find closing statements (last 2 debate messages)
  const closingStatements = debateMessages.slice(-2);

  if (messages.length === 0) return null;

  const cardCls = `rounded-xl border p-4 ${isDark ? "border-slate-700/60 bg-slate-800/40" : "border-slate-200 bg-white/80"}`;
  const highlightCls = `cursor-pointer rounded-lg border p-3 transition-all hover:scale-[1.02] ${isDark ? "border-slate-600/40 bg-slate-700/30 hover:border-violet-500/40" : "border-slate-200 bg-slate-50 hover:border-violet-400/40"}`;

  return (
    <div className={cardCls}>
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-amber-400">Key Highlights</h3>
      </div>

      <div className="space-y-4">
        {/* Opening Statements */}
        {openingStatements.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <Award className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs font-semibold uppercase text-emerald-400">Opening Statements</span>
            </div>
            <div className="space-y-2">
              {openingStatements.map((msg) => (
                <div
                  key={msg.messageId}
                  onClick={() => onScrollToMessage(msg.messageId)}
                  className={highlightCls}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${msg.agentId === "A" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}
                    >
                      {msg.agentId === "A" ? "FOR" : "AGAINST"}
                    </span>
                    <span className="text-[10px] text-slate-500">{msg.messageId}</span>
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-300">{msg.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Longest Arguments */}
        {longestArguments.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs font-semibold uppercase text-amber-400">Most Detailed Arguments</span>
            </div>
            <div className="space-y-2">
              {longestArguments.map((msg) => (
                <div
                  key={msg.messageId}
                  onClick={() => onScrollToMessage(msg.messageId)}
                  className={highlightCls}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${msg.agentId === "A" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}
                    >
                      {msg.agentId === "A" ? "FOR" : "AGAINST"}
                    </span>
                    <span className="text-[10px] text-slate-500">{msg.messageId}</span>
                    <span className="ml-auto text-[9px] text-slate-500">{msg.text?.length || 0} chars</span>
                  </div>
                  <p className="line-clamp-3 text-xs text-slate-300">{msg.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Closing Statements */}
        {closingStatements.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <Award className="h-3.5 w-3.5 text-violet-400" />
              <span className="text-xs font-semibold uppercase text-violet-400">Closing Statements</span>
            </div>
            <div className="space-y-2">
              {closingStatements.map((msg) => (
                <div
                  key={msg.messageId}
                  onClick={() => onScrollToMessage(msg.messageId)}
                  className={highlightCls}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${msg.agentId === "A" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}
                    >
                      {msg.agentId === "A" ? "FOR" : "AGAINST"}
                    </span>
                    <span className="text-[10px] text-slate-500">{msg.messageId}</span>
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-300">{msg.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
