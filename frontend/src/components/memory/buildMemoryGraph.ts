import type { Node, Edge } from "@xyflow/react";
import type { ManualLink } from "@/lib/storage";

// ---------------------------------------------------------------------------
// Types
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

/** Edge from the backend /api/memory/graph endpoint (real cosine similarity). */
export type EmbeddingEdge = {
  source: string;
  target: string;
  similarity: number;
};

/** Node from the backend /api/memory/graph endpoint. */
export type EmbeddingNode = {
  id: string;
  query: string;
  essence: string;
  timestamp: string;
};

/** Full response from /api/memory/graph. */
export type MemoryGraphResponse = {
  nodes: EmbeddingNode[];
  edges: EmbeddingEdge[];
};

// ---------------------------------------------------------------------------
// Configuration — all tunable parameters in one place
// ---------------------------------------------------------------------------

export const GRAPH_CONFIG = {
  /** Minimum cosine similarity from backend to include an edge. */
  embeddingThreshold: 0.3,
  /** Minimum TF-IDF cosine similarity to create a client-side edge. */
  tfidfThreshold: 0.15,
  /** Floor below which any edge is discarded regardless of source. */
  minEdgeSimilarity: 0.1,
  /** Floor for raw TF-IDF pair similarity before storing. */
  minPairSimilarity: 0.05,
  /** Similarity at or above which an edge animates. */
  animationThreshold: 0.8,

  layout: {
    width: 1000,
    height: 700,
    /** Fraction of min(width, height) used as initial circle radius. */
    initialRadiusFraction: 0.35,
    /** Half-width of a SearchNode (used to center the node on its position). */
    nodeOffsetX: 110,
    /** Half-height of a SearchNode. */
    nodeOffsetY: 30,
    iterations: 120,
    repulsionStrength: 8000,
    attractionStrength: 0.008,
    /** Base weight added to every edge's similarity for attraction. */
    attractionBaseWeight: 0.3,
    damping: 0.85,
    centerGravity: 0.002,
  },

  edgeLabel: {
    color: "#94a3b8",
    fontSize: 9,
    fontWeight: 500,
    bgColor: "#0f172a",
    bgOpacity: 0.85,
    padding: [4, 2] as [number, number],
  },
} as const;

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

const EDGE_TIERS = [
  { min: 0.85, stroke: "#4ade80", strokeWidth: 2.5, opacity: 0.9 },
  { min: 0.7,  stroke: "#4ade80", strokeWidth: 2,   opacity: 0.7 },
  { min: 0.5,  stroke: "#4ade8088", strokeWidth: 1.5, opacity: 0.5 },
  { min: 0,    stroke: "#475569", strokeWidth: 1,   opacity: 0.3 },
] as const;

function edgeStyle(sim: number) {
  const tier = EDGE_TIERS.find((t) => sim >= t.min) ?? EDGE_TIERS[EDGE_TIERS.length - 1];
  return { stroke: tier.stroke, strokeWidth: tier.strokeWidth, opacity: tier.opacity };
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Hybrid similarity: BM25-style term matching + Jaccard on character n-grams
// Works well even for tiny corpora (2-3 docs) where TF-IDF fails
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after",
  "between", "out", "off", "over", "under", "then",
  "here", "there", "all", "both", "no", "nor", "not", "so", "very",
  "but", "and", "or", "if", "this", "that", "these", "those",
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "it", "its", "they", "them", "their",
]);

function tokenize(text: string): string[] {
  return normalizeQuery(text)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** Generate character n-grams (trigrams) from text for fuzzy matching. */
function charNgrams(text: string, n = 3): Set<string> {
  const clean = normalizeQuery(text).replace(/[^a-z0-9]/g, "");
  const grams = new Set<string>();
  for (let i = 0; i <= clean.length - n; i++) {
    grams.add(clean.slice(i, i + n));
  }
  return grams;
}

/** Jaccard similarity between two sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) { if (b.has(x)) intersection++; }
  return intersection / (a.size + b.size - intersection);
}

/** Shared-term ratio: what fraction of the smaller doc's terms appear in the larger. */
function sharedTermRatio(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let shared = 0;
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;
  for (const t of smaller) { if (larger.has(t)) shared++; }
  return shared / smaller.size;
}

/**
 * Compute pairwise similarity using a hybrid approach:
 * 1. Shared-term ratio (exact word overlap, weighted heavily)
 * 2. Character trigram Jaccard (catches partial matches like "rank"/"ranking")
 * 3. Combined with max() so any signal is enough
 */
function computeAllPairSimilarities(
  documents: string[],
): Map<string, number> {
  const n = documents.length;
  if (n < 2) return new Map();

  const tokenized = documents.map(tokenize);
  const trigrams = documents.map((d) => charNgrams(d));

  const sims = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const termSim = sharedTermRatio(tokenized[i], tokenized[j]);
      const ngramSim = jaccard(trigrams[i], trigrams[j]);
      const sim = Math.max(termSim * 0.9, ngramSim * 0.8, (termSim + ngramSim) / 2);
      if (sim > GRAPH_CONFIG.minPairSimilarity) {
        sims.set(`${i}||${j}`, sim);
      }
    }
  }
  return sims;
}

// ---------------------------------------------------------------------------
// Fetch embedding graph from backend
// ---------------------------------------------------------------------------

export async function fetchEmbeddingGraph(
  threshold = GRAPH_CONFIG.embeddingThreshold,
): Promise<MemoryGraphResponse | null> {
  try {
    const res = await fetch(`/api/memory/graph?threshold=${threshold}`);
    if (!res.ok) return null;
    return (await res.json()) as MemoryGraphResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Force-directed layout
// ---------------------------------------------------------------------------

function forceLayout(
  nodeCount: number,
  edgeList: { source: number; target: number; weight: number }[],
  width: number,
  height: number,
): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];
  const cx = width / 2;
  const cy = height / 2;

  const { layout: cfg } = GRAPH_CONFIG;

  for (let i = 0; i < nodeCount; i++) {
    const angle = (i / Math.max(nodeCount, 1)) * Math.PI * 2 - Math.PI / 2;
    const radius = Math.min(width, height) * cfg.initialRadiusFraction;
    positions.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }

  if (nodeCount <= 1) return positions;

  const velocities = positions.map(() => ({ vx: 0, vy: 0 }));

  for (let iter = 0; iter < cfg.iterations; iter++) {
    const forces = positions.map(() => ({ fx: 0, fy: 0 }));

    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = cfg.repulsionStrength / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces[i].fx += fx;
        forces[i].fy += fy;
        forces[j].fx -= fx;
        forces[j].fy -= fy;
      }
    }

    for (const edge of edgeList) {
      const dx = positions[edge.target].x - positions[edge.source].x;
      const dy = positions[edge.target].y - positions[edge.source].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const force = dist * cfg.attractionStrength * (edge.weight + cfg.attractionBaseWeight);
      const fx = (dx / Math.max(dist, 1)) * force;
      const fy = (dy / Math.max(dist, 1)) * force;
      forces[edge.source].fx += fx;
      forces[edge.source].fy += fy;
      forces[edge.target].fx -= fx;
      forces[edge.target].fy -= fy;
    }

    for (let i = 0; i < nodeCount; i++) {
      forces[i].fx += (cx - positions[i].x) * cfg.centerGravity;
      forces[i].fy += (cy - positions[i].y) * cfg.centerGravity;
    }

    for (let i = 0; i < nodeCount; i++) {
      velocities[i].vx = (velocities[i].vx + forces[i].fx) * cfg.damping;
      velocities[i].vy = (velocities[i].vy + forces[i].fy) * cfg.damping;
      positions[i].x += velocities[i].vx;
      positions[i].y += velocities[i].vy;
    }
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

export function buildGraph(
  sessions: WidgetSession[],
  currentQuery?: string,
  currentEssence?: string | null,
  recalledMemories?: RecalledMemory[],
  embeddingGraph?: MemoryGraphResponse | null,
  manualLinks?: ManualLink[],
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const recalled = recalledMemories ?? [];
  const hasCenter = !!currentQuery;

  if (sessions.length === 0 && !hasCenter) return { nodes, edges };

  // --- Collect all edge data: session-index pair → best similarity ---
  const edgeMap = new Map<string, { srcIdx: number; tgtIdx: number; sim: number; source: string; target: string }>();
  function addEdge(srcIdx: number, tgtIdx: number, srcId: string, tgtId: string, sim: number) {
    if (srcIdx === tgtIdx && srcId === tgtId) return;
    if (sim < GRAPH_CONFIG.minEdgeSimilarity) return;
    const key = srcIdx < tgtIdx ? `${srcIdx}||${tgtIdx}` : `${tgtIdx}||${srcIdx}`;
    const existing = edgeMap.get(key);
    if (!existing || sim > existing.sim) {
      edgeMap.set(key, { srcIdx, tgtIdx, sim, source: srcId, target: tgtId });
    }
  }

  // Build lookup: normalized query → list of session indices (handles duplicates)
  const queryToIndices = new Map<string, number[]>();
  sessions.forEach((s, i) => {
    const nq = normalizeQuery(s.query);
    const arr = queryToIndices.get(nq) ?? [];
    arr.push(i);
    queryToIndices.set(nq, arr);
  });

  // --- Source 1: Backend embedding graph (real cosine similarity) ---
  if (embeddingGraph && embeddingGraph.edges.length > 0) {
    // Map embedding node ID → normalized query
    const embIdToQuery = new Map<string, string>();
    for (const en of embeddingGraph.nodes) {
      embIdToQuery.set(en.id, normalizeQuery(en.query));
    }

    for (const e of embeddingGraph.edges) {
      const srcQuery = embIdToQuery.get(e.source);
      const tgtQuery = embIdToQuery.get(e.target);
      if (!srcQuery || !tgtQuery) continue;

      const srcIndices = queryToIndices.get(srcQuery) ?? [];
      const tgtIndices = queryToIndices.get(tgtQuery) ?? [];

      for (const si of srcIndices) {
        for (const ti of tgtIndices) {
          if (si !== ti) {
            addEdge(si, ti, sessions[si].id, sessions[ti].id, e.similarity);
          }
        }
      }
    }
  }

  // --- Source 2: recalled_memories from session metadata ---
  sessions.forEach((s, i) => {
    const rm = (s.metadata?.recalled_memories ?? []) as RecalledMemory[];
    rm.forEach((mem) => {
      const memQueryNorm = normalizeQuery(mem.query);
      const targetIndices = queryToIndices.get(memQueryNorm) ?? [];
      for (const ti of targetIndices) {
        if (ti !== i) {
          addEdge(i, ti, s.id, sessions[ti].id, mem.similarity);
        }
      }
    });
  });

  // --- Source 3: TF-IDF similarity (always runs as fallback / supplement) ---
  // Use both query and essence text for richer comparison
  const documents = sessions.map((s) => {
    const essence = (s.metadata?.essence_text as string) ?? "";
    return `${s.query} ${essence}`;
  });
  const tfidfSims = computeAllPairSimilarities(documents);
  tfidfSims.forEach((sim, key) => {
    if (sim < GRAPH_CONFIG.tfidfThreshold) return;
    const [iStr, jStr] = key.split("||");
    const i = parseInt(iStr, 10);
    const j = parseInt(jStr, 10);
    addEdge(i, j, sessions[i].id, sessions[j].id, sim);
  });

  // --- Source 4: Current search → recalled sessions ---
  const currentEdges: { targetIdx: number; sim: number }[] = [];
  if (hasCenter) {
    recalled.forEach((mem) => {
      const normQ = normalizeQuery(mem.query);
      const targetIndices = queryToIndices.get(normQ) ?? [];
      for (const ti of targetIndices) {
        currentEdges.push({ targetIdx: ti, sim: mem.similarity });
      }
    });
  }

  // --- Source 5: Manual user-created links (highest priority) ---
  const manualEdges: { srcIdx: number; tgtIdx: number; srcId: string; tgtId: string }[] = [];
  if (manualLinks && manualLinks.length > 0) {
    const idToIdx = new Map(sessions.map((s, i) => [s.id, i]));
    for (const link of manualLinks) {
      const si = idToIdx.get(link.sourceId);
      const ti = idToIdx.get(link.targetId);
      if (si !== undefined && ti !== undefined) {
        addEdge(si, ti, link.sourceId, link.targetId, 1.0);
        manualEdges.push({ srcIdx: si, tgtIdx: ti, srcId: link.sourceId, tgtId: link.targetId });
      }
    }
  }

  // --- Layout ---
  const layoutEdges: { source: number; target: number; weight: number }[] = [];
  edgeMap.forEach(({ srcIdx, tgtIdx, sim }) => {
    layoutEdges.push({ source: srcIdx, target: tgtIdx, weight: sim });
  });

  const { layout: lc } = GRAPH_CONFIG;
  const positions = forceLayout(sessions.length, layoutEdges, lc.width, lc.height);

  // --- Build nodes ---
  if (hasCenter) {
    nodes.push({
      id: "__current__",
      type: "searchNode",
      position: { x: lc.width / 2 - lc.nodeOffsetX, y: lc.height / 2 - lc.nodeOffsetY },
      data: {
        query: currentQuery!,
        essenceSummary: currentEssence || "Research in progress...",
        date: "Now",
        category: "Current",
      },
    });
  }

  sessions.forEach((s, i) => {
    nodes.push({
      id: s.id,
      type: "searchNode",
      position: { x: positions[i].x - lc.nodeOffsetX, y: positions[i].y - lc.nodeOffsetY },
      data: {
        query: s.query,
        essenceSummary:
          (s.metadata?.essence_text as string) ||
          "No essence captured for this session.",
        date: new Date(s.timestamp).toLocaleDateString(),
        category: categoryFromModes(s.metadata?.modes_used),
      },
    });
  });

  // --- Build edges ---
  const { edgeLabel: elCfg, animationThreshold } = GRAPH_CONFIG;
  const labelStyle = { fill: elCfg.color, fontSize: elCfg.fontSize, fontWeight: elCfg.fontWeight };
  const labelBgStyle = { fill: elCfg.bgColor, fillOpacity: elCfg.bgOpacity };

  function makeEdge(id: string, source: string, target: string, sim: number, isManual = false): Edge {
    return {
      id,
      source,
      target,
      type: "smoothstep",
      animated: isManual || sim >= animationThreshold,
      label: isManual ? "Linked" : `${Math.round(sim * 100)}%`,
      labelStyle: isManual
        ? { fill: "#a78bfa", fontSize: 9, fontWeight: 600 }
        : labelStyle,
      labelBgStyle,
      labelBgPadding: elCfg.padding,
      style: isManual
        ? { stroke: "#a78bfa", strokeWidth: 2, opacity: 0.9, strokeDasharray: "6 3" }
        : edgeStyle(sim),
      data: { similarityScore: sim, isManual },
    };
  }

  const manualEdgeKeys = new Set(manualEdges.map((e) => [e.srcId, e.tgtId].sort().join("||")));

  edgeMap.forEach(({ source, target, sim }) => {
    const key = [source, target].sort().join("||");
    edges.push(makeEdge(`e-${key}`, source, target, sim, manualEdgeKeys.has(key)));
  });

  // Add manual edges that weren't already covered by the edgeMap
  for (const { srcIdx, tgtIdx, srcId, tgtId } of manualEdges) {
    const key = [srcId, tgtId].sort().join("||");
    const existingEdge = edges.find((e) => e.id === `e-${key}`);
    if (existingEdge) {
      // Upgrade existing edge to show it's also manually linked
      existingEdge.label = "Linked";
      existingEdge.labelStyle = { fill: "#a78bfa", fontSize: 9, fontWeight: 600 };
      existingEdge.style = { stroke: "#a78bfa", strokeWidth: 2, opacity: 0.9, strokeDasharray: "6 3" };
      existingEdge.animated = true;
      if (existingEdge.data) (existingEdge.data as Record<string, unknown>).isManual = true;
    }
  }

  for (const { targetIdx, sim } of currentEdges) {
    const targetId = sessions[targetIdx].id;
    const key = `__current__||${targetId}`;
    edges.push(makeEdge(`e-${key}`, "__current__", targetId, sim));
  }

  return { nodes, edges };
}

export type { ManualLink } from "@/lib/storage";
