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
import {
  buildGraph,
  fetchEmbeddingGraph,
  type WidgetSession,
  type RecalledMemory,
  type MemoryGraphResponse,
} from "./buildMemoryGraph";
import { loadManualLinks, type ManualLink } from "@/lib/storage";

const nodeTypes = { searchNode: SearchNode } as const;

type Props = {
  sessions: WidgetSession[];
  currentQuery?: string;
  currentEssence?: string | null;
  recalledMemories: RecalledMemory[];
  isDark: boolean;
  onClose: () => void;
};

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
  const [embeddingGraph, setEmbeddingGraph] = useState<MemoryGraphResponse | null>(null);
  const [manualLinks, setManualLinks] = useState<ManualLink[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchEmbeddingGraph().then((eg) => {
      if (!cancelled) setEmbeddingGraph(eg);
    });
    setManualLinks(loadManualLinks());
    return () => { cancelled = true; };
  }, [sessions.length]);

  useEffect(() => {
    const g = buildGraph(
      sessions,
      currentQuery,
      currentEssence,
      recalledMemories,
      embeddingGraph,
      manualLinks,
    );
    setNodes(g.nodes);
    setEdges(g.edges);
  }, [sessions, currentQuery, currentEssence, recalledMemories, embeddingGraph, manualLinks, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNode(node);
  }, []);

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
        {/* Header */}
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
              {nodes.length} node{nodes.length !== 1 ? "s" : ""} &middot;{" "}
              {edges.length} link{edges.length !== 1 ? "s" : ""}
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

        {/* ReactFlow Canvas */}
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

      <NodeDetailsSidebar
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
      />
    </>
  );
}
