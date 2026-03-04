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
  const [prevRunning, setPrevRunning] = useState(isToolRunning);
  const [debouncedStopped, setDebouncedStopped] = useState(!isToolRunning);
  const runStartRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track tool start/stop transitions during render (React-safe state adjustment)
  if (isToolRunning && !prevRunning) {
    setPrevRunning(true);
    if (debouncedStopped) setDebouncedStopped(false);
  }
  if (!isToolRunning && prevRunning) {
    setPrevRunning(false);
  }

  useEffect(() => {
    if (isToolRunning) {
      runStartRef.current = Date.now();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    } else {
      // Tool stopped — hold visual for remainder of MIN_DISPLAY_MS
      const elapsed = Date.now() - runStartRef.current;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);

      const commit = () => {
        timerRef.current = null;
        setDebouncedStopped(true);
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
  }, [isToolRunning]);

  const visualRunning = isToolRunning || !debouncedStopped;

  return {
    isToolRunning: visualRunning,
    currentToolName: visualRunning ? currentToolName : null,
    displayEvent: visualRunning ? latestEvent : null,
  };
}
