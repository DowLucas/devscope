import type { SQL } from "bun";
import type { WorkflowProfile, TeamWorkflowSummary } from "@devscope/shared";
import { inList } from "./utils";

export async function upsertWorkflowProfile(
  sql: SQL,
  profile: Omit<WorkflowProfile, "computed_at"> & { organization_id?: string | null; computed_at?: string }
): Promise<WorkflowProfile> {
  const [row] = await sql`
    INSERT INTO workflow_profiles (
      id,
      organization_id,
      developer_id,
      period_start,
      period_end,
      iterative_vs_planning,
      tool_diversity,
      recovery_speed,
      session_depth,
      prompt_density,
      agent_usage,
      raw_metrics,
      sessions_analyzed,
      computed_at
    ) VALUES (
      ${profile.id},
      ${profile.organization_id ?? null},
      ${profile.developer_id},
      ${profile.period_start}::timestamptz,
      ${profile.period_end}::timestamptz,
      ${profile.iterative_vs_planning ?? null},
      ${profile.tool_diversity ?? null},
      ${profile.recovery_speed ?? null},
      ${profile.session_depth ?? null},
      ${profile.prompt_density ?? null},
      ${profile.agent_usage ?? null},
      ${JSON.stringify(profile.raw_metrics)}::jsonb,
      ${profile.sessions_analyzed},
      NOW()
    )
    ON CONFLICT (developer_id, period_start, period_end) DO UPDATE SET
      iterative_vs_planning = EXCLUDED.iterative_vs_planning,
      tool_diversity = EXCLUDED.tool_diversity,
      recovery_speed = EXCLUDED.recovery_speed,
      session_depth = EXCLUDED.session_depth,
      prompt_density = EXCLUDED.prompt_density,
      agent_usage = EXCLUDED.agent_usage,
      raw_metrics = EXCLUDED.raw_metrics,
      sessions_analyzed = EXCLUDED.sessions_analyzed,
      computed_at = NOW()
    RETURNING *
  `;
  return row as WorkflowProfile;
}

export async function getWorkflowProfile(
  sql: SQL,
  developerId: string
): Promise<WorkflowProfile | null> {
  const [row] = await sql`
    SELECT *
    FROM workflow_profiles
    WHERE developer_id = ${developerId}
    ORDER BY computed_at DESC
    LIMIT 1
  `;
  return (row as WorkflowProfile) ?? null;
}

export async function getWorkflowProfileHistory(
  sql: SQL,
  developerId: string,
  limit = 10
): Promise<WorkflowProfile[]> {
  const rows = await sql`
    SELECT *
    FROM workflow_profiles
    WHERE developer_id = ${developerId}
    ORDER BY period_end DESC
    LIMIT ${limit}
  `;
  return rows as WorkflowProfile[];
}

export async function getTeamWorkflowSummary(
  sql: SQL,
  orgId: string,
  developerIds: string[]
): Promise<TeamWorkflowSummary> {
  if (developerIds.length === 0) {
    return {
      dimension_averages: {},
      dimension_ranges: {},
      developer_count: 0,
      period_start: new Date().toISOString(),
      period_end: new Date().toISOString(),
    };
  }

  const [agg] = await sql`
    SELECT
      AVG(iterative_vs_planning) AS avg_iterative_vs_planning,
      AVG(tool_diversity)        AS avg_tool_diversity,
      AVG(recovery_speed)        AS avg_recovery_speed,
      AVG(session_depth)         AS avg_session_depth,
      AVG(prompt_density)        AS avg_prompt_density,
      AVG(agent_usage)           AS avg_agent_usage,

      MIN(iterative_vs_planning) AS min_iterative_vs_planning,
      MAX(iterative_vs_planning) AS max_iterative_vs_planning,
      MIN(tool_diversity)        AS min_tool_diversity,
      MAX(tool_diversity)        AS max_tool_diversity,
      MIN(recovery_speed)        AS min_recovery_speed,
      MAX(recovery_speed)        AS max_recovery_speed,
      MIN(session_depth)         AS min_session_depth,
      MAX(session_depth)         AS max_session_depth,
      MIN(prompt_density)        AS min_prompt_density,
      MAX(prompt_density)        AS max_prompt_density,
      MIN(agent_usage)           AS min_agent_usage,
      MAX(agent_usage)           AS max_agent_usage,

      COUNT(DISTINCT developer_id) AS developer_count,
      MIN(period_start)            AS period_start,
      MAX(period_end)              AS period_end
    FROM workflow_profiles
    WHERE developer_id IN (${inList(developerIds)})
      AND organization_id = ${orgId}
  ` as any[];

  if (!agg) {
    return {
      dimension_averages: {},
      dimension_ranges: {},
      developer_count: 0,
      period_start: new Date().toISOString(),
      period_end: new Date().toISOString(),
    };
  }

  const dimensions = [
    "iterative_vs_planning",
    "tool_diversity",
    "recovery_speed",
    "session_depth",
    "prompt_density",
    "agent_usage",
  ];

  const dimension_averages: Record<string, number> = {};
  const dimension_ranges: Record<string, { min: number; max: number }> = {};

  for (const dim of dimensions) {
    const avg = agg[`avg_${dim}`];
    const min = agg[`min_${dim}`];
    const max = agg[`max_${dim}`];
    if (avg !== null && avg !== undefined) {
      dimension_averages[dim] = Number(avg);
    }
    if (min !== null && min !== undefined && max !== null && max !== undefined) {
      dimension_ranges[dim] = { min: Number(min), max: Number(max) };
    }
  }

  return {
    dimension_averages,
    dimension_ranges,
    developer_count: Number(agg.developer_count),
    period_start: agg.period_start ? new Date(agg.period_start).toISOString() : new Date().toISOString(),
    period_end: agg.period_end ? new Date(agg.period_end).toISOString() : new Date().toISOString(),
  };
}
