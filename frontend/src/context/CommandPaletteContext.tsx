"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from "react";

export type CommandAction =
  | { type: "route"; path: string }
  | { type: "toggle"; key: string }
  | { type: "search_focus" }
  | { type: "assistant_new_chat" }
  | { type: "clear_history" }
  | { type: "open_persona"; persona_id: string }
  | { type: "clear_cache" };

export type CommandPaletteHandlers = {
  toggle?: (key: string) => void;
  searchFocus?: () => void;
  assistantNewChat?: () => void;
  clearHistoryStateRefresh?: () => void;
};

type CommandPaletteContextValue = {
  registerHandlers: (handlers: CommandPaletteHandlers) => () => void;
  runAction: (action: CommandAction) => void;
};

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef<CommandPaletteHandlers>({});

  const registerHandlers = useCallback((handlers: CommandPaletteHandlers) => {
    const prev = handlersRef.current;
    handlersRef.current = { ...prev, ...handlers };
    return () => {
      handlersRef.current = prev;
    };
  }, []);

  const runAction = useCallback((action: CommandAction) => {
    const h = handlersRef.current;
    switch (action.type) {
      case "toggle":
        h.toggle?.(action.key);
        break;
      case "search_focus":
        h.searchFocus?.();
        break;
      case "assistant_new_chat":
        h.assistantNewChat?.();
        break;
      case "clear_history":
        h.clearHistoryStateRefresh?.();
        break;
      default:
        break;
    }
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ registerHandlers, runAction }}>
      {children}
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) {
    return {
      registerHandlers: (_: CommandPaletteHandlers) => () => {},
      runAction: (_: CommandAction) => {},
    };
  }
  return ctx;
}
