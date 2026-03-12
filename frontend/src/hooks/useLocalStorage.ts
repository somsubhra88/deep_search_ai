/**
 * Optimized localStorage hook with automatic serialization,
 * error handling, and optional compression
 */

import { useState, useEffect, useCallback, useRef } from 'react';

type UseLocalStorageOptions<T> = {
  compress?: boolean;
  ttl?: number; // Time to live in milliseconds
  sync?: boolean; // Sync across tabs
};

export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  options: UseLocalStorageOptions<T> = {}
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const { compress = false, ttl, sync = true } = options;
  const isInitializedRef = useRef(false);

  // Initialize state from localStorage
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      if (!item) return defaultValue;

      const parsed = JSON.parse(item);

      // Check TTL if configured
      if (ttl && parsed._timestamp) {
        const age = Date.now() - parsed._timestamp;
        if (age > ttl) {
          localStorage.removeItem(key);
          return defaultValue;
        }
        return parsed.value;
      }

      return parsed.value !== undefined ? parsed.value : parsed;
    } catch (error) {
      console.warn(`Error loading ${key} from localStorage:`, error);
      return defaultValue;
    }
  });

  // Update localStorage when state changes
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        const valueToStore = value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);

        const toSave = ttl
          ? { value: valueToStore, _timestamp: Date.now() }
          : { value: valueToStore };

        localStorage.setItem(key, JSON.stringify(toSave));

        // Dispatch custom event for cross-tab sync
        if (sync) {
          window.dispatchEvent(
            new CustomEvent('local-storage-change', {
              detail: { key, value: valueToStore },
            })
          );
        }
      } catch (error) {
        console.error(`Error saving ${key} to localStorage:`, error);
      }
    },
    [key, storedValue, ttl, sync]
  );

  // Clear the value
  const clearValue = useCallback(() => {
    try {
      localStorage.removeItem(key);
      setStoredValue(defaultValue);

      if (sync) {
        window.dispatchEvent(
          new CustomEvent('local-storage-change', {
            detail: { key, value: defaultValue },
          })
        );
      }
    } catch (error) {
      console.error(`Error clearing ${key} from localStorage:`, error);
    }
  }, [key, defaultValue, sync]);

  // Listen for changes from other tabs
  useEffect(() => {
    if (!sync) return;

    const handleStorageChange = (e: StorageEvent | CustomEvent) => {
      if (e instanceof StorageEvent) {
        if (e.key === key && e.newValue !== null) {
          try {
            const parsed = JSON.parse(e.newValue);
            const newValue = parsed.value !== undefined ? parsed.value : parsed;
            setStoredValue(newValue);
          } catch (error) {
            console.warn(`Error parsing storage event for ${key}:`, error);
          }
        }
      } else if (e instanceof CustomEvent) {
        const detail = e.detail as { key: string; value: T };
        if (detail.key === key) {
          setStoredValue(detail.value);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('local-storage-change', handleStorageChange as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('local-storage-change', handleStorageChange as EventListener);
    };
  }, [key, sync]);

  // Auto-cleanup expired values
  useEffect(() => {
    if (!ttl || isInitializedRef.current) return;
    isInitializedRef.current = true;

    const checkExpiry = () => {
      try {
        const item = localStorage.getItem(key);
        if (!item) return;

        const parsed = JSON.parse(item);
        if (parsed._timestamp) {
          const age = Date.now() - parsed._timestamp;
          if (age > ttl) {
            clearValue();
          }
        }
      } catch (error) {
        // Ignore
      }
    };

    checkExpiry();
    const interval = setInterval(checkExpiry, Math.min(ttl, 60000)); // Check at most every minute

    return () => clearInterval(interval);
  }, [key, ttl, clearValue]);

  return [storedValue, setValue, clearValue];
}

/**
 * Hook for managing arrays in localStorage with deduplication
 */
export function useLocalStorageArray<T extends { id: string }>(
  key: string,
  maxItems: number = 50
): {
  items: T[];
  addItem: (item: T) => void;
  removeItem: (id: string) => void;
  clear: () => void;
} {
  const [items, setItems, clear] = useLocalStorage<T[]>(key, []);

  const addItem = useCallback(
    (item: T) => {
      setItems((prev) => {
        // Remove duplicate if exists
        const filtered = prev.filter((i) => i.id !== item.id);
        // Add to front and limit size
        return [item, ...filtered].slice(0, maxItems);
      });
    },
    [setItems, maxItems]
  );

  const removeItem = useCallback(
    (id: string) => {
      setItems((prev) => prev.filter((i) => i.id !== id));
    },
    [setItems]
  );

  return { items, addItem, removeItem, clear };
}
