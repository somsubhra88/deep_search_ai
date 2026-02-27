"use client";

import { Lock, Unlock, Shuffle } from "lucide-react";
import {
  PersonaConfig,
  PROFESSIONS,
  ATTITUDES,
  STYLES,
  GENDERS,
} from "./types";

type Props = {
  agentId: "A" | "B";
  stance: "FOR" | "AGAINST";
  persona: PersonaConfig;
  locked: boolean;
  isDark: boolean;
  onChange: (p: PersonaConfig) => void;
  onToggleLock: () => void;
  onRandomize: () => void;
};

export default function PersonaCard({
  agentId,
  stance,
  persona,
  locked,
  isDark,
  onChange,
  onToggleLock,
  onRandomize,
}: Props) {
  const color = stance === "FOR" ? "emerald" : "rose";
  const border = stance === "FOR"
    ? isDark ? "border-emerald-500/40" : "border-emerald-400"
    : isDark ? "border-rose-500/40" : "border-rose-400";
  const badge = stance === "FOR"
    ? "bg-emerald-500/15 text-emerald-400"
    : "bg-rose-500/15 text-rose-400";

  const selectCls = `w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none ${
    isDark
      ? "border-slate-600/60 bg-slate-800/60 text-slate-200"
      : "border-slate-300 bg-white text-slate-800"
  }`;

  return (
    <div className={`rounded-xl border-2 p-4 ${border} ${isDark ? "bg-slate-800/30" : "bg-white/80"}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ${
            stance === "FOR" ? "bg-emerald-500" : "bg-rose-500"
          }`}>
            {agentId}
          </div>
          <div>
            <span className="text-sm font-semibold">Agent {agentId}</span>
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge}`}>
              {stance}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRandomize}
            disabled={locked}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-700/30 disabled:opacity-30"
            title="Randomize persona"
          >
            <Shuffle className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onToggleLock}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-700/30"
            title={locked ? "Unlock persona" : "Lock persona"}
          >
            {locked ? <Lock className="h-3.5 w-3.5 text-amber-400" /> : <Unlock className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Gender</span>
          <select
            value={persona.gender}
            onChange={(e) => onChange({ ...persona, gender: e.target.value as PersonaConfig["gender"] })}
            disabled={locked}
            className={selectCls}
          >
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Profession</span>
          <select
            value={persona.profession}
            onChange={(e) => onChange({ ...persona, profession: e.target.value })}
            disabled={locked}
            className={selectCls}
          >
            <option value="">Select...</option>
            {PROFESSIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Attitude</span>
          <select
            value={persona.attitude}
            onChange={(e) => onChange({ ...persona, attitude: e.target.value })}
            disabled={locked}
            className={selectCls}
          >
            {ATTITUDES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Style</span>
          <select
            value={persona.style}
            onChange={(e) => onChange({ ...persona, style: e.target.value })}
            disabled={locked}
            className={selectCls}
          >
            {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
