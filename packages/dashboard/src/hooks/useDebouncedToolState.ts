import { useState, useEffect, useRef } from "react";
import type { DevscopeEvent } from "@devscope/shared";

const MIN_DISPLAY_MS = 600;

interface DebouncedToolState {
  isToolRunning: boolean;
  currentToolName: string | null;
  displayEvent: DevscopeEvent | null;
}

/**
 * Holds the "tool running" visual state for a minimum duration so that
 * sub-second tool calls don't flicker in the UI.
 */
export function useDebouncedToolState(
  isToolRunning: boolean,
  currentToolName: string | null,
  latestEvent: DevscopeEvent | null,
): DebouncedToolState {
  const [visual, setVisual] = useState<DebouncedToolState>({
    isToolRunning,
    currentToolName,
    displayEvent: latestEvent,
  });

  const runStartRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isToolRunning) {
      // Immediately show running state
      runStartRef.current = Date.now();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setVisual({ isToolRunning: true, currentToolName, displayEvent: latestEvent });
    } else {
      // Tool stopped — hold visual for remainder of MIN_DISPLAY_MS
      const elapsed = Date.now() - runStartRef.current;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);

      const commit = () => {
        timerRef.current = null;
        setVisual({ isToolRunning: false, currentToolName, displayEvent: latestEvent });
      };

      if (remaining > 0 && runStartRef.current > 0) {
        timerRef.current = setTimeout(commit, remaining);
      } else {
        commit();
      }
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isToolRunning, currentToolName, latestEvent]);

  return visual;
}
