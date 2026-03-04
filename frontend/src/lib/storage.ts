export const HISTORY_KEY = "deep-search-history";
export const MAX_HISTORY = 20;
export const THEME_KEY = "deep-search-theme";
export const SESSIONS_KEY = "deep-search-sessions";
export const MAX_SESSIONS = 50;
export const SETUP_KEY = "deep-search-setup";
export const RESEARCH_HISTORY_KEY = "deep-search-research-history";
export const MAX_RESEARCH_HISTORY = 50;
export const BRIDGE_PINNED_KEY = "deep-search-bridge-pinned";
export const EXPLAIN_MODE_KEY = "deep-search-explain-mode";
export const ACTIVE_REPORT_KEY = "deep-search-active-report";
export const ACTIVE_CHAT_KEY = "deep-search-active-chat";
export const MAX_PERSISTED_MESSAGES = 100;

export const MANUAL_LINKS_KEY = "deep-search-manual-links";

export type ManualLink = {
  sourceId: string;
  targetId: string;
  sourceQuery: string;
  targetQuery: string;
  createdAt: number;
};

export function loadManualLinks(): ManualLink[] {
  return loadFromStorage<ManualLink[]>(MANUAL_LINKS_KEY, []);
}

export function saveManualLink(link: ManualLink) {
  const existing = loadManualLinks();
  const key = [link.sourceId, link.targetId].sort().join("||");
  const deduped = existing.filter((l) => {
    const k = [l.sourceId, l.targetId].sort().join("||");
    return k !== key;
  });
  deduped.push(link);
  compressAndStore(MANUAL_LINKS_KEY, deduped);
}

export function removeManualLink(sourceId: string, targetId: string) {
  const existing = loadManualLinks();
  const key = [sourceId, targetId].sort().join("||");
  const filtered = existing.filter((l) => {
    const k = [l.sourceId, l.targetId].sort().join("||");
    return k !== key;
  });
  compressAndStore(MANUAL_LINKS_KEY, filtered);
}

export type ActiveReport = {
  query: string;
  report: string;
  metadata: Record<string, unknown> | null;
  searchId: string | null;
  essenceText: string | null;
  recalledMemories: Array<{ query: string; essence: string; timestamp: string; similarity: number }>;
  explain: Record<string, unknown> | null;
  bridgeSuggestions: unknown[];
};

export function saveActiveReport(data: ActiveReport) {
  try {
    sessionStorage.setItem(ACTIVE_REPORT_KEY, JSON.stringify(data));
  } catch { /* quota */ }
}

export function loadActiveReport(): ActiveReport | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_REPORT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveReport;
  } catch {
    return null;
  }
}

export function clearActiveReport() {
  try {
    sessionStorage.removeItem(ACTIVE_REPORT_KEY);
  } catch { /* ignore */ }
}

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

export type ActiveChat = {
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    skill?: string;
    action?: { type: string; label: string };
    explain?: Record<string, unknown> | null;
  }>;
  activePersonaId: string | null;
};

export function saveActiveChat(data: ActiveChat) {
  try {
    const trimmed = {
      ...data,
      messages: data.messages.slice(-MAX_PERSISTED_MESSAGES),
    };
    sessionStorage.setItem(ACTIVE_CHAT_KEY, JSON.stringify(trimmed));
  } catch { /* quota */ }
}

export function loadActiveChat(): ActiveChat | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_CHAT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveChat;
  } catch {
    return null;
  }
}

export function clearActiveChat() {
  try {
    sessionStorage.removeItem(ACTIVE_CHAT_KEY);
  } catch { /* ignore */ }
}

export function clearAllSearchHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(SESSIONS_KEY);
    localStorage.removeItem(RESEARCH_HISTORY_KEY);
  } catch { /* graceful fail */ }
}
