import type { SQL } from "bun";
import { computeClaudeMdCorrelation } from "../db";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function startClaudeMdCorrelation(sql: SQL) {
  const g = globalThis as any;
  if (g.__gc_claudemd_interval) clearInterval(g.__gc_claudemd_interval);

  async function compute() {
    try {
      // Get all snapshots without correlations
      const uncorrelated = (await sql`
        SELECT s.id, s.project_path, s.organization_id, s.captured_at
        FROM claude_md_snapshots s
        LEFT JOIN claude_md_correlations c ON c.snapshot_id = s.id
        WHERE c.id IS NULL
        ORDER BY s.captured_at
        LIMIT 50
      `) as any[];

      for (const snap of uncorrelated) {
        const windowStart = new Date(snap.captured_at);
        const windowEnd = new Date(windowStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        // Only compute if the 7-day window has fully elapsed
        if (windowEnd.getTime() > Date.now()) continue;

        await computeClaudeMdCorrelation(
          sql,
          snap.id,
          snap.project_path,
          snap.organization_id,
          windowStart.toISOString(),
          windowEnd.toISOString()
        );
      }
    } catch (err) {
      console.error("[claudemd] Correlation error:", err);
    }
  }

  g.__gc_claudemd_interval = setInterval(compute, CHECK_INTERVAL_MS);
  console.log("[claudemd] CLAUDE.md correlation job started (every 6h)");
}
