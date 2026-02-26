"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X, Sparkles, ArrowRight, Calendar, Tag } from "lucide-react";
import type { Node } from "@xyflow/react";
import type { SearchNodeData } from "./mockMemoryData";

type Props = {
  node: Node | null;
  onClose: () => void;
};

export default function NodeDetailsSidebar({ node, onClose }: Props) {
  const data = node?.data as SearchNodeData | undefined;

  return (
    <AnimatePresence>
      {node && data && (
        <>
          {/* Click-away backdrop (transparent) */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40"
            onClick={onClose}
          />

          {/* Sidebar panel */}
          <motion.aside
            key="sidebar"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 z-50 flex h-screen w-96 max-w-[90vw] flex-col border-l border-slate-700/60 bg-gray-950/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-green-400">
                Memory Node
              </h2>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* ── Scrollable Content ── */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {/* Query title */}
              <h3 className="text-xl font-bold text-slate-100">{data.query}</h3>

              {/* Meta badges */}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-400">
                  <Tag className="h-3 w-3" />
                  {data.category}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <Calendar className="h-3 w-3" />
                  {data.date}
                </span>
              </div>

              {/* Essence Summary callout */}
              <div className="mt-6 rounded-xl border border-green-500/20 bg-green-500/5 p-4">
                <div className="mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-green-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-green-400">
                    Research Essence
                  </span>
                </div>
                <p className="text-sm italic leading-relaxed text-slate-300">
                  &ldquo;{data.essenceSummary}&rdquo;
                </p>
              </div>

              {/* Similarity hint */}
              <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <p className="text-xs leading-relaxed text-slate-500">
                  This node is connected to other research sessions through
                  semantic similarity. Restoring context will pre-load this
                  essence into your next search.
                </p>
              </div>
            </div>

            {/* ── Footer CTA ── */}
            <div className="border-t border-slate-800 px-6 py-4">
              <button
                onClick={() => {
                  window.location.href = `/?q=${encodeURIComponent(data.query)}`;
                }}
                className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 px-4 py-3 font-medium text-white shadow-lg shadow-green-500/20 transition hover:from-green-500 hover:to-emerald-500"
              >
                Restore Context &amp; Continue Research
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
