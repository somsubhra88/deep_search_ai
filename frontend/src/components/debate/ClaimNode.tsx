"use client";

import { memo, useState } from "react";
import { Handle, Position, NodeToolbar } from "@xyflow/react";

export type ClaimNodeData = {
  claimId: string;
  text: string;
  byAgent: "A" | "B";
  type: "assertion" | "evidence" | "assumption" | "counterclaim";
  messageIds: string[];
};

const TYPE_STYLES: Record<string, string> = {
  assertion: "bg-slate-500/20 text-slate-300 border-slate-500/40",
  evidence: "bg-cyan-500/20 text-cyan-400 border-cyan-500/40",
  counterclaim: "bg-rose-500/20 text-rose-400 border-rose-500/40",
  assumption: "bg-amber-500/20 text-amber-400 border-amber-500/40",
};

const AGENT_STYLES = {
  A: "border-l-emerald-500/60 bg-emerald-500/5",
  B: "border-l-rose-500/60 bg-rose-500/5",
};

const PREVIEW_LEN = 48;

function ClaimNode({
  data,
  selected,
}: {
  data: ClaimNodeData;
  selected?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const typeStyle = TYPE_STYLES[data.type] ?? TYPE_STYLES.assertion;
  const agentStyle = AGENT_STYLES[data.byAgent];
  const preview =
    data.text.length <= PREVIEW_LEN
      ? data.text
      : data.text.slice(0, PREVIEW_LEN).trim() + "…";

  return (
    <>
      <NodeToolbar
        position={Position.Top}
        offset={12}
        align="center"
        isVisible={hover || selected}
        className="!rounded-xl !border !border-slate-600 !bg-slate-800/95 !px-4 !py-3 !shadow-xl !backdrop-blur-sm z-50 max-w-sm"
      >
        <div className="text-left">
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${typeStyle}`}
            >
              {data.type}
            </span>
            <span className="text-[10px] text-slate-500">
              Agent {data.byAgent} · {data.claimId}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">
            {data.text}
          </p>
          {data.messageIds?.length > 0 && (
            <p className="mt-2 text-[10px] text-slate-500">
              Messages: {data.messageIds.join(", ")}
            </p>
          )}
        </div>
      </NodeToolbar>

      <div
        className={`rounded-xl border-l-4 px-3 py-2.5 transition-all ${
          selected ? "ring-2 ring-violet-400 ring-offset-2 ring-offset-slate-900" : ""
        } ${agentStyle} border border-slate-600/50 bg-slate-800/80 shadow-lg`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ minWidth: 140, maxWidth: 200 }}
      >
        <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-slate-700 !bg-slate-500" />
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-400">{data.claimId}</span>
            <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${typeStyle}`}>
              {data.type}
            </span>
          </div>
          <p className="text-[11px] leading-snug text-slate-300 line-clamp-2">
            {preview}
          </p>
          <span className="text-[9px] text-slate-500">Agent {data.byAgent}</span>
        </div>
        <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-slate-700 !bg-slate-500" />
      </div>
    </>
  );
}

export default memo(ClaimNode);
