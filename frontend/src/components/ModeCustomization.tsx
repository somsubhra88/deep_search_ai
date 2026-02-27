"use client";

import { GraduationCap, Waypoints, SearchCheck, Layers, Clock } from "lucide-react";

// ---------------------------------------------------------------------------
// Site / platform catalogs
// ---------------------------------------------------------------------------

export const ACADEMIC_SITES = [
  { id: "arxiv", label: "arXiv", domain: "arxiv.org" },
  { id: "scholar", label: "Google Scholar", domain: "scholar.google.com" },
  { id: "pubmed", label: "PubMed", domain: "pubmed.ncbi.nlm.nih.gov" },
  { id: "ieee", label: "IEEE Xplore", domain: "ieeexplore.ieee.org" },
  { id: "nature", label: "Nature", domain: "nature.com" },
  { id: "science", label: "Science (AAAS)", domain: "science.org" },
  { id: "springer", label: "SpringerLink", domain: "link.springer.com" },
  { id: "jstor", label: "JSTOR", domain: "jstor.org" },
  { id: "ssrn", label: "SSRN", domain: "ssrn.com" },
  { id: "semanticscholar", label: "Semantic Scholar", domain: "semanticscholar.org" },
];

export const SOCIAL_PLATFORMS = [
  { id: "twitter", label: "X / Twitter", domain: "twitter.com" },
  { id: "reddit", label: "Reddit", domain: "reddit.com" },
  { id: "linkedin", label: "LinkedIn", domain: "linkedin.com" },
  { id: "facebook", label: "Facebook", domain: "facebook.com" },
  { id: "instagram", label: "Instagram", domain: "instagram.com" },
  { id: "youtube", label: "YouTube", domain: "youtube.com" },
  { id: "tiktok", label: "TikTok", domain: "tiktok.com" },
  { id: "mastodon", label: "Mastodon", domain: "mastodon.social" },
];

export const FACTCHECK_SITES = [
  { id: "snopes", label: "Snopes", domain: "snopes.com" },
  { id: "politifact", label: "PolitiFact", domain: "politifact.com" },
  { id: "factcheck", label: "FactCheck.org", domain: "factcheck.org" },
  { id: "reuters", label: "Reuters Fact Check", domain: "reuters.com" },
  { id: "apnews", label: "AP News", domain: "apnews.com" },
  { id: "bbc", label: "BBC News", domain: "bbc.com" },
  { id: "nytimes", label: "NY Times", domain: "nytimes.com" },
  { id: "washpost", label: "Washington Post", domain: "washingtonpost.com" },
  { id: "guardian", label: "The Guardian", domain: "theguardian.com" },
  { id: "fullfact", label: "Full Fact", domain: "fullfact.org" },
];

export const TIMELINE_RANGES = [
  { id: "1y", label: "Last year" },
  { id: "5y", label: "Last 5 years" },
  { id: "10y", label: "Last decade" },
  { id: "all", label: "All time" },
];

export const TIMELINE_FOCUS = [
  { id: "technology", label: "Technology" },
  { id: "politics", label: "Politics" },
  { id: "science", label: "Science" },
  { id: "business", label: "Business" },
  { id: "culture", label: "Culture" },
  { id: "health", label: "Health" },
  { id: "environment", label: "Environment" },
  { id: "general", label: "General" },
];

export const DEEP_DIVE_DEPTH = [
  { id: "moderate", label: "Moderate" },
  { id: "thorough", label: "Thorough" },
  { id: "exhaustive", label: "Exhaustive" },
];

// ---------------------------------------------------------------------------
// Mode settings type (sent to backend)
// ---------------------------------------------------------------------------

export type ModeSettings = {
  academic_sites: string[];
  social_platforms: string[];
  factcheck_sites: string[];
  timeline_range: string;
  timeline_focus: string[];
  deep_dive_depth: string;
  deep_dive_include_technical: boolean;
  deep_dive_max_sources: number;
};

export const DEFAULT_MODE_SETTINGS: ModeSettings = {
  academic_sites: ACADEMIC_SITES.map((s) => s.id),
  social_platforms: SOCIAL_PLATFORMS.map((s) => s.id),
  factcheck_sites: FACTCHECK_SITES.map((s) => s.id),
  timeline_range: "all",
  timeline_focus: ["general"],
  deep_dive_depth: "thorough",
  deep_dive_include_technical: true,
  deep_dive_max_sources: 20,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Props = {
  selectedModes: Set<string>;
  settings: ModeSettings;
  onChange: (s: ModeSettings) => void;
  isDark: boolean;
  disabled: boolean;
};

function ChipGrid({
  items,
  selected,
  onToggle,
  isDark,
  disabled,
  accentColor,
}: {
  items: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  isDark: boolean;
  disabled: boolean;
  accentColor: string;
}) {
  const allSelected = selected.length === items.length;
  const toggleAll = () => {
    if (allSelected) return;
    onToggle("__ALL__");
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={toggleAll}
        disabled={disabled}
        className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
          allSelected
            ? `border-${accentColor}-500/40 bg-${accentColor}-500/15 text-${accentColor}-400`
            : isDark
            ? "border-slate-600/50 text-slate-400 hover:border-slate-500"
            : "border-slate-300 text-slate-600 hover:border-slate-400"
        }`}
      >
        All
      </button>
      {items.map((item) => {
        const active = selected.includes(item.id);
        return (
          <button
            key={item.id}
            onClick={() => onToggle(item.id)}
            disabled={disabled}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
              active
                ? `border-${accentColor}-500/40 bg-${accentColor}-500/15 text-${accentColor}-400`
                : isDark
                ? "border-slate-700/50 text-slate-500 hover:border-slate-600 hover:text-slate-400"
                : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-600"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default function ModeCustomization({ selectedModes, settings, onChange, isDark, disabled }: Props) {
  const showAcademic = selectedModes.has("academic");
  const showSocial = selectedModes.has("social_media");
  const showFactCheck = selectedModes.has("fact_check");
  const showTimeline = selectedModes.has("timeline");
  const showDeepDive = selectedModes.has("deep_dive");

  if (!showAcademic && !showSocial && !showFactCheck && !showTimeline && !showDeepDive) {
    return null;
  }

  const toggleSite = (
    key: keyof Pick<ModeSettings, "academic_sites" | "social_platforms" | "factcheck_sites">,
    allItems: { id: string }[],
    id: string,
  ) => {
    if (id === "__ALL__") {
      onChange({ ...settings, [key]: allItems.map((s) => s.id) });
      return;
    }
    const current = settings[key] as string[];
    const next = current.includes(id) ? current.filter((s) => s !== id) : [...current, id];
    onChange({ ...settings, [key]: next.length > 0 ? next : allItems.map((s) => s.id) });
  };

  const sectionCls = `border-t px-6 py-4 ${isDark ? "border-slate-700/30" : "border-slate-200/60"}`;
  const headingCls = "mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider";

  return (
    <div>
      {/* Academic */}
      {showAcademic && (
        <div className={sectionCls}>
          <div className={`${headingCls} text-blue-400`}>
            <GraduationCap className="h-3.5 w-3.5" /> Academic Sources
            <span className="font-normal normal-case text-slate-500 ml-1">
              ({settings.academic_sites.length === ACADEMIC_SITES.length ? "all" : settings.academic_sites.length})
            </span>
          </div>
          <ChipGrid
            items={ACADEMIC_SITES}
            selected={settings.academic_sites}
            onToggle={(id) => toggleSite("academic_sites", ACADEMIC_SITES, id)}
            isDark={isDark}
            disabled={disabled}
            accentColor="blue"
          />
        </div>
      )}

      {/* Social Media */}
      {showSocial && (
        <div className={sectionCls}>
          <div className={`${headingCls} text-pink-400`}>
            <Waypoints className="h-3.5 w-3.5" /> Social Platforms
            <span className="font-normal normal-case text-slate-500 ml-1">
              ({settings.social_platforms.length === SOCIAL_PLATFORMS.length ? "all" : settings.social_platforms.length})
            </span>
          </div>
          <ChipGrid
            items={SOCIAL_PLATFORMS}
            selected={settings.social_platforms}
            onToggle={(id) => toggleSite("social_platforms", SOCIAL_PLATFORMS, id)}
            isDark={isDark}
            disabled={disabled}
            accentColor="pink"
          />
        </div>
      )}

      {/* Fact Check */}
      {showFactCheck && (
        <div className={sectionCls}>
          <div className={`${headingCls} text-amber-400`}>
            <SearchCheck className="h-3.5 w-3.5" /> Fact-Check & News Sources
            <span className="font-normal normal-case text-slate-500 ml-1">
              ({settings.factcheck_sites.length === FACTCHECK_SITES.length ? "all" : settings.factcheck_sites.length})
            </span>
          </div>
          <ChipGrid
            items={FACTCHECK_SITES}
            selected={settings.factcheck_sites}
            onToggle={(id) => toggleSite("factcheck_sites", FACTCHECK_SITES, id)}
            isDark={isDark}
            disabled={disabled}
            accentColor="amber"
          />
        </div>
      )}

      {/* Timeline */}
      {showTimeline && (
        <div className={sectionCls}>
          <div className={`${headingCls} text-cyan-400`}>
            <Clock className="h-3.5 w-3.5" /> Timeline Options
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-slate-500">Time Range</span>
              <div className="flex flex-wrap gap-1.5">
                {TIMELINE_RANGES.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onChange({ ...settings, timeline_range: r.id })}
                    disabled={disabled}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                      settings.timeline_range === r.id
                        ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-400"
                        : isDark ? "border-slate-700/50 text-slate-500 hover:border-slate-600" : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-slate-500">Focus Area</span>
              <div className="flex flex-wrap gap-1.5">
                {TIMELINE_FOCUS.map((f) => {
                  const active = settings.timeline_focus.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() => {
                        const next = active
                          ? settings.timeline_focus.filter((x) => x !== f.id)
                          : [...settings.timeline_focus, f.id];
                        onChange({ ...settings, timeline_focus: next.length > 0 ? next : ["general"] });
                      }}
                      disabled={disabled}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                        active
                          ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-400"
                          : isDark ? "border-slate-700/50 text-slate-500 hover:border-slate-600" : "border-slate-200 text-slate-500 hover:border-slate-300"
                      }`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deep Dive */}
      {showDeepDive && (
        <div className={sectionCls}>
          <div className={`${headingCls} text-violet-400`}>
            <Layers className="h-3.5 w-3.5" /> Deep Dive Options
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-slate-500">Depth Level</span>
              <div className="flex flex-wrap gap-1.5">
                {DEEP_DIVE_DEPTH.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => onChange({ ...settings, deep_dive_depth: d.id })}
                    disabled={disabled}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                      settings.deep_dive_depth === d.id
                        ? "border-violet-500/40 bg-violet-500/15 text-violet-400"
                        : isDark ? "border-slate-700/50 text-slate-500 hover:border-slate-600" : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                Max Sources: {settings.deep_dive_max_sources}
              </span>
              <input
                type="range"
                min={10}
                max={30}
                step={5}
                value={settings.deep_dive_max_sources}
                onChange={(e) => onChange({ ...settings, deep_dive_max_sources: Number(e.target.value) })}
                disabled={disabled}
                className={`w-full h-1.5 rounded-full appearance-none cursor-pointer ${isDark ? "bg-slate-700" : "bg-slate-200"} accent-violet-500`}
              />
            </div>
            <label className="flex items-center gap-2 self-end pb-1">
              <input
                type="checkbox"
                checked={settings.deep_dive_include_technical}
                onChange={(e) => onChange({ ...settings, deep_dive_include_technical: e.target.checked })}
                disabled={disabled}
                className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-violet-600 focus:ring-violet-500"
              />
              <span className="text-xs text-slate-400">Include technical papers</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
