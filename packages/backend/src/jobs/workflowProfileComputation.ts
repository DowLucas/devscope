import type { SQL } from "bun";
import { sql as Sql } from "bun";
import { getOrgDeveloperIds } from "../services/developerLink";
import { upsertWorkflowProfile } from "../db";
import { inList } from "../db/utils";
import type { WorkflowIntentProfile } from "@devscope/shared";
import { CONFIDENCE } from "../ai/typesafe";
import {
  MAX_EPISODES,
  rateEpisodes,
  recoveryQualityFrom,
  toVerdicts,
} from "../ai/detection/recoveryQuality";
import {
  computeDimensions,
  extractFailureEpisodes,
  sessionsByIntent,
} from "../services/workflowDimensions";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // Daily

export function startWorkflowProfileComputation(sql: SQL) {
  const g = globalThis as any;
  if (g.__gc_workflow_startup_timeout) clearTimeout(g.__gc_workflow_startup_timeout);
  if (g.__gc_workflow_interval) clearInterval(g.__gc_workflow_interval);

  async function compute() {
    try {
      const orgs = await sql`
        SELECT DISTINCT organization_id FROM organization_developer
        WHERE organization_id IS NOT NULL`;

      // Normalize to day boundaries so the upsert unique constraint
      // (developer_id, period_start, period_end) can deduplicate properly
      const periodEnd = new Date();
      periodEnd.setUTCHours(0, 0, 0, 0);
      const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

      for (const org of orgs as any[]) {
        const orgId = org.organization_id;
        const devIds = await getOrgDeveloperIds(sql, orgId);

        for (const devId of devIds) {
          // Check if we already computed recently
          const [existing] = await sql`
            SELECT computed_at, by_intent FROM workflow_profiles
            WHERE developer_id = ${devId}
              AND period_start >= ${periodStart.toISOString()}::timestamptz
            LIMIT 1
          ` as any[];

          // Rows from before migration 042 lack by_intent; recompute those so
          // the new dimensions appear without waiting for the next period.
          if (existing && existing.by_intent != null) {
            const lastComputed = new Date(existing.computed_at);
            if (periodEnd.getTime() - lastComputed.getTime() < 6 * 24 * 60 * 60 * 1000) continue;
          }

          // Get session data for this developer in the period
          const sessions = await sql`
            SELECT id, started_at, ended_at, session_intent, session_intent_confidence,
              EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at)) / 60 as duration_min
            FROM sessions
            WHERE developer_id = ${devId}
              AND started_at >= ${periodStart.toISOString()}::timestamptz
              AND started_at < ${periodEnd.toISOString()}::timestamptz
          ` as any[];

          if (sessions.length === 0) continue;

          // Get events for those sessions
          const sessionIds = sessions.map((s: any) => s.id);
          const events = await sql`
            SELECT event_type, session_id, payload, created_at
            FROM events
            WHERE session_id IN (${inList(sessionIds)})
            ORDER BY created_at ASC
          ` as any[];

          const overall = computeDimensions(sessions, events);

          // Model-rated recovery over the most recent failure episodes. Null
          // when TypeSafe is unavailable; the dashboard then falls back to the
          // heuristic recovery_speed, so nothing gets weaker.
          const episodes = extractFailureEpisodes(events).slice(-MAX_EPISODES);
          const ratings = await rateEpisodes(episodes, { sql, orgId });
          const verdicts = ratings ? toVerdicts(episodes, ratings) : null;

          // Per-intent slices, so a debugging-heavy week is compared with
          // other debugging rather than read as a change in style.
          const byIntent: Record<string, WorkflowIntentProfile> = {};
          for (const [intent, slice] of sessionsByIntent(sessions, CONFIDENCE.floor)) {
            const ids = new Set(slice.map((s: any) => s.id));
            const d = computeDimensions(slice, events.filter((e: any) => ids.has(e.session_id)));
            byIntent[intent] = {
              iterative_vs_planning: d.iterative_vs_planning,
              tool_diversity: d.tool_diversity,
              recovery_speed: d.recovery_speed,
              recovery_quality: verdicts
                ? recoveryQualityFrom(verdicts.filter((v) => ids.has(v.session_id)))
                : null,
              session_depth: d.session_depth,
              prompt_density: d.prompt_density,
              agent_usage: d.agent_usage,
              sessions_analyzed: d.sessions_analyzed,
            };
          }

          await upsertWorkflowProfile(sql, {
            id: crypto.randomUUID(),
            organization_id: orgId,
            developer_id: devId,
            period_start: periodStart.toISOString(),
            period_end: periodEnd.toISOString(),
            iterative_vs_planning: overall.iterative_vs_planning,
            tool_diversity: overall.tool_diversity,
            recovery_speed: overall.recovery_speed,
            recovery_quality: verdicts ? recoveryQualityFrom(verdicts) : null,
            session_depth: overall.session_depth,
            prompt_density: overall.prompt_density,
            agent_usage: overall.agent_usage,
            by_intent: byIntent,
            raw_metrics: {
              ...overall.raw_metrics,
              failure_episodes: episodes.length,
              recovery_rated_episodes: verdicts?.length ?? 0,
              recovery_source: verdicts ? "typesafe" : "unavailable",
            },
            sessions_analyzed: overall.sessions_analyzed,
          });
        }
      }
    } catch (err) {
      console.error("[workflow] Profile computation error:", err);
    }
  }

  // Run immediately on startup, then daily
  g.__gc_workflow_startup_timeout = setTimeout(compute, 5_000);
  g.__gc_workflow_interval = setInterval(compute, CHECK_INTERVAL_MS);
  console.log("[workflow] Workflow profile computation started (daily)");
}
