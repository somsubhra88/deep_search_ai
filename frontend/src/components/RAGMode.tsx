"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Upload,
  FolderOpen,
  FileArchive,
  Plus,
  Database,
  FileText,
  CheckCircle2,
  XCircle,
  SkipForward,
  Loader2,
  Search,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  BookOpen,
  Globe,
  RefreshCw,
  Trash2,
  Info,
  Copy,
  Check,
  ExternalLink,
  Hash,
  Lightbulb,
  Download,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KB = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  doc_count: number;
};

type DocStatus = {
  filename: string;
  content_hash: string;
  doc_id: string;
  status: "indexed" | "skipped_cached" | "failed" | "pending";
  message: string;
  chunk_count: number;
};

type KBDoc = {
  id: string;
  kb_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  content_hash_sha256: string;
  source_type: string;
  status: string;
  error_message?: string;
  created_at: string;
  chunk_count: number;
};

type KBCitation = {
  chunk_id: string;
  doc_id: string;
  filename: string;
  page_range?: string;
  quote: string;
  used_in: string[];
};

type WebCitation = {
  card_id: string;
  url: string;
  quote: string;
  used_in: string[];
};

type ConflictItem = {
  statement: string;
  kb_support: string[];
  web_support: string[];
  note: string;
};

type CoverageGap = {
  gap: string;
  suggested_query: string;
};

type RAGResult = {
  answer_markdown: string;
  citations: {
    kb: KBCitation[];
    web: WebCitation[];
  };
  conflicts: ConflictItem[];
  coverage_gaps: CoverageGap[];
  scope_used: string;
  kb_chunks_used: number;
  web_cards_used: number;
};

type RAGScope = "KB_ONLY" | "WEB_ONLY" | "HYBRID";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RAGMode({
  isDark,
  modelId,
  modelName,
  perspectiveDial,
}: {
  isDark: boolean;
  modelId: string;
  modelName: string;
  perspectiveDial: number;
}) {
  // KB state
  const [kbs, setKBs] = useState<KB[]>([]);
  const [selectedKB, setSelectedKB] = useState<string>("");
  const [newKBName, setNewKBName] = useState("");
  const [newKBDesc, setNewKBDesc] = useState("");
  const [showCreateKB, setShowCreateKB] = useState(false);
  const [isCreatingKB, setIsCreatingKB] = useState(false);

  // Doc state
  const [docs, setDocs] = useState<KBDoc[]>([]);
  const [uploadResults, setUploadResults] = useState<DocStatus[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showDocs, setShowDocs] = useState(false);

  // Query state
  const [ragQuery, setRagQuery] = useState("");
  const [ragScope, setRagScope] = useState<RAGScope>("HYBRID");
  const [isQuerying, setIsQuerying] = useState(false);
  const [ragResult, setRagResult] = useState<RAGResult | null>(null);
  const [ragError, setRagError] = useState<string | null>(null);
  const [ragProgress, setRagProgress] = useState<string[]>([]);

  // Citation expansion
  const [expandedKBCite, setExpandedKBCite] = useState<number | null>(null);
  const [expandedWebCite, setExpandedWebCite] = useState<number | null>(null);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const panel = isDark
    ? "border-slate-700/60 bg-slate-800/30"
    : "border-slate-200 bg-white/80";
  const panelHover = isDark
    ? "hover:bg-slate-700/40"
    : "hover:bg-slate-100";

  // ---------------------------------------------------------------------------
  // KB Management
  // ---------------------------------------------------------------------------

  const fetchKBs = useCallback(async () => {
    try {
      const res = await fetch("/api/kb/list");
      if (res.ok) {
        const data = await res.json();
        setKBs(data);
        if (data.length > 0 && !selectedKB) {
          setSelectedKB(data[0].id);
        }
      }
    } catch (e) {
      console.error("Failed to fetch KBs:", e);
    }
  }, [selectedKB]);

  useEffect(() => {
    fetchKBs();
  }, [fetchKBs]);

  const createKB = useCallback(async () => {
    if (!newKBName.trim()) return;
    setIsCreatingKB(true);
    try {
      const res = await fetch("/api/kb/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKBName.trim(), description: newKBDesc.trim() }),
      });
      if (res.ok) {
        const kb = await res.json();
        setKBs((prev) => [kb, ...prev]);
        setSelectedKB(kb.id);
        setNewKBName("");
        setNewKBDesc("");
        setShowCreateKB(false);
      }
    } catch (e) {
      console.error("Create KB failed:", e);
    } finally {
      setIsCreatingKB(false);
    }
  }, [newKBName, newKBDesc]);

  const deleteKB = useCallback(async (kbId: string) => {
    try {
      const res = await fetch(`/api/kb/${kbId}`, { method: "DELETE" });
      if (res.ok) {
        setKBs((prev) => prev.filter((kb) => kb.id !== kbId));
        if (selectedKB === kbId) setSelectedKB("");
      }
    } catch (e) {
      console.error("Delete KB failed:", e);
    }
  }, [selectedKB]);

  // ---------------------------------------------------------------------------
  // Document fetching
  // ---------------------------------------------------------------------------

  const fetchDocs = useCallback(async () => {
    if (!selectedKB) return;
    try {
      const res = await fetch(`/api/kb/${selectedKB}/docs`);
      if (res.ok) setDocs(await res.json());
    } catch (e) {
      console.error("Fetch docs failed:", e);
    }
  }, [selectedKB]);

  useEffect(() => {
    if (selectedKB) fetchDocs();
  }, [selectedKB, fetchDocs]);

  // ---------------------------------------------------------------------------
  // Upload handlers
  // ---------------------------------------------------------------------------

  const handleUpload = useCallback(
    async (files: FileList | null, endpoint: string) => {
      if (!files || files.length === 0 || !selectedKB) return;
      setIsUploading(true);
      setUploadResults([]);
      try {
        const formData = new FormData();
        Array.from(files).forEach((f) => formData.append("files", f));
        const res = await fetch(`/api/kb/${selectedKB}/${endpoint}`, {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          setUploadResults(data.results || []);
          fetchDocs();
          fetchKBs();
        }
      } catch (e) {
        console.error("Upload failed:", e);
      } finally {
        setIsUploading(false);
      }
    },
    [selectedKB, fetchDocs, fetchKBs]
  );

  const handleZipUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !selectedKB) return;
      setIsUploading(true);
      setUploadResults([]);
      try {
        const formData = new FormData();
        formData.append("file", files[0]);
        const res = await fetch(`/api/kb/${selectedKB}/upload-zip`, {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          setUploadResults(data.results || []);
          fetchDocs();
          fetchKBs();
        }
      } catch (e) {
        console.error("Zip upload failed:", e);
      } finally {
        setIsUploading(false);
      }
    },
    [selectedKB, fetchDocs, fetchKBs]
  );

  // ---------------------------------------------------------------------------
  // RAG Query
  // ---------------------------------------------------------------------------

  const runRAGQuery = useCallback(async () => {
    if (!ragQuery.trim() || !selectedKB) return;
    setIsQuerying(true);
    setRagResult(null);
    setRagError(null);
    setRagProgress([]);

    try {
      const res = await fetch("/api/rag/query/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kb_id: selectedKB,
          query: ragQuery.trim(),
          scope: ragScope,
          top_k_kb: 6,
          top_k_web: 4,
          model_id: modelId,
          model_name: modelName,
          perspective_dial: perspectiveDial,
        }),
      });

      if (!res.ok) {
        setRagError(`HTTP ${res.status}`);
        return;
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
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              // Check if this is an event wrapper
              if (data.error) {
                setRagError(data.error);
                break;
              }
              // SSE event format
              const eventLine = lines.find((l) => l.startsWith("event: "));
              const eventType = eventLine?.slice(7) || "";

              if (eventType === "rag.final" || data.answer_markdown) {
                setRagResult(data);
              } else if (eventType === "rag.error") {
                setRagError(data.error || "Unknown error");
              } else {
                const detail =
                  eventType === "rag.started"
                    ? "Starting RAG query..."
                    : eventType === "rag.kb.retrieved"
                    ? `Retrieved ${data.count || 0} KB chunks`
                    : eventType === "rag.web.retrieved"
                    ? `Retrieved ${data.count || 0} web results`
                    : eventType === "rag.generating"
                    ? "Generating grounded answer..."
                    : eventType === "rag.verifying"
                    ? "Verifying citations..."
                    : `${eventType}`;
                if (detail) setRagProgress((p) => [...p, detail]);
              }
            } catch {
              // Parse errors on partial SSE chunks
            }
          }
        }
      }

      // If no stream result yet, try sync fallback
      if (!ragResult && !ragError) {
        try {
          const syncRes = await fetch("/api/rag/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kb_id: selectedKB,
              query: ragQuery.trim(),
              scope: ragScope,
              top_k_kb: 6,
              top_k_web: 4,
              model_id: modelId,
              model_name: modelName,
            }),
          });
          if (syncRes.ok) {
            const data = await syncRes.json();
            setRagResult(data);
          }
        } catch {
          // Fallback also failed
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setRagError(e instanceof Error ? e.message : "Query failed");
    } finally {
      setIsQuerying(false);
    }
  }, [ragQuery, selectedKB, ragScope, modelId, modelName, perspectiveDial, ragResult, ragError]);

  // Copy answer
  const [answerCopied, setAnswerCopied] = useState(false);
  const copyAnswer = useCallback(() => {
    if (!ragResult) return;
    navigator.clipboard.writeText(ragResult.answer_markdown);
    setAnswerCopied(true);
    setTimeout(() => setAnswerCopied(false), 2000);
  }, [ragResult]);

  const downloadAnswer = useCallback(() => {
    if (!ragResult) return;
    const blob = new Blob([ragResult.answer_markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rag-answer-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [ragResult]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const statusIcon = (status: string) => {
    switch (status) {
      case "indexed":
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "skipped_cached":
        return <SkipForward className="h-4 w-4 text-amber-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />;
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const processedAnswer = useMemo(() => {
    if (!ragResult?.answer_markdown) return "";
    let text = ragResult.answer_markdown;
    // Normalize escaped LaTeX delimiters the LLM sometimes produces
    text = text.replace(/\\\(/g, "$").replace(/\\\)/g, "$");
    text = text.replace(/\\\[/g, "$$").replace(/\\\]/g, "$$");
    return text;
  }, [ragResult?.answer_markdown]);

  const shortFilename = (name: string) => {
    const parts = name.split("/");
    return parts[parts.length - 1];
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* KB Selector + Create */}
      <div className={`rounded-2xl border p-5 ${panel}`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
            <Database className="h-4 w-4" /> Knowledge Base
          </h3>
          <button
            onClick={() => setShowCreateKB(!showCreateKB)}
            className="flex items-center gap-1 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/30"
          >
            <Plus className="h-3 w-3" /> New KB
          </button>
        </div>

        {/* Create KB form */}
        {showCreateKB && (
          <div className={`mb-4 rounded-xl border p-4 ${isDark ? "border-slate-600/40 bg-slate-900/50" : "border-slate-200 bg-slate-50"}`}>
            <input
              type="text"
              value={newKBName}
              onChange={(e) => setNewKBName(e.target.value)}
              placeholder="Knowledge base name..."
              className={`mb-2 w-full rounded-lg border px-3 py-2 text-sm outline-none ${isDark ? "border-slate-600/60 bg-slate-800/50 text-slate-200 focus:border-emerald-500" : "border-slate-300 bg-white text-slate-800 focus:border-emerald-500"}`}
            />
            <input
              type="text"
              value={newKBDesc}
              onChange={(e) => setNewKBDesc(e.target.value)}
              placeholder="Description (optional)..."
              className={`mb-3 w-full rounded-lg border px-3 py-2 text-sm outline-none ${isDark ? "border-slate-600/60 bg-slate-800/50 text-slate-200 focus:border-emerald-500" : "border-slate-300 bg-white text-slate-800 focus:border-emerald-500"}`}
            />
            <div className="flex gap-2">
              <button
                onClick={createKB}
                disabled={!newKBName.trim() || isCreatingKB}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {isCreatingKB ? "Creating..." : "Create"}
              </button>
              <button
                onClick={() => setShowCreateKB(false)}
                className="rounded-lg bg-slate-600/50 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-600/70"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* KB dropdown */}
        {kbs.length > 0 ? (
          <div className="flex items-center gap-2">
            <select
              value={selectedKB}
              onChange={(e) => setSelectedKB(e.target.value)}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none ${isDark ? "border-slate-600/60 bg-slate-900/50 text-slate-200 focus:border-emerald-500" : "border-slate-300 bg-white text-slate-800 focus:border-emerald-500"}`}
            >
              {kbs.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name} ({kb.doc_count} docs)
                </option>
              ))}
            </select>
            <button
              onClick={() => selectedKB && deleteKB(selectedKB)}
              className="rounded-lg p-2 text-red-400/60 transition hover:bg-red-500/10 hover:text-red-400"
              title="Delete KB"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No knowledge bases yet. Create one to get started.</p>
        )}
      </div>

      {/* Upload Panel */}
      {selectedKB && (
        <div className={`rounded-2xl border p-5 ${panel}`}>
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
            <Upload className="h-4 w-4" /> Add Documents
          </h3>

          <div className="grid grid-cols-3 gap-3">
            {/* File upload */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition ${isDark ? "border-slate-600/40 hover:border-emerald-500/50 hover:bg-emerald-500/5" : "border-slate-300 hover:border-emerald-400 hover:bg-emerald-50"} disabled:opacity-50`}
            >
              <FileText className="h-6 w-6 text-emerald-500" />
              <span className="text-xs font-semibold text-slate-400">Upload Files</span>
              <span className="text-[10px] text-slate-500">PDF, DOCX, MD, TXT</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.md,.txt,.markdown,.rst,.csv,.json,.xml,.html,.htm,.log"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files, "upload")}
            />

            {/* Folder upload */}
            <button
              onClick={() => dirInputRef.current?.click()}
              disabled={isUploading}
              className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition ${isDark ? "border-slate-600/40 hover:border-blue-500/50 hover:bg-blue-500/5" : "border-slate-300 hover:border-blue-400 hover:bg-blue-50"} disabled:opacity-50`}
            >
              <FolderOpen className="h-6 w-6 text-blue-500" />
              <span className="text-xs font-semibold text-slate-400">Import Folder</span>
              <span className="text-[10px] text-slate-500">Auto-detect files</span>
            </button>
            <input
              ref={dirInputRef}
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is valid but not typed
              webkitdirectory="true"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files, "upload-directory")}
            />

            {/* Zip upload */}
            <button
              onClick={() => zipInputRef.current?.click()}
              disabled={isUploading}
              className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition ${isDark ? "border-slate-600/40 hover:border-violet-500/50 hover:bg-violet-500/5" : "border-slate-300 hover:border-violet-400 hover:bg-violet-50"} disabled:opacity-50`}
            >
              <FileArchive className="h-6 w-6 text-violet-500" />
              <span className="text-xs font-semibold text-slate-400">Upload Zip</span>
              <span className="text-[10px] text-slate-500">Extracts & indexes</span>
            </button>
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => handleZipUpload(e.target.files)}
            />
          </div>

          {/* Upload progress */}
          {isUploading && (
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Uploading & indexing...
            </div>
          )}

          {/* Upload results */}
          {uploadResults.length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="text-xs font-semibold text-slate-500">Results</h4>
              {uploadResults.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isDark ? "bg-slate-800/40" : "bg-slate-50"}`}
                >
                  {statusIcon(r.status)}
                  <span className="flex-1 truncate text-slate-300">{r.filename}</span>
                  <span className={`text-xs font-medium ${r.status === "indexed" ? "text-emerald-400" : r.status === "skipped_cached" ? "text-amber-400" : "text-red-400"}`}>
                    {r.status === "indexed"
                      ? `${r.chunk_count} chunks`
                      : r.status === "skipped_cached"
                      ? "Cached"
                      : "Failed"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Indexed docs list */}
          <div className="mt-4">
            <button
              onClick={() => { setShowDocs(!showDocs); if (!showDocs) fetchDocs(); }}
              className="flex items-center gap-2 text-xs font-semibold text-slate-500 transition hover:text-slate-400"
            >
              {showDocs ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {docs.length} indexed documents
            </button>
            {showDocs && docs.length > 0 && (
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {docs.map((d) => (
                  <div
                    key={d.id}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${isDark ? "bg-slate-800/30" : "bg-slate-50/80"}`}
                  >
                    {statusIcon(d.status)}
                    <span className="flex-1 truncate text-slate-300">{d.filename}</span>
                    <span className="text-[10px] text-slate-500">{formatBytes(d.size_bytes)}</span>
                    <span className="text-[10px] text-slate-500">{d.chunk_count} chunks</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Query Panel */}
      {selectedKB && docs.length > 0 && (
        <div className={`rounded-2xl border p-5 ${panel}`}>
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
            <Search className="h-4 w-4" /> Ask Your Knowledge Base
          </h3>

          {/* Scope toggle */}
          <div className="mb-4 flex gap-2">
            {(["KB_ONLY", "HYBRID", "WEB_ONLY"] as RAGScope[]).map((scope) => (
              <button
                key={scope}
                onClick={() => setRagScope(scope)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  ragScope === scope
                    ? scope === "KB_ONLY"
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                      : scope === "WEB_ONLY"
                      ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                      : "bg-violet-500/20 text-violet-400 border border-violet-500/40"
                    : isDark
                    ? "bg-slate-700/30 text-slate-400 border border-transparent hover:bg-slate-700/50"
                    : "bg-slate-100 text-slate-500 border border-transparent hover:bg-slate-200"
                }`}
              >
                {scope === "KB_ONLY" && <BookOpen className="h-3 w-3" />}
                {scope === "HYBRID" && <><BookOpen className="h-3 w-3" /><span>+</span><Globe className="h-3 w-3" /></>}
                {scope === "WEB_ONLY" && <Globe className="h-3 w-3" />}
                {scope === "KB_ONLY" ? "KB Only" : scope === "WEB_ONLY" ? "Web Only" : "Hybrid"}
              </button>
            ))}
          </div>

          {/* Query input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={ragQuery}
              onChange={(e) => setRagQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runRAGQuery()}
              placeholder="Ask a question about your documents..."
              disabled={isQuerying}
              className={`flex-1 rounded-xl border px-4 py-3 text-sm outline-none ${isDark ? "border-slate-600/60 bg-slate-900/50 text-slate-200 placeholder-slate-500 focus:border-emerald-500" : "border-slate-300 bg-white text-slate-800 placeholder-slate-400 focus:border-emerald-500"} disabled:opacity-50`}
            />
            <button
              onClick={runRAGQuery}
              disabled={isQuerying || !ragQuery.trim()}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-5 py-3 text-sm font-semibold text-white transition hover:from-emerald-500 hover:to-cyan-500 disabled:opacity-50"
            >
              {isQuerying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {isQuerying ? "Searching..." : "Ask"}
            </button>
          </div>

          {/* Progress */}
          {ragProgress.length > 0 && isQuerying && (
            <div className="mt-3 space-y-1">
              {ragProgress.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  {p}
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {ragError && (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
              {ragError}
            </div>
          )}

          {/* RAG Result */}
          {ragResult && (
            <div className="mt-8 space-y-6">

              {/* ── Answer Panel ───────────────────────────────── */}
              <div className={`overflow-hidden rounded-2xl border shadow-lg ${isDark ? "border-slate-600/30 bg-gradient-to-b from-slate-800/60 to-slate-900/80 shadow-black/20" : "border-slate-200 bg-white shadow-slate-200/60"}`}>
                {/* Header bar */}
                <div className={`flex items-center justify-between border-b px-6 py-3.5 ${isDark ? "border-slate-700/40 bg-slate-800/40" : "border-slate-100 bg-slate-50/80"}`}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500">
                      <FileText className="h-3.5 w-3.5 text-white" />
                    </div>
                    <h4 className={`text-sm font-bold tracking-wide ${isDark ? "text-slate-200" : "text-slate-800"}`}>Answer</h4>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                      ragResult.scope_used === "KB_ONLY"
                        ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                        : ragResult.scope_used === "WEB_ONLY"
                        ? "bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30"
                        : "bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/30"
                    }`}>
                      {ragResult.scope_used === "KB_ONLY" ? "KB Only" : ragResult.scope_used === "WEB_ONLY" ? "Web Only" : "Hybrid"}
                    </span>
                    <button
                      onClick={copyAnswer}
                      className={`rounded-lg p-1.5 transition ${isDark ? "text-slate-500 hover:bg-slate-700/60 hover:text-slate-300" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"}`}
                      title="Copy answer"
                    >
                      {answerCopied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={downloadAnswer}
                      className={`rounded-lg p-1.5 transition ${isDark ? "text-slate-500 hover:bg-slate-700/60 hover:text-slate-300" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"}`}
                      title="Download as Markdown"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Stats ribbon */}
                {(ragResult.kb_chunks_used > 0 || ragResult.web_cards_used > 0) && (
                  <div className={`flex items-center gap-4 border-b px-6 py-2 text-[11px] ${isDark ? "border-slate-700/30 bg-slate-800/20 text-slate-500" : "border-slate-100 bg-slate-50/40 text-slate-400"}`}>
                    {ragResult.kb_chunks_used > 0 && (
                      <span className="flex items-center gap-1">
                        <BookOpen className="h-3 w-3 text-emerald-500/70" />
                        {ragResult.kb_chunks_used} KB chunks used
                      </span>
                    )}
                    {ragResult.web_cards_used > 0 && (
                      <span className="flex items-center gap-1">
                        <Globe className="h-3 w-3 text-blue-500/70" />
                        {ragResult.web_cards_used} web sources used
                      </span>
                    )}
                  </div>
                )}

                {/* Answer body */}
                <div className="px-6 py-6">
                  <article className={`rag-answer prose max-w-none ${isDark ? "prose-invert" : "prose-slate"}`}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        a: ({ href, children }) => {
                          const safeHref = href && (href.startsWith("http://") || href.startsWith("https://")) ? href : "#";
                          return (
                            <a href={safeHref} target="_blank" rel="noopener noreferrer" className="font-medium text-emerald-400 no-underline transition hover:text-emerald-300 hover:underline">
                              {children}
                            </a>
                          );
                        },
                        h1: ({ children }) => <h1 className={`mt-6 mb-4 text-xl font-bold ${isDark ? "text-slate-100" : "text-slate-900"}`}>{children}</h1>,
                        h2: ({ children }) => <h2 className={`mt-8 mb-3 border-b pb-2 text-lg font-bold ${isDark ? "border-slate-700/40 text-slate-100" : "border-slate-200 text-slate-800"}`}>{children}</h2>,
                        h3: ({ children }) => <h3 className={`mt-6 mb-2.5 text-base font-semibold ${isDark ? "text-slate-200" : "text-slate-700"}`}>{children}</h3>,
                        p: ({ children }) => {
                          // Post-process: style [KB-N] and [WEB-N] as badges
                          const processNode = (node: React.ReactNode): React.ReactNode => {
                            if (typeof node !== "string") return node;
                            const parts = node.split(/(\[KB-\d+\]|\[WEB-\d+\])/g);
                            if (parts.length === 1) return node;
                            return parts.map((part, i) => {
                              if (/^\[KB-\d+\]$/.test(part)) {
                                return (
                                  <span key={i} className="mx-0.5 inline-flex items-center rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-bold text-emerald-400 ring-1 ring-inset ring-emerald-500/25">
                                    {part}
                                  </span>
                                );
                              }
                              if (/^\[WEB-\d+\]$/.test(part)) {
                                return (
                                  <span key={i} className="mx-0.5 inline-flex items-center rounded-md bg-blue-500/15 px-1.5 py-0.5 text-[11px] font-bold text-blue-400 ring-1 ring-inset ring-blue-500/25">
                                    {part}
                                  </span>
                                );
                              }
                              return part;
                            });
                          };
                          const processed = Array.isArray(children)
                            ? children.map((child) => processNode(child))
                            : processNode(children);
                          return <p className={`mb-4 text-[15px] leading-[1.8] ${isDark ? "text-slate-300" : "text-slate-600"}`}>{processed}</p>;
                        },
                        strong: ({ children }) => <strong className={`font-bold ${isDark ? "text-slate-100" : "text-slate-800"}`}>{children}</strong>,
                        em: ({ children }) => <em className={isDark ? "text-slate-300" : "text-slate-600"}>{children}</em>,
                        ul: ({ children }) => <ul className={`mb-5 list-none space-y-2 pl-0 ${isDark ? "text-slate-300" : "text-slate-600"}`}>{children}</ul>,
                        ol: ({ children }) => <ol className={`mb-5 list-decimal space-y-2 pl-5 text-[15px] leading-[1.8] ${isDark ? "text-slate-300" : "text-slate-600"}`}>{children}</ol>,
                        li: ({ children }) => (
                          <li className="flex items-start gap-2.5 text-[15px] leading-[1.8]">
                            <span className={`mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full ${isDark ? "bg-emerald-500/60" : "bg-emerald-500/50"}`} />
                            <span className="flex-1">{children}</span>
                          </li>
                        ),
                        code: ({ children, className }) => {
                          const isBlock = className?.includes("language-");
                          if (isBlock) {
                            return (
                              <code className={`block overflow-x-auto rounded-xl p-4 font-mono text-sm ${isDark ? "bg-slate-950/60 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
                                {children}
                              </code>
                            );
                          }
                          return (
                            <code className={`rounded-md px-1.5 py-0.5 font-mono text-[13px] ${isDark ? "bg-slate-700/60 text-amber-300" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200/60"}`}>
                              {children}
                            </code>
                          );
                        },
                        blockquote: ({ children }) => (
                          <blockquote className={`my-4 rounded-r-xl border-l-4 py-3 pl-4 pr-4 ${isDark ? "border-emerald-500/40 bg-emerald-500/5 text-slate-400" : "border-emerald-400/50 bg-emerald-50/60 text-slate-500"}`}>
                            {children}
                          </blockquote>
                        ),
                        table: ({ children }) => (
                          <div className={`my-5 overflow-x-auto rounded-xl border ${isDark ? "border-slate-700/40" : "border-slate-200"}`}>
                            <table className="min-w-full text-sm">{children}</table>
                          </div>
                        ),
                        thead: ({ children }) => (
                          <thead className={isDark ? "bg-slate-800/60 text-slate-200" : "bg-slate-100 text-slate-800"}>
                            {children}
                          </thead>
                        ),
                        th: ({ children }) => (
                          <th className={`px-4 py-3 text-left font-semibold ${isDark ? "border-slate-700/40" : "border-slate-200"}`}>
                            {children}
                          </th>
                        ),
                        td: ({ children }) => (
                          <td className={`border-t px-4 py-3 ${isDark ? "border-slate-700/40 text-slate-300" : "border-slate-200 text-slate-600"}`}>
                            {children}
                          </td>
                        ),
                        hr: () => (
                          <hr className={`my-6 ${isDark ? "border-slate-700/40" : "border-slate-200"}`} />
                        ),
                      }}
                    >
                      {processedAnswer}
                    </ReactMarkdown>
                  </article>
                </div>
              </div>

              {/* ── Citations Panel ────────────────────────────── */}
              {(ragResult.citations.kb.length > 0 || ragResult.citations.web.length > 0) && (
                <div className={`overflow-hidden rounded-2xl border ${isDark ? "border-slate-600/30 bg-slate-800/40" : "border-slate-200 bg-white"}`}>
                  <div className={`flex items-center gap-3 border-b px-6 py-3.5 ${isDark ? "border-slate-700/40 bg-slate-800/30" : "border-slate-100 bg-slate-50/80"}`}>
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-slate-500 to-slate-600">
                      <Hash className="h-3.5 w-3.5 text-white" />
                    </div>
                    <h4 className={`text-sm font-bold tracking-wide ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                      Sources & Citations
                    </h4>
                    <span className={`ml-auto text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                      {ragResult.citations.kb.length + ragResult.citations.web.length} total
                    </span>
                  </div>

                  <div className="p-5">
                    <div className="grid gap-5 lg:grid-cols-2">
                      {/* KB Citations */}
                      {ragResult.citations.kb.length > 0 && (
                        <div>
                          <h5 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-500">
                            <BookOpen className="h-3.5 w-3.5" />
                            Knowledge Base
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isDark ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-100 text-emerald-600"}`}>
                              {ragResult.citations.kb.length}
                            </span>
                          </h5>
                          <div className="space-y-2.5">
                            {ragResult.citations.kb.map((cite, i) => (
                              <div key={i} className={`group rounded-xl border transition ${
                                expandedKBCite === i
                                  ? isDark ? "border-emerald-500/30 bg-emerald-500/5" : "border-emerald-200 bg-emerald-50/50"
                                  : isDark ? "border-slate-700/40 bg-slate-800/30 hover:border-slate-600/60" : "border-slate-100 bg-slate-50/60 hover:border-slate-200"
                              }`}>
                                <button
                                  onClick={() => setExpandedKBCite(expandedKBCite === i ? null : i)}
                                  className="w-full px-4 py-3 text-left"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${isDark ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-100 text-emerald-600"}`}>
                                      {i + 1}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className={`truncate text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                                        {shortFilename(cite.filename || "Document")}
                                      </p>
                                      <div className="mt-0.5 flex items-center gap-2">
                                        {cite.page_range && (
                                          <span className={`text-[11px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>{cite.page_range}</span>
                                        )}
                                        {cite.used_in.length > 0 && cite.used_in.map((s, j) => (
                                          <span key={j} className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500">
                                            {s}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                    <ChevronDown className={`h-4 w-4 shrink-0 transition ${isDark ? "text-slate-600" : "text-slate-300"} ${expandedKBCite === i ? "rotate-180" : ""}`} />
                                  </div>
                                </button>
                                {expandedKBCite === i && cite.quote && (
                                  <div className={`border-t px-4 py-3 ${isDark ? "border-slate-700/30" : "border-slate-100"}`}>
                                    <div className={`rounded-lg border-l-3 pl-3 text-[13px] italic leading-relaxed ${isDark ? "border-emerald-500/50 text-slate-400" : "border-emerald-400/50 text-slate-500"}`}>
                                      &ldquo;{cite.quote}&rdquo;
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Web Citations */}
                      {ragResult.citations.web.length > 0 && (
                        <div>
                          <h5 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-500">
                            <Globe className="h-3.5 w-3.5" />
                            Web Evidence
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isDark ? "bg-blue-500/15 text-blue-400" : "bg-blue-100 text-blue-600"}`}>
                              {ragResult.citations.web.length}
                            </span>
                          </h5>
                          <div className="space-y-2.5">
                            {ragResult.citations.web.map((cite, i) => {
                              let hostname = "Web source";
                              try { hostname = cite.url ? new URL(cite.url).hostname.replace("www.", "") : "Web source"; } catch { /* ok */ }
                              return (
                                <div key={i} className={`group rounded-xl border transition ${
                                  expandedWebCite === i
                                    ? isDark ? "border-blue-500/30 bg-blue-500/5" : "border-blue-200 bg-blue-50/50"
                                    : isDark ? "border-slate-700/40 bg-slate-800/30 hover:border-slate-600/60" : "border-slate-100 bg-slate-50/60 hover:border-slate-200"
                                }`}>
                                  <button
                                    onClick={() => setExpandedWebCite(expandedWebCite === i ? null : i)}
                                    className="w-full px-4 py-3 text-left"
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${isDark ? "bg-blue-500/15 text-blue-400" : "bg-blue-100 text-blue-600"}`}>
                                        {i + 1}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <p className={`truncate text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                                          {hostname}
                                        </p>
                                        <div className="mt-0.5 flex items-center gap-2">
                                          {cite.used_in.length > 0 && cite.used_in.map((s, j) => (
                                            <span key={j} className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-500">
                                              {s}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                      <ChevronDown className={`h-4 w-4 shrink-0 transition ${isDark ? "text-slate-600" : "text-slate-300"} ${expandedWebCite === i ? "rotate-180" : ""}`} />
                                    </div>
                                  </button>
                                  {expandedWebCite === i && (
                                    <div className={`border-t px-4 py-3 ${isDark ? "border-slate-700/30" : "border-slate-100"}`}>
                                      {cite.quote && (
                                        <div className={`rounded-lg border-l-3 pl-3 text-[13px] italic leading-relaxed ${isDark ? "border-blue-500/50 text-slate-400" : "border-blue-400/50 text-slate-500"}`}>
                                          &ldquo;{cite.quote}&rdquo;
                                        </div>
                                      )}
                                      {cite.url && (
                                        <a
                                          href={cite.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="mt-2 flex items-center gap-1.5 text-xs font-medium text-blue-400 transition hover:text-blue-300"
                                        >
                                          <ExternalLink className="h-3 w-3" />
                                          {cite.url.length > 60 ? cite.url.slice(0, 60) + "..." : cite.url}
                                        </a>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Conflicts Panel ────────────────────────────── */}
              {ragResult.conflicts.length > 0 && (
                <div className={`overflow-hidden rounded-2xl border-2 ${isDark ? "border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-orange-500/5" : "border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50/50"}`}>
                  <div className={`flex items-center gap-3 border-b px-6 py-3.5 ${isDark ? "border-amber-500/20" : "border-amber-100"}`}>
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500">
                      <AlertTriangle className="h-3.5 w-3.5 text-white" />
                    </div>
                    <h4 className={`text-sm font-bold tracking-wide ${isDark ? "text-amber-300" : "text-amber-700"}`}>
                      Potential Conflicts Detected
                    </h4>
                  </div>
                  <div className="space-y-3 p-5">
                    {ragResult.conflicts.map((c, i) => (
                      <div key={i} className={`rounded-xl border p-4 ${isDark ? "border-slate-700/40 bg-slate-800/30" : "border-amber-100 bg-white/80"}`}>
                        <p className={`text-sm font-medium leading-relaxed ${isDark ? "text-slate-200" : "text-slate-700"}`}>{c.statement}</p>
                        {c.note && <p className={`mt-2 text-xs leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>{c.note}</p>}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {c.kb_support.length > 0 && (
                            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-500">
                              <BookOpen className="h-3 w-3" /> KB: {c.kb_support.join(", ")}
                            </span>
                          )}
                          {c.web_support.length > 0 && (
                            <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-1 text-[11px] font-semibold text-blue-500">
                              <Globe className="h-3 w-3" /> Web: {c.web_support.join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Coverage Gaps Panel ────────────────────────── */}
              {ragResult.coverage_gaps.length > 0 && ragResult.coverage_gaps.some(g => g.gap && !g.gap.startsWith("Could not parse")) && (
                <div className={`overflow-hidden rounded-2xl border ${isDark ? "border-slate-600/30 bg-slate-800/40" : "border-slate-200 bg-white"}`}>
                  <div className={`flex items-center gap-3 border-b px-6 py-3.5 ${isDark ? "border-slate-700/40 bg-slate-800/30" : "border-slate-100 bg-slate-50/80"}`}>
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500">
                      <Lightbulb className="h-3.5 w-3.5 text-white" />
                    </div>
                    <h4 className={`text-sm font-bold tracking-wide ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                      Coverage Gaps & Suggestions
                    </h4>
                  </div>
                  <div className="space-y-1 p-4">
                    {ragResult.coverage_gaps.filter(g => g.gap && !g.gap.startsWith("Could not parse")).map((g, i) => (
                      <div key={i} className={`flex items-start gap-3 rounded-xl p-3 transition ${isDark ? "hover:bg-slate-700/20" : "hover:bg-slate-50"}`}>
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isDark ? "bg-cyan-500/50" : "bg-cyan-500/40"}`} />
                        <div className="flex-1">
                          <p className={`text-sm leading-relaxed ${isDark ? "text-slate-300" : "text-slate-600"}`}>{g.gap}</p>
                          {g.suggested_query && (
                            <button
                              onClick={() => setRagQuery(g.suggested_query)}
                              className={`mt-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                                isDark
                                  ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                                  : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                              }`}
                            >
                              <Search className="h-3 w-3" />
                              Try: {g.suggested_query}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      )}
    </div>
  );
}
