/** 850 ms · 12.3 s · 4m 05s · 1h 12m */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  // Round once, then split, so 3m 59.6s reads 4m 00s rather than 3m 60s.
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
  const minutes = Math.round(total / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Percent change from `before` to `now`, or null when there is no baseline. */
export function percentChange(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}
