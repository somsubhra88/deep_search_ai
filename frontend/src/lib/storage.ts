export const HISTORY_KEY = "deep-search-history";
export const MAX_HISTORY = 20;
export const THEME_KEY = "deep-search-theme";
export const SESSIONS_KEY = "deep-search-sessions";
export const MAX_SESSIONS = 10;
export const SETUP_KEY = "deep-search-setup";
export const RESEARCH_HISTORY_KEY = "deep-search-research-history";
export const MAX_RESEARCH_HISTORY = 50;

export type Session = {
  id: string;
  query: string;
  timestamp: number;
  report: string;
  metadata: {
    model_used?: string;
    modes_used?: string[];
    sources?: Array<{ id: number; title: string; url: string; domain: string; type: string }>;
    self_reflection?: { quality_score?: number };
    essence_text?: string;
    [key: string]: unknown;
  } | null;
};

export type ResearchHistoryEntry = {
  id: string;
  query: string;
  createdAt: number;
  modes: string[];
  provider: string;
  model: string;
};

export function compressAndStore(key: string, data: unknown) {
  try {
    const json = JSON.stringify(data);
    if (json.length > 4 * 1024 * 1024) {
      const trimmed = Array.isArray(data) ? data.slice(-MAX_SESSIONS) : data;
      localStorage.setItem(key, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(key, json);
    }
  } catch {
    try {
      localStorage.removeItem(key);
    } catch { /* quota exceeded, graceful fail */ }
  }
}

export function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function addResearchHistoryEntry(entry: Omit<ResearchHistoryEntry, "id" | "createdAt">) {
  const existing = loadFromStorage<ResearchHistoryEntry[]>(RESEARCH_HISTORY_KEY, []);
  const newEntry: ResearchHistoryEntry = {
    ...entry,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: Date.now(),
  };
  const deduped = [newEntry, ...existing.filter((e) => e.query !== entry.query)].slice(0, MAX_RESEARCH_HISTORY);
  compressAndStore(RESEARCH_HISTORY_KEY, deduped);
  return deduped;
}

export function clearAllSearchHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(SESSIONS_KEY);
    localStorage.removeItem(RESEARCH_HISTORY_KEY);
  } catch { /* graceful fail */ }
}
