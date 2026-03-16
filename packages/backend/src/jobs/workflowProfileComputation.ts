import type { SQL } from "bun";
import { sql as Sql } from "bun";
import { getOrgDeveloperIds } from "../services/developerLink";
import { upsertWorkflowProfile } from "../db";
import { inList } from "../db/utils";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // Daily

export function startWorkflowProfileComputation(sql: SQL) {
  const g = globalThis as any;
  if (g.__gc_workflow_interval) clearInterval(g.__gc_workflow_interval);

  async function compute() {
    try {
      const orgs = await sql`
        SELECT DISTINCT organization_id FROM organization_developer
        WHERE organization_id IS NOT NULL`;

      const now = new Date();
      const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      for (const org of orgs as any[]) {
        const orgId = org.organization_id;
        const devIds = await getOrgDeveloperIds(sql, orgId);

        for (const devId of devIds) {
          // Check if we already computed recently
          const [existing] = await sql`
            SELECT computed_at FROM workflow_profiles
            WHERE developer_id = ${devId}
              AND period_start >= ${periodStart.toISOString()}::timestamptz
            LIMIT 1
          ` as any[];

          if (existing) {
            const lastComputed = new Date(existing.computed_at);
            if (now.getTime() - lastComputed.getTime() < 6 * 24 * 60 * 60 * 1000) continue;
          }

          // Get session data for this developer in the period
          const sessions = await sql`
            SELECT id, started_at, ended_at,
              EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at)) / 60 as duration_min
            FROM sessions
            WHERE developer_id = ${devId}
              AND started_at >= ${periodStart.toISOString()}::timestamptz
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

          // Compute dimensions
          const totalToolCalls = events.filter((e: any) =>
            e.event_type === "tool.complete" || e.event_type === "tool.fail"
          ).length;
          const uniqueTools = new Set(
            events
              .filter(
                (e: any) =>
                  e.event_type === "tool.complete" || e.event_type === "tool.fail"
              )
              .map((e: any) => {
                const p =
                  typeof e.payload === "string"
                    ? JSON.parse(e.payload)
                    : e.payload;
                return p?.toolName ?? "unknown";
              })
          ).size;

          const prompts = events.filter(
            (e: any) => e.event_type === "prompt.submit"
          );
          const totalDurationMin = sessions.reduce(
            (sum: number, s: any) => sum + (Number(s.duration_min) || 0),
            0
          );

          // tool_diversity: unique/total, 0-1
          const toolDiversity =
            totalToolCalls > 0
              ? Math.min(
                  uniqueTools / Math.max(totalToolCalls * 0.1, 1),
                  1
                )
              : null;

          // session_depth: avg duration / 120 min cap
          const avgDuration = totalDurationMin / sessions.length;
          const sessionDepth = Math.min(avgDuration / 120, 1);

          // prompt_density: prompts per minute / 2.0 cap
          const promptsPerMin =
            totalDurationMin > 0 ? prompts.length / totalDurationMin : 0;
          const promptDensity = Math.min(promptsPerMin / 2.0, 1);

          // agent_usage
          const sessionsWithAgents = new Set(
            events
              .filter((e: any) => e.event_type === "agent.start")
              .map((e: any) => e.session_id)
          ).size;
          const agentUsage =
            sessions.length > 0 ? sessionsWithAgents / sessions.length : 0;

          // iterative_vs_planning: high tool/prompt ratio = iterative
          const toolsPerPrompt =
            prompts.length > 0 ? totalToolCalls / prompts.length : 0;
          const iterativeVsPlanning = Math.min(toolsPerPrompt / 5, 1); // cap at 5 tools/prompt

          // recovery_speed: avg time between fail and next complete
          const recoveryTimes: number[] = [];
          const eventsBySession = new Map<string, any[]>();
          for (const e of events) {
            const arr = eventsBySession.get(e.session_id) ?? [];
            arr.push(e);
            eventsBySession.set(e.session_id, arr);
          }
          for (const [, sessionEvents] of eventsBySession) {
            for (let i = 0; i < sessionEvents.length; i++) {
              if (sessionEvents[i].event_type === "tool.fail") {
                for (let j = i + 1; j < sessionEvents.length; j++) {
                  if (sessionEvents[j].event_type === "tool.complete") {
                    const dt =
                      (new Date(sessionEvents[j].created_at).getTime() -
                        new Date(sessionEvents[i].created_at).getTime()) /
                      1000;
                    recoveryTimes.push(dt);
                    break;
                  }
                }
              }
            }
          }
          const avgRecovery =
            recoveryTimes.length > 0
              ? recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length
              : 60;
          const recoverySpeed = 1 / (1 + avgRecovery / 60);

          await upsertWorkflowProfile(sql, {
            id: crypto.randomUUID(),
            organization_id: orgId,
            developer_id: devId,
            period_start: periodStart.toISOString(),
            period_end: now.toISOString(),
            iterative_vs_planning: iterativeVsPlanning,
            tool_diversity: toolDiversity,
            recovery_speed: recoverySpeed,
            session_depth: sessionDepth,
            prompt_density: promptDensity,
            agent_usage: agentUsage,
            raw_metrics: {
              total_sessions: sessions.length,
              total_events: events.length,
              total_tool_calls: totalToolCalls,
              unique_tools: uniqueTools,
              total_prompts: prompts.length,
              avg_duration_min: avgDuration,
              avg_recovery_seconds: avgRecovery,
            },
            sessions_analyzed: sessions.length,
          });
        }
      }
    } catch (err) {
      console.error("[workflow] Profile computation error:", err);
    }
  }

  g.__gc_workflow_interval = setInterval(compute, CHECK_INTERVAL_MS);
  console.log("[workflow] Workflow profile computation started (daily)");
}
