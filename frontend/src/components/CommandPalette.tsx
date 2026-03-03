"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Search,
  MessageCircle,
  HelpCircle,
  FileText,
  Shield,
  Plus,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "@/context/ThemeContext";
import { useCommandPalette, type CommandAction } from "@/context/CommandPaletteContext";
import {
  clearAllSearchHistory,
  clearActiveReport,
  clearActiveChat,
} from "@/lib/storage";

type CommandItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  icon_key?: string | null;
  group: string;
  shortcut?: string | null;
  action: Record<string, unknown>;
};

const CMD_USAGE_KEY = "deep-search-cmd-usage";

function trackCommandUsage(id: string) {
  try {
    const raw = localStorage.getItem(CMD_USAGE_KEY);
    const usage: Record<string, number> = raw ? JSON.parse(raw) : {};
    usage[id] = (usage[id] ?? 0) + 1;
    localStorage.setItem(CMD_USAGE_KEY, JSON.stringify(usage));
  } catch { /* ignore */ }
}

const ICON_MAP: Record<string, LucideIcon> = {
  search: Search,
  messageCircle: MessageCircle,
  helpCircle: HelpCircle,
  fileText: FileText,
  shield: Shield,
  plus: Plus,
  trash2: Trash2,
  zap: Zap,
};

function getIcon(iconKey: string | null | undefined): LucideIcon {
  if (!iconKey) return Search;
  return ICON_MAP[iconKey] ?? Zap;
}

/** Detect Mac for shortcut label (⌘ vs Ctrl+) */
function isMac(): boolean {
  if (typeof navigator === "undefined") return true;
  return /Mac|iPad|iPhone/i.test(navigator.platform);
}

/** Format shortcut for current OS: ⌘ on Mac, Ctrl+ on Windows/Linux */
function displayShortcut(shortcut: string | null | undefined): string {
  if (!shortcut) return "";
  if (isMac()) return shortcut;
  return shortcut.replace(/⌘/g, "Ctrl+").replace(/⇧/g, "Shift+");
}

/** Fallback commands when API is unavailable or returns empty (same schema as backend). */
const DEFAULT_COMMANDS: CommandItem[] = [
  { id: "nav_search", title: "Go to Search", subtitle: "Open search page", icon_key: "search", group: "Navigation", shortcut: "⌘1", action: { type: "route", path: "/search" } },
  { id: "nav_assistant", title: "Go to Assistant", subtitle: "Open assistant chat", icon_key: "messageCircle", group: "Navigation", shortcut: "⌘2", action: { type: "route", path: "/assistant" } },
  { id: "toggle_explain", title: "Toggle Explain mode", subtitle: "Show/hide explain panel", icon_key: "helpCircle", group: "Toggles", shortcut: "⌘E", action: { type: "toggle", key: "explain_mode" } },
  { id: "toggle_snippets", title: "Toggle Snippets only", subtitle: "Use snippets only for search", icon_key: "fileText", group: "Toggles", shortcut: null, action: { type: "toggle", key: "snippets_only" } },
  { id: "toggle_safe_search", title: "Toggle Safe search", subtitle: "Filter safe search", icon_key: "shield", group: "Toggles", shortcut: null, action: { type: "toggle", key: "safe_search" } },
  { id: "action_search_focus", title: "New Search", subtitle: "Focus search input", icon_key: "search", group: "Actions", shortcut: "⌘L", action: { type: "search_focus" } },
  { id: "action_new_chat", title: "New Assistant Chat", subtitle: "Start a new chat", icon_key: "plus", group: "Actions", shortcut: "⌘N", action: { type: "assistant_new_chat" } },
  { id: "action_clear_history", title: "Clear history", subtitle: "Clear search and assistant history (local)", icon_key: "trash2", group: "Actions", shortcut: null, action: { type: "clear_history" } },
  { id: "cache_clear", title: "Clear cache", subtitle: "Clear backend search and LLM caches", icon_key: "trash2", group: "Cache", shortcut: null, action: { type: "clear_cache" } },
];

type ConfirmType = "clear_history" | "clear_cache" | null;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function CommandPalette({ open, onOpenChange }: Props) {
  const router = useRouter();
  const { isDark } = useTheme();
  const { runAction } = useCommandPalette();
  const [commands, setCommands] = useState<CommandItem[]>(DEFAULT_COMMANDS);
  const [loading, setLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmType>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/commands", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CommandItem[] | null) => {
        if (Array.isArray(data) && data.length > 0) {
          setCommands(data);
        } else {
          setCommands(DEFAULT_COMMANDS);
        }
      })
      .catch(() => setCommands(DEFAULT_COMMANDS))
      .finally(() => setLoading(false));
  }, [open]);

  const executeAction = useCallback(
    (action: CommandItem["action"], close = true) => {
      const type = action?.type as string | undefined;
      if (!type) return;

      switch (type) {
        case "route": {
          const path = action.path as string | undefined;
          if (path) router.push(path);
          if (close) onOpenChange(false);
          break;
        }
        case "toggle":
        case "search_focus":
        case "clear_history":
          runAction(action as CommandAction);
          if (close) onOpenChange(false);
          break;
        case "assistant_new_chat": {
          try {
            sessionStorage.setItem("assistant-new-chat", "1");
          } catch { /* ignore */ }
          router.push("/assistant");
          runAction(action as CommandAction);
          if (close) onOpenChange(false);
          break;
        }
        case "open_persona": {
          const personaId = action.persona_id as string | undefined;
          if (personaId) router.push(`/assistant?persona_id=${encodeURIComponent(personaId)}`);
          if (close) onOpenChange(false);
          break;
        }
        case "clear_cache":
          runAction(action as CommandAction);
          if (close) onOpenChange(false);
          break;
        default:
          if (close) onOpenChange(false);
      }
    },
    [router, runAction, onOpenChange]
  );

  const handleSelect = useCallback(
    (value: string) => {
      const cmd = commands.find((c) => c.id === value);
      if (!cmd?.action) return;
      trackCommandUsage(cmd.id);

      const type = (cmd.action as { type?: string }).type;
      if (type === "clear_history") {
        setConfirmDialog("clear_history");
        return;
      }
      if (type === "clear_cache") {
        setConfirmDialog("clear_cache");
        return;
      }
      executeAction(cmd.action);
    },
    [commands, executeAction]
  );

  const handleConfirmClearHistory = useCallback(() => {
    trackCommandUsage("action_clear_history");
    clearAllSearchHistory();
    clearActiveReport();
    clearActiveChat();
    runAction({ type: "clear_history" });
    setConfirmDialog(null);
    onOpenChange(false);
    toast.success("History cleared");
  }, [runAction, onOpenChange]);

  const handleConfirmClearCache = useCallback(async () => {
    trackCommandUsage("cache_clear");
    try {
      const res = await fetch("/api/cache/clear", { method: "POST" });
      if (res.ok) toast.success("Cache cleared");
      else toast.error("Failed to clear cache");
    } catch {
      toast.error("Failed to clear cache");
    }
    setConfirmDialog(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const groups = commands.reduce<Record<string, CommandItem[]>>((acc, cmd) => {
    const g = cmd.group || "Other";
    if (!acc[g]) acc[g] = [];
    acc[g].push(cmd);
    return acc;
  }, {});

  const dialogBg = isDark ? "bg-slate-900/95" : "bg-white/95";
  const borderCls = isDark ? "border-slate-700" : "border-slate-200";

  return (
    <>
      <Command.Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) setConfirmDialog(null);
          onOpenChange(o);
        }}
        label="Command palette"
        className={`${dialogBg} [&_[data-cmdk-root]]:flex [&_[data-cmdk-root]]:flex-col [&_[data-cmdk-root]]:min-h-[16rem]`}
        overlayClassName="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm"
        contentClassName={`fixed left-[50%] top-[15%] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border shadow-2xl max-h-[80vh] flex flex-col min-h-[20rem] ${dialogBg} ${borderCls} backdrop-blur-xl`}
      >
        <Command.Input
          placeholder="Search commands…"
          className="flex h-12 w-full border-b border-[var(--glass-border)] bg-transparent px-4 text-sm outline-none placeholder:text-slate-500 text-slate-900 dark:text-slate-100"
          aria-label="Search commands"
        />
        <Command.List
          className="min-h-[200px] max-h-[min(55vh,380px)] overflow-y-auto p-2 shrink-0"
          aria-label="Command list"
        >
          {loading && (
            <div className="py-4 text-center text-sm text-slate-500">Loading commands…</div>
          )}
          <Command.Empty className="py-6 text-center text-sm text-slate-500">
            No commands found.
          </Command.Empty>
          {Object.entries(groups).map(([groupName, items]) => (
            <Command.Group
              key={groupName}
              heading={groupName}
              className="[&_[data-cmdk-group-heading]]:px-2 [&_[data-cmdk-group-heading]]:py-1.5 [&_[data-cmdk-group-heading]]:text-xs [&_[data-cmdk-group-heading]]:font-semibold [&_[data-cmdk-group-heading]]:uppercase [&_[data-cmdk-group-heading]]:tracking-wider [&_[data-cmdk-group-heading]]:text-slate-500"
            >
              {items.map((cmd) => {
                const Icon = getIcon(cmd.icon_key);
                return (
                  <Command.Item
                    key={cmd.id}
                    value={cmd.id}
                    keywords={[cmd.title, cmd.subtitle].filter(Boolean) as string[]}
                    onSelect={() => handleSelect(cmd.id)}
                    className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm outline-none transition [&[data-selected=true]]:bg-slate-200/70 dark:[&[data-selected=true]]:bg-slate-700/50 text-slate-900 dark:text-slate-100"
                    aria-label={cmd.title}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200/50 dark:bg-slate-700/50">
                      <Icon className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                    </span>
                    <div className="min-w-0 flex-1 text-left">
                      <div className="font-medium">{cmd.title}</div>
                      {cmd.subtitle && (
                        <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {cmd.subtitle}
                        </div>
                      )}
                    </div>
                    {cmd.shortcut && (
                      <kbd className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                        {displayShortcut(cmd.shortcut)}
                      </kbd>
                    )}
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
      </Command.Dialog>

      {/* Confirmation modals for destructive actions */}
      {confirmDialog === "clear_history" && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-history-title"
        >
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl ${isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}
          >
            <h2 id="clear-history-title" className="mb-2 text-lg font-bold">
              Clear history?
            </h2>
            <p className={`mb-6 text-sm ${isDark ? "text-slate-400" : "text-slate-600"}`}>
              This will clear your local search history and assistant context. Provider credentials
              will not be affected.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${isDark ? "border border-slate-600 text-slate-300 hover:bg-slate-800" : "border border-slate-300 text-slate-600 hover:bg-slate-100"}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClearHistory}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
              >
                Clear history
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog === "clear_cache" && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-cache-title"
        >
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl ${isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}
          >
            <h2 id="clear-cache-title" className="mb-2 text-lg font-bold">
              Clear cache?
            </h2>
            <p className={`mb-6 text-sm ${isDark ? "text-slate-400" : "text-slate-600"}`}>
              This will clear backend search and LLM caches. No user data will be removed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${isDark ? "border border-slate-600 text-slate-300 hover:bg-slate-800" : "border border-slate-300 text-slate-600 hover:bg-slate-100"}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClearCache}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
              >
                Clear cache
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
