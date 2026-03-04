import type { Node, Edge } from "@xyflow/react";

// ---------------------------------------------------------------------------
// Types (compatible with Session / RecalledMemory from search page)
// ---------------------------------------------------------------------------

export type WidgetSession = {
  id: string;
  query: string;
  timestamp: number;
  report: string;
  metadata: Record<string, unknown> | null;
};

export type RecalledMemory = {
  query: string;
  essence: string;
  timestamp: string;
  similarity: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Graph builder — turns session data into React Flow nodes/edges
// ---------------------------------------------------------------------------

export function buildGraph(
  sessions: WidgetSession[],
  currentQuery?: string,
  currentEssence?: string | null,
  recalledMemories?: RecalledMemory[],
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const recalled = recalledMemories ?? [];

  const cx = 400;
  const cy = 200;
  const hasCenter = !!currentQuery;

  // Current search as the center node
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

  // Past sessions in a radial layout
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

  // Cross-session edges from recalled_memories metadata
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
