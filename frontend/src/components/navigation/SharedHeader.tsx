"use client";

import { useState, useEffect } from "react";
import { Sun, Moon, Command } from "lucide-react";
import { Toaster } from "sonner";
import { useTheme } from "@/context/ThemeContext";
import AppTabs from "./AppTabs";
import CommandPalette from "@/components/CommandPalette";

export default function SharedHeader() {
  const { theme, isDark, toggleTheme } = useTheme();
  const [logoError, setLogoError] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <Toaster theme={theme} position="top-right" richColors closeButton />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <header className="sticky top-0 z-40 glass border-b border-[var(--glass-border)] transition-colors duration-300">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 shadow-lg shadow-emerald-500/25">
                {logoError ? (
                  <span className="flex h-full w-full items-center justify-center text-sm font-bold text-white">DS</span>
                ) : (
                  <img
                    src="/logo.png"
                    alt="Logo"
                    className="h-full w-full object-contain"
                    onError={() => setLogoError(true)}
                  />
                )}
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-bold tracking-tight">Deep Search AI</h1>
              </div>
            </div>
            <div className="ml-2">
              <AppTabs />
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="btn-polish flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm text-slate-500 hover:bg-slate-200/50 hover:text-slate-700 dark:hover:bg-slate-800/50 dark:hover:text-slate-300"
              aria-label="Open command palette (⌘K)"
              title="Command palette (⌘K)"
            >
              <Command className="h-4 w-4" />
              <span className="hidden sm:inline">⌘K</span>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="btn-polish rounded-xl p-2.5 transition hover:bg-slate-200/50 dark:hover:bg-slate-800/50"
              aria-label="Toggle theme"
            >
              {isDark ? (
                <Sun className="h-5 w-5 text-amber-400" />
              ) : (
                <Moon className="h-5 w-5 text-indigo-600" />
              )}
            </button>
          </div>
        </div>
      </header>
    </>
  );
}
