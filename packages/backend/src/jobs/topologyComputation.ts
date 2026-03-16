import type { SQL } from "bun";
import { getOrgDeveloperIds } from "../services/developerLink";
import { computeTeamToolTopology, detectSkillGaps } from "../db";

const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

export function startTopologyComputation(sql: SQL) {
  const g = globalThis as any;
  if (g.__gc_topology_interval) clearInterval(g.__gc_topology_interval);

  async function compute() {
    try {
      const orgs = await sql`
        SELECT DISTINCT organization_id FROM organization_developer
        WHERE organization_id IS NOT NULL`;

      for (const org of orgs as any[]) {
        const orgId = org.organization_id;
        const devIds = await getOrgDeveloperIds(sql, orgId);
        if (devIds.length === 0) continue;

        const now = new Date();
        const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        await computeTeamToolTopology(sql, orgId, devIds, periodStart.toISOString(), now.toISOString());
        await detectSkillGaps(sql, orgId, devIds.length);
      }
    } catch (err) {
      console.error("[topology] Computation error:", err);
    }
  }

  g.__gc_topology_interval = setInterval(compute, CHECK_INTERVAL_MS);
  console.log("[topology] Topology computation started (every 2h)");
}
