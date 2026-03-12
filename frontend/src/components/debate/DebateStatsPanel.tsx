"use client";

import { BarChart3, MessageSquare, Shield, AlertTriangle, TrendingUp } from "lucide-react";
import { DebateMessage } from "./types";

type Props = {
  messages: DebateMessage[];
  forCards: { title: string }[];
  againstCards: { title: string }[];
  isDark: boolean;
};

export default function DebateStatsPanel({ messages, forCards, againstCards, isDark }: Props) {
  // Calculate stats
  const agentAMessages = messages.filter((m) => m.agentId === "A").length;
  const agentBMessages = messages.filter((m) => m.agentId === "B").length;

  const phases = {
    debate: messages.filter((m) => m.phase === "debate").length,
    cross_exam_q: messages.filter((m) => m.phase === "cross_exam_question").length,
    cross_exam_a: messages.filter((m) => m.phase === "cross_exam_answer").length,
    system: messages.filter((m) => m.phase === "system").length,
  };

  const totalArguments = agentAMessages + agentBMessages;
  const evidenceCount = forCards.length + againstCards.length;

  // Calculate average message length
  const avgLength = messages.length > 0
    ? Math.round(messages.reduce((acc, m) => acc + (m.text?.length || 0), 0) / messages.length)
    : 0;

  const cardCls = `rounded-xl border p-4 ${isDark ? "border-slate-700/60 bg-slate-800/40" : "border-slate-200 bg-white/80"}`;
  const statCls = `flex items-center justify-between rounded-lg p-3 ${isDark ? "bg-slate-700/40" : "bg-slate-100"}`;

  return (
    <div className={cardCls}>
      <div className="mb-4 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-violet-400">Debate Statistics</h3>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Total Arguments */}
        <div className={statCls}>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Total Arguments</div>
            <div className="text-2xl font-bold text-emerald-400">{totalArguments}</div>
          </div>
          <MessageSquare className="h-5 w-5 text-emerald-400/40" />
        </div>

        {/* Evidence Cards */}
        <div className={statCls}>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Evidence</div>
            <div className="text-2xl font-bold text-cyan-400">{evidenceCount}</div>
          </div>
          <Shield className="h-5 w-5 text-cyan-400/40" />
        </div>

        {/* Cross-Exam Questions */}
        <div className={statCls}>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Questions</div>
            <div className="text-2xl font-bold text-amber-400">{phases.cross_exam_q}</div>
          </div>
          <AlertTriangle className="h-5 w-5 text-amber-400/40" />
        </div>

        {/* Avg Length */}
        <div className={statCls}>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Avg Length</div>
            <div className="text-2xl font-bold text-violet-400">{avgLength}</div>
          </div>
          <TrendingUp className="h-5 w-5 text-violet-400/40" />
        </div>
      </div>

      {/* Arguments Distribution */}
      <div className="mt-4">
        <div className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Arguments Distribution</div>
        <div className="flex gap-2">
          <div className="flex-1">
            <div className="mb-1 text-xs text-emerald-400">Agent A (FOR)</div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-700/40">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
                style={{ width: totalArguments ? `${(agentAMessages / totalArguments) * 100}%` : "0%" }}
              />
            </div>
            <div className="mt-0.5 text-right text-xs text-slate-500">{agentAMessages}</div>
          </div>
          <div className="flex-1">
            <div className="mb-1 text-xs text-rose-400">Agent B (AGAINST)</div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-700/40">
              <div
                className="h-full bg-gradient-to-r from-rose-500 to-rose-400 transition-all"
                style={{ width: totalArguments ? `${(agentBMessages / totalArguments) * 100}%` : "0%" }}
              />
            </div>
            <div className="mt-0.5 text-right text-xs text-slate-500">{agentBMessages}</div>
          </div>
        </div>
      </div>

      {/* Phase Breakdown */}
      <div className="mt-4">
        <div className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Phase Breakdown</div>
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(phases).map(([phase, count]) => {
            const label = phase === "cross_exam_q" ? "Questions" :
                         phase === "cross_exam_a" ? "Answers" :
                         phase === "debate" ? "Debate" : "System";
            return (
              <div key={phase} className="text-center">
                <div className={`rounded-lg p-2 ${isDark ? "bg-slate-700/30" : "bg-slate-50"}`}>
                  <div className="text-lg font-bold text-violet-400">{count}</div>
                  <div className="text-[9px] uppercase text-slate-500">{label}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Evidence Balance */}
      {evidenceCount > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Evidence Balance</div>
          <div className="flex gap-2 text-center text-xs">
            <div className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2">
              <div className="font-bold text-emerald-400">{forCards.length}</div>
              <div className="text-[10px] text-emerald-400/70">Supporting</div>
            </div>
            <div className="flex-1 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2">
              <div className="font-bold text-rose-400">{againstCards.length}</div>
              <div className="text-[10px] text-rose-400/70">Opposing</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
