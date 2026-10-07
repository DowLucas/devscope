import { useEffect, useState } from "react";

/**
 * Current time in ms, refreshed every `intervalMs` while the tab is visible,
 * for UI that changes with time alone.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs]);

  return now;
}
