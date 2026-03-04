import type { SQL } from "bun";
import {
  anonymizeOldSessions,
  purgeOldEvents,
  logRetentionPurge,
  getRetentionSettings,
} from "../db";
import { getOrgDeveloperIds } from "../services/developerLink";
import { logEthicsEvent } from "../utils/ethicsAudit";

const CHECK_INTERVAL_MS = 60_000; // Check every minute
const RUN_HOUR_UTC = 3; // Run at 3 AM UTC

export function startDataRetention(sql: SQL) {
  const g = globalThis as any;
  if (g.__gc_retention_interval) clearInterval(g.__gc_retention_interval);

  let lastRunDate = "";

  async function check() {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== RUN_HOUR_UTC) return;
    if (lastRunDate === todayStr) return;

    try {
      const orgs = await sql`SELECT id FROM organization`;

      for (const org of orgs as any[]) {
        const orgId = org.id;
        try {
          const devIds = await getOrgDeveloperIds(sql, orgId);
          if (devIds.length === 0) continue;

          const settings = await getRetentionSettings(sql, orgId);
          const now = new Date();
          const cutoff = new Date(Date.UTC(
            now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - settings.retention_days
          ));
          const cutoffDate = cutoff.toISOString();

          let sessionsAnonymized = 0;
          if (settings.anonymize_on_expire) {
            sessionsAnonymized = await anonymizeOldSessions(sql, devIds, cutoffDate);
          }

          const eventsDeleted = await purgeOldEvents(sql, devIds, cutoffDate);

          if (eventsDeleted > 0 || sessionsAnonymized > 0) {
            await logRetentionPurge(sql, orgId, eventsDeleted, sessionsAnonymized);
            logEthicsEvent(sql, orgId, "retention_purge_executed", {
              events_deleted: eventsDeleted,
              sessions_anonymized: sessionsAnonymized,
              retention_days: settings.retention_days,
            });
            console.log(
              `[retention] Org ${orgId}: deleted ${eventsDeleted} events, anonymized ${sessionsAnonymized} sessions (retention: ${settings.retention_days}d)`
            );
          }
        } catch (orgErr) {
          console.error(`[retention] Error processing org ${orgId}:`, orgErr);
        }
      }

      lastRunDate = todayStr;
    } catch (err) {
      console.error("[retention] Error:", err);
    }
  }

  g.__gc_retention_interval = setInterval(check, CHECK_INTERVAL_MS);
  console.log(`[retention] Data retention job started (runs daily at ${RUN_HOUR_UTC}:00 UTC)`);
}
