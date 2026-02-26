"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import SearchNode from "./SearchNode";
import NodeDetailsSidebar from "./NodeDetailsSidebar";
import {
  mockNodes,
  mockEdges,
  type MemoryEdgeData,
} from "./mockMemoryData";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const nodeTypes = { searchNode: SearchNode } as const;

function edgeStyle(similarity: number) {
  if (similarity >= 0.8)
    return { stroke: "#4ade80", strokeWidth: 2, opacity: 0.7 };
  if (similarity >= 0.6)
    return { stroke: "#4ade8066", strokeWidth: 1.5, opacity: 0.45 };
  return { stroke: "#475569", strokeWidth: 1, opacity: 0.25 };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MemoryGraphCanvas() {
  const [nodes, , onNodesChange] = useNodesState(mockNodes);
  const [edges, , onEdgesChange] = useEdgesState(mockEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const styledEdges = useMemo(
    () =>
      edges.map((e) => {
        const score = (e.data as MemoryEdgeData | undefined)?.similarityScore ?? 0.5;
        return {
          ...e,
          type: "smoothstep" as const,
          style: edgeStyle(score),
          animated: score >= 0.8,
        };
      }),
    [edges],
  );

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNode(node);
  }, []);

  return (
    <div className="relative h-screen w-full bg-gray-950">
      {/* ── Floating header ── */}
      <div className="pointer-events-none absolute left-0 top-0 z-10 w-full px-5 py-4">
        <div className="pointer-events-auto inline-flex items-center gap-3 rounded-2xl border border-slate-700/60 bg-gray-900/80 px-5 py-3 shadow-xl backdrop-blur-md">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 shadow-lg shadow-green-500/20">
            <span className="text-sm font-bold text-white">M</span>
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100">
              Semantic Memory Graph
            </h1>
            <p className="text-[11px] text-slate-500">
              {nodes.length} research nodes · Click to inspect
            </p>
          </div>
        </div>
      </div>

      {/* ── Back link ── */}
      <div className="pointer-events-none absolute right-0 top-0 z-10 px-5 py-4">
        <Link
          href="/"
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-xl border border-slate-700/60 bg-gray-900/80 px-4 py-2.5 text-xs font-medium text-slate-400 shadow-xl backdrop-blur-md transition hover:border-green-500/40 hover:text-green-400"
        >
          ← Back to Search
        </Link>
      </div>

      {/* ── React Flow Canvas ── */}
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
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
          className="!rounded-xl !border-slate-700/60 !bg-gray-900/80 !shadow-xl !backdrop-blur-md
            [&>button]:!border-slate-700/40 [&>button]:!bg-gray-800/80 [&>button]:!text-slate-400
            [&>button:hover]:!bg-gray-700 [&>button:hover]:!text-slate-200"
        />
        <MiniMap
          nodeColor={() => "#4ade80"}
          maskColor="rgba(0,0,0,0.7)"
          className="!rounded-xl !border-slate-700/60 !bg-gray-900/80 !backdrop-blur-md"
        />
      </ReactFlow>

      {/* ── Detail sidebar (framer-motion) ── */}
      <NodeDetailsSidebar
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
      />
    </div>
  );
}
