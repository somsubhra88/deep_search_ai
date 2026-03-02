"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  Search,
  Loader2,
  FileText,
  Shield,
  Zap,
  ChevronDown,
  ChevronUp,
  History,
  AlertCircle,
  Scale,
  Eye,
  ShieldCheck,
  Brain,
  MessageSquarePlus,
  BadgeCheck,
  Activity,
  Sparkles,
  X,
  ArrowRight,
  Clock,
  GraduationCap,
  SearchCheck,
  Layers,
  Waypoints,
  Settings2,
  Database,
  Trash2,
  Pin,
  MoreHorizontal,
  ArrowRightCircle,
  HelpCircle,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import MemoryGraphWidget from "@/components/memory/MemoryGraphWidget";
import DebateMode from "@/components/debate/DebateMode";
import RAGMode from "@/components/RAGMode";
import ModeCustomization, { DEFAULT_MODE_SETTINGS, type ModeSettings } from "@/components/ModeCustomization";
import { useTheme } from "@/context/ThemeContext";
import {
  compressAndStore,
  loadFromStorage,
  clearAllSearchHistory,
  addResearchHistoryEntry,
  HISTORY_KEY,
  MAX_HISTORY,
  SESSIONS_KEY,
  MAX_SESSIONS,
  SETUP_KEY,
  BRIDGE_PINNED_KEY,
  EXPLAIN_MODE_KEY,
  saveActiveReport,
  loadActiveReport,
  clearActiveReport,
} from "@/lib/storage";
import type { ActiveReport } from "@/lib/storage";
import { useRouter } from "next/navigation";
import ClearHistoryModal from "@/components/ClearHistoryModal";
import ReportViewer from "@/components/ReportViewer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProgressStep = {
  step: string;
  detail: string;
  data?: Record<string, unknown>;
};

type ConfidenceMatrix = {
  pro_arguments?: string[];
  con_arguments?: string[];
  consensus_points?: string[];
  unresolved_conflicts?: string[];
};

type DataVoid = {
  is_data_void: boolean;
  void_type?: "low_volume" | "seo_spam" | "unverified_sources";
  explanation?: string;
};

type SelfReflection = {
  quality_score?: number;
  factual_density?: string;
  bias_indicators?: string[];
  missing_perspectives?: string[];
  strength_points?: string[];
  improvement_suggestions?: string[];
  needs_refinement?: boolean;
};

type VerifiedClaim = {
  claim: string;
  status: "verified" | "partially_verified" | "unverified" | "contradicted";
  supporting_sources?: number[];
  note?: string;
};

type FollowUpQuestion = {
  question: string;
  rationale: string;
  depth: "quick" | "moderate" | "deep";
};

type TokenUsage = {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  budget_remaining_pct?: string;
  calls?: Array<{ stage: string; input_tokens: number; output_tokens: number }>;
  cache_stats?: { hits: number; misses: number; size: number; hit_rate: string };
};

type ReportMetadata = {
  sections?: Array<{
    heading: string;
    content?: string;
    sources?: number[];
    confidence?: number;
    consensus?: string;
  }>;
  research_gaps?: string[];
  data_void?: DataVoid;
  confidence_matrix?: ConfidenceMatrix;
  self_reflection?: SelfReflection;
  verified_claims?: VerifiedClaim[];
  followup_questions?: FollowUpQuestion[];
  token_usage?: TokenUsage;
  sources?: Array<{ id: number; title: string; url: string; domain: string; type: string }>;
  graph?: {
    nodes: Array<{ id: number; title: string; url: string; domain: string; type: string }>;
    edges: Array<{ source: number; target: number }>;
  };
  diversity?: { score: number; breakdown: Array<{ type: string; count: number; value: number }> };
  model_used?: string;
  modes_used?: string[];
  essence_text?: string;
  recalled_memories?: RecalledMemory[];
};

type RecalledMemory = {
  query: string;
  essence: string;
  timestamp: string;
  similarity: number;
};

/** Action suggestion from POST /api/search/{id}/action_suggestions (backend-generated, no hardcoding). */
type BridgeSuggestion = {
  action_id: string;
  label: string;
  icon_key: string;
  short_description: string;
  risk_hint: string;
  suggested_persona_id: string;
  prefill_prompt: string;
};

/** Structured explain payload (Search/Assistant). Safe: no prompts or secrets. */
type ExplainPayload = {
  cache_decision?: { hit: boolean; kind: string; hits?: number; misses?: number; hit_rate?: string; why?: string } | null;
  retrieval?: {
    sources_considered_count: number;
    top_sources: Array<{ title: string; url?: string; doc_id?: string; score?: number | null }>;
    retrieval_params: Record<string, unknown>;
    why_these_sources?: string;
  } | null;
  generation?: { model?: string; provider?: string; prompt_version?: string; temperature?: number; max_tokens?: number } | null;
  safety?: { risk_level?: string | null; approvals?: unknown[]; tool_calls?: Array<{ tool: string; summary?: string }> } | null;
};

type SearchMode =
  | "standard"
  | "debate"
  | "timeline"
  | "academic"
  | "fact_check"
  | "deep_dive"
  | "social_media"
  | "rag";
type ModelId = "openai" | "anthropic" | "grok" | "mistral" | "gemini" | "deepseek" | "qwen" | "ollama" | "inception";
type SearchProvider = "serpapi" | "tavily";

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------

type Session = {
  id: string;
  query: string;
  timestamp: number;
  report: string;
  metadata: ReportMetadata | null;
};

type UserSetup = {
  llm_provider: ModelId;
  llm_model: string;
  llm_api_key: string;
  ollama_base_url: string;
  search_provider: SearchProvider;
  search_api_key: string;
};

const MODEL_PROVIDER_META: Record<
  ModelId,
  { label: string; description: string; color: string; keyLabel: string }
> = {
  openai: {
    label: "OpenAI",
    description: "GPT-4o, GPT-4.1, o3/o4 reasoning models",
    color: "from-emerald-500 to-teal-500",
    keyLabel: "OPENAI_API_KEY",
  },
  anthropic: {
    label: "Anthropic (Claude)",
    description: "Claude 4, Sonnet, Haiku models",
    color: "from-orange-500 to-amber-500",
    keyLabel: "ANTHROPIC_API_KEY",
  },
  grok: {
    label: "xAI (Grok)",
    description: "Grok-3, Grok-3 Mini from xAI",
    color: "from-sky-500 to-blue-600",
    keyLabel: "GROK_API_KEY",
  },
  mistral: {
    label: "Mistral AI",
    description: "Mistral Large, Medium, Codestral",
    color: "from-rose-500 to-pink-500",
    keyLabel: "MISTRAL_API_KEY",
  },
  gemini: {
    label: "Google (Gemini)",
    description: "Gemini 2.5 Pro, Flash models",
    color: "from-blue-500 to-indigo-500",
    keyLabel: "GEMINI_API_KEY",
  },
  deepseek: {
    label: "DeepSeek",
    description: "DeepSeek-V3, R1 reasoning model",
    color: "from-cyan-500 to-teal-600",
    keyLabel: "DEEPSEEK_API_KEY",
  },
  qwen: {
    label: "Qwen (DashScope)",
    description: "Alibaba Qwen-Max, Qwen3 models",
    color: "from-violet-500 to-purple-500",
    keyLabel: "QWEN_API_KEY",
  },
  inception: {
    label: "Inception Labs",
    description: "mercury-2 fast reasoning model",
    color: "from-emerald-500 to-cyan-500",
    keyLabel: "INCEPTION_API_KEY",
  },
  ollama: {
    label: "Ollama (Local)",
    description: "Run open-source models locally",
    color: "from-slate-500 to-zinc-600",
    keyLabel: "No API key required",
  },
};

const MODEL_CATALOG: Record<ModelId, string[]> = {
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "o4-mini",
    "o3",
    "o3-mini",
  ],
  anthropic: [
    "claude-sonnet-4-20250514",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
  ],
  grok: [
    "grok-3",
    "grok-3-fast",
    "grok-3-mini",
    "grok-3-mini-fast",
    "grok-2",
  ],
  mistral: [
    "mistral-large-latest",
    "mistral-medium-latest",
    "mistral-small-latest",
    "codestral-latest",
    "pixtral-large-latest",
    "mistral-saba-latest",
  ],
  gemini: [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
  ],
  deepseek: [
    "deepseek-chat",
    "deepseek-reasoner",
  ],
  qwen: [
    "qwen-max",
    "qwen-plus",
    "qwen-turbo",
    "qwen3-235b-a22b",
    "qwen3-32b",
    "qwen3-14b",
    "qwen2.5-72b-instruct",
    "qwen2.5-32b-instruct",
    "qwen2.5-14b-instruct",
    "qwen2.5-7b-instruct",
  ],
  inception: ["mercury-2"],
  ollama: [
    "llama3.2",
    "llama3.1:8b",
    "qwen2.5:7b",
    "mistral",
    "gemma2:9b",
    "phi4",
    "deepseek-r1:8b",
  ],
};

const SEARCH_PROVIDER_META: Record<
  SearchProvider,
  { label: string; keyLabel: string; helper: string }
> = {
  serpapi: {
    label: "SerpAPI",
    keyLabel: "SERPAPI_API_KEY",
    helper: "Google search engine results API",
  },
  tavily: {
    label: "Tavily",
    keyLabel: "TAVILY_API_KEY",
    helper: "AI search API focused on web extraction",
  },
};

const MODE_CONFIG: Record<SearchMode, { label: string; description: string; color: string; activeColor: string; icon: React.ReactNode }> = {
  standard: {
    label: "Standard",
    description: "Balanced research",
    color: "from-emerald-500 to-cyan-500",
    activeColor: "border-emerald-500 bg-emerald-500/15 text-emerald-400",
    icon: <Search className="h-4 w-4" />,
  },
  debate: {
    label: "Debate",
    description: "Pro vs. Con analysis",
    color: "from-violet-500 to-purple-500",
    activeColor: "border-violet-500 bg-violet-500/15 text-violet-400",
    icon: <Scale className="h-4 w-4" />,
  },
  timeline: {
    label: "Timeline",
    description: "Chronological view",
    color: "from-blue-500 to-indigo-500",
    activeColor: "border-blue-500 bg-blue-500/15 text-blue-400",
    icon: <Clock className="h-4 w-4" />,
  },
  academic: {
    label: "Academic",
    description: "Scholarly sources",
    color: "from-amber-500 to-orange-500",
    activeColor: "border-amber-500 bg-amber-500/15 text-amber-400",
    icon: <GraduationCap className="h-4 w-4" />,
  },
  fact_check: {
    label: "Fact Check",
    description: "Verify claims",
    color: "from-teal-500 to-emerald-500",
    activeColor: "border-teal-500 bg-teal-500/15 text-teal-400",
    icon: <SearchCheck className="h-4 w-4" />,
  },
  deep_dive: {
    label: "Deep Dive",
    description: "Maximum depth",
    color: "from-rose-500 to-pink-500",
    activeColor: "border-rose-500 bg-rose-500/15 text-rose-400",
    icon: <Layers className="h-4 w-4" />,
  },
  social_media: {
    label: "Social",
    description: "Social media signals",
    color: "from-cyan-500 to-blue-500",
    activeColor: "border-cyan-500 bg-cyan-500/15 text-cyan-400",
    icon: <MessageSquarePlus className="h-4 w-4" />,
  },
  rag: {
    label: "RAG",
    description: "Knowledge base Q&A",
    color: "from-orange-500 to-amber-500",
    activeColor: "border-orange-500 bg-orange-500/15 text-orange-400",
    icon: <Database className="h-4 w-4" />,
  },
};


// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

const ConfidenceBadge = ({
  heading,
  confidence,
  consensus,
}: {
  heading?: string;
  confidence: number;
  consensus: string;
}) => {
  const consensusColor =
    consensus === "consensus"
      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
      : consensus === "conflict"
      ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
      : "bg-slate-500/20 text-slate-400 border-slate-500/30";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${consensusColor}`}
      title={consensus === "consensus" ? "Sources agree" : consensus === "conflict" ? "Conflicting" : "Single source"}
    >
      {heading && <span className="truncate max-w-[120px]">{heading}</span>}
      <span>
        {confidence} source{confidence !== 1 ? "s" : ""}
        {consensus === "conflict" && " ⚠"}
      </span>
    </span>
  );
};

const ClaimStatusBadge = ({ status }: { status: VerifiedClaim["status"] }) => {
  const styles = {
    verified: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    partially_verified: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    unverified: "bg-slate-500/20 text-slate-400 border-slate-500/30",
    contradicted: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const labels = {
    verified: "Verified",
    partially_verified: "Partial",
    unverified: "Unverified",
    contradicted: "Contradicted",
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[status]}`}>
      {labels[status]}
    </span>
  );
};

const DepthBadge = ({ depth }: { depth: string }) => {
  const styles: Record<string, string> = {
    quick: "bg-emerald-500/15 text-emerald-400",
    moderate: "bg-amber-500/15 text-amber-400",
    deep: "bg-violet-500/15 text-violet-400",
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${styles[depth] || styles.moderate}`}>
      {depth}
    </span>
  );
};

const QualityMeter = ({ score }: { score: number }) => {
  const pct = Math.min(100, Math.max(0, score * 10));
  const color = score >= 7 ? "bg-emerald-500" : score >= 5 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 rounded-full bg-slate-700/50 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-bold tabular-nums">{score}/10</span>
    </div>
  );
};

const ResearchEssenceBanner = ({
  essenceText,
  recalledMemories,
  isDark,
}: {
  essenceText: string | null;
  recalledMemories: RecalledMemory[];
  isDark: boolean;
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!essenceText && recalledMemories.length === 0) return null;

  return (
    <div
      className={`relative mb-8 overflow-hidden rounded-2xl border p-5 shadow-lg backdrop-blur-sm transition-all duration-500 ${
        isDark
          ? "border-emerald-500/30 bg-gradient-to-r from-emerald-500/5 via-cyan-500/5 to-emerald-500/5 shadow-emerald-500/10"
          : "border-emerald-400/40 bg-gradient-to-r from-emerald-50/80 via-cyan-50/60 to-emerald-50/80 shadow-emerald-200/40"
      }`}
    >
      {/* Soft glow effect */}
      <div className="pointer-events-none absolute -inset-1 rounded-2xl bg-emerald-500/5 blur-xl" />

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className={`h-4 w-4 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
            <span
              className={`text-xs font-semibold uppercase tracking-wider ${
                isDark ? "text-emerald-400" : "text-emerald-600"
              }`}
            >
              Research Essence
            </span>
          </div>
          {essenceText && (
            <p
              className={`text-base italic leading-relaxed ${
                isDark ? "text-slate-200" : "text-slate-700"
              }`}
            >
              &ldquo;{essenceText}&rdquo;
            </p>
          )}
        </div>

        {recalledMemories.length > 0 && (
          <div className="relative shrink-0">
            <button
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              onClick={() => setShowTooltip((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                isDark
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                  : "border-emerald-400/40 bg-emerald-100/60 text-emerald-700 hover:bg-emerald-200/60"
              }`}
            >
              <Brain className="h-3.5 w-3.5" />
              Linked to {recalledMemories.length} past search
              {recalledMemories.length !== 1 ? "es" : ""}
            </button>

            {showTooltip && (
              <div
                className={`absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border p-4 shadow-xl backdrop-blur-md ${
                  isDark
                    ? "border-slate-700/60 bg-slate-800/95"
                    : "border-slate-200 bg-white/95"
                }`}
              >
                <p
                  className={`mb-2 text-xs font-semibold ${
                    isDark ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  Related Past Research
                </p>
                <ul className="space-y-2">
                  {recalledMemories.map((m, i) => (
                    <li
                      key={i}
                      className={`rounded-lg px-3 py-2 ${
                        isDark ? "bg-slate-700/30" : "bg-slate-100/80"
                      }`}
                    >
                      <p
                        className={`text-xs font-medium truncate ${
                          isDark ? "text-slate-300" : "text-slate-700"
                        }`}
                      >
                        {m.query}
                      </p>
                      <p
                        className={`mt-0.5 text-[10px] italic ${
                          isDark ? "text-slate-500" : "text-slate-400"
                        }`}
                      >
                        {m.essence}
                      </p>
                      <div
                        className={`mt-1 flex items-center gap-2 text-[10px] ${
                          isDark ? "text-slate-600" : "text-slate-400"
                        }`}
                      >
                        <span>{Math.round(m.similarity * 100)}% match</span>
                        {m.timestamp && (
                          <>
                            <span>·</span>
                            <span>
                              {new Date(m.timestamp).toLocaleDateString()}
                            </span>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Data Integrity Mock
// ---------------------------------------------------------------------------

function checkDataIntegrity(q: string): Promise<"green" | "yellow" | "red"> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const lc = q.toLowerCase();
      if (lc.length < 5) { resolve("red"); return; }
      const voidWords = ["hoax", "fake", "qanon", "flat earth", "illuminati"];
      if (voidWords.some((w) => lc.includes(w))) { resolve("red"); return; }
      const contested = ["conspiracy", "debate", "controversial", "politics", "vaccine", "ivermectin"];
      if (contested.some((w) => lc.includes(w))) { resolve("yellow"); return; }
      resolve("green");
    }, 600);
  });
}

// ---------------------------------------------------------------------------
// PerspectiveDial
// ---------------------------------------------------------------------------

const PerspectiveDial = ({
  value,
  onChange,
  isDark,
}: {
  value: number;
  onChange: (v: number) => void;
  isDark: boolean;
}) => (
  <div className={`mb-8 rounded-xl border px-6 py-4 ${isDark ? "border-slate-700/40 bg-slate-800/20" : "border-slate-200 bg-white/60"}`}>
    <div className="mb-3 flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Perspective Dial</span>
      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold tabular-nums ${
        value < 33 ? "bg-emerald-500/15 text-emerald-400" : value < 66 ? "bg-amber-500/15 text-amber-400" : "bg-rose-500/15 text-rose-400"
      }`}>
        {value}
      </span>
    </div>
    <input
      type="range"
      min={0}
      max={100}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="perspective-slider w-full"
    />
    <div className="mt-2 flex justify-between text-[10px] font-medium text-slate-500">
      <span>Strict Academic</span>
      <span>Mainstream Consensus</span>
      <span>Fringe / Unfiltered</span>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// SwarmVisualizer (Debate Mode Loading)
// ---------------------------------------------------------------------------

const SWARM_STATUSES = [
  "Spawning agents...",
  "Interrogating sources...",
  "Cross-referencing evidence...",
  "Synthesizing debate...",
];

const SwarmVisualizer = ({ isDark }: { isDark: boolean }) => {
  const [statusIdx, setStatusIdx] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setStatusIdx((i) => (i + 1) % SWARM_STATUSES.length), 2500);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className={`mb-12 rounded-2xl border p-6 ${isDark ? "border-slate-700/60 bg-slate-800/30" : "border-slate-200 bg-white/80"}`}>
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
        <Scale className="h-4 w-4 text-violet-400" /> Agent Swarm — Debate Mode
      </h2>

      <svg viewBox="0 0 600 380" className="mx-auto block w-full max-w-lg" aria-label="Debate agent swarm visualization">
        {/* Lines: center → agents */}
        <line x1="300" y1="75" x2="150" y2="170" className="swarm-line swarm-line-d1" stroke={isDark ? "#475569" : "#cbd5e1"} strokeWidth="1.5" fill="none" />
        <line x1="300" y1="75" x2="450" y2="170" className="swarm-line swarm-line-d2" stroke={isDark ? "#475569" : "#cbd5e1"} strokeWidth="1.5" fill="none" />

        {/* Lines: agents → sources */}
        <line x1="150" y1="200" x2="75" y2="300" className="swarm-line swarm-line-d3" stroke={isDark ? "#334155" : "#e2e8f0"} strokeWidth="1" fill="none" />
        <line x1="150" y1="200" x2="225" y2="300" className="swarm-line swarm-line-d4" stroke={isDark ? "#334155" : "#e2e8f0"} strokeWidth="1" fill="none" />
        <line x1="450" y1="200" x2="375" y2="300" className="swarm-line swarm-line-d5" stroke={isDark ? "#334155" : "#e2e8f0"} strokeWidth="1" fill="none" />
        <line x1="450" y1="200" x2="525" y2="300" className="swarm-line swarm-line-d6" stroke={isDark ? "#334155" : "#e2e8f0"} strokeWidth="1" fill="none" />

        {/* Particles flowing along lines */}
        <circle r="2.5" fill="#34d399" className="swarm-particle" opacity="0.8">
          <animateMotion dur="2s" repeatCount="indefinite" path="M300,75 L150,185" />
        </circle>
        <circle r="2.5" fill="#fb7185" className="swarm-particle" opacity="0.8">
          <animateMotion dur="2.2s" repeatCount="indefinite" path="M300,75 L450,185" />
        </circle>
        <circle r="2" fill="#34d399" className="swarm-particle" opacity="0.6">
          <animateMotion dur="1.8s" repeatCount="indefinite" path="M150,200 L75,300" begin="0.8s" />
        </circle>
        <circle r="2" fill="#34d399" className="swarm-particle" opacity="0.6">
          <animateMotion dur="2s" repeatCount="indefinite" path="M150,200 L225,300" begin="1s" />
        </circle>
        <circle r="2" fill="#fb7185" className="swarm-particle" opacity="0.6">
          <animateMotion dur="1.9s" repeatCount="indefinite" path="M450,200 L375,300" begin="1.2s" />
        </circle>
        <circle r="2" fill="#fb7185" className="swarm-particle" opacity="0.6">
          <animateMotion dur="2.1s" repeatCount="indefinite" path="M450,200 L525,300" begin="1.4s" />
        </circle>

        {/* Central query node */}
        <circle cx="300" cy="55" r="22" fill={isDark ? "#0f172a" : "#f1f5f9"} stroke="#22d3ee" strokeWidth="2" className="swarm-node" />
        <text x="300" y="59" textAnchor="middle" className="fill-cyan-400 text-[11px] font-semibold swarm-node">Query</text>

        {/* Agent Pro */}
        <circle cx="150" cy="185" r="18" fill={isDark ? "#0f172a" : "#f1f5f9"} stroke="#34d399" strokeWidth="2" className="swarm-node swarm-node-d1" />
        <text x="150" y="189" textAnchor="middle" className="fill-emerald-400 text-[10px] font-semibold swarm-node swarm-node-d1">Pro</text>
        <text x="150" y="225" textAnchor="middle" className={`text-[9px] ${isDark ? "fill-slate-500" : "fill-slate-400"} swarm-node swarm-node-d1`}>Agent A</text>

        {/* Agent Con */}
        <circle cx="450" cy="185" r="18" fill={isDark ? "#0f172a" : "#f1f5f9"} stroke="#fb7185" strokeWidth="2" className="swarm-node swarm-node-d2" />
        <text x="450" y="189" textAnchor="middle" className="fill-rose-400 text-[10px] font-semibold swarm-node swarm-node-d2">Con</text>
        <text x="450" y="225" textAnchor="middle" className={`text-[9px] ${isDark ? "fill-slate-500" : "fill-slate-400"} swarm-node swarm-node-d2`}>Agent B</text>

        {/* Source nodes */}
        {[
          { cx: 75, cy: 310, delay: "d3", color: "#34d399" },
          { cx: 225, cy: 310, delay: "d4", color: "#34d399" },
          { cx: 375, cy: 310, delay: "d5", color: "#fb7185" },
          { cx: 525, cy: 310, delay: "d6", color: "#fb7185" },
        ].map((s, i) => (
          <g key={i}>
            <circle cx={s.cx} cy={s.cy} r="12" fill={isDark ? "#0f172a" : "#f1f5f9"} stroke={s.color} strokeWidth="1.5" opacity="0.7" className={`swarm-node swarm-node-${s.delay}`} />
            <text x={s.cx} y={s.cy + 4} textAnchor="middle" className={`text-[8px] ${isDark ? "fill-slate-500" : "fill-slate-400"} swarm-node swarm-node-${s.delay}`}>Src {i + 1}</text>
          </g>
        ))}
      </svg>

      <p className="mt-4 text-center text-sm font-medium text-slate-400 transition-all duration-500">
        {SWARM_STATUSES[statusIdx]}
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const BRIDGE_VISIBLE_PILLS = 5;

function getBridgeIcon(iconKey: string) {
  switch (iconKey) {
    case "search": return <Search className="h-3.5 w-3.5 shrink-0" />;
    case "folder": return <FileText className="h-3.5 w-3.5 shrink-0" />;
    case "mail": return <MessageSquarePlus className="h-3.5 w-3.5 shrink-0" />;
    case "calendar": return <Clock className="h-3.5 w-3.5 shrink-0" />;
    case "list": return <History className="h-3.5 w-3.5 shrink-0" />;
    case "zap": return <Zap className="h-3.5 w-3.5 shrink-0" />;
    default: return <ArrowRightCircle className="h-3.5 w-3.5 shrink-0" />;
  }
}

export default function SearchPage() {
  const { isDark } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isResearching, setIsResearching] = useState(false);
  const [progressLog, setProgressLog] = useState<ProgressStep[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<ReportMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [useSnippetsOnly, setUseSnippetsOnly] = useState(false);
  const [safeSearch, setSafeSearch] = useState(true);
  const [selectedModes, setSelectedModes] = useState<Set<SearchMode>>(new Set(["standard"]));
  const [modeSettings, setModeSettings] = useState<ModeSettings>(DEFAULT_MODE_SETTINGS);
  const [modelId, setModelId] = useState<ModelId>("openai");
  const [modelName, setModelName] = useState<string>(MODEL_CATALOG.openai[0]);
  const [searchProvider, setSearchProvider] = useState<SearchProvider>("serpapi");
  const [showFullError, setShowFullError] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [essenceText, setEssenceText] = useState<string | null>(null);
  const [recalledMemories, setRecalledMemories] = useState<RecalledMemory[]>([]);
  const [perspectiveBias, setPerspectiveBias] = useState(50);
  const [dataIntegrity, setDataIntegrity] = useState<"idle" | "checking" | "green" | "yellow" | "red">("idle");
  const [showMemoryGraph, setShowMemoryGraph] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [configuredProviders, setConfiguredProviders] = useState<Partial<Record<ModelId, boolean>>>({});
  const [setupStep, setSetupStep] = useState<1 | 2>(1);
  const [showClearModal, setShowClearModal] = useState(false);
  const [isSavingSetup, setIsSavingSetup] = useState(false);
  const [setup, setSetup] = useState<UserSetup>({
    llm_provider: "openai",
    llm_model: MODEL_CATALOG.openai[0],
    llm_api_key: "",
    ollama_base_url: "http://host.docker.internal:11434/v1",
    search_provider: "serpapi",
    search_api_key: "",
  });
  const [currentSearchId, setCurrentSearchId] = useState<string | null>(null);
  const [bridgeSuggestions, setBridgeSuggestions] = useState<BridgeSuggestion[]>([]);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [bridgeMoreOpen, setBridgeMoreOpen] = useState(false);
  const [explainMode, setExplainMode] = useState(() => loadFromStorage(EXPLAIN_MODE_KEY, false));
  const [currentExplain, setCurrentExplain] = useState<ExplainPayload | null>(null);
  const [explainPanelOpen, setExplainPanelOpen] = useState(false);
  const [pinnedActionIds, setPinnedActionIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(BRIDGE_PINNED_KEY);
      if (!raw) return new Set<string>();
      const arr = JSON.parse(raw) as string[];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set<string>();
    }
  });

  const searchRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const toggleMode = useCallback((mode: SearchMode) => {
    setSelectedModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) {
        next.delete(mode);
        if (next.size === 0) next.add("standard");
      } else {
        if (mode === "standard" || mode === "rag") {
          return new Set([mode]);
        }
        next.delete("standard");
        next.delete("rag");
        next.add(mode);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setHistory(loadFromStorage(HISTORY_KEY, []));
    setSessions(loadFromStorage(SESSIONS_KEY, []));
    const storedSetup = loadFromStorage<UserSetup | null>(SETUP_KEY, null);
    if (storedSetup) {
      setSetup(storedSetup);
      setModelId(storedSetup.llm_provider);
      setModelName(storedSetup.llm_model);
      setSearchProvider(storedSetup.search_provider);
    } else {
      setShowSetupModal(true);
    }
    // Restore active report if navigating back (e.g. from Assistant)
    const saved = loadActiveReport();
    if (saved?.report) {
      setQuery(saved.query || "");
      setReport(saved.report);
      setMetadata(saved.metadata as ReportMetadata | null);
      setCurrentSearchId(saved.searchId);
      setEssenceText(saved.essenceText);
      setRecalledMemories((saved.recalledMemories || []) as RecalledMemory[]);
      setCurrentExplain(saved.explain as ExplainPayload | null);
      setBridgeSuggestions((saved.bridgeSuggestions || []) as BridgeSuggestion[]);
    }
  }, []);

  useEffect(() => {
    fetch("/api/providers")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Array<{ provider?: string; configured?: boolean }>) => {
        const map: Partial<Record<ModelId, boolean>> = {};
        data?.forEach((p) => {
          if (p?.provider) map[p.provider as ModelId] = !!p.configured;
        });
        setConfiguredProviders(map);
      })
      .catch(() => {
        // non-fatal
      });
  }, []);

  const addToHistory = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const next = [trimmed, ...prev.filter((x) => x !== trimmed)].slice(0, MAX_HISTORY);
      compressAndStore(HISTORY_KEY, next);
      return next;
    });
    addResearchHistoryEntry({
      query: trimmed,
      modes: Array.from(selectedModes),
      provider: searchProvider,
      model: modelName,
    });
  }, [selectedModes, searchProvider, modelName]);

  const handleClearHistory = useCallback(() => {
    clearAllSearchHistory();
    clearActiveReport();
    setHistory([]);
    setSessions([]);
    setReport(null);
    setMetadata(null);
    setCurrentSearchId(null);
    setCurrentExplain(null);
    setEssenceText(null);
    setRecalledMemories([]);
    setBridgeSuggestions([]);
    setShowClearModal(false);
    toast.success("History cleared");
  }, []);

  useEffect(() => {
    if (!currentSearchId || !report) return;
    setBridgeLoading(true);
    fetch(`/api/search/${encodeURIComponent(currentSearchId)}/action_suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        perspective_dial: perspectiveBias,
        modes: Array.from(selectedModes),
      }),
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: BridgeSuggestion[]) => {
        setBridgeSuggestions(Array.isArray(data) ? data : []);
      })
      .catch(() => setBridgeSuggestions([]))
      .finally(() => setBridgeLoading(false));
  }, [currentSearchId, report, perspectiveBias, selectedModes]);

  const togglePin = useCallback((actionId: string) => {
    setPinnedActionIds((prev) => {
      const next = new Set(prev);
      if (next.has(actionId)) next.delete(actionId);
      else next.add(actionId);
      try {
        localStorage.setItem(BRIDGE_PINNED_KEY, JSON.stringify(Array.from(next)));
      } catch {
        /* quota */
      }
      return next;
    });
  }, []);

  const openAssistantWithAction = useCallback(
    (s: BridgeSuggestion) => {
      const params = new URLSearchParams({
        from: "search",
        search_id: currentSearchId!,
        action_id: s.action_id,
        persona_id: s.suggested_persona_id,
      });
      if (s.prefill_prompt) params.set("prefill", s.prefill_prompt);
      router.push(`/assistant?${params.toString()}`);
    },
    [currentSearchId, router]
  );

  const updateSetupProvider = useCallback((provider: ModelId) => {
    const defaultModel = MODEL_CATALOG[provider][0] || "";
    setSetup((prev) => ({
      ...prev,
      llm_provider: provider,
      llm_model: defaultModel,
      llm_api_key: provider === prev.llm_provider ? prev.llm_api_key : "",
    }));
    setModelId(provider);
    setModelName(defaultModel);
  }, []);

  const submitSetup = useCallback(async () => {
    const providerConfigured = configuredProviders[setup.llm_provider];
    if (setup.llm_provider !== "ollama" && setup.llm_provider !== "inception" && !setup.llm_api_key.trim()) {
      toast.error("Please enter your model API key");
      return;
    }
    if (setup.llm_provider === "inception" && !providerConfigured && !setup.llm_api_key.trim()) {
      toast.error("Please enter your model API key");
      return;
    }
    if (!setup.search_api_key.trim()) {
      toast.error("Please enter your search API key");
      return;
    }

    setIsSavingSetup(true);
    try {
      const trimmedKey = setup.llm_api_key.trim();
      const payload = {
        llm_provider: setup.llm_provider,
        llm_model: setup.llm_model.trim(),
        llm_api_key: setup.llm_provider === "ollama" ? null : trimmedKey,
        ollama_base_url: setup.llm_provider === "ollama" ? setup.ollama_base_url.trim() : null,
        search_provider: setup.search_provider,
        search_api_key: setup.search_api_key.trim(),
      };

      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((body?.error as string) || `HTTP ${res.status}`);
      }

      const nextSetup: UserSetup = {
        ...setup,
        llm_model: payload.llm_model,
        llm_api_key: setup.llm_provider === "inception" ? "" : trimmedKey,
      };
      compressAndStore(SETUP_KEY, nextSetup);
      setConfiguredProviders((prev) => ({ ...prev, [setup.llm_provider]: true }));
      setModelId(nextSetup.llm_provider);
      setModelName(nextSetup.llm_model);
      setSearchProvider(nextSetup.search_provider);
      setShowSetupModal(false);
      setSetupStep(1);
      toast.success("Setup saved. You can now start researching.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setIsSavingSetup(false);
    }
  }, [setup, configuredProviders]);

  const cancelResearch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsResearching(false);
    toast.info("Research cancelled");
  }, []);

  const runResearch = useCallback(async (overrideQuery?: string) => {
    const q = (overrideQuery || query).trim();
    if (!q) return;
    const providerConfigured = configuredProviders[setup.llm_provider];
    const hasLLMKey =
      setup.llm_provider === "ollama"
        ? true
        : setup.llm_provider === "inception"
          ? providerConfigured || !!setup.llm_api_key.trim()
          : !!setup.llm_api_key.trim();
    const hasSetup = hasLLMKey && !!setup.search_api_key.trim();
    if (!hasSetup) {
      setShowSetupModal(true);
      toast.info("Complete setup first to run research");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsResearching(true);
    setProgressLog([]);
    setReport(null);
    setMetadata(null);
    setCurrentSearchId(null);
    setCurrentExplain(null);
    setBridgeSuggestions([]);
    clearActiveReport();
    setError(null);
    setShowFullError(false);
    setEssenceText(null);
    setRecalledMemories([]);
    if (!overrideQuery) setQuery(q);
    addToHistory(q);

    const actualModes = Array.from(selectedModes);
    if (actualModes.length === 0) actualModes.push("standard");

    try {
      const res = await fetch(
        "/api/research",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: q,
            use_snippets_only: useSnippetsOnly,
            safe_search: safeSearch,
            modes: actualModes,
            model_id: modelId,
            model_name: modelName,
            mode_settings: modeSettings,
          }),
          signal: controller.signal,
        }
      );

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error("Rate limit exceeded. Please wait a moment before searching again.");
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.error) {
                  setError(data.error);
                  toast.error("Research failed");
                  break;
                }
                setProgressLog((prev) => [
                  ...prev,
                  { step: data.step || "", detail: data.detail || "", data: data.data },
                ]);

                if (
                  data.step === "memory_recall" &&
                  Array.isArray(data.data?.recalled_memories)
                ) {
                  setRecalledMemories(
                    data.data.recalled_memories as RecalledMemory[]
                  );
                }

                if (data.step === "complete" && data.data?.report) {
                  setReport(data.data.report);
                  const meta = data.data.metadata || null;
                  setMetadata(meta);
                  if (meta?.essence_text) setEssenceText(meta.essence_text);
                  if (Array.isArray(meta?.recalled_memories)) {
                    setRecalledMemories(
                      meta.recalled_memories as RecalledMemory[]
                    );
                  }
                  const reportText = data.data.report as string;
                  const session: Session = {
                    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    query: q,
                    timestamp: Date.now(),
                    report: reportText.slice(0, 50000),
                    metadata: meta,
                  };
                  setSessions((prev) => {
                    const next = [session, ...prev].slice(0, MAX_SESSIONS);
                    compressAndStore(SESSIONS_KEY, next);
                    return next;
                  });
                  setCurrentSearchId(session.id);
                  setCurrentExplain((data.data as { explain?: ExplainPayload }).explain ?? null);
                  fetch("/api/search/record", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      id: session.id,
                      query: session.query,
                      created_at: session.timestamp,
                      mode: Array.from(selectedModes),
                      provider: searchProvider,
                      model: modelName,
                      perspective: perspectiveBias,
                      citations: meta?.sources ?? [],
                      summary_snippet: (meta?.essence_text || reportText.slice(0, 500)) ?? "",
                    }),
                  }).catch(() => {});
                  toast.success("Report ready!");
                }
              } catch {
                // ignore parse errors on SSE chunks
              }
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "Research failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsResearching(false);
      abortRef.current = null;
    }
  }, [query, useSnippetsOnly, safeSearch, selectedModes, modelId, modelName, modeSettings, addToHistory, setup, configuredProviders, searchProvider, perspectiveBias]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        runResearch();
      }
      if (e.key === "Escape" && isResearching) {
        cancelResearch();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [runResearch, isResearching, cancelResearch]);

  const copyToClipboard = useCallback(async () => {
    if (!report) return;
    await navigator.clipboard.writeText(report);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }, [report]);

  const downloadReport = useCallback(() => {
    if (!report) return;
    const blob = new Blob([report], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = query.slice(0, 30).replace(/[^a-zA-Z0-9_-]/g, "-");
    a.download = `research-${safeName}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report downloaded");
  }, [report, query]);

  // Persist active report to sessionStorage so it survives navigation (e.g. Search → Assistant → back)
  useEffect(() => {
    if (report) {
      saveActiveReport({
        query,
        report,
        metadata: metadata as Record<string, unknown> | null,
        searchId: currentSearchId,
        essenceText,
        recalledMemories: recalledMemories as ActiveReport["recalledMemories"],
        explain: currentExplain as Record<string, unknown> | null,
        bridgeSuggestions: bridgeSuggestions as unknown[],
      });
    }
  }, [report, query, metadata, currentSearchId, essenceText, recalledMemories, currentExplain, bridgeSuggestions]);

  const clearReport = useCallback(() => {
    setReport(null);
    setMetadata(null);
    setCurrentSearchId(null);
    setCurrentExplain(null);
    setEssenceText(null);
    setRecalledMemories([]);
    setBridgeSuggestions([]);
    setError(null);
    setProgressLog([]);
    clearActiveReport();
    toast.success("Report cleared");
  }, []);

  const loadSession = useCallback((session: Session) => {
    setQuery(session.query);
    setReport(session.report);
    setMetadata(session.metadata);
    setError(null);
    setShowSessions(false);
    toast.success("Session restored");
  }, []);

  const errorSummary = error?.split("\n\nFull traceback:")[0] ?? error;
  const errorTraceback = error?.includes("Full traceback:")
    ? error.split("Full traceback:\n")[1]
    : null;

  const tokenUsage = useMemo(() => metadata?.token_usage, [metadata]);
  const reflection = useMemo(() => metadata?.self_reflection, [metadata]);
  const verifiedClaims = useMemo(() => metadata?.verified_claims, [metadata]);
  const followupQuestions = useMemo(() => metadata?.followup_questions, [metadata]);

  const isDebateSwarm = isResearching && selectedModes.has("debate");
  const isDebateOnlyMode = selectedModes.has("debate") && selectedModes.size === 1;
  const isRAGMode = selectedModes.has("rag") && selectedModes.size === 1;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) { setDataIntegrity("idle"); return; }
    setDataIntegrity("checking");
    const timeout = setTimeout(() => {
      checkDataIntegrity(trimmed).then(setDataIntegrity);
    }, 500);
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div
      className={`min-h-screen transition-colors duration-500 ${
        isDark
          ? "bg-gradient-to-br from-slate-950 via-indigo-950/30 to-slate-950 text-slate-100"
          : "bg-gradient-to-br from-slate-50 via-indigo-50/50 to-slate-100 text-slate-900"
      }`}
    >
      <ClearHistoryModal
        open={showClearModal}
        onClose={() => setShowClearModal(false)}
        onConfirm={handleClearHistory}
      />
      {showSetupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className={`w-full max-w-xl rounded-2xl border p-6 shadow-2xl ${isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold">Welcome Setup</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {setupStep === 1
                    ? "Step 1/2: choose LLM provider + model and provide credentials."
                    : "Step 2/2: choose search engine and provide API key."}
                </p>
              </div>
              <button
                onClick={() => setShowSetupModal(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800/30"
                aria-label="Close setup"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {setupStep === 1 ? (
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">LLM Provider</span>
                  <select
                    value={setup.llm_provider}
                    onChange={(e) => updateSetupProvider(e.target.value as ModelId)}
                    className="w-full rounded-xl border border-slate-600/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-200"
                  >
                    {(Object.keys(MODEL_PROVIDER_META) as ModelId[]).map((provider) => (
                      <option key={provider} value={provider}>
                        {MODEL_PROVIDER_META[provider].label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Model (exhaustive preset list)</span>
                  <select
                    value={setup.llm_model}
                    onChange={(e) => setSetup((prev) => ({ ...prev, llm_model: e.target.value }))}
                    className="w-full rounded-xl border border-slate-600/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-200"
                  >
                    {MODEL_CATALOG[setup.llm_provider].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Custom model id (optional override)</span>
                  <input
                    type="text"
                    value={setup.llm_model}
                    onChange={(e) => setSetup((prev) => ({ ...prev, llm_model: e.target.value }))}
                    placeholder="Enter any model id"
                    className="w-full rounded-xl border border-slate-600/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-200"
                  />
                </label>

                {setup.llm_provider !== "ollama" ? (
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {MODEL_PROVIDER_META[setup.llm_provider].keyLabel}
                    </span>
                    <input
                      type="password"
                      value={setup.llm_api_key}
                      onChange={(e) => setSetup((prev) => ({ ...prev, llm_api_key: e.target.value }))}
                      placeholder="Paste API key"
                      className="w-full rounded-xl border border-slate-600/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-200"
                    />
                    {setup.llm_provider === "inception" && (
                      <p className="mt-1 text-xs text-slate-500">
                        Get your API key from https://inceptionlabs.ai
                      </p>
                    )}
                  </label>
                ) : (
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">OLLAMA_BASE_URL</span>
                    <input
                      type="text"
                      value={setup.ollama_base_url}
                      onChange={(e) => setSetup((prev) => ({ ...prev, ollama_base_url: e.target.value }))}
                      placeholder="http://host.docker.internal:11434/v1"
                      className="w-full rounded-xl border border-slate-600/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-200"
                    />
                  </label>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setSetupStep(2)}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Search Provider</span>
                  <select
                    value={setup.search_provider}
                    onChange={(e) =>
                      setSetup((prev) => ({
                        ...prev,
                        search_provider: e.target.value as SearchProvider,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-600/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-200"
                  >
                    {(Object.keys(SEARCH_PROVIDER_META) as SearchProvider[]).map((provider) => (
                      <option key={provider} value={provider}>
                        {SEARCH_PROVIDER_META[provider].label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    {SEARCH_PROVIDER_META[setup.search_provider].helper}
                  </p>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {SEARCH_PROVIDER_META[setup.search_provider].keyLabel}
                  </span>
                  <input
                    type="password"
                    value={setup.search_api_key}
                    onChange={(e) => setSetup((prev) => ({ ...prev, search_api_key: e.target.value }))}
                    placeholder="Paste search API key"
                    className="w-full rounded-xl border border-slate-600/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-200"
                  />
                </label>

                <div className="flex justify-between pt-2">
                  <button
                    onClick={() => setSetupStep(1)}
                    className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
                  >
                    Back
                  </button>
                  <button
                    onClick={submitSetup}
                    disabled={isSavingSetup}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {isSavingSetup ? "Saving..." : "Save & Continue"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="mx-auto max-w-5xl px-6 py-6">
        {/* Search Actions Bar */}
        <div className="mb-8 flex items-center justify-end gap-2">
          <button
            onClick={() => setShowSessions((v) => !v)}
            className="rounded-xl p-2.5 transition hover:bg-slate-200/50 dark:hover:bg-slate-800/50"
            aria-label="Research sessions"
            title="Past research sessions"
          >
            <History className="h-5 w-5 text-slate-500" />
          </button>
          <button
            onClick={() => setShowMemoryGraph((v) => !v)}
            className={`relative rounded-xl p-2.5 transition hover:bg-slate-200/50 dark:hover:bg-slate-800/50 ${
              showMemoryGraph ? "bg-slate-200/50 dark:bg-slate-800/50" : ""
            }`}
            aria-label="Memory Graph"
            title="Semantic Memory Graph"
          >
            <Waypoints
              className={`h-5 w-5 transition-colors ${
                showMemoryGraph ? "text-green-400" : "text-slate-500"
              }`}
            />
            {sessions.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[9px] font-bold text-white shadow-sm">
                {sessions.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowSetupModal(true)}
            className="rounded-xl p-2.5 transition hover:bg-slate-200/50 dark:hover:bg-slate-800/50"
            aria-label="Setup"
            title="Model & API setup"
          >
            <Settings2 className="h-5 w-5 text-slate-500" />
          </button>
          <button
            onClick={() => setShowClearModal(true)}
            className="rounded-xl p-2.5 transition hover:bg-slate-200/50 dark:hover:bg-slate-800/50"
            aria-label="Clear history"
            title="Clear search history"
          >
            <Trash2 className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {/* Session Memory Panel */}
        {showSessions && sessions.length > 0 && (
          <div className={`mb-8 rounded-2xl border p-4 ${isDark ? "border-slate-700/60 bg-slate-800/40" : "border-slate-200 bg-white/90"}`}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-400">
                <History className="h-4 w-4" /> Research Sessions
              </h3>
              <button onClick={() => setShowSessions(false)} className="rounded-lg p-1 hover:bg-slate-700/30">
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
            <div className="space-y-2">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => loadSession(s)}
                  className={`w-full rounded-xl px-4 py-3 text-left transition ${isDark ? "hover:bg-slate-700/50" : "hover:bg-slate-100"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm truncate max-w-[70%]">{s.query}</span>
                    <span className="text-xs text-slate-500">{new Date(s.timestamp).toLocaleDateString()}</span>
                  </div>
                  {s.metadata?.self_reflection?.quality_score && (
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <span>Quality: {s.metadata.self_reflection.quality_score}/10</span>
                      <span>·</span>
                      <span>{s.metadata.sources?.length || 0} sources</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search Bar */}
        <div ref={searchRef} className="relative mb-6">
          <div
            className={`flex gap-3 rounded-2xl border p-2 shadow-xl transition-all duration-300 ${
              isDark
                ? "border-slate-700/60 bg-slate-800/40 shadow-slate-900/50 backdrop-blur-sm"
                : "border-slate-200 bg-white/80 shadow-slate-200/50 backdrop-blur-sm"
            }`}
          >
            <div className="relative flex flex-1 items-center gap-3 px-4">
              <Search className="h-5 w-5 shrink-0 text-slate-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runResearch()}
                onFocus={() => setShowHistory(true)}
                placeholder={isDebateOnlyMode ? "Enter debate topic..." : "Topic, @username, #hashtag..."}
                className="w-full bg-transparent text-lg outline-none placeholder:text-slate-500"
                disabled={isResearching}
                aria-label="Search query"
                maxLength={500}
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowHistory((v) => !v); }}
                className="rounded-lg p-1.5 transition hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                title="Search history"
                aria-label="Toggle search history"
              >
                <History className="h-5 w-5 text-slate-500" />
              </button>

              {/* Data Integrity Indicator */}
              {dataIntegrity !== "idle" && (
                <div
                  className="relative shrink-0"
                  title={
                    dataIntegrity === "green" ? "High Data Availability"
                    : dataIntegrity === "yellow" ? "Contested Topic — Debate Mode Recommended"
                    : dataIntegrity === "red" ? "Data Void Detected — Proceed with Caution"
                    : "Analyzing..."
                  }
                >
                  <ShieldCheck className={`h-5 w-5 transition-colors duration-500 ${
                    dataIntegrity === "checking" ? "text-slate-500 animate-pulse"
                    : dataIntegrity === "green" ? "text-emerald-400 drop-shadow-[0_0_6px_#34d399]"
                    : dataIntegrity === "yellow" ? "text-amber-400 drop-shadow-[0_0_6px_#fbbf24]"
                    : "text-rose-400 drop-shadow-[0_0_6px_#fb7185]"
                  }`} />
                </div>
              )}
            </div>
            {isResearching ? (
              <button
                onClick={cancelResearch}
                className="flex items-center gap-2 rounded-xl bg-red-600 px-6 py-3 font-medium text-white shadow-lg transition hover:bg-red-500"
              >
                <X className="h-5 w-5" /> Cancel
              </button>
            ) : (
              <button
                onClick={() => runResearch()}
                disabled={!query.trim()}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-6 py-3 font-medium text-white shadow-lg shadow-emerald-500/25 transition hover:from-emerald-500 hover:to-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Search
              </button>
            )}
          </div>

          {showHistory && history.length > 0 && (
            <div
              className={`absolute left-0 right-0 top-full z-20 mt-2 rounded-xl border p-2 shadow-xl ${
                isDark ? "border-slate-700/60 bg-slate-800/95 backdrop-blur-md" : "border-slate-200 bg-white/95 backdrop-blur-md"
              }`}
              role="listbox"
              aria-label="Search history"
            >
              <p className="mb-2 px-2 text-xs font-medium text-slate-500">Recent searches</p>
              {history.map((h, i) => (
                <button
                  key={i}
                  role="option"
                  aria-selected={false}
                  onClick={(e) => { e.stopPropagation(); setQuery(h); setShowHistory(false); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { setQuery(h); setShowHistory(false); } }}
                  className="w-full rounded-lg px-4 py-2 text-left text-sm transition hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                >
                  {h}
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="mb-6 text-center text-xs text-slate-500">
          <kbd className="rounded bg-slate-200 px-1.5 py-0.5 dark:bg-slate-700">{"⌘"}</kbd>
          <kbd className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 dark:bg-slate-700">Enter</kbd>{" "}
          to search{" · "}
          <kbd className="rounded bg-slate-200 px-1.5 py-0.5 dark:bg-slate-700">Esc</kbd> to cancel
        </p>

        {/* Perspective Dial */}
        <PerspectiveDial value={perspectiveBias} onChange={setPerspectiveBias} isDark={isDark} />

        {/* Model Selector + Mode Buttons + Options */}
        <div className={`mb-12 rounded-xl border ${isDark ? "border-slate-700/60 bg-slate-800/20" : "border-slate-200 bg-white/60"}`}>
          {/* Model Selector Dropdown */}
          <div className="px-6 pt-4 pb-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Model</span>
              <span className="text-[11px] text-slate-500">
                Search: {SEARCH_PROVIDER_META[searchProvider].label}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-500">Provider</span>
                <select
                  value={modelId}
                  disabled={isResearching}
                  onChange={(e) => {
                    const provider = e.target.value as ModelId;
                    updateSetupProvider(provider);
                    setSetupStep(1);
                    setShowSetupModal(true);
                  }}
                  className="w-full rounded-xl border border-slate-600/60 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500"
                >
                  {(Object.keys(MODEL_PROVIDER_META) as ModelId[]).map((provider) => (
                    <option key={provider} value={provider}>
                      {MODEL_PROVIDER_META[provider].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-500">Model Name</span>
                <select
                  value={modelName}
                  disabled={isResearching}
                  onChange={(e) => {
                    const name = e.target.value;
                    setModelName(name);
                    setSetup((prev) => ({ ...prev, llm_model: name }));
                  }}
                  className="w-full rounded-xl border border-slate-600/60 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500"
                >
                  {MODEL_CATALOG[modelId].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {MODEL_PROVIDER_META[modelId].description}
            </p>
          </div>

          {/* Mode Selection Buttons (multi-select) */}
          <div className="border-t border-slate-700/30 px-6 py-4 dark:border-slate-700/30">
            <span className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Research Modes <span className="font-normal normal-case text-slate-600">(select multiple)</span>
            </span>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {(Object.entries(MODE_CONFIG) as [SearchMode, typeof MODE_CONFIG[SearchMode]][]).map(([mode, config]) => {
                const active = selectedModes.has(mode);
                return (
                  <button
                    key={mode}
                    onClick={() => toggleMode(mode)}
                    disabled={isResearching}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 text-center transition disabled:opacity-50 ${
                      active
                        ? config.activeColor
                        : isDark
                        ? "border-slate-700/40 bg-slate-800/30 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                        : "border-slate-200 bg-white/60 text-slate-500 hover:border-slate-300 hover:text-slate-700"
                    }`}
                  >
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${active ? `bg-gradient-to-br ${config.color} text-white` : isDark ? "bg-slate-700/50" : "bg-slate-100"}`}>
                      {config.icon}
                    </div>
                    <span className="text-[11px] font-semibold leading-tight">{config.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mode-Specific Customization */}
          <ModeCustomization
            selectedModes={selectedModes}
            settings={modeSettings}
            onChange={setModeSettings}
            isDark={isDark}
            disabled={isResearching}
          />

          {/* Toggle Options */}
          <div className="flex flex-wrap gap-6 border-t border-slate-700/30 px-6 py-3 dark:border-slate-700/30">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={useSnippetsOnly} onChange={(e) => setUseSnippetsOnly(e.target.checked)} disabled={isResearching} className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-emerald-600 focus:ring-emerald-500" />
              <Zap className="h-4 w-4 text-amber-500" />
              <span className="text-sm text-slate-600 dark:text-slate-300">Snippets only</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={safeSearch} onChange={(e) => setSafeSearch(e.target.checked)} disabled={isResearching} className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-emerald-600 focus:ring-emerald-500" />
              <Shield className="h-4 w-4 text-emerald-500" />
              <span className="text-sm text-slate-600 dark:text-slate-300">Safe search</span>
            </label>
          </div>
        </div>

        {/* Debate Mode — persona-based two-agent chat */}
        {isDebateOnlyMode && (
          <div className="mb-12">
            <DebateMode
              topic={query}
              perspectiveDial={perspectiveBias}
              modelId={modelId}
              modelName={modelName}
              isDark={isDark}
            />
          </div>
        )}

        {/* RAG Mode — Knowledge Base Q&A */}
        {isRAGMode && (
          <div className="mb-12">
            <RAGMode
              isDark={isDark}
              modelId={modelId}
              modelName={modelName}
              perspectiveDial={perspectiveBias}
            />
          </div>
        )}

        {/* Memory Graph Widget */}
        {showMemoryGraph && (
          <MemoryGraphWidget
            sessions={sessions}
            currentQuery={query.trim() && (isResearching || report) ? query : undefined}
            currentEssence={essenceText}
            recalledMemories={recalledMemories}
            isDark={isDark}
            onClose={() => setShowMemoryGraph(false)}
          />
        )}

        {/* Swarm Visualizer — Debate mode hero loading (only for multi-mode with debate) */}
        {isDebateSwarm && !isDebateOnlyMode && <SwarmVisualizer isDark={isDark} />}

        {/* Progress Log */}
        {isResearching && progressLog.length > 0 && !isDebateSwarm && (
          <div className={`mb-12 rounded-2xl border p-6 ${isDark ? "border-slate-700/60 bg-slate-800/30" : "border-slate-200 bg-white/80"}`} role="log" aria-live="polite" aria-label="Research progress">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Live Progress
            </h2>
            <ul className="space-y-3">
              {progressLog.map((p, i) => (
                <li key={i} className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm transition ${isDark ? "bg-slate-800/50" : "bg-slate-100/80"}`}>
                  <span className="mt-0.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
                  <div>
                    <span className="text-slate-600 dark:text-slate-300">{p.detail}</span>
                    {Array.isArray(p.data?.queries) && (
                      <ul className="mt-2 list-inside list-disc text-slate-500">
                        {(p.data.queries as string[]).map((q, j) => <li key={j}>{q}</li>)}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-12 rounded-2xl border border-red-500/30 bg-red-500/10 p-6" role="alert">
            <div className="mb-2 text-sm font-semibold text-red-400">Error</div>
            <pre className="whitespace-pre-wrap break-words text-sm text-red-300">{errorSummary}</pre>
            {errorTraceback && (
              <div className="mt-4">
                <button onClick={() => setShowFullError((v) => !v)} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
                  {showFullError ? <><ChevronUp className="h-3 w-3" /> Hide traceback</> : <><ChevronDown className="h-3 w-3" /> Show full traceback</>}
                </button>
                {showFullError && (
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-900/50 p-3 text-xs text-slate-400">{errorTraceback}</pre>
                )}
              </div>
            )}
          </div>
        )}

        {/* Essence Banner */}
        {(essenceText || recalledMemories.length > 0) && (
          <ResearchEssenceBanner
            essenceText={essenceText}
            recalledMemories={recalledMemories}
            isDark={isDark}
          />
        )}

        {/* Search → Assistant Bridge: context-aware actions (backend-generated) */}
        {report && currentSearchId && (
          <div className={`rounded-xl border px-4 py-3 ${isDark ? "border-slate-700/40 bg-slate-800/20" : "border-slate-200 bg-white/60"}`}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Turn this research into action
              </span>
              {bridgeLoading && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {bridgeSuggestions.slice(0, BRIDGE_VISIBLE_PILLS).map((s) => (
                <div key={s.action_id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openAssistantWithAction(s)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      isDark
                        ? "border-slate-600 bg-slate-700/50 text-slate-200 hover:bg-slate-600/50"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                    title={s.short_description || undefined}
                  >
                    {getBridgeIcon(s.icon_key)}
                    <span>{s.label}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(s.action_id);
                    }}
                    className={`rounded-full p-1 transition-colors ${
                      pinnedActionIds.has(s.action_id)
                        ? "text-amber-500"
                        : isDark
                          ? "text-slate-500 hover:text-slate-300"
                          : "text-slate-400 hover:text-slate-600"
                    }`}
                    title={pinnedActionIds.has(s.action_id) ? "Unpin" : "Pin"}
                    aria-label={pinnedActionIds.has(s.action_id) ? "Unpin" : "Pin"}
                  >
                    <Pin className={`h-3.5 w-3.5 ${pinnedActionIds.has(s.action_id) ? "fill-current" : ""}`} />
                  </button>
                </div>
              ))}
              {bridgeSuggestions.length > BRIDGE_VISIBLE_PILLS && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setBridgeMoreOpen((o) => !o)}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm ${
                      isDark ? "border-slate-600 bg-slate-700/50 text-slate-300" : "border-slate-300 bg-white text-slate-600"
                    }`}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                    More
                  </button>
                  {bridgeMoreOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        aria-hidden
                        onClick={() => setBridgeMoreOpen(false)}
                      />
                      <div
                        className={`absolute left-0 top-full z-20 mt-1 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border py-1 ${
                          isDark ? "border-slate-600 bg-slate-800" : "border-slate-200 bg-white"
                        }`}
                      >
                        {bridgeSuggestions.slice(BRIDGE_VISIBLE_PILLS).map((s) => (
                          <button
                            key={s.action_id}
                            type="button"
                            onClick={() => {
                              openAssistantWithAction(s);
                              setBridgeMoreOpen(false);
                            }}
                            className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${
                              isDark ? "hover:bg-slate-700" : "hover:bg-slate-100"
                            }`}
                            title={s.short_description || undefined}
                          >
                            {getBridgeIcon(s.icon_key)}
                            <span>{s.label}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Report + All Metadata */}
        {report && (
          <div className="space-y-8">

            {/* Explain mode toggle (per-session, client-side) */}
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={explainMode}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setExplainMode(v);
                    try {
                      localStorage.setItem(EXPLAIN_MODE_KEY, JSON.stringify(v));
                    } catch {
                      /* ignore */
                    }
                  }}
                  className={`h-4 w-4 rounded ${isDark ? "border-slate-600 bg-slate-700 text-cyan-500" : "border-slate-400 text-cyan-600"}`}
                />
                <HelpCircle className={`h-4 w-4 ${isDark ? "text-slate-400" : "text-slate-500"}`} />
                <span className="text-sm text-slate-600 dark:text-slate-300">Explain mode</span>
              </label>
            </div>

            {/* Token Usage Bar */}
            {tokenUsage && (
              <div className={`flex flex-wrap items-center gap-4 rounded-2xl border px-6 py-4 ${isDark ? "border-slate-700/40 bg-slate-800/20" : "border-slate-200 bg-white/60"}`}>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Activity className="h-4 w-4 text-cyan-500" />
                  <span className="font-medium">Token Usage</span>
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                  <span>{(tokenUsage.total_tokens || 0).toLocaleString()} tokens</span>
                  <span className="text-slate-600 dark:text-slate-400">{"≈"} ${tokenUsage.estimated_cost_usd || 0}</span>
                  <span>Budget: {tokenUsage.budget_remaining_pct || "N/A"}</span>
                  {tokenUsage.cache_stats && (
                    <span className="text-emerald-500">Cache: {tokenUsage.cache_stats.hit_rate} ({tokenUsage.cache_stats.hits} hits)</span>
                  )}
                </div>
              </div>
            )}

            {/* Self-Reflection (Critic Agent) */}
            {reflection && (
              <div className={`rounded-2xl border p-6 ${isDark ? "border-indigo-500/30 bg-indigo-500/5" : "border-indigo-300 bg-indigo-50/50"}`}>
                <h3 className="mb-4 flex items-center gap-2 font-semibold text-indigo-600 dark:text-indigo-400">
                  <Brain className="h-5 w-5" /> AI Self-Assessment
                </h3>
                <div className="mb-4">
                  <QualityMeter score={reflection.quality_score || 5} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {reflection.strength_points && reflection.strength_points.length > 0 && (
                    <div>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-500">Strengths</h4>
                      <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                        {reflection.strength_points.map((s, i) => (
                          <li key={i} className="flex gap-2"><span className="text-emerald-500 shrink-0">{"✓"}</span>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {reflection.improvement_suggestions && reflection.improvement_suggestions.length > 0 && (
                    <div>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-500">Improvements</h4>
                      <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                        {reflection.improvement_suggestions.map((s, i) => (
                          <li key={i} className="flex gap-2"><span className="text-amber-500 shrink-0">{"●"}</span>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {reflection.bias_indicators && reflection.bias_indicators.length > 0 && (
                    <div>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-rose-500">Bias Indicators</h4>
                      <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                        {reflection.bias_indicators.map((b, i) => (
                          <li key={i} className="flex gap-2"><span className="text-rose-500 shrink-0">{"⚠"}</span>{b}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {reflection.missing_perspectives && reflection.missing_perspectives.length > 0 && (
                    <div>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyan-500">Missing Perspectives</h4>
                      <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                        {reflection.missing_perspectives.map((p, i) => (
                          <li key={i} className="flex gap-2"><span className="text-cyan-500 shrink-0">{"○"}</span>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                {reflection.factual_density && (
                  <div className="mt-4 text-xs text-slate-500">Factual density: <span className="font-semibold capitalize">{reflection.factual_density}</span></div>
                )}
              </div>
            )}

            {/* Confidence Matrix (Debate Mode) */}
            {metadata?.confidence_matrix && (
              <div className={`rounded-2xl border p-6 ${isDark ? "border-violet-500/30 bg-violet-500/5" : "border-violet-300 bg-violet-50/50"}`}>
                <h3 className="mb-4 flex items-center gap-2 font-semibold text-violet-600 dark:text-violet-400">
                  <Scale className="h-5 w-5" /> Confidence Matrix (Debate Mode)
                </h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className={`rounded-xl border p-4 ${isDark ? "border-emerald-500/30 bg-emerald-500/10" : "border-emerald-300 bg-emerald-50/50"}`}>
                    <h4 className="mb-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">Pro Arguments</h4>
                    <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                      {(metadata.confidence_matrix.pro_arguments || []).map((arg, i) => (
                        <li key={i} className="flex gap-2"><span className="text-emerald-500">{"•"}</span>{arg}</li>
                      ))}
                      {(!metadata.confidence_matrix.pro_arguments || metadata.confidence_matrix.pro_arguments.length === 0) && (
                        <li className="text-slate-500">None identified</li>
                      )}
                    </ul>
                  </div>
                  <div className={`rounded-xl border p-4 ${isDark ? "border-red-500/30 bg-red-500/10" : "border-red-300 bg-red-50/50"}`}>
                    <h4 className="mb-2 text-sm font-semibold text-red-600 dark:text-red-400">Con Arguments</h4>
                    <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                      {(metadata.confidence_matrix.con_arguments || []).map((arg, i) => (
                        <li key={i} className="flex gap-2"><span className="text-red-500">{"•"}</span>{arg}</li>
                      ))}
                      {(!metadata.confidence_matrix.con_arguments || metadata.confidence_matrix.con_arguments.length === 0) && (
                        <li className="text-slate-500">None identified</li>
                      )}
                    </ul>
                  </div>
                  <div className={`rounded-xl border p-4 ${isDark ? "border-cyan-500/30 bg-cyan-500/10" : "border-cyan-300 bg-cyan-50/50"}`}>
                    <h4 className="mb-2 text-sm font-semibold text-cyan-600 dark:text-cyan-400">Consensus Points</h4>
                    <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                      {(metadata.confidence_matrix.consensus_points || []).map((pt, i) => (
                        <li key={i} className="flex gap-2"><span className="text-cyan-500">{"✓"}</span>{pt}</li>
                      ))}
                      {(!metadata.confidence_matrix.consensus_points || metadata.confidence_matrix.consensus_points.length === 0) && (
                        <li className="text-slate-500">None identified</li>
                      )}
                    </ul>
                  </div>
                  <div className={`rounded-xl border p-4 ${isDark ? "border-amber-500/30 bg-amber-500/10" : "border-amber-300 bg-amber-50/50"}`}>
                    <h4 className="mb-2 text-sm font-semibold text-amber-600 dark:text-amber-400">Unresolved Conflicts</h4>
                    <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                      {(metadata.confidence_matrix.unresolved_conflicts || []).map((c, i) => (
                        <li key={i} className="flex gap-2"><span className="text-amber-500">{"⚠"}</span>{c}</li>
                      ))}
                      {(!metadata.confidence_matrix.unresolved_conflicts || metadata.confidence_matrix.unresolved_conflicts.length === 0) && (
                        <li className="text-slate-500">None identified</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Claim Verification */}
            {verifiedClaims && verifiedClaims.length > 0 && (
              <div className={`rounded-2xl border p-6 ${isDark ? "border-teal-500/30 bg-teal-500/5" : "border-teal-300 bg-teal-50/50"}`}>
                <h3 className="mb-4 flex items-center gap-2 font-semibold text-teal-600 dark:text-teal-400">
                  <BadgeCheck className="h-5 w-5" /> Claim Verification
                </h3>
                <div className="space-y-3">
                  {verifiedClaims.map((claim, i) => (
                    <div key={i} className={`rounded-xl px-4 py-3 ${isDark ? "bg-slate-800/40" : "bg-white/60"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-slate-600 dark:text-slate-300 flex-1">&ldquo;{claim.claim}&rdquo;</p>
                        <ClaimStatusBadge status={claim.status} />
                      </div>
                      {claim.note && <p className="mt-1.5 text-xs text-slate-500">{claim.note}</p>}
                      {claim.supporting_sources && claim.supporting_sources.length > 0 && (
                        <p className="mt-1 text-xs text-slate-500">Sources: {claim.supporting_sources.map((s) => `[${s}]`).join(", ")}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Report */}
            {metadata?.sections && metadata.sections.length > 0 && (
              <div className={`rounded-2xl border px-6 py-4 ${isDark ? "border-slate-700/60 bg-slate-800/30" : "border-slate-200 bg-white/90"}`}>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-400">Report Quality</h3>
                <div className="flex flex-wrap gap-2">
                  {metadata.sections.map((sec, i) => (
                    <ConfidenceBadge key={i} heading={sec.heading} confidence={sec.confidence ?? sec.sources?.length ?? 1} consensus={sec.consensus ?? "single_source"} />
                  ))}
                </div>
              </div>
            )}

            <ReportViewer
              markdown={report}
              isDark={isDark}
              onCopy={copyToClipboard}
              onDownload={downloadReport}
              onClear={clearReport}
              copied={copied}
              headerSlot={
                <h2 className="flex items-center gap-2 font-semibold">
                  <FileText className="h-5 w-5 text-emerald-500" /> Research Report
                  {metadata?.model_used && (
                    <span className="ml-2 rounded-md bg-slate-700/60 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                      {metadata.model_used as string}
                    </span>
                  )}
                  {metadata?.modes_used && (metadata.modes_used as string[]).filter(m => m !== "standard").map((m) => (
                    <span key={m} className={`rounded-md bg-gradient-to-r ${MODE_CONFIG[m as SearchMode]?.color || "from-slate-500 to-slate-600"} px-2 py-0.5 text-[10px] font-semibold uppercase text-white`}>
                      {MODE_CONFIG[m as SearchMode]?.label || m}
                    </span>
                  ))}
                </h2>
              }
            />

            {/* Explain panel (structured transparency, no prompts/secrets) */}
            {explainMode && currentExplain && (
              <div className={`rounded-2xl border p-5 ${isDark ? "border-cyan-500/30 bg-cyan-500/5" : "border-cyan-300 bg-cyan-50/50"}`}>
                <button
                  type="button"
                  onClick={() => setExplainPanelOpen((v) => !v)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-cyan-600 dark:text-cyan-400">
                    <HelpCircle className="h-4 w-4" /> Why this answer?
                  </h3>
                  {explainPanelOpen
                    ? <ChevronDown className="h-4 w-4 text-cyan-500" />
                    : <ChevronRight className="h-4 w-4 text-cyan-500" />}
                </button>
                {explainPanelOpen && (
                  <div className="mt-4 space-y-5 text-sm">
                    {/* Cache Decision */}
                    {currentExplain.cache_decision && (
                      <div>
                        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Cache Decision</h4>
                        <div className="flex flex-wrap gap-3 text-slate-600 dark:text-slate-300">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${currentExplain.cache_decision.hit ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                            {currentExplain.cache_decision.hit ? "Cache HIT" : "Cache MISS"}
                          </span>
                          {currentExplain.cache_decision.hit_rate && (
                            <span className="text-xs text-slate-500">Hit rate: {currentExplain.cache_decision.hit_rate}</span>
                          )}
                          {currentExplain.cache_decision.why && (
                            <span className="text-xs text-slate-500">{currentExplain.cache_decision.why}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Retrieval: Sources Used */}
                    {currentExplain.retrieval && (
                      <div>
                        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Sources ({currentExplain.retrieval.sources_considered_count} considered)
                        </h4>
                        {currentExplain.retrieval.why_these_sources && (
                          <p className="mb-2 text-xs italic text-slate-500">{currentExplain.retrieval.why_these_sources}</p>
                        )}
                        <ul className="space-y-1">
                          {currentExplain.retrieval.top_sources.slice(0, 10).map((s, i) => (
                            <li key={i} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                              <span className="shrink-0 text-slate-500">[{i + 1}]</span>
                              {s.url ? (
                                <a href={s.url} target="_blank" rel="noopener noreferrer" className="truncate text-cyan-500 hover:underline">
                                  {s.title || s.url}
                                </a>
                              ) : (
                                <span className="truncate">{s.title || s.doc_id || "Unknown"}</span>
                              )}
                              {s.score != null && (
                                <span className="shrink-0 rounded bg-slate-700/40 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-400">{s.score.toFixed(3)}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                        {Object.keys(currentExplain.retrieval.retrieval_params).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500">
                            {Object.entries(currentExplain.retrieval.retrieval_params).map(([k, v]) => (
                              <span key={k} className="rounded bg-slate-700/30 px-1.5 py-0.5">{k}: {String(v)}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Generation */}
                    {currentExplain.generation && (
                      <div>
                        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Generation</h4>
                        <div className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300">
                          {currentExplain.generation.model && <span>Model: <strong>{currentExplain.generation.model}</strong></span>}
                          {currentExplain.generation.provider && <span>Provider: {currentExplain.generation.provider}</span>}
                          {currentExplain.generation.prompt_version && <span>Prompt v{currentExplain.generation.prompt_version}</span>}
                        </div>
                      </div>
                    )}

                    {/* Safety / Actions */}
                    {currentExplain.safety && (
                      <div>
                        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Safety</h4>
                        <div className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300">
                          {currentExplain.safety.risk_level && (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              currentExplain.safety.risk_level === "safe" ? "bg-emerald-500/20 text-emerald-400"
                              : currentExplain.safety.risk_level === "needs_approval" ? "bg-amber-500/20 text-amber-400"
                              : "bg-rose-500/20 text-rose-400"
                            }`}>
                              {currentExplain.safety.risk_level}
                            </span>
                          )}
                          {currentExplain.safety.tool_calls?.map((tc, i) => (
                            <span key={i} className="rounded bg-slate-700/30 px-1.5 py-0.5">{tc.tool}{tc.summary ? `: ${tc.summary.slice(0, 60)}` : ""}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Report Issue */}
                    <div className="border-t border-slate-700/30 pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          const payload = {
                            answer_id: currentSearchId,
                            cache_status: currentExplain.cache_decision?.hit ? "hit" : "miss",
                            retrieval_signature: `sources=${currentExplain.retrieval?.sources_considered_count ?? 0},model=${currentExplain.generation?.model ?? ""}`,
                            feedback: "",
                          };
                          navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                          toast.success("Issue context copied to clipboard");
                        }}
                        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-cyan-400 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" /> Report issue (copies context)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Data Void & Research Gaps */}
            {(metadata?.data_void || (metadata?.research_gaps && metadata.research_gaps.length > 0)) && (
              <div className="space-y-4">
                {metadata?.data_void && (
                  <div
                    className={`overflow-hidden rounded-2xl border-2 ${
                      metadata.data_void.is_data_void
                        ? isDark ? "border-rose-500/50 bg-gradient-to-br from-rose-500/10 to-rose-600/5" : "border-rose-400/50 bg-gradient-to-br from-rose-50 to-rose-100/50"
                        : isDark ? "border-emerald-500/30 bg-emerald-500/5" : "border-emerald-300 bg-emerald-50/50"
                    }`}
                  >
                    <div className="flex items-start gap-4 p-6">
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${metadata.data_void.is_data_void ? "bg-rose-500/20" : "bg-emerald-500/20"}`}>
                        {metadata.data_void.is_data_void ? <Eye className="h-6 w-6 text-rose-500" /> : <ShieldCheck className="h-6 w-6 text-emerald-500" />}
                      </div>
                      <div className="flex-1">
                        <h3 className="mb-1 flex flex-wrap items-center gap-2 font-semibold">
                          {metadata.data_void.is_data_void ? (
                            <>
                              <span className="text-rose-600 dark:text-rose-400">Blind Spot Detected</span>
                              {metadata.data_void.void_type && (
                                <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-rose-600 dark:text-rose-400">
                                  {metadata.data_void.void_type.replace("_", " ")}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400">Data Quality Verified</span>
                          )}
                        </h3>
                        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{metadata.data_void.explanation}</p>
                      </div>
                    </div>
                  </div>
                )}

                {metadata?.research_gaps && metadata.research_gaps.length > 0 && (
                  <div className={`rounded-2xl border p-6 ${isDark ? "border-amber-500/30 bg-amber-500/5" : "border-amber-300 bg-amber-50/50"}`}>
                    <h3 className="mb-4 flex items-center gap-2 font-semibold text-amber-600 dark:text-amber-400">
                      <AlertCircle className="h-5 w-5" /> Research Gaps
                    </h3>
                    <ul className="space-y-2">
                      {metadata.research_gaps.map((gap, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                          {gap}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Follow-Up Research Questions */}
            {followupQuestions && followupQuestions.length > 0 && (
              <div className={`rounded-2xl border p-6 ${isDark ? "border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-fuchsia-500/5" : "border-violet-200 bg-gradient-to-br from-violet-50/50 to-fuchsia-50/50"}`}>
                <h3 className="mb-4 flex items-center gap-2 font-semibold text-violet-600 dark:text-violet-400">
                  <Sparkles className="h-5 w-5" /> Continue Your Research
                </h3>
                <div className="space-y-3">
                  {followupQuestions.map((fq, i) => (
                    <button
                      key={i}
                      onClick={() => runResearch(fq.question)}
                      className={`group w-full rounded-xl px-5 py-4 text-left transition ${isDark ? "bg-slate-800/30 hover:bg-slate-800/60" : "bg-white/60 hover:bg-white/90"}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <MessageSquarePlus className="h-4 w-4 text-violet-500 shrink-0" />
                            <span className="font-medium text-sm text-slate-700 dark:text-slate-200">{fq.question}</span>
                          </div>
                          <p className="text-xs text-slate-500 pl-6">{fq.rationale}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <DepthBadge depth={fq.depth} />
                          <ArrowRight className="h-4 w-4 text-slate-500 opacity-0 transition group-hover:opacity-100" />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        {/* Empty state */}
        {!isResearching && !report && !error && (
          <div className="text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20">
              <Search className="h-8 w-8 text-emerald-500" />
            </div>
            <p className="text-slate-500">Enter a topic, @username, or #hashtag above and click Search.</p>
            <p className="mt-1 text-sm text-slate-400">Enable &quot;Snippets only&quot; if scraping fails on your network.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {["AI safety research", "Climate change policy 2025", "#OpenAI", "@elonmusk"].map((ex) => (
                <button
                  key={ex}
                  onClick={() => { setQuery(ex); }}
                  className={`rounded-lg px-4 py-2 text-sm transition ${isDark ? "bg-slate-800/40 hover:bg-slate-800/70 text-slate-400" : "bg-white/60 hover:bg-white/90 text-slate-600"}`}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
