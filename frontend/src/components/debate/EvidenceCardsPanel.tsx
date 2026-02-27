"use client";

import { useState } from "react";
import { FileSearch, ExternalLink, ChevronDown, ChevronUp, Quote, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { EvidenceCard } from "./types";

type Props = {
  forCards: EvidenceCard[];
  againstCards: EvidenceCard[];
  isDark: boolean;
};

function ConfidenceBadge({ confidence, isDark }: { confidence: number; isDark: boolean }) {
  const level = confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
  const colors = {
    high: isDark ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-200",
    medium: isDark ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-amber-50 text-amber-700 border-amber-200",
    low: isDark ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-red-50 text-red-700 border-red-200",
  };
  const icons = { high: ShieldCheck, medium: Shield, low: ShieldAlert };
  const Icon = icons[level];

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${colors[level]}`}>
      <Icon className="h-3 w-3" />
      {(confidence * 100).toFixed(0)}%
    </span>
  );
}

function CardItem({ card, isDark }: { card: EvidenceCard; isDark: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded-xl border p-3 transition-all ${isDark ? "border-slate-700/50 bg-slate-800/40 hover:border-slate-600/60" : "border-slate-200 bg-white hover:border-slate-300"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <ConfidenceBadge confidence={card.confidence} isDark={isDark} />
            <span className={`text-[10px] font-medium ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              {card.domain}
            </span>
            {card.source_type !== "general" && (
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${isDark ? "bg-violet-500/20 text-violet-400" : "bg-violet-100 text-violet-600"}`}>
                {card.source_type}
              </span>
            )}
          </div>
          <p className={`text-xs leading-relaxed ${isDark ? "text-slate-300" : "text-slate-700"}`}>
            {card.snippet}
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex-shrink-0 rounded-lg p-1 transition ${isDark ? "text-slate-500 hover:bg-slate-700 hover:text-slate-300" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"}`}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 space-y-2 border-t border-dashed pt-2" style={{ borderColor: isDark ? "rgb(51 65 85 / 0.5)" : "rgb(226 232 240)" }}>
          {card.quote && (
            <div className={`flex gap-2 rounded-lg p-2 ${isDark ? "bg-slate-700/30" : "bg-slate-50"}`}>
              <Quote className={`mt-0.5 h-3 w-3 flex-shrink-0 ${isDark ? "text-violet-400" : "text-violet-500"}`} />
              <p className={`text-[11px] italic ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                &ldquo;{card.quote}&rdquo;
              </p>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className={`text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              <span className="font-semibold">Claim:</span> {card.claim}
            </p>
            <a
              href={card.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1 text-[10px] font-medium ${isDark ? "text-violet-400 hover:text-violet-300" : "text-violet-600 hover:text-violet-500"}`}
            >
              Source <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
          <p className={`text-[9px] font-mono ${isDark ? "text-slate-600" : "text-slate-300"}`}>
            {card.card_id}
          </p>
        </div>
      )}
    </div>
  );
}

export default function EvidenceCardsPanel({ forCards, againstCards, isDark }: Props) {
  const [view, setView] = useState<"for" | "against" | "all">("all");

  const displayCards = view === "for" ? forCards : view === "against" ? againstCards : [...forCards, ...againstCards];

  return (
    <div className={`rounded-2xl border p-4 ${isDark ? "border-sky-500/20 bg-sky-500/5" : "border-sky-200 bg-sky-50/50"}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <FileSearch className={`h-4 w-4 ${isDark ? "text-sky-400" : "text-sky-600"}`} />
          Retrieved Evidence
          <span className={`text-[10px] font-normal ${isDark ? "text-slate-500" : "text-slate-400"}`}>
            {forCards.length + againstCards.length} cards
          </span>
        </h3>
        <div className="flex gap-1">
          {(["all", "for", "against"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold transition ${
                view === v
                  ? isDark
                    ? "bg-sky-500/20 text-sky-300"
                    : "bg-sky-100 text-sky-700"
                  : isDark
                    ? "text-slate-500 hover:text-slate-300"
                    : "text-slate-400 hover:text-slate-600"
              }`}
            >
              {v === "all" ? "All" : v === "for" ? `FOR (${forCards.length})` : `AGAINST (${againstCards.length})`}
            </button>
          ))}
        </div>
      </div>

      {displayCards.length === 0 ? (
        <p className={`text-center text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
          No evidence cards collected yet.
        </p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {displayCards.map((card) => (
            <CardItem key={card.card_id} card={card} isDark={isDark} />
          ))}
        </div>
      )}
    </div>
  );
}
