"use client";

import { useState, useCallback, useEffect } from "react";
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
import { Brain } from "lucide-react";

import SearchNode from "./SearchNode";
import NodeDetailsSidebar from "./NodeDetailsSidebar";
import { buildGraph, type WidgetSession } from "./buildMemoryGraph";
import { loadFromStorage, SESSIONS_KEY } from "@/lib/storage";

const nodeTypes = { searchNode: SearchNode } as const;

export default function MemoryGraphCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [sessions, setSessions] = useState<WidgetSession[]>([]);

  useEffect(() => {
    const stored = loadFromStorage<WidgetSession[]>(SESSIONS_KEY, []);
    setSessions(stored);
    const { nodes: n, edges: e } = buildGraph(stored);
    setNodes(n);
    setEdges(e);
  }, [setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNode(node);
  }, []);

  if (sessions.length === 0) {
    return (
      <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-gray-950 px-4">
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
                0 research nodes
              </p>
            </div>
          </div>
        </div>
        <Link
          href="/"
          className="pointer-events-auto absolute right-5 top-4 inline-flex items-center gap-1.5 rounded-xl border border-slate-700/60 bg-gray-900/80 px-4 py-2.5 text-xs font-medium text-slate-400 shadow-xl backdrop-blur-md transition hover:border-green-500/40 hover:text-green-400"
        >
          ← Back to Search
        </Link>
        <div className="rounded-2xl border border-slate-700/40 bg-slate-800/20 p-8 text-center">
          <Brain className="mx-auto mb-3 h-10 w-10 text-slate-600" />
          <p className="text-sm text-slate-500">No research sessions yet.</p>
          <p className="mt-1 text-xs text-slate-600">
            Complete your first search to start building your memory graph.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block text-xs text-green-500 hover:text-green-400"
          >
            Go to Search →
          </Link>
        </div>
      </div>
    );
  }

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
