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
  type OnNodesChange,
  type OnEdgesChange,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize2, Minimize2 } from "lucide-react";
import ClaimNode, { type ClaimNodeData } from "./ClaimNode";
import type { DebateArtifacts } from "./types";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 90;
const LEVEL_GAP = 260;
const ROW_GAP = 100;

const nodeTypes = { claimNode: ClaimNode };

type ArgumentGraph = NonNullable<DebateArtifacts["argumentGraph"]>;

function computeLevels(claims: ArgumentGraph["claims"], relations: ArgumentGraph["relations"]): Map<string, number> {
  const levels = new Map<string, number>();
  claims.forEach((c) => levels.set(c.claimId, 0));

  const incoming = new Map<string, string[]>();
  relations.forEach((r) => {
    if (!incoming.has(r.to)) incoming.set(r.to, []);
    incoming.get(r.to)!.push(r.from);
  });

  let changed = true;
  for (let iter = 0; iter < claims.length + 1 && changed; iter++) {
    changed = false;
    relations.forEach((r) => {
      const fromLevel = levels.get(r.from) ?? 0;
      const toLevel = levels.get(r.to) ?? 0;
      const need = fromLevel + 1;
      if (need > toLevel) {
        levels.set(r.to, need);
        changed = true;
      }
    });
  }
  return levels;
}

function buildGraph(argumentGraph: ArgumentGraph): { nodes: Node[]; edges: Edge[] } {
  const { claims, relations } = argumentGraph;
  if (!claims.length) return { nodes: [], edges: [] };

  const levels = computeLevels(claims, relations);
  const byLevel = new Map<number, ArgumentGraph["claims"]>();
  claims.forEach((c) => {
    const l = levels.get(c.claimId) ?? 0;
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)!.push(c);
  });

  byLevel.forEach((arr) =>
    arr.sort((a, b) => (a.byAgent !== b.byAgent ? (a.byAgent === "A" ? -1 : 1) : a.claimId.localeCompare(b.claimId)))
  );

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  byLevel.forEach((levelClaims, level) => {
    levelClaims.forEach((c, row) => {
      nodes.push({
        id: c.claimId,
        type: "claimNode",
        position: { x: level * LEVEL_GAP, y: row * ROW_GAP },
        data: {
          claimId: c.claimId,
          text: c.text,
          byAgent: c.byAgent,
          type: c.type,
          messageIds: c.messageIds ?? [],
        } as ClaimNodeData,
      });
    });
  });

  const relColors: Record<string, { stroke: string; label?: string }> = {
    supports: { stroke: "#4ade80", label: "supports" },
    refutes: { stroke: "#f43f5e", label: "refutes" },
    clarifies: { stroke: "#38bdf8", label: "clarifies" },
  };

  relations.forEach((r, i) => {
    const style = relColors[r.rel] ?? { stroke: "#64748b" };
    edges.push({
      id: `e-${r.from}-${r.to}-${i}`,
      source: r.from,
      target: r.to,
      type: "smoothstep",
      animated: r.rel === "refutes",
      style: { stroke: style.stroke, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
      label: style.label,
      labelStyle: { fill: style.stroke, fontWeight: 600 },
      labelBgStyle: { fill: "rgb(15 23 42)", fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
    });
  });

  return { nodes, edges };
}

type Props = {
  argumentGraph: ArgumentGraph;
  isDark: boolean;
};

const GRAPH_HEIGHT = 420;

function GraphCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  height,
}: {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node>;
  onEdgesChange: OnEdgesChange<Edge>;
  height: string | number;
}) {
  return (
    <div className="w-full" style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        panOnDrag
        zoomOnScroll
        minZoom={0.15}
        maxZoom={2}
        defaultEdgeOptions={{ type: "smoothstep" }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#334155" gap={18} />
        <Controls
          className="!rounded-lg !border-slate-600 !bg-slate-800/90 !shadow-lg
            [&>button]:!border-slate-600 [&>button]:!bg-slate-700/80 [&>button]:!text-slate-300
            [&>button:hover]:!bg-slate-600 [&>button:hover]:!text-white"
        />
      </ReactFlow>
    </div>
  );
}

export default function DebateArgumentGraph({ argumentGraph, isDark }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const { nodes: n, edges: e } = buildGraph(argumentGraph);
    setNodes(n);
    setEdges(e);
  }, [argumentGraph, setNodes, setEdges]);

  const toggleFullscreen = useCallback(() => setFullscreen((v) => !v), []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [fullscreen]);

  if (argumentGraph.claims.length === 0) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-xl border border-slate-600/50 bg-slate-800/30 text-slate-500">
        <p className="text-sm">No claims to display. Run a debate to see the argument graph.</p>
      </div>
    );
  }

  const header = (
    <div className="flex shrink-0 items-center justify-between border-b border-slate-600/50 px-4 py-2">
      <span className="text-xs font-semibold text-slate-400">
        {argumentGraph.claims.length} nodes · {argumentGraph.relations.length} relations
      </span>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500 hidden sm:inline">
          Hover a node to see full claim · Green = supports, Red = refutes
        </span>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200"
          title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-slate-900">
        {header}
        <div className="min-h-0 flex-1">
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            height="100%"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-600/50 bg-slate-900/50 overflow-hidden">
      {header}
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        height={GRAPH_HEIGHT}
      />
    </div>
  );
}
