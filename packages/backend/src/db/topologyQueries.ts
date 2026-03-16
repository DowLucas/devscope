import type { SQL } from "bun";
import type { TeamToolTopology, TeamSkillGap, ProficiencyLevel, CoverageLevel } from "@devscope/shared";
import { inList } from "./utils";

function classifyProficiency(failureRate: number | null): ProficiencyLevel {
  if (failureRate === null) return "unknown";
  if (failureRate < 0.10) return "strong";
  if (failureRate < 0.25) return "developing";
  return "struggling";
}

function classifyCoverage(uniqueUsers: number, teamSize: number): CoverageLevel {
  if (teamSize === 0) return "unknown";
  const ratio = uniqueUsers / teamSize;
  if (ratio > 0.6) return "widespread";
  if (ratio > 0.3) return "partial";
  return "narrow";
}

export async function computeTeamToolTopology(
  sql: SQL,
  orgId: string,
  developerIds: string[],
  periodStart: string,
  periodEnd: string
): Promise<void> {
  if (developerIds.length === 0) return;

  const rows = await sql`
    SELECT
      e.payload->>'toolName' AS tool_name,
      COUNT(*)::INT AS total_uses,
      COUNT(DISTINCT s.developer_id)::INT AS unique_users,
      COUNT(*) FILTER (WHERE e.event_type = 'tool.complete')::INT AS success_count,
      COUNT(*) FILTER (WHERE e.event_type = 'tool.fail')::INT AS failure_count,
      AVG((e.payload->>'duration')::NUMERIC) AS avg_duration_ms
    FROM events e
    JOIN sessions s ON s.id = e.session_id
    WHERE e.event_type IN ('tool.complete', 'tool.fail')
      AND e.payload->>'toolName' IS NOT NULL
      AND s.developer_id IN (${inList(developerIds)})
      AND e.created_at >= ${periodStart}::TIMESTAMPTZ
      AND e.created_at < ${periodEnd}::TIMESTAMPTZ
    GROUP BY e.payload->>'toolName'`;

  const teamSize = developerIds.length;

  for (const row of rows as any[]) {
    const totalUses: number = row.total_uses ?? 0;
    const failureCount: number = row.failure_count ?? 0;
    const failureRate = totalUses > 0 ? failureCount / totalUses : null;
    const uniqueUsers: number = row.unique_users ?? 0;

    const proficiencyLevel = classifyProficiency(failureRate);
    const coverageLevel = classifyCoverage(uniqueUsers, teamSize);
    const id = crypto.randomUUID();

    await sql`
      INSERT INTO team_tool_topology (
        id, organization_id, tool_name,
        period_start, period_end,
        total_uses, unique_users,
        success_count, failure_count,
        failure_rate, avg_duration_ms,
        proficiency_level, coverage_level,
        computed_at
      ) VALUES (
        ${id}, ${orgId}, ${row.tool_name},
        ${periodStart}::TIMESTAMPTZ, ${periodEnd}::TIMESTAMPTZ,
        ${totalUses}, ${uniqueUsers},
        ${row.success_count ?? 0}, ${failureCount},
        ${failureRate}, ${row.avg_duration_ms ?? null},
        ${proficiencyLevel}, ${coverageLevel},
        NOW()
      )
      ON CONFLICT (organization_id, tool_name, period_start, period_end)
      DO UPDATE SET
        total_uses = EXCLUDED.total_uses,
        unique_users = EXCLUDED.unique_users,
        success_count = EXCLUDED.success_count,
        failure_count = EXCLUDED.failure_count,
        failure_rate = EXCLUDED.failure_rate,
        avg_duration_ms = EXCLUDED.avg_duration_ms,
        proficiency_level = EXCLUDED.proficiency_level,
        coverage_level = EXCLUDED.coverage_level,
        computed_at = NOW()`;
  }
}

export async function getTeamToolTopology(
  sql: SQL,
  orgId: string
): Promise<TeamToolTopology[]> {
  return (await sql`
    SELECT * FROM team_tool_topology
    WHERE organization_id = ${orgId}
    ORDER BY total_uses DESC`) as TeamToolTopology[];
}

export async function detectSkillGaps(
  sql: SQL,
  orgId: string,
  teamSize: number
): Promise<void> {
  const topology = await sql`
    SELECT DISTINCT ON (tool_name)
      tool_name, failure_rate, unique_users, total_uses
    FROM team_tool_topology
    WHERE organization_id = ${orgId}
    ORDER BY tool_name, computed_at DESC`;

  for (const row of topology as any[]) {
    const toolName: string = row.tool_name;
    const failureRate: number | null = row.failure_rate != null ? Number(row.failure_rate) : null;
    const uniqueUsers: number = row.unique_users ?? 0;

    type GapEntry = { gapType: string; severity: "info" | "warning" | "critical"; description: string; dataContext: Record<string, unknown> };
    const gaps: GapEntry[] = [];

    if (failureRate !== null && failureRate > 0.30) {
      gaps.push({
        gapType: "high_failure",
        severity: "critical",
        description: `Tool "${toolName}" has a high failure rate of ${Math.round(failureRate * 100)}%.`,
        dataContext: { failure_rate: failureRate, tool_name: toolName },
      });
    }

    if (uniqueUsers === 1) {
      gaps.push({
        gapType: "single_expert",
        severity: "warning",
        description: `Tool "${toolName}" is only used by a single team member, creating a knowledge bottleneck.`,
        dataContext: { unique_users: uniqueUsers, tool_name: toolName },
      });
    }

    if (teamSize > 0 && uniqueUsers / teamSize < 0.2) {
      gaps.push({
        gapType: "low_adoption",
        severity: "info",
        description: `Tool "${toolName}" has low team adoption (${uniqueUsers}/${teamSize} members).`,
        dataContext: { unique_users: uniqueUsers, team_size: teamSize, tool_name: toolName },
      });
    }

    for (const gap of gaps) {
      // Only insert if no existing unresolved gap for same org+tool+gap_type
      const [existing] = await sql`
        SELECT id FROM team_skill_gaps
        WHERE organization_id = ${orgId}
          AND tool_name = ${toolName}
          AND gap_type = ${gap.gapType}
          AND resolved_at IS NULL
        LIMIT 1`;

      if (!existing) {
        const id = crypto.randomUUID();
        await sql`
          INSERT INTO team_skill_gaps (
            id, organization_id, tool_name, gap_type,
            severity, description, data_context, detected_at
          ) VALUES (
            ${id}, ${orgId}, ${toolName}, ${gap.gapType},
            ${gap.severity}, ${gap.description},
            ${JSON.stringify(gap.dataContext)}::JSONB,
            NOW()
          )`;
      }
    }
  }
}

export async function getTeamSkillGaps(
  sql: SQL,
  orgId: string
): Promise<TeamSkillGap[]> {
  return (await sql`
    SELECT * FROM team_skill_gaps
    WHERE organization_id = ${orgId}
      AND resolved_at IS NULL
    ORDER BY detected_at DESC`) as TeamSkillGap[];
}
