"use client";

import { AlertCircle, X } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export default function ClearHistoryModal({ open, onClose, onConfirm }: Props) {
  const { isDark } = useTheme();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl ${
          isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/15">
              <AlertCircle className="h-5 w-5 text-red-400" />
            </div>
            <h2 className="text-lg font-bold">Clear History</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800/30"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className={`mb-6 text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
          This will clear your local search history and assistant context. Your model keys and provider
          credentials will not be affected. Continue?
        </p>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              isDark
                ? "border border-slate-600 text-slate-300 hover:bg-slate-800"
                : "border border-slate-300 text-slate-600 hover:bg-slate-100"
            }`}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
          >
            Clear History
          </button>
        </div>
      </div>
    </div>
  );
}
