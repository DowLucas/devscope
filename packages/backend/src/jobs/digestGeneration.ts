import type { SQL } from "bun";
import { generateDigest } from "../db";

const CHECK_INTERVAL_MS = 60_000;

export function startDigestGeneration(sql: SQL) {
  const g = globalThis as any;

  // Clear previous interval to avoid leaks on hot reload
  if (g.__gc_digest_interval) {
    clearInterval(g.__gc_digest_interval);
  }

  let lastDailyDate = "";
  let lastWeeklyDate = "";

  async function check() {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday

    // Daily digest — generate once per day (skip if already exists)
    if (todayStr !== lastDailyDate) {
      const periodEnd = todayStr + "T00:00:00.000Z";
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const periodStart = yesterday.toISOString().slice(0, 10) + "T00:00:00.000Z";

      const [existing] = await sql`
        SELECT id FROM digests WHERE digest_type = 'daily' AND period_start = ${periodStart}::TIMESTAMPTZ`;

      if (!existing) {
        try {
          await generateDigest(sql, periodStart, periodEnd, "daily");
          console.log(`[digest] Generated daily digest for ${yesterday.toISOString().slice(0, 10)}`);
        } catch (err) {
          console.error("[digest] Failed to generate daily digest:", err);
        }
      }
      lastDailyDate = todayStr;
    }

    // Weekly digest — generate on Monday (skip if already exists)
    if (dayOfWeek === 1 && todayStr !== lastWeeklyDate) {
      const periodEnd = todayStr + "T00:00:00.000Z";
      const lastMonday = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const periodStart = lastMonday.toISOString().slice(0, 10) + "T00:00:00.000Z";

      const [existing] = await sql`
        SELECT id FROM digests WHERE digest_type = 'weekly' AND period_start = ${periodStart}::TIMESTAMPTZ`;

      if (!existing) {
        try {
          await generateDigest(sql, periodStart, periodEnd, "weekly");
          console.log(`[digest] Generated weekly digest for week of ${lastMonday.toISOString().slice(0, 10)}`);
        } catch (err) {
          console.error("[digest] Failed to generate weekly digest:", err);
        }
      }
      lastWeeklyDate = todayStr;
    }
  }

  g.__gc_digest_interval = setInterval(check, CHECK_INTERVAL_MS);
  console.log("[digest] Digest generation started (check interval: 60s)");
}
