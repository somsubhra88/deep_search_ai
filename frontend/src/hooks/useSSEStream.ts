/**
 * Reusable hook for Server-Sent Events streaming
 * Handles connection, parsing, error handling, and cleanup
 */

import { useCallback, useRef, useEffect } from 'react';

type SSEMessage = {
  event?: string;
  data: unknown;
};

type UseSSEStreamOptions = {
  onMessage: (message: SSEMessage) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
  enabled?: boolean;
};

export function useSSEStream() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const start = useCallback(
    async (url: string, body: unknown, options: UseSSEStreamOptions) => {
      const { onMessage, onError, onComplete, enabled = true } = options;

      if (!enabled) return;

      // Cleanup previous stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            if (onComplete) onComplete();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim() || line.startsWith(':')) continue;

            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6).trim();
              if (!dataStr) continue;

              try {
                const parsed = JSON.parse(dataStr);
                onMessage({ data: parsed });
              } catch (parseErr) {
                console.warn('Failed to parse SSE data:', dataStr);
              }
            } else if (line.startsWith('event: ')) {
              // Handle custom event types if needed
              const eventType = line.slice(7).trim();
              // Store event type for next data line
            }
          }
        }
      } catch (error) {
        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            // Intentional abort, don't report error
            return;
          }
          if (onError) onError(error);
        }
      } finally {
        readerRef.current = null;
        abortControllerRef.current = null;
      }
    },
    []
  );

  const stop = useCallback(() => {
    if (readerRef.current) {
      readerRef.current.cancel();
      readerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return { start, stop };
}
