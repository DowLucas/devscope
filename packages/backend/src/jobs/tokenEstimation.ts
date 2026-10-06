import type { SQL } from "bun";
import { estimateSession, getLegacySessions } from "../db";

// Replaces the legacy token undercount (plugins before 0.23.0, see migration
// 055) with a server-side estimate once a session has ended and settled.
// Only recent sessions: history is backfilled deliberately with
// scripts/token-backfill.ts (dry run first), not as a side effect of a deploy.

const CHECK_INTERVAL_MS = 10 * 60_000;
const BATCH = 50;
/** Late Stop/SessionEnd events land before the estimate freezes. */
const SETTLE_MINUTES = 15;
/** Sessions that ended within this window are the job's; older is the script's. */
const RECENT_DAYS = 2;

export async function estimateRecentOnce(sql: SQL): Promise<number> {
  const endedAfter = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
  const ids = await getLegacySessions(sql, { limit: BATCH, endedAfter, settledMinutes: SETTLE_MINUTES });
  for (const id of ids) await estimateSession(sql, id, true);
  return ids.length;
}

export function startTokenEstimation(sql: SQL) {
  const g = globalThis as any;
  if (g.__gc_token_estimation_interval) clearInterval(g.__gc_token_estimation_interval);

  if (process.env.DISABLE_TOKEN_ESTIMATION === "1") {
    console.log("[tokens] Estimation skipped — DISABLE_TOKEN_ESTIMATION=1");
    return;
  }

  let running = false;

  async function check() {
    if (running) return;
    running = true;
    try {
      const n = await estimateRecentOnce(sql);
      if (n) console.log(`[tokens] Estimated ${n} legacy session(s)`);
    } catch (err) {
      console.error("[tokens] Estimation failed:", err);
    } finally {
      running = false;
    }
  }

  setTimeout(() => void check(), 90_000);
  g.__gc_token_estimation_interval = setInterval(check, CHECK_INTERVAL_MS);
  console.log(`[tokens] Estimating ended legacy sessions every ${CHECK_INTERVAL_MS / 60_000} min`);
}
