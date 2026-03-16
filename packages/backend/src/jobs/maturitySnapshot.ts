import type { SQL } from "bun";
import { getOrgDeveloperIds } from "../services/developerLink";
import { broadcastToOrg } from "../ws/handler";
import { isAiAvailable } from "../ai/gemini";
import { runMaturityWorkflow } from "../ai/workflows/maturityWorkflow";

const CHECK_INTERVAL_MS = 60_000; // Check every minute

export function startMaturitySnapshotJob(sql: SQL) {
  const g = globalThis as any;
  if (g.__gc_maturity_interval) clearInterval(g.__gc_maturity_interval);

  let lastRunDate = "";

  async function check() {
    if (!isAiAvailable()) return;

    const today = new Date().toISOString().split("T")[0];
    if (today === lastRunDate) return;

    // Run at midnight UTC (hour 0)
    const currentHour = new Date().getUTCHours();
    if (currentHour !== 0) return;

    lastRunDate = today;

    try {
      const orgs = await sql`
        SELECT DISTINCT organization_id FROM organization_developer
        WHERE organization_id IS NOT NULL`;

      for (const org of orgs as any[]) {
        const orgId = org.organization_id;
        const devIds = await getOrgDeveloperIds(sql, orgId);
        if (devIds.length === 0) continue;

        try {
          const snapshot = await runMaturityWorkflow(sql, orgId, devIds);

          broadcastToOrg(orgId, {
            type: "maturity.updated",
            data: snapshot,
          });

          console.log(
            `[maturity] Org ${orgId}: score ${snapshot.overall_score}`
          );
        } catch (err) {
          console.error(`[maturity] Error for org ${orgId}:`, err);
        }
      }
    } catch (err) {
      console.error("[maturity] Error:", err);
    }
  }

  g.__gc_maturity_interval = setInterval(check, CHECK_INTERVAL_MS);
  console.log("[maturity] Maturity snapshot job started (daily at midnight UTC)");
}
