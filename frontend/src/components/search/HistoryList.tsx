/**
 * Memoized history list component with virtual scrolling
 * Prevents unnecessary re-renders when parent state changes
 */

import { memo, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

type HistoryListProps = {
  items: string[];
  onSelect: (item: string) => void;
  isDark?: boolean;
};

function HistoryListComponent({ items, onSelect, isDark = true }: HistoryListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Virtual scrolling for large lists
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44, // Approximate height of each item
    overscan: 5, // Render 5 extra items above/below viewport
  });

  const handleSelect = useCallback(
    (item: string) => {
      onSelect(item);
    },
    [onSelect]
  );

  if (items.length === 0) return null;

  return (
    <div
      className="glass-card absolute left-0 right-0 top-full z-20 mt-2 border border-[var(--glass-border)] shadow-xl"
      role="listbox"
      aria-label="Search history"
    >
      <p className="px-2 py-2 text-xs font-medium text-slate-500">
        Recent searches
      </p>
      <div
        ref={parentRef}
        className="max-h-[300px] overflow-auto p-2"
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
            const item = items[virtualItem.index];
            return (
              <button
                key={virtualItem.key}
                role="option"
                aria-selected={false}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(item);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    handleSelect(item);
                  }
                }}
                className={`absolute left-0 top-0 w-full rounded-lg px-4 py-2 text-left text-sm transition ${
                  isDark
                    ? 'hover:bg-slate-700/50'
                    : 'hover:bg-slate-200/50'
                }`}
                style={{
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                {item}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Memoize to prevent re-renders when parent state changes
export const HistoryList = memo(HistoryListComponent, (prev, next) => {
  return (
    prev.items === next.items &&
    prev.onSelect === next.onSelect &&
    prev.isDark === next.isDark
  );
});
