"use client";

import { useState } from "react";
import { Sun, Moon } from "lucide-react";
import { Toaster } from "sonner";
import { useTheme } from "@/context/ThemeContext";
import AppTabs from "./AppTabs";

export default function SharedHeader() {
  const { theme, isDark, toggleTheme } = useTheme();
  const [logoError, setLogoError] = useState(false);

  return (
    <>
      <Toaster theme={theme} position="top-right" richColors closeButton />
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur-md transition-colors duration-300 ${
          isDark
            ? "border-slate-800/60 bg-slate-950/80"
            : "border-slate-200/80 bg-white/80"
        }`}
      >
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

          <button
            onClick={toggleTheme}
            className="rounded-xl p-2.5 transition hover:bg-slate-200/50 dark:hover:bg-slate-800/50"
            aria-label="Toggle theme"
          >
            {isDark ? (
              <Sun className="h-5 w-5 text-amber-400" />
            ) : (
              <Moon className="h-5 w-5 text-indigo-600" />
            )}
          </button>
        </div>
      </header>
    </>
  );
}
