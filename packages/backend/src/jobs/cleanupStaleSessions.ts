import type { SQL } from "bun";
import { getStaleActiveSessions, endSession } from "../db";
import { broadcast } from "../ws/handler";

const INTERVAL_MS = 60_000;
const STARTUP_STALE_THRESHOLD_MINUTES = 60 * 24; // 24 hours

export function startStaleSessionCleanup(sql: SQL) {
  const thresholdMinutes = Number(process.env.STALE_SESSION_TIMEOUT_MINUTES ?? 5);
  const g = globalThis as any;

  // Startup cleanup should only run once (not on hot reload)
  if (!g.__gc_cleanup_startup_done) {
    g.__gc_cleanup_startup_done = true;

    // On startup, only close sessions that have been idle for 24+ hours.
    (async () => {
      try {
        const startupStale = await getStaleActiveSessions(sql, STARTUP_STALE_THRESHOLD_MINUTES) as any[];
        if (startupStale.length > 0) {
          for (const session of startupStale) {
            await endSession(sql, session.id);
          }
          console.log(`[cleanup] Closed ${startupStale.length} stale session(s) idle for 24h+ from previous run`);
        }
      } catch (err) {
        console.error("[cleanup] Error during startup cleanup:", err);
      }
    })();
  }

  // Clear previous interval to avoid leaks on hot reload
  if (g.__gc_cleanup_interval) {
    clearInterval(g.__gc_cleanup_interval);
  }

  async function cleanup() {
    try {
      const staleSessions = await getStaleActiveSessions(sql, thresholdMinutes) as any[];

      if (staleSessions.length === 0) return;

      const affectedDeveloperIds = new Set<string>();

      for (const session of staleSessions) {
        await endSession(sql, session.id);
        affectedDeveloperIds.add(session.developer_id);
        broadcast({ type: "session.update", data: { sessionId: session.id, status: "ended" } });
        console.log(`[cleanup] Ended stale session ${session.id} (developer: ${session.developer_name})`);
      }

      for (const developerId of affectedDeveloperIds) {
        broadcast({ type: "developer.update", data: { developerId } });
      }

      console.log(`[cleanup] Cleaned up ${staleSessions.length} stale session(s)`);
    } catch (err) {
      console.error("[cleanup] Error during stale session cleanup:", err);
    }
  }

  g.__gc_cleanup_interval = setInterval(cleanup, INTERVAL_MS);

  console.log(`[cleanup] Stale session cleanup started (threshold: ${thresholdMinutes}min, interval: ${INTERVAL_MS / 1000}s)`);
}
