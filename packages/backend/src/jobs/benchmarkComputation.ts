import type { SQL } from "bun";
import { getOrgDeveloperIds } from "../services/developerLink";
import {
  isBenchmarkOptedIn,
  upsertBenchmarkContribution,
  computeBenchmarkPercentiles,
  gatherBenchmarkMetrics,
} from "../db";
import { logEthicsEvent } from "../utils/ethicsAudit";

const CHECK_INTERVAL_MS = 60_000; // Check every minute

export function startBenchmarkComputation(sql: SQL) {
  const g = globalThis as any;
  if (g.__gc_benchmark_interval) clearInterval(g.__gc_benchmark_interval);

  let lastRunDay = -1;

  async function check() {
    const now = new Date();
    const currentDay = now.getUTCDay(); // 0 = Sunday

    // Run once per week on Sunday at midnight UTC
    if (currentDay !== 0 || now.getUTCHours() !== 0) return;
    if (currentDay === lastRunDay && lastRunDay === 0) return;
    lastRunDay = currentDay;

    try {
      const orgs = await sql`
        SELECT DISTINCT organization_id FROM organization_developer
        WHERE organization_id IS NOT NULL`;

      const periodEnd = now.toISOString().split("T")[0];
      const periodStart = new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0];

      for (const org of orgs as any[]) {
        const orgId = org.organization_id;

        // Only process opted-in orgs
        const optedIn = await isBenchmarkOptedIn(sql, orgId);
        if (!optedIn) continue;

        const devIds = await getOrgDeveloperIds(sql, orgId);
        if (devIds.length === 0) continue;

        try {
          const metrics = await gatherBenchmarkMetrics(sql, orgId, devIds, 7);
          await upsertBenchmarkContribution(sql, orgId, periodStart, periodEnd, metrics);

          logEthicsEvent(sql, orgId, "data_request_processed", {
            action: "benchmark_contribution",
            period: `${periodStart} to ${periodEnd}`,
            metrics_contributed: Object.keys(metrics),
          });

          console.log(`[benchmark] Org ${orgId}: contributed metrics`);
        } catch (err) {
          console.error(`[benchmark] Error for org ${orgId}:`, err);
        }
      }

      // Recompute percentiles across all contributions
      await computeBenchmarkPercentiles(sql, periodStart);
      console.log(`[benchmark] Percentiles recomputed for ${periodStart}`);
    } catch (err) {
      console.error("[benchmark] Error:", err);
    }
  }

  g.__gc_benchmark_interval = setInterval(check, CHECK_INTERVAL_MS);
  console.log("[benchmark] Benchmark computation started (weekly on Sunday)");
}
