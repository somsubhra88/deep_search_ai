"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Search } from "lucide-react";
import type { SearchNodeData } from "./mockMemoryData";

const CATEGORY_COLORS: Record<string, string> = {
  AI: "bg-green-500/10 text-green-400",
  Biotech: "bg-violet-500/10 text-violet-400",
  Policy: "bg-amber-500/10 text-amber-400",
  Energy: "bg-cyan-500/10 text-cyan-400",
  Finance: "bg-rose-500/10 text-rose-400",
  Current: "bg-emerald-500/20 text-emerald-300",
  Research: "bg-slate-500/10 text-slate-400",
  Standard: "bg-slate-500/10 text-slate-400",
  Debate: "bg-violet-500/10 text-violet-400",
  Academic: "bg-amber-500/10 text-amber-400",
  Timeline: "bg-blue-500/10 text-blue-400",
  "Fact Check": "bg-teal-500/10 text-teal-400",
  "Deep Dive": "bg-rose-500/10 text-rose-400",
};

function SearchNode({
  data,
  selected,
}: {
  data: SearchNodeData;
  selected?: boolean;
}) {
  const catColor = CATEGORY_COLORS[data.category] ?? "bg-slate-500/10 text-slate-400";
  const isCurrent = data.category === "Current";

  return (
    <div
      className={`group relative rounded-xl border px-4 py-3 backdrop-blur-md
        transition-all duration-300 ease-out bg-gray-900/80
        ${
          isCurrent
            ? "border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.5)] ring-1 ring-emerald-400/20"
            : selected
            ? "border-green-400 shadow-[0_0_20px_rgba(74,222,128,0.4)]"
            : "border-slate-700/60 hover:border-green-400 hover:shadow-[0_0_15px_rgba(74,222,128,0.3)]"
        }`}
      style={{ minWidth: 210, maxWidth: 260 }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-gray-900 !bg-green-500"
      />

      <div className="flex items-start gap-2.5">
        <div
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors
            ${selected ? "bg-green-500/20" : "bg-slate-800 group-hover:bg-green-500/10"}`}
        >
          <Search
            className={`h-3.5 w-3.5 transition-colors ${
              selected ? "text-green-400" : "text-slate-500 group-hover:text-green-400"
            }`}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-100">
            {data.query}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${catColor}`}
            >
              {data.category}
            </span>
            <span className="text-[10px] text-slate-500">{data.date}</span>
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-gray-900 !bg-green-500"
      />
    </div>
  );
}

export default memo(SearchNode);
