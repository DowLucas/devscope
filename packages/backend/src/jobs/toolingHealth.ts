import type { SQL } from "bun";
import {
  snapshotToolingHealth,
  detectToolingAnomalies,
} from "../db";
import { getOrgDeveloperIds } from "../services/developerLink";
import { broadcastToOrg } from "../ws/handler";

const CHECK_INTERVAL_MS = 60_000; // Check every minute
const SNAPSHOT_INTERVAL_HOURS = 1; // Snapshot every hour

export function startToolingHealthCheck(sql: SQL) {
  const g = globalThis as any;
  if (g.__gc_toolhealth_interval) clearInterval(g.__gc_toolhealth_interval);

  let lastSnapshotHour = -1;

  async function check() {
    const now = new Date();
    const currentHour = now.getUTCHours();

    // Run once per hour
    if (currentHour === lastSnapshotHour) return;
    lastSnapshotHour = currentHour;

    try {
      const orgs = await sql`
        SELECT DISTINCT organization_id FROM organization_developer
        WHERE organization_id IS NOT NULL`;

      for (const org of orgs as any[]) {
        const orgId = org.organization_id;
        const devIds = await getOrgDeveloperIds(sql, orgId);
        if (devIds.length === 0) continue;

        // Take snapshot
        await snapshotToolingHealth(sql, orgId, devIds);

        // Detect anomalies
        const anomalies = await detectToolingAnomalies(sql, orgId, devIds);

        for (const anomaly of anomalies) {
          // Create an alert event
          const alertId = crypto.randomUUID();
          await sql`
            INSERT INTO alert_events (id, rule_id, session_id, developer_id, tool_name, failure_count, organization_id)
            VALUES (${alertId}, 'tooling-health-auto', 'system', 'system', ${anomaly.tool_name}, ${Math.round(anomaly.current_rate)}, ${orgId})`;

          broadcastToOrg(orgId, {
            type: "alert.triggered",
            data: {
              id: alertId,
              tool_name: anomaly.tool_name,
              project_name: anomaly.project_name,
              failure_rate: anomaly.current_rate,
              baseline_rate: anomaly.baseline_rate,
              alert_type: "tooling_health_spike",
            },
          });

          console.log(
            `[toolhealth] Org ${orgId}: ${anomaly.tool_name} failure rate ${anomaly.current_rate}% (baseline ${anomaly.baseline_rate}%)`
          );
        }
      }
    } catch (err) {
      console.error("[toolhealth] Error:", err);
    }
  }

  g.__gc_toolhealth_interval = setInterval(check, CHECK_INTERVAL_MS);
  console.log(`[toolhealth] Tooling health check started (snapshots every ${SNAPSHOT_INTERVAL_HOURS}h)`);
}
