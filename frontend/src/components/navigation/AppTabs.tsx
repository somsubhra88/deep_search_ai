"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, MessageSquare } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

const TABS = [
  { href: "/search", label: "Search", icon: Search },
  { href: "/assistant", label: "Assistant", icon: MessageSquare },
] as const;

export default function AppTabs() {
  const pathname = usePathname();
  const { isDark } = useTheme();

  return (
    <nav className="flex items-center gap-1 rounded-xl border p-1"
      style={{
        borderColor: isDark ? "rgba(51,65,85,0.5)" : "rgba(203,213,225,0.8)",
        background: isDark ? "rgba(15,23,42,0.6)" : "rgba(255,255,255,0.7)",
      }}
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href === "/search" && pathname === "/");
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
              active
                ? isDark
                  ? "bg-emerald-500/15 text-emerald-400 shadow-sm shadow-emerald-500/10"
                  : "bg-emerald-500/10 text-emerald-600 shadow-sm"
                : isDark
                  ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-100/80"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
