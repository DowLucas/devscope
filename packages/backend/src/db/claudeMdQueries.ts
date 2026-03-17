import type { SQL } from "bun";
import type {
  ClaudeMdSnapshot,
  ClaudeMdCorrelation,
  ClaudeMdTimelineEntry,
} from "@devscope/shared";

export async function upsertClaudeMdSnapshot(
  sql: SQL,
  data: Omit<ClaudeMdSnapshot, "id" | "captured_at">
): Promise<ClaudeMdSnapshot> {
  const id = crypto.randomUUID();

  const rows = await sql`
    INSERT INTO claude_md_snapshots (
      id,
      organization_id,
      project_name,
      project_path,
      content_hash,
      content_size,
      content_text,
      file_type,
      session_id,
      developer_id
    ) VALUES (
      ${id},
      ${data.organization_id ?? null},
      ${data.project_name},
      ${data.project_path},
      ${data.content_hash},
      ${data.content_size},
      ${data.content_text ?? null},
      ${data.file_type ?? "claude_md"},
      ${data.session_id},
      ${data.developer_id}
    )
    ON CONFLICT (project_path, content_hash) DO NOTHING
    RETURNING *
  `;

  if (rows.length > 0) {
    return rows[0] as ClaudeMdSnapshot;
  }

  // Conflict — fetch existing row
  const [existing] = await sql`
    SELECT * FROM claude_md_snapshots
    WHERE project_path = ${data.project_path}
      AND content_hash = ${data.content_hash}
  `;
  return existing as ClaudeMdSnapshot;
}

export async function getClaudeMdTimeline(
  sql: SQL,
  projectPath: string,
  orgId: string,
  limit = 50
): Promise<ClaudeMdTimelineEntry[]> {
  const rows = await sql`
    SELECT
      s.id                        AS snapshot_id,
      s.organization_id           AS s_organization_id,
      s.project_name              AS s_project_name,
      s.project_path              AS s_project_path,
      s.content_hash              AS s_content_hash,
      s.content_size              AS s_content_size,
      s.content_text              AS s_content_text,
      s.session_id                AS s_session_id,
      s.developer_id              AS s_developer_id,
      s.captured_at               AS s_captured_at,
      c.id                        AS c_id,
      c.snapshot_id               AS c_snapshot_id,
      c.project_path              AS c_project_path,
      c.window_start              AS c_window_start,
      c.window_end                AS c_window_end,
      c.sessions_count            AS c_sessions_count,
      c.avg_failure_rate          AS c_avg_failure_rate,
      c.avg_prompt_count          AS c_avg_prompt_count,
      c.avg_session_duration_min  AS c_avg_session_duration_min,
      c.computed_at               AS c_computed_at
    FROM claude_md_snapshots s
    LEFT JOIN claude_md_correlations c ON c.snapshot_id = s.id
    WHERE s.project_path = ${projectPath}
      AND s.organization_id = ${orgId}
    ORDER BY s.captured_at DESC
    LIMIT ${limit}
  `;

  return (rows as any[]).map((row) => {
    const snapshot: ClaudeMdSnapshot = {
      id: row.snapshot_id,
      organization_id: row.s_organization_id,
      project_name: row.s_project_name,
      project_path: row.s_project_path,
      content_hash: row.s_content_hash,
      content_size: row.s_content_size,
      content_text: row.s_content_text,
      session_id: row.s_session_id,
      developer_id: row.s_developer_id,
      captured_at: row.s_captured_at,
    };

    const correlation: ClaudeMdCorrelation | null = row.c_id
      ? {
          id: row.c_id,
          snapshot_id: row.c_snapshot_id,
          project_path: row.c_project_path,
          window_start: row.c_window_start,
          window_end: row.c_window_end,
          sessions_count: row.c_sessions_count,
          avg_failure_rate: row.c_avg_failure_rate,
          avg_prompt_count: row.c_avg_prompt_count,
          avg_session_duration_min: row.c_avg_session_duration_min,
          computed_at: row.c_computed_at,
        }
      : null;

    return { snapshot, correlation };
  });
}

export async function getClaudeMdProjects(
  sql: SQL,
  orgId: string
): Promise<
  Array<{ project_name: string; project_path: string; snapshot_count: number }>
> {
  const rows = await sql`
    SELECT
      project_name,
      project_path,
      COUNT(*) AS snapshot_count
    FROM claude_md_snapshots
    WHERE organization_id = ${orgId}
    GROUP BY project_name, project_path
    ORDER BY project_name ASC
  `;
  return rows as any[];
}

export async function computeClaudeMdCorrelation(
  sql: SQL,
  snapshotId: string,
  projectPath: string,
  orgId: string | null,
  windowStart: string,
  windowEnd: string
): Promise<ClaudeMdCorrelation> {
  // Aggregate session metrics for the project within the time window
  const [agg] = await sql`
    SELECT
      COUNT(DISTINCT s.id)::int                                   AS sessions_count,
      AVG(
        CASE WHEN tool_totals.total_tools > 0
          THEN tool_totals.fail_tools::float / tool_totals.total_tools
          ELSE NULL
        END
      )                                                           AS avg_failure_rate,
      AVG(prompt_totals.prompt_count)                            AS avg_prompt_count,
      AVG(
        CASE WHEN s.ended_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60.0
          ELSE NULL
        END
      )                                                           AS avg_session_duration_min
    FROM sessions s
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE event_type IN ('tool.start', 'tool.complete', 'tool.fail'))  AS total_tools,
        COUNT(*) FILTER (WHERE event_type = 'tool.fail')                                     AS fail_tools
      FROM events e
      WHERE e.session_id = s.id
    ) tool_totals ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS prompt_count
      FROM events e
      WHERE e.session_id = s.id
        AND e.event_type = 'prompt.submit'
    ) prompt_totals ON TRUE
    WHERE s.project_path = ${projectPath}
      AND s.started_at >= ${windowStart}::timestamptz
      AND s.started_at <  ${windowEnd}::timestamptz
  `;

  const id = crypto.randomUUID();
  const [row] = await sql`
    INSERT INTO claude_md_correlations (
      id,
      organization_id,
      project_path,
      snapshot_id,
      window_start,
      window_end,
      sessions_count,
      avg_failure_rate,
      avg_prompt_count,
      avg_session_duration_min
    ) VALUES (
      ${id},
      ${orgId ?? null},
      ${projectPath},
      ${snapshotId},
      ${windowStart}::timestamptz,
      ${windowEnd}::timestamptz,
      ${(agg as any).sessions_count ?? 0},
      ${(agg as any).avg_failure_rate ?? null},
      ${(agg as any).avg_prompt_count ?? null},
      ${(agg as any).avg_session_duration_min ?? null}
    )
    ON CONFLICT DO NOTHING
    RETURNING *
  `;

  if (row) return row as ClaudeMdCorrelation;

  // If conflict, return existing
  const [existing] = await sql`
    SELECT * FROM claude_md_correlations WHERE snapshot_id = ${snapshotId}
  `;
  return existing as ClaudeMdCorrelation;
}
