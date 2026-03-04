"use client";

import { useState } from "react";
import { FileText, Scale, GitBranch, AlertTriangle, Download, Copy, Check } from "lucide-react";
import { DebateArtifacts, DebateMessage } from "./types";
import DebateArgumentGraph from "./DebateArgumentGraph";

type Props = {
  artifacts: DebateArtifacts;
  messages: DebateMessage[];
  sessionId: string;
  isDark: boolean;
  onScrollToMessage: (messageId: string) => void;
};

type Tab = "summary" | "judge" | "graph" | "gaps" | "export";

function MsgIds({ ids, onClick }: { ids: string[]; onClick: (id: string) => void }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {ids.map((id) => (
        <button key={id} onClick={() => onClick(id)}
          className="rounded bg-violet-500/20 px-1 py-0.5 text-[9px] font-bold text-violet-400 hover:bg-violet-500/30"
        >
          {id}
        </button>
      ))}
    </span>
  );
}

export default function DebateArtifactsPanel({ artifacts, messages, sessionId, isDark, onScrollToMessage }: Props) {
  const [tab, setTab] = useState<Tab>("summary");
  const [copied, setCopied] = useState(false);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "summary", label: "Summary", icon: <FileText className="h-3.5 w-3.5" /> },
    { id: "judge", label: "Judge", icon: <Scale className="h-3.5 w-3.5" /> },
    { id: "graph", label: "Graph", icon: <GitBranch className="h-3.5 w-3.5" /> },
    { id: "gaps", label: "Gaps", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
    { id: "export", label: "Export", icon: <Download className="h-3.5 w-3.5" /> },
  ];

  const cardCls = `rounded-2xl border p-5 ${isDark ? "border-slate-700/60 bg-slate-800/30" : "border-slate-200 bg-white/80"}`;

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={cardCls}>
      {/* Tab bar */}
      <div className="mb-4 flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition whitespace-nowrap ${
              tab === t.id
                ? "bg-violet-500/20 text-violet-400"
                : isDark ? "text-slate-400 hover:bg-slate-700/50" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Summary */}
      {tab === "summary" && artifacts.summary && (
        <div className="space-y-4">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase text-emerald-400">Key Points (FOR)</h4>
            {artifacts.summary.key_points_for.map((p, i) => (
              <div key={i} className="mb-1.5 text-sm text-slate-300">
                • {p.point} <MsgIds ids={p.message_ids} onClick={onScrollToMessage} />
              </div>
            ))}
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase text-rose-400">Key Points (AGAINST)</h4>
            {artifacts.summary.key_points_against.map((p, i) => (
              <div key={i} className="mb-1.5 text-sm text-slate-300">
                • {p.point} <MsgIds ids={p.message_ids} onClick={onScrollToMessage} />
              </div>
            ))}
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase text-cyan-400">Strongest Evidence</h4>
            {artifacts.summary.strongest_evidence.map((e, i) => (
              <div key={i} className="mb-1.5 text-sm text-slate-300">
                ◆ {e.evidence} <MsgIds ids={e.message_ids} onClick={onScrollToMessage} />
              </div>
            ))}
          </div>
          {artifacts.summary.unresolved_points.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase text-amber-400">Unresolved</h4>
              {artifacts.summary.unresolved_points.map((u, i) => (
                <div key={i} className="mb-1 text-sm text-slate-400">⚠ {u}</div>
              ))}
            </div>
          )}
          <div className={`rounded-lg p-3 text-sm ${isDark ? "bg-slate-700/30 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <span className="font-semibold">Takeaway: </span>{artifacts.summary.neutral_takeaway}
          </div>
        </div>
      )}

      {/* Judge */}
      {tab === "judge" && artifacts.judge && (
        <div className="space-y-4">
          <div className="text-center">
            <span className={`inline-block rounded-full px-4 py-1.5 text-sm font-bold ${
              artifacts.judge.winner === "FOR" ? "bg-emerald-500/20 text-emerald-400" :
              artifacts.judge.winner === "AGAINST" ? "bg-rose-500/20 text-rose-400" :
              "bg-slate-500/20 text-slate-400"
            }`}>
              Winner: {artifacts.judge.winner}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(artifacts.judge.rubric).map(([key, val]) => (
              <div key={key} className={`rounded-lg p-2 text-center ${isDark ? "bg-slate-700/30" : "bg-slate-100"}`}>
                <div className="text-lg font-bold text-violet-400">{val}</div>
                <div className="text-[10px] uppercase text-slate-500">{key.replace(/_/g, " ")}</div>
              </div>
            ))}
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase text-slate-400">Rationales</h4>
            {artifacts.judge.rationales.map((r, i) => (
              <div key={i} className="mb-1.5 text-sm text-slate-300">
                • {r.point} <MsgIds ids={r.message_ids} onClick={onScrollToMessage} />
              </div>
            ))}
          </div>
          <div className={`rounded-lg p-3 text-sm ${isDark ? "bg-slate-700/30 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <span className="font-semibold">Recommendation: </span>{artifacts.judge.executive_recommendation}
          </div>
          {artifacts.judge.risks_and_compliance_notes && (
            <div className={`rounded-lg border border-amber-500/30 p-3 text-xs text-amber-400`}>
              <span className="font-semibold">Risks: </span>{artifacts.judge.risks_and_compliance_notes}
            </div>
          )}
        </div>
      )}

      {/* Argument Graph — interactive node/edge graph with hover for full claim */}
      {tab === "graph" && artifacts.argumentGraph && (
        <DebateArgumentGraph argumentGraph={artifacts.argumentGraph} isDark={isDark} />
      )}

      {/* Coverage Gaps */}
      {tab === "gaps" && (
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {artifacts.coverageGaps.length === 0 && (
            <p className="text-sm text-slate-500">No coverage gaps identified.</p>
          )}
          {artifacts.coverageGaps.map((g) => (
            <div key={g.gapId} className={`rounded-lg border p-3 ${
              g.severity === "high" ? "border-red-500/30 bg-red-500/5" :
              g.severity === "medium" ? "border-amber-500/30 bg-amber-500/5" :
              "border-slate-600/30 bg-slate-800/20"
            }`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                    g.severity === "high" ? "bg-red-500/20 text-red-400" :
                    g.severity === "medium" ? "bg-amber-500/20 text-amber-400" :
                    "bg-slate-500/20 text-slate-400"
                  }`}>
                    {g.severity.toUpperCase()}
                  </span>
                  <span className="ml-1.5 text-[10px] text-slate-500">{g.type.replace(/_/g, " ")}</span>
                </div>
                <MsgIds ids={g.relatedMessageIds} onClick={onScrollToMessage} />
              </div>
              <p className="mt-1.5 text-xs text-slate-300">{g.description}</p>
            </div>
          ))}
        </div>
      )}

      {/* Export */}
      {tab === "export" && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              onClick={() => downloadFile(
                JSON.stringify({ messages: messages.map((m) => ({ ...m, isStreaming: undefined })), artifacts }, null, 2),
                `debate-${sessionId}.json`
              )}
              className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition ${isDark ? "border-slate-600 text-slate-300 hover:bg-slate-700/50" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
            >
              <Download className="h-4 w-4" /> Download JSON
            </button>
            <button
              onClick={async () => {
                const res = await fetch(`/api/debate/${sessionId}/export/markdown`);
                const data = await res.json();
                if (data.content) downloadFile(data.content, `debate-${sessionId}.md`);
              }}
              className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition ${isDark ? "border-slate-600 text-slate-300 hover:bg-slate-700/50" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
            >
              <Download className="h-4 w-4" /> Download Markdown
            </button>
          </div>
          <button
            onClick={() => copyToClipboard(JSON.stringify({ messages, artifacts }, null, 2))}
            className={`flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm transition ${isDark ? "border-slate-600 text-slate-300 hover:bg-slate-700/50" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied!" : "Copy JSON to Clipboard"}
          </button>
        </div>
      )}
    </div>
  );
}
