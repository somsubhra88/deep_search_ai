"use client";

import { useState, useCallback } from "react";
import { ArrowLeftRight, Shuffle, Play, Settings2, FileSearch, Plus, X } from "lucide-react";
import PersonaCard from "./PersonaCard";
import {
  PersonaConfig,
  AgentProfile,
  DebateConfig,
  PROFESSIONS,
  ATTITUDES,
  STYLES,
  GENDERS,
} from "./types";

type Props = {
  topic: string;
  perspectiveDial: number;
  modelId: string;
  modelName: string;
  isDark: boolean;
  onStart: (payload: {
    topic: string;
    perspective_dial: number;
    model_id: string;
    model_name: string;
    agent_a: AgentProfile;
    agent_b: AgentProfile;
    config: DebateConfig;
  }) => void;
};

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPersona(): PersonaConfig {
  return {
    gender: randomPick(GENDERS),
    profession: randomPick(PROFESSIONS),
    attitude: randomPick(ATTITUDES),
    style: randomPick(STYLES),
  };
}

const DEFAULT_CONFIG: DebateConfig = {
  turn_count: 5,
  cross_exam_enabled: true,
  cross_exam_questions_per_agent: 1,
  max_tokens_per_message: 300,
  max_sentences_per_message: 6,
  no_repetition: true,
  retrieval_enabled: false,
  evidence_urls: [],
};

export default function DebateSettingsPanel({ topic, perspectiveDial, modelId, modelName, isDark, onStart }: Props) {
  const [personaA, setPersonaA] = useState<PersonaConfig>(randomPersona());
  const [personaB, setPersonaB] = useState<PersonaConfig>(randomPersona());
  const [lockedA, setLockedA] = useState(false);
  const [lockedB, setLockedB] = useState(false);
  const [stanceA, setStanceA] = useState<"FOR" | "AGAINST">("FOR");
  const [stanceB, setStanceB] = useState<"FOR" | "AGAINST">("AGAINST");
  const [config, setConfig] = useState<DebateConfig>(DEFAULT_CONFIG);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const swapSides = useCallback(() => {
    setStanceA((s) => (s === "FOR" ? "AGAINST" : "FOR"));
    setStanceB((s) => (s === "FOR" ? "AGAINST" : "FOR"));
  }, []);

  const randomizeBoth = useCallback(() => {
    if (!lockedA) setPersonaA(randomPersona());
    if (!lockedB) setPersonaB(randomPersona());
  }, [lockedA, lockedB]);

  const handleStart = () => {
    const fillBlanks = (p: PersonaConfig): PersonaConfig => ({
      gender: p.gender || randomPick(GENDERS),
      profession: p.profession || randomPick(PROFESSIONS),
      attitude: p.attitude || randomPick(ATTITUDES),
      style: p.style || randomPick(STYLES),
    });
    const finalA = fillBlanks(personaA);
    const finalB = fillBlanks(personaB);
    setPersonaA(finalA);
    setPersonaB(finalB);

    onStart({
      topic,
      perspective_dial: perspectiveDial,
      model_id: modelId,
      model_name: modelName,
      agent_a: { agent_id: "A", stance: stanceA, persona: finalA, randomized: false },
      agent_b: { agent_id: "B", stance: stanceB, persona: finalB, randomized: false },
      config,
    });
  };

  const sliderCls = `w-full h-1.5 rounded-full appearance-none cursor-pointer ${
    isDark ? "bg-slate-700" : "bg-slate-200"
  } accent-emerald-500`;

  return (
    <div className={`rounded-2xl border p-6 ${isDark ? "border-violet-500/30 bg-slate-800/40" : "border-violet-300 bg-violet-50/50"}`}>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold">
        <Settings2 className="h-5 w-5 text-violet-400" /> Debate Settings
      </h2>
      <p className="mb-5 text-xs text-slate-500">Configure personas for Agent A and Agent B, then start the debate.</p>

      {/* Persona cards */}
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <PersonaCard
          agentId="A" stance={stanceA} persona={personaA} locked={lockedA}
          isDark={isDark} onChange={setPersonaA}
          onToggleLock={() => setLockedA((v) => !v)}
          onRandomize={() => !lockedA && setPersonaA(randomPersona())}
        />
        <PersonaCard
          agentId="B" stance={stanceB} persona={personaB} locked={lockedB}
          isDark={isDark} onChange={setPersonaB}
          onToggleLock={() => setLockedB((v) => !v)}
          onRandomize={() => !lockedB && setPersonaB(randomPersona())}
        />
      </div>

      {/* Action buttons */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button onClick={swapSides} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${isDark ? "border-slate-600 text-slate-300 hover:bg-slate-700/50" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}>
          <ArrowLeftRight className="h-3.5 w-3.5" /> Swap Sides
        </button>
        <button onClick={randomizeBoth} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${isDark ? "border-slate-600 text-slate-300 hover:bg-slate-700/50" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}>
          <Shuffle className="h-3.5 w-3.5" /> Randomize Both
        </button>
      </div>

      {/* Turn count + cross-exam */}
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Debate Turns</span>
          <div className="flex items-center gap-2">
            <input type="range" min={2} max={20} step={2} value={config.turn_count}
              onChange={(e) => setConfig((c) => ({ ...c, turn_count: Number(e.target.value) }))}
              className={sliderCls}
            />
            <span className="w-6 text-center text-xs font-bold tabular-nums">{config.turn_count}</span>
          </div>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={config.cross_exam_enabled}
            onChange={(e) => setConfig((c) => ({ ...c, cross_exam_enabled: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-violet-600 focus:ring-violet-500"
          />
          <span className="text-xs text-slate-400">Cross-exam</span>
        </label>
        {config.cross_exam_enabled && (
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Questions/Agent</span>
            <div className="flex items-center gap-2">
              <input type="range" min={1} max={5} value={config.cross_exam_questions_per_agent}
                onChange={(e) => setConfig((c) => ({ ...c, cross_exam_questions_per_agent: Number(e.target.value) }))}
                className={sliderCls}
              />
              <span className="w-6 text-center text-xs font-bold tabular-nums">{config.cross_exam_questions_per_agent}</span>
            </div>
          </label>
        )}
      </div>

      {/* Advanced toggle */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        className="mb-3 text-[11px] font-medium text-violet-400 hover:text-violet-300"
      >
        {showAdvanced ? "Hide advanced settings" : "Show advanced settings"}
      </button>
      {showAdvanced && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Max Sentences</span>
              <input type="number" min={3} max={50} value={config.max_sentences_per_message}
                onChange={(e) => setConfig((c) => ({ ...c, max_sentences_per_message: Number(e.target.value) }))}
                className={`w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none ${isDark ? "border-slate-600/60 bg-slate-800/60 text-slate-200" : "border-slate-300 bg-white text-slate-800"}`}
              />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={config.no_repetition}
                onChange={(e) => setConfig((c) => ({ ...c, no_repetition: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-violet-600"
              />
              <span className="text-xs text-slate-400">No repetition</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={config.retrieval_enabled}
                onChange={(e) => setConfig((c) => ({ ...c, retrieval_enabled: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-violet-600"
              />
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <FileSearch className="h-3 w-3" /> Retrieval Evidence
              </span>
            </label>
          </div>

          {config.retrieval_enabled && (
            <div className={`mb-4 rounded-xl border p-3 ${isDark ? "border-sky-500/20 bg-sky-500/5" : "border-sky-200 bg-sky-50/50"}`}>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                Evidence URLs (optional — leave empty to auto-search)
              </p>
              {config.evidence_urls.map((url, i) => (
                <div key={i} className="mb-1.5 flex items-center gap-1.5">
                  <input
                    type="url"
                    value={url}
                    placeholder="https://..."
                    onChange={(e) => {
                      const urls = [...config.evidence_urls];
                      urls[i] = e.target.value;
                      setConfig((c) => ({ ...c, evidence_urls: urls }));
                    }}
                    className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs outline-none ${isDark ? "border-slate-600/60 bg-slate-800/60 text-slate-200 placeholder:text-slate-600" : "border-slate-300 bg-white text-slate-800 placeholder:text-slate-400"}`}
                  />
                  <button
                    onClick={() => setConfig((c) => ({ ...c, evidence_urls: c.evidence_urls.filter((_, j) => j !== i) }))}
                    className="rounded p-1 text-red-400 hover:bg-red-500/10"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {config.evidence_urls.length < 10 && (
                <button
                  onClick={() => setConfig((c) => ({ ...c, evidence_urls: [...c.evidence_urls, ""] }))}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-medium ${isDark ? "text-sky-400 hover:bg-sky-500/10" : "text-sky-600 hover:bg-sky-100"}`}
                >
                  <Plus className="h-3 w-3" /> Add URL
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Start button */}
      <button
        onClick={handleStart}
        disabled={!topic.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:from-violet-500 hover:to-purple-500 disabled:opacity-40"
      >
        <Play className="h-4 w-4" /> Start Debate
      </button>
    </div>
  );
}
