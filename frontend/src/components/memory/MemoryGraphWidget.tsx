"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { X, ArrowRight, Brain } from "lucide-react";
import SearchNode from "./SearchNode";
import NodeDetailsSidebar from "./NodeDetailsSidebar";

// ---------------------------------------------------------------------------
// Types (kept compatible with page.tsx Session / RecalledMemory shapes)
// ---------------------------------------------------------------------------

type WidgetSession = {
  id: string;
  query: string;
  timestamp: number;
  report: string;
  metadata: Record<string, unknown> | null;
};

type RecalledMemory = {
  query: string;
  essence: string;
  timestamp: string;
  similarity: number;
};

type Props = {
  sessions: WidgetSession[];
  currentQuery?: string;
  currentEssence?: string | null;
  recalledMemories: RecalledMemory[];
  isDark: boolean;
  onClose: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nodeTypes = { searchNode: SearchNode } as const;

const MODE_LABELS: Record<string, string> = {
  standard: "Research",
  debate: "Debate",
  academic: "Academic",
  timeline: "Timeline",
  fact_check: "Fact Check",
  deep_dive: "Deep Dive",
};

function categoryFromModes(modes?: unknown): string {
  if (!Array.isArray(modes) || modes.length === 0) return "Research";
  return MODE_LABELS[modes[0] as string] ?? "Research";
}

function edgeStyle(sim: number) {
  if (sim >= 0.8) return { stroke: "#4ade80", strokeWidth: 2, opacity: 0.7 };
  if (sim >= 0.6) return { stroke: "#4ade8066", strokeWidth: 1.5, opacity: 0.45 };
  return { stroke: "#475569", strokeWidth: 1, opacity: 0.25 };
}

// ---------------------------------------------------------------------------
// Graph builder — turns real session data into React Flow nodes/edges
// ---------------------------------------------------------------------------

function buildGraph(
  sessions: WidgetSession[],
  currentQuery?: string,
  currentEssence?: string | null,
  recalledMemories?: RecalledMemory[],
) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const recalled = recalledMemories ?? [];

  const cx = 400;
  const cy = 200;
  const hasCenter = !!currentQuery;

  // ── Current search as the center node ──
  if (hasCenter) {
    nodes.push({
      id: "__current__",
      type: "searchNode",
      position: { x: cx - 110, y: cy - 30 },
      data: {
        query: currentQuery!,
        essenceSummary: currentEssence || "Research in progress...",
        date: "Now",
        category: "Current",
      },
    });
  }

  // ── Past sessions in a radial layout ──
  const total = sessions.length;
  sessions.forEach((s, i) => {
    const isRecalled = recalled.some((m) => m.query === s.query);
    const angle = (i / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
    const radius = hasCenter ? (isRecalled ? 220 : 340) : 200;

    nodes.push({
      id: s.id,
      type: "searchNode",
      position: {
        x: cx + Math.cos(angle) * radius - 110,
        y: cy + Math.sin(angle) * radius - 30,
      },
      data: {
        query: s.query,
        essenceSummary:
          (s.metadata?.essence_text as string) ||
          "No essence captured for this session.",
        date: new Date(s.timestamp).toLocaleDateString(),
        category: categoryFromModes(s.metadata?.modes_used),
      },
    });

    if (hasCenter && isRecalled) {
      const mem = recalled.find((m) => m.query === s.query);
      const sim = mem?.similarity ?? 0.7;
      edges.push({
        id: `e-cur-${s.id}`,
        source: "__current__",
        target: s.id,
        type: "smoothstep",
        animated: sim >= 0.8,
        style: edgeStyle(sim),
        data: { similarityScore: sim },
      });
    }
  });

  // ── Cross-session edges from recalled_memories metadata ──
  const edgeSet = new Set<string>();
  sessions.forEach((s) => {
    const rm = (s.metadata?.recalled_memories ?? []) as RecalledMemory[];
    rm.forEach((mem) => {
      const target = sessions.find(
        (t) => t.query === mem.query && t.id !== s.id,
      );
      if (!target) return;
      const key = [s.id, target.id].sort().join("-");
      if (edgeSet.has(key)) return;
      edgeSet.add(key);
      edges.push({
        id: `e-${key}`,
        source: s.id,
        target: target.id,
        type: "smoothstep",
        style: edgeStyle(mem.similarity),
        data: { similarityScore: mem.similarity },
      });
    });
  });

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Widget Component
// ---------------------------------------------------------------------------

export default function MemoryGraphWidget({
  sessions,
  currentQuery,
  currentEssence,
  recalledMemories,
  isDark,
  onClose,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  useEffect(() => {
    const g = buildGraph(
      sessions,
      currentQuery,
      currentEssence,
      recalledMemories,
    );
    setNodes(g.nodes);
    setEdges(g.edges);
  }, [sessions, currentQuery, currentEssence, recalledMemories, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNode(node);
  }, []);

  // ── Empty state ──
  if (sessions.length === 0 && !currentQuery) {
    return (
      <div
        className={`mb-8 rounded-2xl border p-8 text-center ${
          isDark
            ? "border-slate-700/40 bg-slate-800/20"
            : "border-slate-200 bg-white/60"
        }`}
      >
        <Brain className="mx-auto mb-3 h-10 w-10 text-slate-600" />
        <p className="text-sm text-slate-500">No research sessions yet.</p>
        <p className="mt-1 text-xs text-slate-600">
          Complete your first search to start building your memory graph.
        </p>
        <button
          onClick={onClose}
          className="mt-4 text-xs text-slate-500 hover:text-slate-400"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        className={`mb-8 overflow-hidden rounded-2xl border ${
          isDark
            ? "border-slate-700/40 bg-slate-900/50"
            : "border-slate-200 bg-white/60"
        }`}
      >
        {/* ── Header ── */}
        <div
          className={`flex items-center justify-between px-5 py-3 border-b ${
            isDark ? "border-slate-700/40" : "border-slate-200"
          }`}
        >
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-green-500 to-emerald-600">
              <Brain className="h-3.5 w-3.5 text-white" />
            </div>
            <h3
              className={`text-sm font-semibold ${
                isDark ? "text-slate-300" : "text-slate-700"
              }`}
            >
              Semantic Memory Graph
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                isDark
                  ? "bg-slate-700/50 text-slate-500"
                  : "bg-slate-200 text-slate-500"
              }`}
            >
              {nodes.length} node{nodes.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/memory"
              className="flex items-center gap-1 text-[11px] text-green-500 transition hover:text-green-400"
            >
              Full View <ArrowRight className="h-3 w-3" />
            </a>
            <button
              onClick={onClose}
              className={`rounded-lg p-1 transition ${
                isDark
                  ? "text-slate-500 hover:bg-slate-700/40 hover:text-slate-300"
                  : "text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              }`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── ReactFlow Canvas ── */}
        <div className="h-[400px] w-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            onPaneClick={() => setSelectedNode(null)}
            fitView
            fitViewOptions={{ padding: 0.35 }}
            panOnDrag
            zoomOnScroll
            minZoom={0.2}
            maxZoom={2.5}
            defaultEdgeOptions={{ type: "smoothstep" }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#333" gap={20} />
            <Controls
              className="!rounded-lg !border-slate-700/60 !bg-gray-900/80 !shadow-lg
                [&>button]:!border-slate-700/40 [&>button]:!bg-gray-800/80 [&>button]:!text-slate-400
                [&>button:hover]:!bg-gray-700 [&>button:hover]:!text-slate-200"
            />
          </ReactFlow>
        </div>
      </div>

      {/* Sidebar rendered outside overflow-hidden container so fixed positioning works */}
      <NodeDetailsSidebar
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
      />
    </>
  );
}
