/**
 * Memoized sessions list component with virtual scrolling
 * Optimized for rendering large session histories
 */

import { memo, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { History, X } from 'lucide-react';

type Session = {
  id: string;
  query: string;
  timestamp: number;
  metadata: {
    self_reflection?: { quality_score?: number };
    sources?: Array<{ id: number; title: string; url: string; domain: string; type: string }>;
    [key: string]: unknown;
  } | null;
  report: string;
};

type SessionsListProps = {
  sessions: Session[];
  onSelect: (session: Session) => void;
  onClose: () => void;
  isDark?: boolean;
};

function SessionsListComponent({ sessions, onSelect, onClose, isDark = true }: SessionsListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76, // Approximate height of each session card
    overscan: 3,
  });

  const handleSelect = useCallback(
    (session: Session) => {
      onSelect(session);
    },
    [onSelect]
  );

  return (
    <div
      className={`glass-card mb-6 border border-[var(--glass-border)] p-4 ${
        isDark ? '' : 'bg-white/80'
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-400">
          <History className="h-4 w-4" /> Research Sessions
        </h3>
        <button
          onClick={onClose}
          className="rounded-lg p-1 hover:bg-slate-700/30"
          aria-label="Close sessions"
        >
          <X className="h-4 w-4 text-slate-500" />
        </button>
      </div>
      <div
        ref={parentRef}
        className="max-h-[400px] overflow-auto"
        style={{ contain: 'strict' }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const session = sessions[virtualItem.index];
            return (
              <button
                key={session.id}
                onClick={() => handleSelect(session)}
                className={`absolute left-0 top-0 w-full rounded-xl px-4 py-3 text-left transition ${
                  isDark ? 'hover:bg-slate-700/50' : 'hover:bg-slate-100'
                }`}
                style={{
                  transform: `translateY(${virtualItem.start}px)`,
                  height: `${virtualItem.size}px`,
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="max-w-[70%] truncate text-sm font-medium">
                    {session.query}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(session.timestamp).toLocaleDateString()}
                  </span>
                </div>
                {session.metadata?.self_reflection?.quality_score && (
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span>Quality: {session.metadata.self_reflection.quality_score}/10</span>
                    <span>·</span>
                    <span>{session.metadata.sources?.length || 0} sources</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Memoize to prevent re-renders
export const SessionsList = memo(SessionsListComponent, (prev, next) => {
  return (
    prev.sessions === next.sessions &&
    prev.onSelect === next.onSelect &&
    prev.onClose === next.onClose &&
    prev.isDark === next.isDark
  );
});
