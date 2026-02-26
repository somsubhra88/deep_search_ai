import type { Node, Edge } from "@xyflow/react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchNodeData = {
  query: string;
  essenceSummary: string;
  date: string;
  category: string;
};

export type MemoryEdgeData = {
  similarityScore: number;
};

// ---------------------------------------------------------------------------
// Nodes — three organic clusters: AI, Biotech, Policy/Econ
// ---------------------------------------------------------------------------

export const mockNodes: Node<SearchNodeData>[] = [
  {
    id: "1",
    type: "searchNode",
    position: { x: 80, y: 60 },
    data: {
      query: "AI safety research",
      essenceSummary:
        "AI alignment unsolved; RLHF and constitutional methods lead current safety research globally.",
      date: "Feb 24, 2026",
      category: "AI",
    },
  },
  {
    id: "2",
    type: "searchNode",
    position: { x: 380, y: 0 },
    data: {
      query: "Transformer architecture deep dive",
      essenceSummary:
        "Attention mechanisms revolutionized NLP; scaling laws predict emergent abilities in large models.",
      date: "Feb 20, 2026",
      category: "AI",
    },
  },
  {
    id: "3",
    type: "searchNode",
    position: { x: 220, y: 260 },
    data: {
      query: "Neural network interpretability",
      essenceSummary:
        "Mechanistic interpretability reveals model circuits; superposition challenges full understanding of behavior.",
      date: "Feb 15, 2026",
      category: "AI",
    },
  },
  {
    id: "4",
    type: "searchNode",
    position: { x: 0, y: 400 },
    data: {
      query: "AGI timeline predictions",
      essenceSummary:
        "Expert AGI predictions span 2030-2080; compute scaling and algorithmic breakthroughs remain decisive.",
      date: "Feb 10, 2026",
      category: "AI",
    },
  },
  {
    id: "5",
    type: "searchNode",
    position: { x: 650, y: 180 },
    data: {
      query: "CRISPR gene editing ethics",
      essenceSummary:
        "CRISPR enables precise gene editing; ethical debates center on germline changes and access.",
      date: "Feb 8, 2026",
      category: "Biotech",
    },
  },
  {
    id: "6",
    type: "searchNode",
    position: { x: 820, y: 380 },
    data: {
      query: "mRNA vaccine technology",
      essenceSummary:
        "mRNA platforms extend beyond vaccines into cancer therapeutics and protein replacement trials.",
      date: "Jan 30, 2026",
      category: "Biotech",
    },
  },
  {
    id: "7",
    type: "searchNode",
    position: { x: 600, y: 480 },
    data: {
      query: "Synthetic biology startups",
      essenceSummary:
        "Synthetic biology startups attract billions for biofuels, materials, food, and pharma applications.",
      date: "Jan 25, 2026",
      category: "Biotech",
    },
  },
  {
    id: "8",
    type: "searchNode",
    position: { x: 1000, y: 40 },
    data: {
      query: "Climate change policy 2025",
      essenceSummary:
        "Paris targets demand aggressive action; carbon pricing and green subsidies dominate policy debates.",
      date: "Jan 18, 2026",
      category: "Policy",
    },
  },
  {
    id: "9",
    type: "searchNode",
    position: { x: 1120, y: 260 },
    data: {
      query: "Renewable energy storage solutions",
      essenceSummary:
        "Solid-state batteries and iron-air storage promise reliable grid-scale renewable energy systems.",
      date: "Jan 12, 2026",
      category: "Energy",
    },
  },
  {
    id: "10",
    type: "searchNode",
    position: { x: 980, y: 460 },
    data: {
      query: "Cryptocurrency regulation EU",
      essenceSummary:
        "EU MiCA framework sets precedent; stablecoin rules and DeFi oversight reshape crypto markets.",
      date: "Jan 5, 2026",
      category: "Finance",
    },
  },
];

// ---------------------------------------------------------------------------
// Edges — semantic connections with similarity scores
// ---------------------------------------------------------------------------

export const mockEdges: Edge<MemoryEdgeData>[] = [
  // AI cluster (dense connections)
  { id: "e1-2", source: "1", target: "2", data: { similarityScore: 0.89 } },
  { id: "e1-3", source: "1", target: "3", data: { similarityScore: 0.92 } },
  { id: "e1-4", source: "1", target: "4", data: { similarityScore: 0.85 } },
  { id: "e2-3", source: "2", target: "3", data: { similarityScore: 0.78 } },

  // Biotech cluster
  { id: "e5-6", source: "5", target: "6", data: { similarityScore: 0.72 } },
  { id: "e5-7", source: "5", target: "7", data: { similarityScore: 0.81 } },
  { id: "e6-7", source: "6", target: "7", data: { similarityScore: 0.68 } },

  // Policy / Econ cluster
  { id: "e8-9", source: "8", target: "9", data: { similarityScore: 0.88 } },

  // Cross-cluster weak links
  { id: "e1-5", source: "1", target: "5", data: { similarityScore: 0.55 } },
  { id: "e8-10", source: "8", target: "10", data: { similarityScore: 0.42 } },
];
