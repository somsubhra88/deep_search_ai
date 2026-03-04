"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Brain, RefreshCw, Link2, X } from "lucide-react";
import { toast } from "sonner";

import SearchNode from "./SearchNode";
import NodeDetailsSidebar from "./NodeDetailsSidebar";
import {
  buildGraph,
  fetchEmbeddingGraph,
  type WidgetSession,
  type MemoryGraphResponse,
} from "./buildMemoryGraph";
import {
  loadFromStorage,
  SESSIONS_KEY,
  loadManualLinks,
  saveManualLink,
  removeManualLink,
  type ManualLink,
} from "@/lib/storage";

const nodeTypes = { searchNode: SearchNode } as const;

export default function MemoryGraphCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [sessions, setSessions] = useState<WidgetSession[]>([]);
  const [embeddingGraph, setEmbeddingGraph] = useState<MemoryGraphResponse | null>(null);
  const [manualLinks, setManualLinks] = useState<ManualLink[]>([]);
  const [loading, setLoading] = useState(true);

  // Link mode state
  const [linkMode, setLinkMode] = useState(false);
  const [linkSource, setLinkSource] = useState<Node | null>(null);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const rebuildGraph = useCallback(
    (s: WidgetSession[], eg: MemoryGraphResponse | null, ml: ManualLink[]) => {
      const { nodes: n, edges: e } = buildGraph(s, undefined, undefined, undefined, eg, ml);
      setNodes(n);
      setEdges(e);
    },
    [setNodes, setEdges],
  );

  const refreshFromStorage = useCallback(async () => {
    setLoading(true);
    const stored = loadFromStorage<WidgetSession[]>(SESSIONS_KEY, []);
    setSessions(stored);
    const ml = loadManualLinks();
    setManualLinks(ml);

    const eg = await fetchEmbeddingGraph();
    setEmbeddingGraph(eg);
    rebuildGraph(stored, eg, ml);
    setLoading(false);
  }, [rebuildGraph]);

  useEffect(() => {
    refreshFromStorage();
  }, [refreshFromStorage]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshFromStorage();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSIONS_KEY) refreshFromStorage();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
    };
  }, [refreshFromStorage]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      if (!linkMode) {
        setSelectedNode(node);
        return;
      }

      if (node.id === "__current__") return;

      if (!linkSource) {
        setLinkSource(node);
        toast.info(`Selected "${(node.data as { query: string }).query}" — now click a second node to link`);
        return;
      }

      if (node.id === linkSource.id) {
        setLinkSource(null);
        toast.info("Selection cleared — click a different node");
        return;
      }

      const srcData = linkSource.data as { query: string };
      const tgtData = node.data as { query: string };

      // Check if link already exists — if so, remove it (toggle)
      const existingKey = [linkSource.id, node.id].sort().join("||");
      const existing = manualLinks.find((l) => {
        const k = [l.sourceId, l.targetId].sort().join("||");
        return k === existingKey;
      });

      if (existing) {
        removeManualLink(existing.sourceId, existing.targetId);
        const updated = manualLinks.filter((l) => {
          const k = [l.sourceId, l.targetId].sort().join("||");
          return k !== existingKey;
        });
        setManualLinks(updated);
        rebuildGraph(sessionsRef.current, embeddingGraph, updated);
        toast.success(`Unlinked "${srcData.query}" ↔ "${tgtData.query}"`);
      } else {
        const newLink: ManualLink = {
          sourceId: linkSource.id,
          targetId: node.id,
          sourceQuery: srcData.query,
          targetQuery: tgtData.query,
          createdAt: Date.now(),
        };
        saveManualLink(newLink);
        const updated = [...manualLinks, newLink];
        setManualLinks(updated);
        rebuildGraph(sessionsRef.current, embeddingGraph, updated);
        toast.success(`Linked "${srcData.query}" ↔ "${tgtData.query}"`);
      }

      setLinkSource(null);
    },
    [linkMode, linkSource, manualLinks, embeddingGraph, rebuildGraph],
  );

  const toggleLinkMode = useCallback(() => {
    setLinkMode((prev) => {
      if (prev) {
        setLinkSource(null);
        toast.info("Link mode off");
      } else {
        setSelectedNode(null);
        toast.info("Link mode on — click two nodes to connect them. Click an existing link to remove it.");
      }
      return !prev;
    });
  }, []);

  if (!loading && sessions.length === 0) {
    return (
      <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-gray-950 px-4">
        <div className="pointer-events-none absolute left-0 top-0 z-10 w-full px-5 py-4">
          <div className="pointer-events-auto inline-flex items-center gap-3 rounded-2xl border border-slate-700/60 bg-gray-900/80 px-5 py-3 shadow-xl backdrop-blur-md">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 shadow-lg shadow-green-500/20">
              <span className="text-sm font-bold text-white">M</span>
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100">Semantic Memory Graph</h1>
              <p className="text-[11px] text-slate-500">0 research nodes</p>
            </div>
          </div>
        </div>
        <Link
          href="/"
          className="pointer-events-auto absolute right-5 top-4 inline-flex items-center gap-1.5 rounded-xl border border-slate-700/60 bg-gray-900/80 px-4 py-2.5 text-xs font-medium text-slate-400 shadow-xl backdrop-blur-md transition hover:border-green-500/40 hover:text-green-400"
        >
          &larr; Back to Search
        </Link>
        <div className="rounded-2xl border border-slate-700/40 bg-slate-800/20 p-8 text-center">
          <Brain className="mx-auto mb-3 h-10 w-10 text-slate-600" />
          <p className="text-sm text-slate-500">No research sessions yet.</p>
          <p className="mt-1 text-xs text-slate-600">
            Complete your first search to start building your memory graph.
          </p>
          <Link href="/" className="mt-4 inline-block text-xs text-green-500 hover:text-green-400">
            Go to Search &rarr;
          </Link>
        </div>
      </div>
    );
  }

  const manualCount = manualLinks.length;

  return (
    <div className="relative h-screen w-full bg-gray-950">
      {/* Floating header */}
      <div className="pointer-events-none absolute left-0 top-0 z-10 w-full px-5 py-4">
        <div className="pointer-events-auto inline-flex items-center gap-3 rounded-2xl border border-slate-700/60 bg-gray-900/80 px-5 py-3 shadow-xl backdrop-blur-md">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 shadow-lg shadow-green-500/20">
            <span className="text-sm font-bold text-white">M</span>
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100">Semantic Memory Graph</h1>
            <p className="text-[11px] text-slate-500">
              {nodes.length} nodes &middot; {edges.length} connections
              {manualCount > 0 ? ` (${manualCount} manual)` : ""}
              {embeddingGraph ? " &middot; embeddings active" : ""}
            </p>
          </div>
          <button
            onClick={toggleLinkMode}
            className={`ml-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              linkMode
                ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40"
                : "text-slate-500 hover:bg-slate-700/40 hover:text-slate-300"
            }`}
            title={linkMode ? "Exit link mode" : "Link two nodes manually"}
          >
            {linkMode ? <X className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
            {linkMode ? "Exit Link Mode" : "Link Nodes"}
          </button>
          <button
            onClick={() => refreshFromStorage()}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-700/40 hover:text-slate-300"
            title="Refresh graph"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Link mode banner */}
      {linkMode && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-10 -translate-x-1/2">
          <div className="pointer-events-auto rounded-xl border border-violet-500/40 bg-violet-950/80 px-5 py-2.5 text-center shadow-xl backdrop-blur-md">
            <p className="text-xs font-medium text-violet-300">
              {linkSource
                ? `Selected: "${(linkSource.data as { query: string }).query}" — click another node to link (or same to cancel)`
                : "Click a node to start linking"}
            </p>
          </div>
        </div>
      )}

      {/* Back link */}
      <div className="pointer-events-none absolute right-0 top-0 z-10 px-5 py-4">
        <Link
          href="/"
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-xl border border-slate-700/60 bg-gray-900/80 px-4 py-2.5 text-xs font-medium text-slate-400 shadow-xl backdrop-blur-md transition hover:border-green-500/40 hover:text-green-400"
        >
          &larr; Back to Search
        </Link>
      </div>

      {/* React Flow Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={() => {
          if (!linkMode) setSelectedNode(null);
          if (linkMode && linkSource) {
            setLinkSource(null);
            toast.info("Selection cleared");
          }
        }}
        fitView
        fitViewOptions={{ padding: 0.35 }}
        panOnDrag
        zoomOnScroll
        minZoom={0.2}
        maxZoom={2.5}
        defaultEdgeOptions={{ type: "smoothstep" }}
        proOptions={{ hideAttribution: true }}
        className={linkMode ? "cursor-crosshair" : ""}
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

      {/* Detail sidebar */}
      {!linkMode && (
        <NodeDetailsSidebar
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}
