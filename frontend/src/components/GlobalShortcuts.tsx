"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCommandPalette } from "@/context/CommandPaletteContext";

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  const role = target.getAttribute("role");
  const editable = target.isContentEditable;
  return tag === "input" || tag === "textarea" || tag === "select" || editable || role === "textbox" || role === "searchbox";
}

export default function GlobalShortcuts() {
  const router = useRouter();
  const { runAction } = useCommandPalette();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || isEditableElement(e.target)) return;

      switch (e.key) {
        case "1":
          e.preventDefault();
          router.push("/search");
          break;
        case "2":
          e.preventDefault();
          router.push("/assistant");
          break;
        case "l":
        case "L":
          e.preventDefault();
          runAction({ type: "search_focus" });
          break;
        case "n":
        case "N":
          e.preventDefault();
          try {
            sessionStorage.setItem("assistant-new-chat", "1");
          } catch { /* ignore */ }
          router.push("/assistant");
          runAction({ type: "assistant_new_chat" });
          break;
        case "e":
        case "E":
          e.preventDefault();
          runAction({ type: "toggle", key: "explain_mode" });
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, runAction]);

  return null;
}
