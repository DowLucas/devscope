import type { SQL } from "bun";
import type {
  ClaudeMdSnapshot,
  ClaudeMdCorrelation,
  ClaudeMdTimelineEntry,
  DocGapCandidate,
  DocGapPeriod,
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

// --------------------------------------------------------------------------
// Doc-gap helper (DEV-48)
// --------------------------------------------------------------------------

/**
 * Surface the top recurring search/read terms in an org's events that do NOT
 * appear in the org's most recent CLAUDE.md snapshots — i.e. candidate
 * documentation gaps for the weekly-buyer report. Team-aggregate by
 * construction: every returned field is a tool-side primitive (search
 * pattern, file basename, directory, count, session UUID). Per the DEV-37
 * mission guardrail, no developer ids, names, or emails are read or
 * returned.
 *
 * Algorithm (kept intentionally simple — this is a wedge differentiator,
 * not a search engine):
 *
 *   1. Build a single lower-cased "corpus" of the latest CLAUDE.md snapshot
 *      per project_path for the org. A term is considered "covered" if its
 *      lower-cased form appears as a substring in this corpus.
 *   2. Query top Grep/Glob `pattern`, top Read/Write/Edit file basenames,
 *      and top Glob `path` directories from events in the period for
 *      sessions belonging to developers in this org. Each candidate row
 *      carries up to 3 distinct sample session UUIDs.
 *   3. Drop any candidate whose term is covered by the corpus, drop empty
 *      / single-char terms, and return the top `limit` by count with a
 *      stable tie-break on `term ASC` for deterministic output.
 *
 * Returns `[]` if the org has no developers or no recent CLAUDE.md snapshot.
 */
export async function getDocGapsForOrg(
  sql: SQL,
  orgId: string,
  period: DocGapPeriod,
  limit = 8
): Promise<DocGapCandidate[]> {
  // 1. Latest CLAUDE.md snapshot per project_path for this org. We join the
  //    text content into one lower-cased corpus for cheap substring lookup.
  const snapshotRows = (await sql`
    SELECT DISTINCT ON (project_path) content_text
    FROM claude_md_snapshots
    WHERE organization_id = ${orgId}
      AND content_text IS NOT NULL
    ORDER BY project_path, captured_at DESC
  `) as Array<{ content_text: string | null }>;

  if (snapshotRows.length === 0) {
    // No CLAUDE.md to compare against — bail out rather than declare every
    // search term a "gap".
    return [];
  }

  const corpus = snapshotRows
    .map((r) => (r.content_text ?? "").toLowerCase())
    .join("\n");

  // 2. Pull candidate terms in three categories. We deliberately use the
  //    same `payload->>'toolName'` filters as `getConcreteToolDetails` so the
  //    helper rides on the existing `idx_events_payload_toolname` GIN index.
  //    Org scoping joins via `organization_developer`. Sample sessions are
  //    UUIDs (under the 16-hex SHA-256 threshold of the mission guardrail).

  // Grep/Glob patterns
  const grepRows = (await sql`
    SELECT
      e.payload->'toolInput'->>'pattern'                                    AS term,
      COUNT(*)::INT                                                          AS count,
      (ARRAY_AGG(DISTINCT e.session_id ORDER BY e.session_id))[1:3]          AS sample_session_ids
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    JOIN organization_developer od ON od.developer_id = s.developer_id
    WHERE od.organization_id = ${orgId}
      AND e.event_type IN ('tool.complete', 'tool.fail')
      AND e.payload->>'toolName' IN ('Grep', 'Glob')
      AND e.payload->'toolInput'->>'pattern' IS NOT NULL
      AND length(e.payload->'toolInput'->>'pattern') >= 2
      AND s.privacy_mode IS DISTINCT FROM 'private'
      AND e.created_at >= ${period.start}::timestamptz
      AND e.created_at <  ${period.end}::timestamptz
    GROUP BY term
    ORDER BY count DESC, term ASC
    LIMIT 50
  `) as Array<{ term: string; count: number; sample_session_ids: string[] }>;

  // Read/Write/Edit file basenames. We strip the directory because absolute
  // paths are noisy and the basename is what a CLAUDE.md typically mentions.
  const fileRows = (await sql`
    SELECT
      regexp_replace(e.payload->'toolInput'->>'file_path', '^.*/', '')      AS term,
      COUNT(*)::INT                                                          AS count,
      (ARRAY_AGG(DISTINCT e.session_id ORDER BY e.session_id))[1:3]          AS sample_session_ids
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    JOIN organization_developer od ON od.developer_id = s.developer_id
    WHERE od.organization_id = ${orgId}
      AND e.event_type IN ('tool.complete', 'tool.fail')
      AND e.payload->>'toolName' IN ('Read', 'Write', 'Edit')
      AND e.payload->'toolInput'->>'file_path' IS NOT NULL
      AND s.privacy_mode IS DISTINCT FROM 'private'
      AND e.created_at >= ${period.start}::timestamptz
      AND e.created_at <  ${period.end}::timestamptz
    GROUP BY term
    HAVING regexp_replace(e.payload->'toolInput'->>'file_path', '^.*/', '') <> ''
    ORDER BY count DESC, term ASC
    LIMIT 50
  `) as Array<{ term: string; count: number; sample_session_ids: string[] }>;

  // Glob directories
  const dirRows = (await sql`
    SELECT
      e.payload->'toolInput'->>'path'                                       AS term,
      COUNT(*)::INT                                                          AS count,
      (ARRAY_AGG(DISTINCT e.session_id ORDER BY e.session_id))[1:3]          AS sample_session_ids
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    JOIN organization_developer od ON od.developer_id = s.developer_id
    WHERE od.organization_id = ${orgId}
      AND e.event_type IN ('tool.complete', 'tool.fail')
      AND e.payload->>'toolName' = 'Glob'
      AND e.payload->'toolInput'->>'path' IS NOT NULL
      AND length(e.payload->'toolInput'->>'path') >= 2
      AND s.privacy_mode IS DISTINCT FROM 'private'
      AND e.created_at >= ${period.start}::timestamptz
      AND e.created_at <  ${period.end}::timestamptz
    GROUP BY term
    ORDER BY count DESC, term ASC
    LIMIT 50
  `) as Array<{ term: string; count: number; sample_session_ids: string[] }>;

  // 3. Filter out terms covered by the latest CLAUDE.md corpus, then merge
  //    and rank. A term is "covered" if its lower-cased form is a substring
  //    of the corpus. This is intentionally coarse — it is the same heuristic
  //    a developer would use when grepping their own CLAUDE.md.
  const candidates: DocGapCandidate[] = [];

  function isCovered(term: string, kind: DocGapCandidate["kind"]): boolean {
    const lower = term.toLowerCase();
    if (corpus.includes(lower)) return true;
    // For file basenames, also try the extension-stripped stem so that a
    // CLAUDE.md mentioning "stripe" covers reads of "stripe.ts" /
    // "stripe.test.ts" without the developer having to enumerate every
    // extension. Only strip the final extension to keep the heuristic tight
    // (a file mentioned only as "shim" in the docs should NOT cover
    // "telemetry-shim.ts").
    if (kind === "file_path") {
      const stem = lower.replace(/\.[a-z0-9]+$/i, "");
      if (stem.length >= 2 && stem !== lower && corpus.includes(stem)) {
        return true;
      }
    }
    return false;
  }

  function consider(
    rows: Array<{ term: string; count: number; sample_session_ids: string[] }>,
    kind: DocGapCandidate["kind"]
  ) {
    for (const row of rows) {
      const term = (row.term ?? "").trim();
      if (term.length < 2) continue;
      if (isCovered(term, kind)) continue;
      candidates.push({
        term,
        kind,
        count: row.count,
        sample_session_ids: (row.sample_session_ids ?? []).slice(0, 3),
      });
    }
  }

  consider(grepRows, "grep_pattern");
  consider(fileRows, "file_path");
  consider(dirRows, "directory");

  candidates.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.term.localeCompare(b.term);
  });

  return candidates.slice(0, limit);
}
