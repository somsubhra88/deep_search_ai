"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Send,
  Brain,
  Clock,
  X,
  Trash2,
  Mail,
  FolderOpen,
  CalendarDays,
  ListTodo,
  Search,
  Plus,
  CheckCircle2,
  Circle,
  Link2,
  Link2Off,
  ChevronRight,
  Inbox,
  CalendarClock,
  FolderSync,
  Zap,
  AlertCircle,
  FolderSearch,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "@/context/ThemeContext";
import {
  loadFromStorage,
  compressAndStore,
  clearAllSearchHistory,
  SESSIONS_KEY,
} from "@/lib/storage";
import ClearHistoryModal from "@/components/ClearHistoryModal";

const GMAIL_TOKENS_KEY = "deep-search-gmail-tokens";
const GCAL_TOKENS_KEY = "deep-search-gcal-tokens";

type GmailTokens = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
};

type GCalTokens = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SkillId = "email" | "files" | "calendar" | "tasks" | "research" | "actions";

type SkillConfig = {
  id: SkillId;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  gradient: string;
  connected: boolean;
  provider?: string;
  quickActions: { label: string; prompt: string; action?: string }[];
};

type TaskItem = {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
};

type CalendarEvent = {
  id: string;
  title: string;
  date: string;       // ISO date string (YYYY-MM-DD)
  time?: string;       // HH:MM
  duration?: number;   // minutes
  notes?: string;
  createdAt: number;
};

type ScannedFile = {
  name: string;
  path: string;
  size: number;
  type: string;
  lastModified: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  skill?: SkillId;
  action?: { type: string; label: string };
};

type Session = {
  id: string;
  query: string;
  timestamp: number;
  report: string;
  metadata: {
    model_used?: string;
    modes_used?: string[];
    essence_text?: string;
    [key: string]: unknown;
  } | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TASKS_KEY = "deep-search-assistant-tasks";
const EVENTS_KEY = "deep-search-assistant-events";
const SKILLS_KEY = "deep-search-assistant-skills";

type SkillConnectionState = Partial<Record<SkillId, { connected: boolean; provider?: string }>>;

const SKILL_DEFINITIONS: Record<SkillId, Omit<SkillConfig, "connected" | "provider">> = {
  tasks: {
    id: "tasks",
    label: "Notes & Tasks",
    description: "Track to-dos, jot quick notes & manage lists",
    icon: <ListTodo className="h-5 w-5" />,
    color: "text-violet-400",
    gradient: "from-violet-500 to-purple-500",
    quickActions: [
      { label: "Add a task", prompt: "Add task: " },
      { label: "Show my tasks", prompt: "Show all my pending tasks." },
      { label: "What's next?", prompt: "What should I work on next based on my task list?" },
      { label: "Clear completed", prompt: "Clear all completed tasks." },
    ],
  },
  email: {
    id: "email",
    label: "Email",
    description: "Summarise, clean, draft & triage your inbox",
    icon: <Mail className="h-5 w-5" />,
    color: "text-blue-400",
    gradient: "from-blue-500 to-indigo-500",
    quickActions: [
      { label: "Summarise unread", prompt: "Summarise my unread emails and highlight anything urgent." },
      { label: "Clean inbox", prompt: "Identify newsletters and low-priority emails I can archive." },
      { label: "Draft a reply", prompt: "Help me draft a professional reply to the latest email." },
      { label: "Find email", prompt: "Search my inbox for emails about " },
    ],
  },
  calendar: {
    id: "calendar",
    label: "Calendar",
    description: "Google Calendar — schedule events & view agenda",
    icon: <CalendarDays className="h-5 w-5" />,
    color: "text-amber-400",
    gradient: "from-amber-500 to-orange-500",
    quickActions: [
      { label: "Today's agenda", prompt: "Show me my agenda for today." },
      { label: "This week", prompt: "Give me a summary of my schedule this week." },
      { label: "Add event", prompt: "Add event: " },
      { label: "Free slots", prompt: "Find my free time slots for today." },
    ],
  },
  files: {
    id: "files",
    label: "Files & Folders",
    description: "Scan, organise, clean & manage local files",
    icon: <FolderOpen className="h-5 w-5" />,
    color: "text-emerald-400",
    gradient: "from-emerald-500 to-teal-500",
    quickActions: [
      { label: "Scan a folder", prompt: "Scan folder", action: "scan_folder" },
      { label: "List CSV files", prompt: "Please list down the CSV files." },
      { label: "Organise into folders", prompt: "Organise my files into categorised subfolders." },
      { label: "Remove large files", prompt: "Remove large files from my scanned folder." },
      { label: "Remove duplicates", prompt: "Remove duplicate files." },
      { label: "Archive old files", prompt: "Archive old stale files." },
    ],
  },
  research: {
    id: "research",
    label: "Research",
    description: "Query past searches & synthesise findings",
    icon: <Search className="h-5 w-5" />,
    color: "text-cyan-400",
    gradient: "from-cyan-500 to-blue-500",
    quickActions: [
      { label: "Summarise research", prompt: "Summarise my most recent research sessions." },
      { label: "Key findings", prompt: "What were the key findings across my recent searches?" },
      { label: "Compare topics", prompt: "Compare and contrast the topics I've recently researched." },
      { label: "Knowledge gaps", prompt: "What knowledge gaps exist in my research so far?" },
    ],
  },
  actions: {
    id: "actions",
    label: "Actions",
    description: "Take real actions: files, notes, clipboard, shell",
    icon: <Zap className="h-5 w-5" />,
    color: "text-amber-400",
    gradient: "from-amber-500 to-orange-500",
    quickActions: [
      { label: "List my files", prompt: "List files in my home directory." },
      { label: "Read a file", prompt: "Read the file " },
      { label: "Create a note", prompt: "Create a note titled " },
      { label: "Search notes", prompt: "Search my notes for " },
      { label: "Copy to clipboard", prompt: "Copy to clipboard: " },
    ],
  },
};

const SKILL_ORDER: SkillId[] = ["actions", "tasks", "email", "calendar", "files", "research"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function getExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "unknown";
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseEventInput(text: string): Partial<CalendarEvent> | null {
  const cleaned = text.replace(/^add event:?\s*/i, "").trim();
  if (!cleaned) return null;

  let date = todayStr();
  let time: string | undefined;
  let title = cleaned;

  const tmrw = /\btomorrow\b/i;
  const todayMatch = /\btoday\b/i;
  const dateMatch = /\b(\d{4}-\d{2}-\d{2})\b/;
  const timeMatch = /\bat\s+(\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)\b/i;

  if (tmrw.test(title)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    date = d.toISOString().slice(0, 10);
    title = title.replace(tmrw, "").trim();
  } else if (dateMatch.test(title)) {
    date = title.match(dateMatch)![1];
    title = title.replace(dateMatch, "").trim();
  } else if (todayMatch.test(title)) {
    title = title.replace(todayMatch, "").trim();
  }

  if (timeMatch.test(title)) {
    const raw = title.match(timeMatch)![1];
    title = title.replace(timeMatch, "").trim();
    const parts = raw.replace(/\s*(am|pm)/i, (_, m) => m).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (parts) {
      let h = parseInt(parts[1]);
      const m = parts[2] ? parseInt(parts[2]) : 0;
      const ampm = parts[3]?.toLowerCase();
      if (ampm === "pm" && h < 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
      time = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    }
  }

  title = title.replace(/^[-–—,\s]+|[-–—,\s]+$/g, "").trim();
  if (!title) return null;
  return { title, date, time };
}

const FILE_CATEGORIES: Record<string, { label: string; extensions: string[] }> = {
  images: { label: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "tiff"] },
  documents: { label: "Documents", extensions: ["pdf", "doc", "docx", "txt", "rtf", "odt", "pages", "md", "tex"] },
  spreadsheets: { label: "Spreadsheets", extensions: ["xls", "xlsx", "csv", "tsv", "ods", "numbers"] },
  presentations: { label: "Presentations", extensions: ["ppt", "pptx", "key", "odp"] },
  code: { label: "Code", extensions: ["js", "ts", "tsx", "jsx", "py", "java", "cpp", "c", "h", "go", "rs", "rb", "php", "html", "css", "scss", "json", "xml", "yaml", "yml", "toml", "sql", "sh", "bash"] },
  archives: { label: "Archives", extensions: ["zip", "tar", "gz", "rar", "7z", "bz2", "xz", "dmg", "iso"] },
  audio: { label: "Audio", extensions: ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"] },
  video: { label: "Video", extensions: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v"] },
  installers: { label: "Installers", extensions: ["exe", "msi", "deb", "rpm", "app", "pkg"] },
};

function categoriseFile(name: string): string {
  const ext = getExt(name);
  for (const [cat, { extensions }] of Object.entries(FILE_CATEGORIES)) {
    if (extensions.includes(ext)) return cat;
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function AssistantPage() {
  const { isDark } = useTheme();

  const [activeSkill, setActiveSkill] = useState<SkillId>("tasks");
  const [skillConnections, setSkillConnections] = useState<SkillConnectionState>({});
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([]);
  const [scannedFolderName, setScannedFolderName] = useState<string>("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [skillPanelOpen, setSkillPanelOpen] = useState(true);
  const [showConnectModal, setShowConnectModal] = useState<SkillId | null>(null);
  const [gmailTokens, setGmailTokens] = useState<GmailTokens | null>(null);
  const [gcalTokens, setGcalTokens] = useState<GCalTokens | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{
    approvalId: string;
    tool: string;
    runId: string;
    summary: string;
  } | null>(null);
  const [executorAvailable, setExecutorAvailable] = useState<boolean | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const pendingFolderResolve = useRef<((files: ScannedFile[]) => void) | null>(null);

  // --- Check executor status ---
  useEffect(() => {
    fetch("/api/assistant/status")
      .then((r) => r.json())
      .then((d) => setExecutorAvailable(d.executor_available ?? false))
      .catch(() => setExecutorAvailable(false));
  }, []);

  // --- Load persisted state ---
  useEffect(() => {
    setTasks(loadFromStorage<TaskItem[]>(TASKS_KEY, []));
    setEvents(loadFromStorage<CalendarEvent[]>(EVENTS_KEY, []));
    setSessions(loadFromStorage<Session[]>(SESSIONS_KEY, []));
    setSkillConnections(loadFromStorage<SkillConnectionState>(SKILLS_KEY, {}));
    const storedTokens = loadFromStorage<GmailTokens | null>(GMAIL_TOKENS_KEY, null);
    if (storedTokens?.access_token) {
      setGmailTokens(storedTokens);
    }
    const storedGcalTokens = loadFromStorage<GCalTokens | null>(GCAL_TOKENS_KEY, null);
    if (storedGcalTokens?.access_token) {
      setGcalTokens(storedGcalTokens);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // --- Persist helpers ---
  const persistTasks = useCallback((next: TaskItem[]) => {
    setTasks(next);
    compressAndStore(TASKS_KEY, next);
  }, []);

  const persistEvents = useCallback((next: CalendarEvent[]) => {
    setEvents(next);
    compressAndStore(EVENTS_KEY, next);
  }, []);

  // --- Task CRUD ---
  const addTask = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const item: TaskItem = { id: genId(), text: trimmed, done: false, createdAt: Date.now() };
    const next = [item, ...tasks];
    persistTasks(next);
    toast.success("Task added");
    return item;
  }, [tasks, persistTasks]);

  const toggleTask = useCallback((id: string) => {
    persistTasks(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }, [tasks, persistTasks]);

  const deleteTask = useCallback((id: string) => {
    persistTasks(tasks.filter((t) => t.id !== id));
  }, [tasks, persistTasks]);

  const clearCompletedTasks = useCallback(() => {
    const kept = tasks.filter((t) => !t.done);
    const count = tasks.length - kept.length;
    persistTasks(kept);
    if (count > 0) toast.success(`Cleared ${count} completed task(s)`);
    return count;
  }, [tasks, persistTasks]);

  // --- Calendar CRUD ---
  const addEvent = useCallback((ev: Partial<CalendarEvent>) => {
    if (!ev.title) return null;
    const item: CalendarEvent = {
      id: genId(),
      title: ev.title,
      date: ev.date || todayStr(),
      time: ev.time,
      duration: ev.duration || 60,
      notes: ev.notes,
      createdAt: Date.now(),
    };
    const next = [...events, item].sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      return (a.time || "00:00").localeCompare(b.time || "00:00");
    });
    persistEvents(next);
    toast.success("Event added");
    return item;
  }, [events, persistEvents]);

  const deleteEvent = useCallback((id: string) => {
    persistEvents(events.filter((e) => e.id !== id));
    toast.success("Event removed");
  }, [events, persistEvents]);

  // --- File scanning ---
  const handleFolderSelected = useCallback((fileList: FileList) => {
    const files: ScannedFile[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      files.push({
        name: f.name,
        path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
        size: f.size,
        type: f.type || "unknown",
        lastModified: f.lastModified,
      });
    }
    setScannedFiles(files);

    const paths = files.map((f) => f.path);
    const folder = paths.length > 0 ? paths[0].split("/")[0] : "Selected folder";
    setScannedFolderName(folder);

    if (pendingFolderResolve.current) {
      pendingFolderResolve.current(files);
      pendingFolderResolve.current = null;
    }
    toast.success(`Scanned ${files.length} file(s) from "${folder}"`);
  }, []);

  const triggerFolderScan = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  // --- Analyse scanned files ---
  const analyseFiles = useCallback((files: ScannedFile[]): string => {
    if (files.length === 0) return "No files scanned yet. Use **\"Scan a folder\"** in the sidebar to select a folder first.";

    const totalSize = files.reduce((s, f) => s + f.size, 0);
    const byCategory: Record<string, ScannedFile[]> = {};
    files.forEach((f) => {
      const cat = categoriseFile(f.name);
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(f);
    });

    const byExt: Record<string, number> = {};
    files.forEach((f) => {
      const ext = getExt(f.name);
      byExt[ext] = (byExt[ext] || 0) + 1;
    });

    const sorted = Object.entries(byCategory).sort((a, b) => b[1].length - a[1].length);

    let report = `**Folder: "${scannedFolderName}"** — ${files.length} files, ${formatBytes(totalSize)} total\n\n`;
    report += `**Breakdown by category:**\n`;
    sorted.forEach(([cat, catFiles]) => {
      const catSize = catFiles.reduce((s, f) => s + f.size, 0);
      const label = FILE_CATEGORIES[cat]?.label || "Other";
      report += `- **${label}**: ${catFiles.length} file(s), ${formatBytes(catSize)}\n`;
    });

    report += `\n**Organisation suggestions:**\n`;
    sorted.forEach(([cat, catFiles]) => {
      if (cat !== "other" && catFiles.length >= 2) {
        const label = FILE_CATEGORIES[cat]?.label || cat;
        report += `- Move ${catFiles.length} ${label.toLowerCase()} files into a \`${label}/\` subfolder\n`;
      }
    });

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const oldFiles = files.filter((f) => f.lastModified < thirtyDaysAgo);
    if (oldFiles.length > 0) {
      report += `- ${oldFiles.length} file(s) haven't been modified in 30+ days — consider archiving\n`;
    }

    const large = [...files].sort((a, b) => b.size - a.size).slice(0, 5);
    if (large.length > 0 && large[0].size > 10 * 1024 * 1024) {
      report += `\n**Largest files:**\n`;
      large.forEach((f) => {
        report += `- \`${f.name}\` — ${formatBytes(f.size)}\n`;
      });
    }

    const nameCount: Record<string, number> = {};
    files.forEach((f) => { nameCount[f.name] = (nameCount[f.name] || 0) + 1; });
    const dupes = Object.entries(nameCount).filter(([, c]) => c > 1);
    if (dupes.length > 0) {
      report += `\n**Possible duplicates (same filename):**\n`;
      dupes.slice(0, 10).forEach(([name, count]) => {
        report += `- \`${name}\` appears ${count} times\n`;
      });
    }

    return report;
  }, [scannedFolderName]);

  // --- Clear all ---
  const handleClearHistory = useCallback(() => {
    clearAllSearchHistory();
    setSessions([]);
    persistTasks([]);
    persistEvents([]);
    setScannedFiles([]);
    setScannedFolderName("");
    setMessages([]);
    setGmailTokens(null);
    setGcalTokens(null);
    try { localStorage.removeItem(GMAIL_TOKENS_KEY); } catch { /* ok */ }
    try { localStorage.removeItem(GCAL_TOKENS_KEY); } catch { /* ok */ }
    setShowClearModal(false);
    toast.success("All data cleared");
  }, [persistTasks, persistEvents]);

  // --- Email API caller ---
  const callEmailApi = useCallback(async (action: string, query?: string) => {
    if (!gmailTokens?.access_token) throw new Error("Gmail not connected. Please connect Gmail first.");
    const res = await fetch("/api/assistant/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        access_token: gmailTokens.access_token,
        refresh_token: gmailTokens.refresh_token,
        query,
      }),
    });
    const data = await res.json();
    if (data.new_token) {
      const updated = { ...gmailTokens, access_token: data.new_token };
      setGmailTokens(updated);
      compressAndStore(GMAIL_TOKENS_KEY, updated);
    }
    if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
    return data;
  }, [gmailTokens]);

  const startGmailOAuth = useCallback(async () => {
    setShowConnectModal(null);
    setActiveSkill("email");

    try {
      const res = await fetch("/api/assistant/email/auth");
      const data = await res.json();

      if (data.error) {
        const setupSteps = Array.isArray(data.setup) ? (data.setup as string[]) : [];
        const guide = setupSteps.length > 0
          ? setupSteps.join("\n")
          : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file, then restart.";

        const setupMsg: ChatMessage = {
          id: genId(), role: "assistant",
          content: `**Gmail Setup Required**\n\nTo connect Gmail, you need to configure Google OAuth credentials:\n\n${guide}\n\nThis is a one-time setup. Once done, click **"Connect Email"** in the sidebar to sign in.`,
          timestamp: Date.now(), skill: "email",
        };
        setMessages((prev) => [...prev, setupMsg]);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      const errorMsg: ChatMessage = {
        id: genId(), role: "assistant",
        content: `**Could not reach the email auth endpoint.**\n\nMake sure the dev server is running and try again. If running in Docker, ensure the frontend container can reach the API.`,
        timestamp: Date.now(), skill: "email",
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  }, []);

  // --- Google Calendar API caller ---
  const callCalendarApi = useCallback(async (action: string, eventData?: { title: string; date: string; time?: string; duration?: number; description?: string }, query?: string) => {
    if (!gcalTokens?.access_token) throw new Error("Google Calendar not connected. Please connect Google Calendar first.");
    const res = await fetch("/api/assistant/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        access_token: gcalTokens.access_token,
        refresh_token: gcalTokens.refresh_token,
        event_data: eventData,
        query,
      }),
    });
    const data = await res.json();
    if (data.new_token) {
      const updated = { ...gcalTokens, access_token: data.new_token };
      setGcalTokens(updated);
      compressAndStore(GCAL_TOKENS_KEY, updated);
    }
    if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
    return data;
  }, [gcalTokens]);

  const startCalendarOAuth = useCallback(async () => {
    setShowConnectModal(null);
    setActiveSkill("calendar");

    try {
      const res = await fetch("/api/assistant/email/auth?service=calendar");
      const data = await res.json();

      if (data.error) {
        const setupSteps = Array.isArray(data.setup) ? (data.setup as string[]) : [];
        const guide = setupSteps.length > 0
          ? setupSteps.join("\n")
          : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file, then restart.";

        const setupMsg: ChatMessage = {
          id: genId(), role: "assistant",
          content: `**Google Calendar Setup Required**\n\nTo connect Google Calendar, you need to configure Google OAuth credentials:\n\n${guide}\n\nThis is a one-time setup. Once done, click **"Connect Calendar"** in the sidebar to sign in.`,
          timestamp: Date.now(), skill: "calendar",
        };
        setMessages((prev) => [...prev, setupMsg]);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      const errorMsg: ChatMessage = {
        id: genId(), role: "assistant",
        content: `**Could not reach the calendar auth endpoint.**\n\nMake sure the dev server is running and try again.`,
        timestamp: Date.now(), skill: "calendar",
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  }, []);

  // --- Skill connections ---
  const isConnected = useCallback((id: SkillId): boolean => {
    if (id === "actions") return executorAvailable === true;
    if (id === "tasks" || id === "research" || id === "files") return true;
    if (id === "calendar") return !!gcalTokens?.access_token;
    if (id === "email") return !!gmailTokens?.access_token;
    return !!skillConnections[id as keyof SkillConnectionState]?.connected;
  }, [skillConnections, gmailTokens, gcalTokens, executorAvailable]);

  const connectSkill = useCallback((id: SkillId, provider: string) => {
    const next: SkillConnectionState = { ...skillConnections, [id]: { connected: true, provider } };
    setSkillConnections(next);
    compressAndStore(SKILLS_KEY, next);
    setShowConnectModal(null);
    toast.success(`${SKILL_DEFINITIONS[id].label} connected via ${provider}`);
  }, [skillConnections]);

  const disconnectSkill = useCallback((id: SkillId) => {
    if (id === "email") {
      setGmailTokens(null);
      try { localStorage.removeItem(GMAIL_TOKENS_KEY); } catch { /* ok */ }
    }
    if (id === "calendar") {
      setGcalTokens(null);
      try { localStorage.removeItem(GCAL_TOKENS_KEY); } catch { /* ok */ }
    }
    const next: SkillConnectionState = { ...skillConnections };
    delete next[id];
    setSkillConnections(next);
    compressAndStore(SKILLS_KEY, next);
    toast.success(`${SKILL_DEFINITIONS[id].label} disconnected`);
  }, [skillConnections]);

  const skills: SkillConfig[] = SKILL_ORDER.map((id) => ({
    ...SKILL_DEFINITIONS[id],
    connected: isConnected(id),
    provider: skillConnections[id]?.provider,
  }));

  const currentSkill = skills.find((s) => s.id === activeSkill)!;

  // -----------------------------------------------------------------------
  // Process message per skill
  // -----------------------------------------------------------------------

  const handleApprove = useCallback(
    async (approvalId: string, decision: "approve" | "deny") => {
      try {
        await fetch("/api/assistant/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approval_id: approvalId, decision }),
        });
        setPendingApproval(null);
        if (decision === "approve") toast.success("Action approved");
        else toast.info("Action denied");
      } catch (e) {
        toast.error("Failed to respond");
      }
    },
    []
  );

  const processMessage = useCallback(
    async (text: string): Promise<string> => {
      const lower = text.toLowerCase();

      // ---- ACTIONS (real executor) ----
      if (activeSkill === "actions") {
        if (executorAvailable !== true) {
          return "**Actions unavailable.** Start the executor: `cd executor-rust && cargo run`\n\nThe executor runs on 127.0.0.1:7777 and performs real file, note, clipboard, and shell actions.";
        }
        setActionsLoading(true);
        setPendingApproval(null);
        const runId = genId();
        let es: EventSource | null = null;
        try {
          es = new EventSource(`/api/assistant/runs/${runId}/events`);
          es.onmessage = (e) => {
            try {
              const ev = JSON.parse(e.data);
              if (ev.type === "approval_required" && ev.data?.approval_id) {
                setPendingApproval({
                  approvalId: ev.data.approval_id,
                  tool: ev.data.tool || "action",
                  runId,
                  summary: `Approve: ${ev.data.tool || "action"} (risk ${ev.data.risk_level ?? "?"})`,
                });
              }
            } catch { /* ignore parse errors */ }
          };
          es.onerror = () => { es?.close(); };
          const res = await fetch("/api/assistant/act", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text.trim(), run_id: runId }),
            signal: AbortSignal.timeout(120_000),
          });
          es.close();
          es = null;
          const data = await res.json();
          setPendingApproval(null);
          if (data.error) {
            return `**Error:** ${data.error}`;
          }
          if (data.result?.result) {
            const r = data.result.result;
            if (r?.ok && r?.data) {
              const d = r.data;
              if (d.entries) return `**${d.entries.length} items:**\n${d.entries.slice(0, 20).map((e: { name: string; is_dir?: boolean }) => `- ${e.name}${e.is_dir ? "/" : ""}`).join("\n")}${d.entries.length > 20 ? `\n...and ${d.entries.length - 20} more` : ""}`;
              if (d.content) return `**Content:**\n\`\`\`\n${String(d.content).slice(0, 2000)}${String(d.content).length > 2000 ? "\n..." : ""}\n\`\`\``;
              if (d.trashed) return `**Done.** Moved \`${d.trashed}\` to Trash.`;
              if (d.written) return `**Done.** Written to \`${d.written}\`.`;
              if (d.matches) return `**${d.matches.length} note(s) found:**\n${d.matches.slice(0, 10).map((m: { title?: string; snippet?: string }) => `- **${m.title || "?"}**: ${(m.snippet || "").slice(0, 80)}...`).join("\n")}`;
              if (d.exit_code !== undefined) return `**Shell result** (exit ${d.exit_code}):\n\`\`\`\n${(d.stdout || "").slice(0, 2000)}${d.stderr ? "\n--- stderr ---\n" + d.stderr.slice(0, 500) : ""}\n\`\`\``;
              return `**Done.** ${JSON.stringify(d).slice(0, 300)}`;
            }
            if (r?.error) return `**Error:** ${r.error}`;
          }
          return data.message || "Action completed.";
        } catch (e) {
          setPendingApproval(null);
          return `**Request failed:** ${e instanceof Error ? e.message : String(e)}`;
        } finally {
          es?.close();
          setActionsLoading(false);
        }
      }

      // ---- TASKS ----
      if (activeSkill === "tasks") {
        if (lower.startsWith("add task:") || lower.startsWith("add task ") || lower.startsWith("add ") || lower.startsWith("create task")) {
          const taskText = text.replace(/^(?:add|create)\s*task:?\s*/i, "").trim();
          if (taskText) {
            addTask(taskText);
            return `Added task: **"${taskText}"**\n\nYou now have ${tasks.filter((t) => !t.done).length + 1} pending task(s).`;
          }
          return "Please specify what to add, e.g. **\"Add task: Buy groceries\"**.";
        }
        if (lower.includes("complete") || lower.includes("done") || lower.includes("finish") || lower.includes("check off")) {
          const taskRef = text.replace(/^(?:complete|done|finish|check off|mark done):?\s*/i, "").trim().toLowerCase();
          if (taskRef) {
            const pending = tasks.filter((t) => !t.done);
            const match = pending.find((t) => t.text.toLowerCase().includes(taskRef));
            if (match) {
              toggleTask(match.id);
              return `Marked **"${match.text}"** as done.`;
            }
            const numMatch = taskRef.match(/^#?(\d+)$/);
            if (numMatch) {
              const idx = parseInt(numMatch[1]) - 1;
              if (idx >= 0 && idx < pending.length) {
                toggleTask(pending[idx].id);
                return `Marked **"${pending[idx].text}"** as done.`;
              }
            }
            return `No pending task matching "${taskRef}". Say **"Show my tasks"** to see the list.`;
          }
        }
        if (lower.includes("show") && (lower.includes("task") || lower.includes("todo") || lower.includes("pending") || lower.includes("list"))) {
          const pending = tasks.filter((t) => !t.done);
          const done = tasks.filter((t) => t.done);
          if (tasks.length === 0) return "Your task list is empty. Try **\"Add task: Buy groceries\"** to create one.";
          let r = `**Pending (${pending.length}):**\n`;
          pending.forEach((t, i) => { r += `${i + 1}. ${t.text}\n`; });
          if (done.length > 0) {
            r += `\n**Completed (${done.length}):**\n`;
            done.slice(0, 5).forEach((t) => { r += `- ~~${t.text}~~\n`; });
            if (done.length > 5) r += `  ...and ${done.length - 5} more\n`;
          }
          return r;
        }
        if (lower.includes("clear") && lower.includes("completed")) {
          const count = clearCompletedTasks();
          return count > 0 ? `Cleared **${count}** completed task(s).` : "No completed tasks to clear.";
        }
        if (lower.includes("what") && (lower.includes("next") || lower.includes("should"))) {
          const pending = tasks.filter((t) => !t.done);
          if (pending.length === 0) return "No pending tasks! Enjoy the free time or add something new.";
          return `Your top task:\n\n**→ ${pending[0].text}**\n\n${pending.length > 1 ? `Plus ${pending.length - 1} more pending.` : "That's your only task — knock it out!"}`;
        }
        return `I can manage your tasks. Try:\n- **"Add task: ..."** — create a task\n- **"Show my tasks"** — list everything\n- **"Clear completed"** — tidy up\n- **"What's next?"** — get a recommendation`;
      }

      // ---- CALENDAR ----
      if (activeSkill === "calendar") {
        const gcalConnected = !!gcalTokens?.access_token;

        // Use LLM to understand what the user wants
        type CalendarIntent = {
          action: string;
          event_data?: { title: string; date: string; time?: string | null; duration?: number; description?: string | null } | null;
          query?: string | null;
          reasoning?: string;
        };
        let intent: CalendarIntent | null = null;
        try {
          const intentRes = await fetch("/api/assistant/intent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text, skill: "calendar" }),
          });
          if (intentRes.ok) {
            intent = await intentRes.json();
          }
        } catch {
          // LLM intent parsing failed — fall back to old keyword matching below
        }

        // Fall back to keyword matching if LLM intent parsing failed
        if (!intent || intent.action === "unknown") {
          if (lower.startsWith("add event") || lower.startsWith("schedule ") || lower.startsWith("create event") || lower.startsWith("new event") || lower.includes("add") && lower.includes("calendar")) {
            intent = { action: "create_event" };
            const parsed = parseEventInput(text);
            if (parsed?.title) {
              intent.event_data = { title: parsed.title, date: parsed.date || todayStr(), time: parsed.time, duration: 60 };
            }
          } else if (lower.includes("today") && (lower.includes("agenda") || lower.includes("schedule") || lower.includes("show"))) {
            intent = { action: "list_today" };
          } else if (lower.includes("week")) {
            intent = { action: "list_week" };
          } else if (lower.includes("free") && (lower.includes("slot") || lower.includes("time"))) {
            intent = { action: "free_slots" };
          } else if (lower.includes("delete") || lower.includes("remove") || lower.includes("cancel")) {
            intent = { action: "delete_event" };
          } else {
            intent = { action: "list_today" };
          }
        }

        // --- Handle each calendar action ---

        if (intent.action === "create_event") {
          const evData = intent.event_data;
          if (!evData?.title) {
            return "Please provide event details, e.g. **\"Add event: Team standup tomorrow at 10am\"**";
          }

          if (gcalConnected) {
            try {
              const data = await callCalendarApi("create_event", {
                title: evData.title,
                date: evData.date || todayStr(),
                time: evData.time || undefined,
                duration: evData.duration || 60,
                description: evData.description || undefined,
              });
              const ev = data.event;
              const linkStr = ev.link ? `\n\n[Open in Google Calendar](${ev.link})` : "";
              return `Event added to **Google Calendar**: **"${ev.title}"** on ${ev.date} at ${ev.time}${linkStr}\n\nSay **"Today's agenda"** to see all your events.`;
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Calendar API error";
              if (msg.includes("expired") || msg.includes("reconnect")) {
                setGcalTokens(null);
                try { localStorage.removeItem(GCAL_TOKENS_KEY); } catch { /* ok */ }
                return `**Google Calendar session expired.** Please click **"Connect Calendar"** to reconnect.`;
              }
              return `**Error adding to Google Calendar:** ${msg}`;
            }
          }

          const ev = addEvent({
            title: evData.title,
            date: evData.date || todayStr(),
            time: evData.time || undefined,
            duration: evData.duration || 60,
          });
          if (ev) {
            const timeStr = ev.time ? ` at ${ev.time}` : "";
            return `Event added locally: **"${ev.title}"** on ${ev.date}${timeStr}\n\n*Connect Google Calendar to sync events to your real calendar.*\n\nSay **"Today's agenda"** to see all your events.`;
          }
          return "Please provide event details, e.g. **\"Add event: Team standup tomorrow at 10am\"**";
        }

        if (intent.action === "list_today") {
          if (gcalConnected) {
            try {
              const data = await callCalendarApi("list_today");
              if (!data.events || data.events.length === 0) return `**${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}**\n\nNo events scheduled for today on Google Calendar. Looks like a free day!\n\nSay **"Add event: ..."** to schedule something.`;
              let r = `**Today — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}** (Google Calendar)\n\n`;
              data.events.forEach((e: { time: string; title: string }) => {
                r += `- **${e.time}** — ${e.title}\n`;
              });
              return r;
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Calendar API error";
              if (msg.includes("expired") || msg.includes("reconnect")) {
                setGcalTokens(null);
                try { localStorage.removeItem(GCAL_TOKENS_KEY); } catch { /* ok */ }
                return `**Google Calendar session expired.** Please click **"Connect Calendar"** to reconnect.`;
              }
              return `**Error:** ${msg}`;
            }
          }
          const today = todayStr();
          const todayEvents = events.filter((e) => e.date === today);
          if (todayEvents.length === 0) return `**${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}**\n\nNo events scheduled for today. Looks like a free day!\n\n*Connect Google Calendar to see your real events.*\n\nSay **"Add event: ..."** to schedule something.`;
          let r = `**Today — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}** (local)\n\n`;
          todayEvents.forEach((e) => {
            r += `- **${e.time || "All day"}** — ${e.title}\n`;
          });
          return r;
        }

        if (intent.action === "list_week") {
          if (gcalConnected) {
            try {
              const data = await callCalendarApi("list_week");
              if (!data.events || data.events.length === 0) return "No events this week on Google Calendar. Your schedule is clear!";
              let r = `**This week** (Google Calendar) — ${data.events.length} event(s):\n\n`;
              const byDay: Record<string, { time: string; title: string }[]> = {};
              data.events.forEach((e: { date: string; time: string; title: string }) => {
                if (!byDay[e.date]) byDay[e.date] = [];
                byDay[e.date].push(e);
              });
              Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).forEach(([date, evts]) => {
                r += `**${date}:**\n`;
                evts.forEach((e) => { r += `  - ${e.time} — ${e.title}\n`; });
              });
              return r;
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Calendar API error";
              return `**Error:** ${msg}`;
            }
          }
          const now = new Date();
          const weekStart = new Date(now);
          weekStart.setDate(now.getDate() - now.getDay());
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          const startStr = weekStart.toISOString().slice(0, 10);
          const endStr = weekEnd.toISOString().slice(0, 10);
          const weekEvents = events.filter((e) => e.date >= startStr && e.date <= endStr);
          if (weekEvents.length === 0) return "No events this week. Your schedule is clear!\n\n*Connect Google Calendar to see your real events.*";
          let r = `**This week (${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} — ${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })})** (local):\n\n`;
          const byDay: Record<string, CalendarEvent[]> = {};
          weekEvents.forEach((e) => {
            if (!byDay[e.date]) byDay[e.date] = [];
            byDay[e.date].push(e);
          });
          Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).forEach(([date, evts]) => {
            const dayName = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
            r += `**${dayName}:**\n`;
            evts.forEach((e) => { r += `  - ${e.time || "All day"} — ${e.title}\n`; });
          });
          return r;
        }

        if (intent.action === "search") {
          const q = intent.query || "";
          if (gcalConnected) {
            try {
              const data = await callCalendarApi("search", undefined, q);
              if (!data.events || data.events.length === 0) return `No events found matching: **"${q}"**`;
              let r = `**Found ${data.events.length} event(s) matching "${q}":**\n\n`;
              data.events.forEach((e: { time: string; date: string; title: string; link?: string }) => {
                r += `- **${e.date}** ${e.time} — ${e.title}\n`;
              });
              return r;
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Calendar API error";
              return `**Error:** ${msg}`;
            }
          }
          return "Connect Google Calendar to search events.";
        }

        if (intent.action === "free_slots") {
          if (gcalConnected) {
            try {
              const data = await callCalendarApi("free_slots");
              if (!data.free_slots || data.free_slots.length === 0) return "You're fully booked today! Try looking at tomorrow.";
              let r = "**Free slots today** (Google Calendar):\n\n";
              data.free_slots.forEach((slot: string) => { r += `- ${slot}\n`; });
              return r;
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Calendar API error";
              return `**Error:** ${msg}`;
            }
          }
          const today = todayStr();
          const todayEvts = events.filter((e) => e.date === today && e.time);
          const hours = Array.from({ length: 10 }, (_, i) => i + 8);
          const busy = new Set(todayEvts.map((e) => parseInt(e.time!.split(":")[0])));
          const free = hours.filter((h) => !busy.has(h));
          if (free.length === 0) return "You're fully booked today! Try looking at tomorrow.";
          let r = "**Free slots today** (local):\n\n";
          free.forEach((h) => {
            r += `- ${h.toString().padStart(2, "0")}:00 — ${(h + 1).toString().padStart(2, "0")}:00\n`;
          });
          r += "\n*Connect Google Calendar for accurate availability.*";
          return r;
        }

        if (intent.action === "delete_event") {
          const today = todayStr();
          const todayEvents = events.filter((e) => e.date === today);
          if (todayEvents.length === 0) return "No local events to remove today.";
          if (todayEvents.length === 1) {
            deleteEvent(todayEvents[0].id);
            return `Removed: **"${todayEvents[0].title}"**`;
          }
          let r = "Which event should I remove? You have:\n\n";
          todayEvents.forEach((e, i) => { r += `${i + 1}. ${e.time || "All day"} — ${e.title}\n`; });
          r += "\nSay **\"Remove [event name]\"** to delete a specific one.";
          return r;
        }

        if (!gcalConnected) {
          return `I can manage your calendar. **Connect Google Calendar** in the sidebar to create real events.\n\nOr try locally:\n- **"Add event: Team standup tomorrow at 10am"**\n- **"Today's agenda"** — view today\n- **"This week"** — weekly overview\n- **"Free slots"** — find open time`;
        }
        return `I can manage your Google Calendar. Try:\n- **"Add event: Team standup tomorrow at 10am"** — creates in Google Calendar\n- **"Today's agenda"** — view today's events\n- **"This week"** — weekly overview\n- **"Free slots"** — find open time`;
      }

      // ---- FILES ----
      if (activeSkill === "files") {
        const noFiles = scannedFiles.length === 0;
        const folderBase = scannedFolderName ? `~/${scannedFolderName}` : "YOUR_FOLDER";

        // Delegate trash/delete specific file to Actions executor when available
        const trashMatch = lower.match(/(?:put|move|send)\s+(?:the\s+)?(?:file\s+)?["']?([^\s"']+)["']?\s+(?:to|in)\s+(?:the\s+)?(?:trash|bin|recycle)/i)
          || lower.match(/(?:trash|delete|remove)\s+(?:the\s+)?(?:file\s+)?["']?([^\s"']+)["']?/i)
          || lower.match(/(?:put|move)\s+["']?([^\s"']+)["']?\s+(?:to|in)\s+(?:the\s+)?trash/i);
        if (!noFiles && scannedFolderName && executorAvailable && (lower.includes("trash") || lower.includes("delete") || lower.includes("remove")) && trashMatch) {
          const mentionedName = trashMatch[1];
          const matched = scannedFiles.find((f) => f.name === mentionedName || f.name.toLowerCase() === mentionedName.toLowerCase());
          if (matched) {
            const fullPath = `~/${scannedFolderName}/${matched.name}`;
            setActionsLoading(true);
            setPendingApproval(null);
            const runId = genId();
            const es = new EventSource(`/api/assistant/runs/${runId}/events`);
            es.onmessage = (e) => {
              try {
                const ev = JSON.parse(e.data);
                if (ev.type === "approval_required" && ev.data?.approval_id) {
                  setPendingApproval({
                    approvalId: ev.data.approval_id,
                    tool: ev.data.tool || "fs_delete",
                    runId,
                    summary: `Approve: trash ${matched.name}`,
                  });
                }
              } catch { /* ignore */ }
            };
            try {
              const res = await fetch("/api/assistant/act", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  message: `Put ${fullPath} in trash (fs_delete moves to system trash)`,
                  run_id: runId,
                  context: { path: fullPath },
                }),
                signal: AbortSignal.timeout(120_000),
              });
              es.close();
              const data = await res.json();
              setPendingApproval(null);
              if (data.error) return `**Error:** ${data.error}`;
              if (data.result?.result?.ok && data.result?.result?.data?.trashed) {
                return `**Done.** Moved \`${matched.name}\` to Trash.`;
              }
              if (data.result?.result?.error) return `**Error:** ${data.result.result.error}`;
              return data.message || "Action completed.";
            } catch (e) {
              es.close();
              setPendingApproval(null);
              return `**Request failed:** ${e instanceof Error ? e.message : String(e)}`;
            } finally {
              setActionsLoading(false);
            }
          }
        }

        if (lower.includes("scan") || text === "Scan folder") {
          triggerFolderScan();
          return "**Opening folder picker...** Select a folder to scan.\n\nOnce scanned, I can:\n- Break down files by category & suggest organisation\n- Find large files and generate a command to **delete** them\n- Spot duplicates and generate a command to **remove** them\n- Create a script to **sort files into subfolders** by type\n- Find old/stale files and **archive** them";
        }

        if (lower.includes("organis") || lower.includes("organiz") || lower.includes("sort into") || lower.includes("sort files") || (lower.includes("categori") && (lower.includes("file") || lower.includes("folder")))) {
          if (noFiles) return "No files scanned yet. Use **\"Scan a folder\"** first.";
          const analysis = analyseFiles(scannedFiles);

          const byCategory: Record<string, ScannedFile[]> = {};
          scannedFiles.forEach((f) => {
            const cat = categoriseFile(f.name);
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(f);
          });

          let script = `#!/bin/bash\n# Auto-organise ${folderBase}\n# Generated by Deep Search AI Assistant\ncd "${folderBase}"\n\n`;
          const sorted = Object.entries(byCategory).filter(([cat]) => cat !== "other").sort((a, b) => b[1].length - a[1].length);
          sorted.forEach(([cat, files]) => {
            if (files.length < 2) return;
            const label = FILE_CATEGORIES[cat]?.label || cat;
            script += `# ${label} (${files.length} files)\nmkdir -p "${label}"\n`;
            files.forEach((f) => {
              script += `mv "${f.name}" "${label}/"\n`;
            });
            script += `\n`;
          });

          return `${analysis}\n\n---\n\n**Ready-to-run organisation script:**\n\nCopy this and run it in your terminal:\n\n\`\`\`bash\n${script}\`\`\`\n\n*Review the commands before running. Use \`mv -i\` instead of \`mv\` if you want confirmation prompts.*`;
        }

        if ((lower.includes("remove") || lower.includes("delete") || lower.includes("clean") || lower.includes("script") || lower.includes("generate")) && (lower.includes("large") || lower.includes("big") || lower.includes("heavy"))) {
          if (noFiles) return "No files scanned yet. Use **\"Scan a folder\"** first.";
          const threshold = 10 * 1024 * 1024;
          const large = [...scannedFiles].filter((f) => f.size > threshold).sort((a, b) => b.size - a.size);
          if (large.length === 0) return `No files larger than ${formatBytes(threshold)} found. Your folder is already lean!`;

          const totalFreed = large.reduce((s, f) => s + f.size, 0);
          let r = `**${large.length} file(s) larger than ${formatBytes(threshold)} in "${scannedFolderName}":**\n\n`;
          large.slice(0, 20).forEach((f, i) => {
            r += `${i + 1}. \`${f.name}\` — **${formatBytes(f.size)}**\n`;
          });

          let script = `#!/bin/bash\n# Delete large files from ${folderBase}\n# Will free up ${formatBytes(totalFreed)}\ncd "${folderBase}"\n\n`;
          large.forEach((f) => {
            script += `rm "${f.name}"  # ${formatBytes(f.size)}\n`;
          });

          r += `\nDeleting these would free **${formatBytes(totalFreed)}**.\n\n**Delete command** (copy to terminal):\n\n\`\`\`bash\n${script}\`\`\`\n\n*Warning: this permanently deletes files. Use \`trash\` (macOS) or move to a temp folder first if unsure.*\n\nSafer alternative:\n\`\`\`bash\nmkdir -p "${folderBase}/_to_delete"\n${large.map((f) => `mv "${folderBase}/${f.name}" "${folderBase}/_to_delete/"`).join("\n")}\n\`\`\``;
          return r;
        }

        if (lower.includes("large") || lower.includes("biggest") || lower.includes("size")) {
          if (noFiles) return "No files scanned yet. Use **\"Scan a folder\"** first.";
          const sorted = [...scannedFiles].sort((a, b) => b.size - a.size).slice(0, 15);
          let r = `**Largest files in "${scannedFolderName}":**\n\n`;
          sorted.forEach((f, i) => {
            r += `${i + 1}. \`${f.name}\` — **${formatBytes(f.size)}**\n`;
          });
          const totalSize = scannedFiles.reduce((s, f) => s + f.size, 0);
          const topSize = sorted.reduce((s, f) => s + f.size, 0);
          r += `\nTop ${sorted.length} files = **${formatBytes(topSize)}** of ${formatBytes(totalSize)} total (${Math.round(topSize / totalSize * 100)}%)\n\nSay **"Remove large files"** to get a delete script.`;
          return r;
        }

        if ((lower.includes("remove") || lower.includes("delete") || lower.includes("clean") || lower.includes("script") || lower.includes("generate")) && (lower.includes("duplicate") || lower.includes("dupe"))) {
          if (noFiles) return "No files scanned yet. Use **\"Scan a folder\"** first.";
          const nameCount: Record<string, ScannedFile[]> = {};
          scannedFiles.forEach((f) => {
            if (!nameCount[f.name]) nameCount[f.name] = [];
            nameCount[f.name].push(f);
          });
          const dupes = Object.entries(nameCount).filter(([, fs]) => fs.length > 1);
          if (dupes.length === 0) return "No duplicates found!";

          const totalExtra = dupes.reduce((s, [, fs]) => s + fs.slice(1).reduce((ss, f) => ss + f.size, 0), 0);
          let r = `**${dupes.length} duplicate filename(s) found:**\n\n`;
          dupes.slice(0, 10).forEach(([name, fs]) => {
            r += `- \`${name}\` — ${fs.length} copies\n`;
          });

          let script = `#!/bin/bash\n# Remove duplicate files from ${folderBase}\n# Keeps the first copy, removes extras\ncd "${folderBase}"\n\n`;
          dupes.forEach(([name, fs]) => {
            const extras = fs.slice(1);
            extras.forEach((f) => {
              const dir = f.path.includes("/") ? f.path.substring(0, f.path.lastIndexOf("/")) : ".";
              script += `rm "${dir !== "." ? dir + "/" : ""}${name}"  # duplicate\n`;
            });
          });

          r += `\nRemoving extras would save **${formatBytes(totalExtra)}**.\n\n**Remove duplicates script:**\n\n\`\`\`bash\n${script}\`\`\`\n\n*This keeps the first copy found and removes subsequent ones. Review before running!*`;
          return r;
        }

        if (lower.includes("duplicate") || lower.includes("dupe")) {
          if (noFiles) return "No files scanned yet. Use **\"Scan a folder\"** first.";
          const nameCount: Record<string, ScannedFile[]> = {};
          scannedFiles.forEach((f) => {
            if (!nameCount[f.name]) nameCount[f.name] = [];
            nameCount[f.name].push(f);
          });
          const dupes = Object.entries(nameCount).filter(([, fs]) => fs.length > 1);
          if (dupes.length === 0) return `No duplicate filenames found among ${scannedFiles.length} files.`;
          let r = `**Found ${dupes.length} duplicate filename(s):**\n\n`;
          dupes.slice(0, 15).forEach(([name, fs]) => {
            r += `- \`${name}\` — ${fs.length} copies (${fs.map((f) => formatBytes(f.size)).join(", ")})\n`;
          });
          r += `\nSay **"Remove duplicates"** to get a cleanup script.`;
          return r;
        }

        const wantsOldAction = lower.includes("remove") || lower.includes("delete") || lower.includes("clean") || lower.includes("archive") || lower.includes("script") || lower.includes("generate");
        const mentionsOld = lower.includes("old") || lower.includes("stale");
        if (wantsOldAction && mentionsOld) {
          if (noFiles) return "No files scanned yet. Use **\"Scan a folder\"** first.";
          const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
          const old = scannedFiles.filter((f) => f.lastModified < cutoff).sort((a, b) => a.lastModified - b.lastModified);
          if (old.length === 0) return "No files older than 90 days found.";
          const totalFreed = old.reduce((s, f) => s + f.size, 0);

          let script = `#!/bin/bash\n# Archive old files from ${folderBase}\nmkdir -p "${folderBase}/_archive"\ncd "${folderBase}"\n\n`;
          old.forEach((f) => {
            script += `mv "${f.name}" "_archive/"  # ${new Date(f.lastModified).toLocaleDateString()}\n`;
          });

          let r = `**${old.length} file(s) not modified in 90+ days (${formatBytes(totalFreed)}):**\n\n`;
          old.slice(0, 10).forEach((f) => {
            r += `- \`${f.name}\` — ${new Date(f.lastModified).toLocaleDateString()}, ${formatBytes(f.size)}\n`;
          });
          if (old.length > 10) r += `- ...and ${old.length - 10} more\n`;
          r += `\n**Archive script** (moves to \`_archive/\` subfolder):\n\n\`\`\`bash\n${script}\`\`\`\n\nOr to delete permanently:\n\`\`\`bash\ncd "${folderBase}"\n${old.map((f) => `rm "${f.name}"`).join("\n")}\n\`\`\``;
          return r;
        }

        if (mentionsOld || lower.includes("archive")) {
          if (noFiles) return "No files scanned yet. Use **\"Scan a folder\"** first.";
          const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
          const old = scannedFiles.filter((f) => f.lastModified < cutoff);
          if (old.length === 0) return "No files older than 90 days found.";
          let r = `**${old.length} file(s) not modified in 90+ days:**\n\n`;
          old.sort((a, b) => a.lastModified - b.lastModified).slice(0, 15).forEach((f) => {
            r += `- \`${f.name}\` — last modified ${new Date(f.lastModified).toLocaleDateString()}, ${formatBytes(f.size)}\n`;
          });
          r += `\nSay **"Archive old files"** or **"Generate a script to archive old files"** to get an action script.`;
          return r;
        }

        // List files by type: "list CSV files", "show csv files", "list down the csv file", etc.
        const listIntent = lower.includes("list") || lower.includes("show") || lower.includes("find") || lower.includes("what") || lower.includes("which");
        const extFromPhrase: Record<string, string[]> = {
          csv: ["csv"],
          "csv file": ["csv"],
          "csv files": ["csv"],
          pdf: ["pdf"],
          "pdf file": ["pdf"],
          "pdf files": ["pdf"],
          excel: ["xls", "xlsx", "csv", "tsv"],
          spreadsheet: ["xls", "xlsx", "csv", "tsv", "ods", "numbers"],
          spreadsheets: ["xls", "xlsx", "csv", "tsv", "ods", "numbers"],
          image: ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "tiff"],
          images: ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "tiff"],
          document: ["pdf", "doc", "docx", "txt", "rtf", "odt", "pages", "md", "tex"],
          documents: ["pdf", "doc", "docx", "txt", "rtf", "odt", "pages", "md", "tex"],
          code: ["js", "ts", "tsx", "jsx", "py", "java", "cpp", "c", "h", "go", "rs", "rb", "php", "html", "css", "scss", "json", "xml", "yaml", "yml"],
        };
        let requestedExts: string[] | null = null;
        for (const [phrase, exts] of Object.entries(extFromPhrase)) {
          if (lower.includes(phrase)) {
            requestedExts = exts;
            break;
          }
        }
        if (!requestedExts && listIntent) {
          if (/\bcsv\b/i.test(lower)) requestedExts = ["csv"];
          else if (/\bpdf\b/i.test(lower)) requestedExts = ["pdf"];
          else if (/\bexcel\b/i.test(lower) || /\bspreadsheet\b/i.test(lower)) requestedExts = ["xls", "xlsx", "csv", "tsv"];
          else if (/\bimage\b/i.test(lower)) requestedExts = ["jpg", "jpeg", "png", "gif", "webp"];
        }
        if (!noFiles && requestedExts && (listIntent || lower.includes("csv") || lower.includes("pdf") || lower.includes("excel") || lower.includes("spreadsheet") || lower.includes("image") || lower.includes("document"))) {
          const filtered = scannedFiles.filter((f) => requestedExts!.includes(getExt(f.name)));
          if (filtered.length === 0) {
            const typeLabel = requestedExts.length === 1 ? requestedExts[0].toUpperCase() : requestedExts.join("/").toUpperCase();
            return `No **${typeLabel}** files found in "${scannedFolderName}". Scanned ${scannedFiles.length} file(s) total.`;
          }
          const totalSize = filtered.reduce((s, f) => s + f.size, 0);
          const typeLabel = requestedExts.length === 1 ? requestedExts[0].toUpperCase() : "matching";
          let r = `**${filtered.length} ${typeLabel} file(s) in "${scannedFolderName}"** (${formatBytes(totalSize)} total):\n\n`;
          filtered.forEach((f, i) => {
            r += `${i + 1}. \`${f.name}\` — ${formatBytes(f.size)}\n`;
          });
          return r;
        }

        if (lower.includes("suggest") || lower.includes("breakdown") || lower.includes("analyse") || lower.includes("analyze")) {
          return analyseFiles(scannedFiles);
        }

        if (noFiles) {
          const wantsList = listIntent && requestedExts;
          return wantsList
            ? `Scan a folder first to list ${requestedExts!.length === 1 ? requestedExts![0].toUpperCase() : "these"} files.\n\n1. Click **"Scan a folder"** in the sidebar (or type "scan")\n2. Select your folder (e.g. Downloads)\n3. Then ask again: **"List ${requestedExts!.join("/").toUpperCase()} files"**`
            : `I can manage your local files. Start by:\n\n1. Click **"Scan a folder"** in the sidebar (or type "scan")\n2. Select any folder from your computer\n3. Then ask me to:\n   - **"List CSV files"** or **"List down the CSV files"** — show CSV files in the folder\n   - **"Organise my files"** — sorts files into categorised subfolders\n   - **"Remove large files"** — generates a delete script for big files\n   - **"Remove duplicates"** — finds and removes duplicate filenames\n   - **"Archive old files"** — moves stale files to an archive folder\n\nAll file analysis happens in your browser. Scripts are generated for you to review and run.`;
        }

        return analyseFiles(scannedFiles);
      }

      // ---- RESEARCH ----
      if (activeSkill === "research") {
        if (sessions.length === 0) {
          return "No research sessions yet. Use the **Search** tab to run some research, then come back to query your findings.";
        }
        if (lower.includes("summarise") || lower.includes("summarize") || lower.includes("summary") || lower.includes("recent")) {
          const recent = sessions.slice(0, 5);
          let r = `**Your ${recent.length} most recent research sessions:**\n\n`;
          recent.forEach((s, i) => {
            const date = new Date(s.timestamp).toLocaleDateString();
            const essence = s.metadata?.essence_text ? `\n   > ${(s.metadata.essence_text as string).slice(0, 150)}...` : "";
            r += `${i + 1}. **"${s.query}"** — ${date}${essence}\n`;
          });
          return r;
        }
        if (lower.includes("key finding") || lower.includes("findings")) {
          const withEssence = sessions.filter((s) => s.metadata?.essence_text);
          if (withEssence.length === 0) return "No research essences found yet. Run more detailed searches.";
          let r = "**Key findings from your research:**\n\n";
          withEssence.slice(0, 5).forEach((s) => {
            r += `- **${s.query}**: ${(s.metadata!.essence_text as string).slice(0, 200)}\n\n`;
          });
          return r;
        }
        if (lower.includes("compare") || lower.includes("contrast")) {
          if (sessions.length < 2) return "Need at least 2 sessions to compare.";
          const topics = sessions.slice(0, 4).map((s) => `"${s.query}"`).join(", ");
          return `Your recent topics: ${topics}\n\nTo get AI-powered cross-topic analysis, wire the assistant to your configured LLM. The sessions and their essences will be sent as context.`;
        }
        let r = `You have **${sessions.length}** research session(s). Try:\n`;
        r += `- **"Summarise my research"**\n- **"Key findings"**\n- **"Compare topics"**\n`;
        return r;
      }

      // ---- EMAIL ----
      if (activeSkill === "email") {
        if (!gmailTokens?.access_token) {
          return `**Gmail is not connected yet.**\n\nClick **"Connect Email"** in the sidebar to sign in with your Google account. I'll then be able to:\n\n- Summarise your unread emails\n- Identify newsletters to clean up\n- Search your inbox\n- Help you triage messages`;
        }

        try {
          setEmailLoading(true);

          // Use LLM to understand what the user actually wants
          let intent: { action: string; query?: string | null; reasoning?: string } = { action: "summarize" };
          try {
            const intentRes = await fetch("/api/assistant/intent", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: text, skill: "email" }),
            });
            if (intentRes.ok) {
              intent = await intentRes.json();
            }
          } catch {
            // Fall back to keyword matching if intent API fails
            if (lower.includes("clean") || lower.includes("triage") || lower.includes("newsletter")) {
              intent = { action: "clean" };
            } else if (lower.includes("search") || lower.includes("find")) {
              intent = { action: "search", query: text.replace(/^(search|find)\s*(my\s*)?(inbox\s*)?(for\s*)?(emails?\s*)?(about\s*)?/i, "").trim() };
            } else if (lower.includes("draft") || lower.includes("reply") || lower.includes("compose")) {
              intent = { action: "draft_reply" };
            } else if (lower.includes("list") || lower.includes("show") || lower.includes("fetch")) {
              intent = { action: "fetch_unread" };
            }
          }

          if (intent.action === "fetch_unread") {
            const data = await callEmailApi("fetch_unread");
            if (!data.emails || data.emails.length === 0) return "Your inbox is clean — no unread emails!";
            let r = `**${data.emails.length} unread email(s):**\n\n`;
            data.emails.forEach((e: { from: string; subject: string; date: string; snippet: string }, i: number) => {
              r += `${i + 1}. **${e.subject || "(no subject)"}**\n   From: ${e.from} — ${e.date}\n   > ${e.snippet?.slice(0, 100)}...\n\n`;
            });
            return r;
          }

          if (intent.action === "summarize") {
            const data = await callEmailApi("summarize");
            return data.summary || "No summary available.";
          }

          if (intent.action === "clean") {
            const data = await callEmailApi("clean");
            return data.summary || "No analysis available.";
          }

          if (intent.action === "search") {
            const searchQuery = intent.query || text.replace(/^(search|find)\s*(my\s*)?(inbox\s*)?(for\s*)?(emails?\s*)?(about\s*)?/i, "").trim();
            if (!searchQuery) return "What would you like to search for? Try **\"Search for emails about project deadline\"**";
            const data = await callEmailApi("search", searchQuery);
            if (!data.emails || data.emails.length === 0) return `No emails found matching: **"${searchQuery}"**`;
            let r = `**Found ${data.emails.length} email(s) matching "${searchQuery}":**\n\n`;
            data.emails.forEach((e: { from: string; subject: string; date: string; snippet: string }, i: number) => {
              r += `${i + 1}. **${e.subject || "(no subject)"}**\n   From: ${e.from} — ${e.date}\n   > ${e.snippet?.slice(0, 100)}...\n\n`;
            });
            return r;
          }

          if (intent.action === "draft_reply") {
            return `Draft/reply functionality requires write access to Gmail. Currently the integration uses **read-only** access for security.\n\nTo enable drafting, add the \`gmail.compose\` scope and implement the compose endpoint.`;
          }

          // "unknown" or unrecognized intent
          return `I'm not sure how to do that with email yet. I can:\n- **Summarise** your unread emails\n- **Search** for specific emails (e.g. "find emails from John")\n- **Clean** your inbox by categorising emails\n- **List** your unread messages\n\nWhat would you like to do?`;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Email API error";
          if (msg.includes("expired") || msg.includes("reconnect")) {
            setGmailTokens(null);
            try { localStorage.removeItem(GMAIL_TOKENS_KEY); } catch { /* ok */ }
            return `**Gmail session expired.** Please click **"Connect Email"** to reconnect.`;
          }
          return `**Error:** ${msg}\n\nTry reconnecting Gmail if this persists.`;
        } finally {
          setEmailLoading(false);
        }
      }

      const fallbackSkill = activeSkill as SkillId;
      return `I'm not sure how to handle that for **${SKILL_DEFINITIONS[fallbackSkill].label}**. Try one of the quick actions in the sidebar.`;
    },
    [activeSkill, tasks, events, sessions, scannedFiles, scannedFolderName, skillConnections, gmailTokens, gcalTokens, executorAvailable, addTask, toggleTask, clearCompletedTasks, addEvent, deleteEvent, triggerFolderScan, analyseFiles, callEmailApi, callCalendarApi]
  );

  // --- Send message ---
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isThinking) return;

    const userMsg: ChatMessage = { id: genId(), role: "user", content: text, timestamp: Date.now(), skill: activeSkill };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsThinking(true);

    // For file scanning, don't add artificial delay (need user gesture chain)
    const needsImmediate = activeSkill === "files" && (text.toLowerCase().includes("scan") || text === "Scan folder");

    if (!needsImmediate) {
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
    }

    const reply = await processMessage(text);
    const botMsg: ChatMessage = { id: genId(), role: "assistant", content: reply, timestamp: Date.now(), skill: activeSkill };
    setMessages((prev) => [...prev, botMsg]);
    setIsThinking(false);
  }, [input, isThinking, activeSkill, processMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const handleQuickAction = useCallback((prompt: string, action?: string) => {
    if (action === "scan_folder") {
      triggerFolderScan();
      const userMsg: ChatMessage = { id: genId(), role: "user", content: "Scan a folder", timestamp: Date.now(), skill: "files" };
      const botMsg: ChatMessage = {
        id: genId(), role: "assistant",
        content: "**Opening folder picker...** Select a folder to scan.\n\nOnce scanned, ask me to organise, find large files, or spot duplicates.",
        timestamp: Date.now(), skill: "files",
      };
      setMessages((prev) => [...prev, userMsg, botMsg]);
      return;
    }
    setInput(prompt);
    inputRef.current?.focus();
  }, [triggerFolderScan]);

  // --- Derived ---
  const pendingCount = tasks.filter((t) => !t.done).length;
  const doneCount = tasks.filter((t) => t.done).length;
  const todayEventCount = events.filter((e) => e.date === todayStr()).length;

  const bd = { borderColor: isDark ? "rgba(51,65,85,0.4)" : "rgba(226,232,240,1)" };

  return (
    <div
      className={`min-h-screen transition-colors duration-500 ${
        isDark
          ? "bg-gradient-to-br from-slate-950 via-indigo-950/30 to-slate-950 text-slate-100"
          : "bg-gradient-to-br from-slate-50 via-indigo-50/50 to-slate-100 text-slate-900"
      }`}
    >
      <ClearHistoryModal open={showClearModal} onClose={() => setShowClearModal(false)} onConfirm={handleClearHistory} />

      {pendingApproval && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-3 p-4 rounded-xl shadow-xl border bg-background">
          <p className="text-sm font-medium">Confirm action</p>
          <p className="text-xs text-muted-foreground">{pendingApproval.summary}</p>
          <div className="flex gap-2">
            <button
              onClick={() => handleApprove(pendingApproval.approvalId, "approve")}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
            >
              Approve
            </button>
            <button
              onClick={() => handleApprove(pendingApproval.approvalId, "deny")}
              className="px-4 py-2 rounded-lg bg-zinc-600 hover:bg-zinc-700 text-white text-sm font-medium"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {showConnectModal && (
        <ConnectModal skillId={showConnectModal} isDark={isDark} onConnect={connectSkill} onClose={() => setShowConnectModal(null)} onGmailOAuth={startGmailOAuth} />
      )}

      {/* Hidden folder input for file scanning */}
      <input
        ref={folderInputRef}
        type="file"
        /* @ts-expect-error webkitdirectory is non-standard but widely supported */
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFolderSelected(e.target.files);
          }
        }}
      />

      <div className="mx-auto flex h-[calc(100vh-72px)] max-w-7xl gap-0 px-4 py-4 lg:gap-4">
        {/* --- Sidebar: Skills & Quick Actions --- */}
        <aside
          className={`shrink-0 transition-all duration-300 ${
            skillPanelOpen ? "w-72 lg:w-80" : "w-0 overflow-hidden"
          } ${
            skillPanelOpen ? "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-20 max-lg:mt-[72px] max-lg:w-72 max-lg:shadow-2xl" : ""
          } flex flex-col rounded-2xl border ${
            isDark ? "border-slate-700/60 bg-slate-800/30" : "border-slate-200 bg-white/80"
          }`}
        >
          <div className="flex items-center justify-between border-b px-4 py-3" style={bd}>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="h-4 w-4 text-emerald-500" />
              <span className={isDark ? "text-slate-300" : "text-slate-700"}>Skills</span>
            </h2>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowClearModal(true)} className="rounded-lg p-1.5 transition hover:bg-slate-700/50" title="Clear all data">
                <Trash2 className="h-3.5 w-3.5 text-slate-500" />
              </button>
              <button onClick={() => setSkillPanelOpen(false)} className="rounded-lg p-1.5 transition hover:bg-slate-700/50 lg:hidden">
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            <div className="space-y-1">
              {skills.map((skill) => {
                const active = activeSkill === skill.id;
                return (
                  <div key={skill.id}>
                    <button
                      onClick={() => setActiveSkill(skill.id)}
                      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                        active
                          ? isDark ? "bg-slate-700/50 border border-slate-600/50" : "bg-slate-100 border border-slate-200"
                          : isDark ? "hover:bg-slate-700/30 border border-transparent" : "hover:bg-slate-50 border border-transparent"
                      }`}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${skill.gradient} text-white`}>
                        {skill.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${active ? (isDark ? "text-slate-100" : "text-slate-900") : isDark ? "text-slate-300" : "text-slate-700"}`}>
                            {skill.label}
                          </span>
                          {skill.connected ? <Link2 className="h-3 w-3 text-emerald-500" /> : <Link2Off className="h-3 w-3 text-slate-500" />}
                        </div>
                        <p className={`truncate text-[11px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>{skill.description}</p>
                      </div>
                      {skill.id === "tasks" && pendingCount > 0 && (
                        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-violet-500/20 px-1.5 text-[10px] font-bold text-violet-400">{pendingCount}</span>
                      )}
                      {skill.id === "calendar" && todayEventCount > 0 && (
                        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500/20 px-1.5 text-[10px] font-bold text-amber-400">{todayEventCount}</span>
                      )}
                      {skill.id === "files" && scannedFiles.length > 0 && (
                        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-500/20 px-1.5 text-[10px] font-bold text-emerald-400">{scannedFiles.length}</span>
                      )}
                      {skill.id === "research" && sessions.length > 0 && (
                        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-cyan-500/20 px-1.5 text-[10px] font-bold text-cyan-400">{sessions.length}</span>
                      )}
                    </button>

                    {active && (
                      <div className="mt-1 ml-3 space-y-0.5 pb-2 pl-9">
                        {skill.quickActions.map((qa, i) => (
                          <button
                            key={i}
                            onClick={() => handleQuickAction(qa.prompt, qa.action)}
                            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] transition ${
                              isDark ? "text-slate-400 hover:bg-slate-700/40 hover:text-slate-200" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            }`}
                          >
                            {qa.action === "scan_folder" ? <FolderSearch className="h-3 w-3 shrink-0 opacity-50" /> : <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />}
                            {qa.label}
                          </button>
                        ))}
                        {skill.id === "email" && !isConnected("email") && (
                          <button
                            onClick={() => setShowConnectModal("email")}
                            className={`mt-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-medium transition ${
                              isDark ? "border-blue-500/30 text-blue-400 hover:bg-blue-500/10" : "border-blue-300 text-blue-600 hover:bg-blue-50"
                            }`}
                          >
                            <Plus className="h-3 w-3" /> Connect Email
                          </button>
                        )}
                        {skill.id === "email" && isConnected("email") && (
                          <button
                            onClick={() => disconnectSkill("email")}
                            className={`mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[10px] transition ${isDark ? "text-slate-600 hover:text-red-400" : "text-slate-400 hover:text-red-500"}`}
                          >
                            <Link2Off className="h-3 w-3" /> Disconnect
                          </button>
                        )}
                        {skill.id === "calendar" && !isConnected("calendar") && (
                          <button
                            onClick={startCalendarOAuth}
                            className={`mt-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-medium transition ${
                              isDark ? "border-amber-500/30 text-amber-400 hover:bg-amber-500/10" : "border-amber-300 text-amber-600 hover:bg-amber-50"
                            }`}
                          >
                            <Plus className="h-3 w-3" /> Connect Google Calendar
                          </button>
                        )}
                        {skill.id === "calendar" && isConnected("calendar") && (
                          <button
                            onClick={() => disconnectSkill("calendar")}
                            className={`mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[10px] transition ${isDark ? "text-slate-600 hover:text-red-400" : "text-slate-400 hover:text-red-500"}`}
                          >
                            <Link2Off className="h-3 w-3" /> Disconnect Calendar
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Inline task list */}
          {activeSkill === "tasks" && tasks.length > 0 && (
            <div className="border-t px-3 py-3" style={bd}>
              <div className="mb-2 flex items-center justify-between">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  Tasks ({pendingCount} pending)
                </span>
                {doneCount > 0 && (
                  <button onClick={() => clearCompletedTasks()} className={`text-[10px] transition ${isDark ? "text-slate-600 hover:text-slate-400" : "text-slate-400 hover:text-slate-600"}`}>
                    Clear done
                  </button>
                )}
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {tasks.filter((t) => !t.done).map((t) => (
                  <div key={t.id} className="group flex items-center gap-2">
                    <button onClick={() => toggleTask(t.id)} className="shrink-0">
                      <Circle className={`h-4 w-4 ${isDark ? "text-slate-600 hover:text-violet-400" : "text-slate-300 hover:text-violet-500"}`} />
                    </button>
                    <span className={`flex-1 truncate text-xs ${isDark ? "text-slate-300" : "text-slate-600"}`}>{t.text}</span>
                    <button onClick={() => deleteTask(t.id)} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                      <X className={`h-3 w-3 ${isDark ? "text-slate-600 hover:text-red-400" : "text-slate-300 hover:text-red-500"}`} />
                    </button>
                  </div>
                ))}
                {tasks.filter((t) => t.done).slice(0, 3).map((t) => (
                  <div key={t.id} className="group flex items-center gap-2 opacity-50">
                    <button onClick={() => toggleTask(t.id)} className="shrink-0">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500/50" />
                    </button>
                    <span className={`flex-1 truncate text-xs line-through ${isDark ? "text-slate-500" : "text-slate-400"}`}>{t.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inline file scan info */}
          {activeSkill === "files" && scannedFiles.length > 0 && (
            <div className="border-t px-3 py-3" style={bd}>
              <div className="mb-2 flex items-center justify-between">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  Scanned: {scannedFolderName}
                </span>
                <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>{scannedFiles.length} files</span>
              </div>
              <button
                onClick={triggerFolderScan}
                className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition ${
                  isDark ? "border-slate-700 text-slate-400 hover:bg-slate-700/40" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                <Upload className="h-3 w-3" /> Scan different folder
              </button>
            </div>
          )}

          {/* Inline calendar today */}
          {activeSkill === "calendar" && (
            <div className="border-t px-3 py-3" style={bd}>
              <div className="mb-2 flex items-center justify-between">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  Today
                </span>
                <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>{todayEventCount} event(s)</span>
              </div>
              {events.filter((e) => e.date === todayStr()).length === 0 ? (
                <p className={`text-[11px] ${isDark ? "text-slate-600" : "text-slate-400"}`}>No events today</p>
              ) : (
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {events.filter((e) => e.date === todayStr()).map((e) => (
                    <div key={e.id} className="group flex items-center gap-2">
                      <span className={`text-[11px] font-mono ${isDark ? "text-amber-400/70" : "text-amber-600"}`}>{e.time || "—"}</span>
                      <span className={`flex-1 truncate text-xs ${isDark ? "text-slate-300" : "text-slate-600"}`}>{e.title}</span>
                      <button onClick={() => deleteEvent(e.id)} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                        <X className={`h-3 w-3 ${isDark ? "text-slate-600 hover:text-red-400" : "text-slate-300 hover:text-red-500"}`} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>

        {/* --- Main: Chat Panel --- */}
        <main className={`flex flex-1 flex-col rounded-2xl border ${isDark ? "border-slate-700/60 bg-slate-800/20" : "border-slate-200 bg-white/60"}`}>
          {/* Header */}
          <div className="flex items-center justify-between border-b px-5 py-3" style={bd}>
            <div className="flex items-center gap-3">
              <button onClick={() => setSkillPanelOpen((v) => !v)} className={`rounded-lg p-1.5 transition lg:hidden ${isDark ? "hover:bg-slate-700/50" : "hover:bg-slate-100"}`}>
                <Zap className="h-4 w-4 text-slate-500" />
              </button>
              <div className={`flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br ${currentSkill.gradient} text-white`}>
                {currentSkill.icon}
              </div>
              <div>
                <h2 className="text-sm font-semibold">{currentSkill.label} Assistant</h2>
                <p className={`text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  {currentSkill.connected ? (
                    <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ready{currentSkill.provider ? ` — ${currentSkill.provider}` : ""}</span>
                  ) : (
                    <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" /> Setup required</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {messages.length === 0 ? (
              <EmptyState skill={currentSkill} isDark={isDark} onQuickAction={handleQuickAction} scannedCount={scannedFiles.length} />
            ) : (
              <div className="space-y-4">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} isDark={isDark} />
                ))}
                {isThinking && <ThinkingIndicator isDark={isDark} />}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t px-4 py-3" style={bd}>
            <div className={`flex items-end gap-2 rounded-xl border p-2 transition ${isDark ? "border-slate-700/60 bg-slate-800/40" : "border-slate-200 bg-white/80"}`}>
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${isDark ? "bg-slate-700/50" : "bg-slate-100"}`}>
                <span className={currentSkill.color}>{currentSkill.icon}</span>
              </div>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask your ${currentSkill.label.toLowerCase()} assistant...`}
                rows={1}
                className={`flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-slate-500 ${isDark ? "text-slate-200" : "text-slate-700"}`}
                style={{ maxHeight: "120px" }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isThinking}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-emerald-600 to-cyan-600 text-white shadow transition hover:from-emerald-500 hover:to-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className={`mt-2 text-center text-[10px] ${isDark ? "text-slate-600" : "text-slate-400"}`}>
              <kbd className={`rounded px-1 py-0.5 ${isDark ? "bg-slate-700" : "bg-slate-200"}`}>Enter</kbd> to send
              {" · "}
              <kbd className={`rounded px-1 py-0.5 ${isDark ? "bg-slate-700" : "bg-slate-200"}`}>Shift+Enter</kbd> new line
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState({ skill, isDark, onQuickAction, scannedCount }: { skill: SkillConfig; isDark: boolean; onQuickAction: (p: string, a?: string) => void; scannedCount: number }) {
  const icons: Record<SkillId, React.ReactNode> = {
    email: <Inbox className="h-10 w-10 text-blue-400" />,
    calendar: <CalendarClock className="h-10 w-10 text-amber-400" />,
    files: <FolderSync className="h-10 w-10 text-emerald-400" />,
    tasks: <ListTodo className="h-10 w-10 text-violet-400" />,
    research: <Brain className="h-10 w-10 text-cyan-400" />,
    actions: <Zap className="h-10 w-10 text-amber-400" />,
  };
  const descriptions: Record<SkillId, string> = {
    email: "Connect your email to summarise your inbox, clean up newsletters, draft replies, and triage messages.",
    calendar: skill.connected
      ? "Connected to Google Calendar — add events, see your agenda, and find free time."
      : "Connect Google Calendar to add events, see your agenda, and find free time slots.",
    files: scannedCount > 0
      ? `${scannedCount} files scanned. Ask me to analyse, organise, find large files, or spot duplicates.`
      : "Scan a local folder to get file breakdowns, organisation suggestions, and find space hogs.",
    tasks: "Add tasks, check them off, and get suggestions on what to do next. Everything is saved locally.",
    research: "Query and synthesise findings from your past Deep Search sessions.",
    actions: "Take real actions: list files, read/write files, create notes, search notes, copy to clipboard. Destructive actions require your approval.",
  };

  return (
    <div className="flex h-full flex-col items-center justify-center text-center px-4">
      <div className={`mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br ${skill.gradient} bg-opacity-20`} style={{ background: `linear-gradient(135deg, ${isDark ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.6)"}, ${isDark ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.3)"})` }}>
        {icons[skill.id]}
      </div>
      <h3 className={`mb-2 text-lg font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>{skill.label} Assistant</h3>
      <p className={`mb-6 max-w-md text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>{descriptions[skill.id]}</p>
      {!skill.connected && (
        <div className={`mb-6 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${isDark ? "border-amber-500/30 bg-amber-500/5 text-amber-400" : "border-amber-300 bg-amber-50 text-amber-600"}`}>
          <AlertCircle className="h-4 w-4 shrink-0" /> Connect your {skill.label.toLowerCase()} provider to enable this skill
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {skill.quickActions.map((qa, i) => (
          <button key={i} onClick={() => onQuickAction(qa.prompt, qa.action)} className={`rounded-lg px-3.5 py-2 text-xs font-medium transition ${isDark ? "bg-slate-800/50 hover:bg-slate-800/80 text-slate-400" : "bg-white/70 hover:bg-white text-slate-600"}`}>
            {qa.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ msg, isDark }: { msg: ChatMessage; isDark: boolean }) {
  const renderContent = (content: string) => {
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let key = 0;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(...renderInline(content.slice(lastIndex, match.index), key));
        key += 100;
      }
      parts.push(
        <pre key={`cb-${key++}`} className={`my-2 overflow-x-auto rounded-lg p-3 text-xs ${isDark ? "bg-slate-900/80 text-slate-300" : "bg-slate-200/80 text-slate-700"}`}>
          <code>{match[2]}</code>
        </pre>
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      parts.push(...renderInline(content.slice(lastIndex), key));
    }
    return parts;
  };

  const renderInline = (text: string, startKey: number): React.ReactNode[] => {
    return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|`[^`]+`|\n|- )/).map((part, i) => {
      if (!part) return null;
      const k = startKey + i;
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={k}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("*") && part.endsWith("*") && !part.startsWith("**")) return <em key={k} className="opacity-70">{part.slice(1, -1)}</em>;
      if (part.startsWith("~~") && part.endsWith("~~")) return <del key={k} className="opacity-50">{part.slice(2, -2)}</del>;
      if (part.startsWith("`") && part.endsWith("`")) return <code key={k} className={`rounded px-1 py-0.5 text-xs ${isDark ? "bg-slate-700/60" : "bg-slate-200/80"}`}>{part.slice(1, -1)}</code>;
      if (part === "\n") return <br key={k} />;
      if (part === "- ") return <span key={k} className="inline-block w-3">•</span>;
      return <span key={k}>{part}</span>;
    });
  };

  return (
    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${msg.role === "user" ? "bg-gradient-to-r from-emerald-600 to-cyan-600 text-white" : isDark ? "bg-slate-800/60 text-slate-200" : "bg-slate-100 text-slate-700"}`}>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">
          {renderContent(msg.content)}
        </div>
        <p className={`mt-1.5 text-[10px] ${msg.role === "user" ? "text-white/50" : isDark ? "text-slate-500" : "text-slate-400"}`}>
          {new Date(msg.timestamp).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}

function ThinkingIndicator({ isDark }: { isDark: boolean }) {
  return (
    <div className="flex justify-start">
      <div className={`rounded-2xl px-4 py-3 ${isDark ? "bg-slate-800/60" : "bg-slate-100"}`}>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500" style={{ animationDelay: "0ms" }} />
            <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500" style={{ animationDelay: "150ms" }} />
            <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500" style={{ animationDelay: "300ms" }} />
          </div>
          <span className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>Thinking...</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connect Modal (Email only — others work natively)
// ---------------------------------------------------------------------------

const EMAIL_PROVIDERS = [
  { name: "Gmail", icon: <Mail className="h-5 w-5 text-red-400" />, hint: "Sign in with Google — uses read-only access", oauth: true },
  { name: "Outlook", icon: <Mail className="h-5 w-5 text-blue-400" />, hint: "Microsoft Graph API (coming soon)", oauth: false },
  { name: "IMAP / Custom", icon: <Mail className="h-5 w-5 text-slate-400" />, hint: "Manual IMAP server (coming soon)", oauth: false },
];

function ConnectModal({ skillId, isDark, onConnect, onClose, onGmailOAuth }: { skillId: SkillId; isDark: boolean; onConnect: (id: SkillId, provider: string) => void; onClose: () => void; onGmailOAuth: () => void }) {
  const def = SKILL_DEFINITIONS[skillId];
  const providers = skillId === "email" ? EMAIL_PROVIDERS : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className={`w-full max-w-lg rounded-2xl border p-6 shadow-2xl ${isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${def.gradient} text-white`}>{def.icon}</div>
            <div>
              <h2 className="text-lg font-bold">Connect {def.label}</h2>
              <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>Choose a provider</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800/30"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2">
          {providers.map((p) => (
            <button
              key={p.name}
              onClick={() => {
                if (p.name === "Gmail") {
                  onGmailOAuth();
                } else if (p.oauth === false) {
                  toast.info(`${p.name} integration is coming soon`);
                } else {
                  onConnect(skillId, p.name);
                }
              }}
              className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3.5 text-left transition ${
                p.oauth !== false
                  ? isDark ? "border-slate-700/60 hover:border-emerald-500/30 hover:bg-slate-800/50" : "border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50"
                  : isDark ? "border-slate-700/40 opacity-50" : "border-slate-200 opacity-50"
              }`}
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isDark ? "bg-slate-800" : "bg-slate-50"}`}>{p.icon}</div>
              <div className="flex-1">
                <p className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>{p.name}</p>
                <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>{p.hint}</p>
              </div>
              <ChevronRight className={`h-4 w-4 ${isDark ? "text-slate-600" : "text-slate-300"}`} />
            </button>
          ))}
        </div>
        <p className={`mt-4 text-center text-[11px] ${isDark ? "text-slate-600" : "text-slate-400"}`}>
          Gmail uses Google OAuth with read-only access.
          <br />Your tokens are stored locally in your browser.
        </p>
      </div>
    </div>
  );
}
