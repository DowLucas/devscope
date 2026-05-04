import type { SQL } from "bun";
import type { EvidenceRefs } from "@devscope/shared";
import { inList } from "../../backend/src/db/utils";
import type { EvidenceDetail } from "./sandboxRunner";

/**
 * Resolve the structured `EvidenceDetail` block fed into the sandbox prompt.
 * Pulls anti-pattern names + sample errors, pattern descriptions, and a few
 * representative session events for each evidence reference.
 *
 * Caps applied (token-cost control):
 *   - Sessions: at most `MAX_SESSIONS` (5) of `evidenceRefs.sessionIds`.
 *   - Events per session: at most `MAX_EVENTS_PER_SESSION` (3).
 *   - Sample errors per anti-pattern: at most `MAX_SAMPLE_ERRORS_PER_AP` (3).
 *
 * The function performs ONE batched SQL query per evidence dimension —
 * never one query per ID. On any per-row failure, that row is skipped
 * silently; the prompt degrades gracefully if a referenced row was deleted.
 */

const MAX_SESSIONS = 5;
const MAX_EVENTS_PER_SESSION = 3;
const MAX_SAMPLE_ERRORS_PER_AP = 3;
const ERROR_TRUNCATE_LEN = 500;

export interface BuildEvidenceDetailDeps {
  /** Override for tests — defaults to no-op. */
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

export async function buildEvidenceDetail(
  sql: SQL,
  refs: EvidenceRefs,
  deps: BuildEvidenceDetailDeps = {}
): Promise<EvidenceDetail> {
  const log = deps.log ?? (() => {});

  const antiPatternIds = (refs.antiPatternIds ?? []).slice();
  const patternIds = (refs.patternIds ?? []).slice();
  const sessionIds = (refs.sessionIds ?? []).slice(0, MAX_SESSIONS);

  const [antiPatterns, patterns, sessionExcerpts] = await Promise.all([
    fetchAntiPatterns(sql, antiPatternIds, log),
    fetchPatterns(sql, patternIds, log),
    fetchSessionExcerpts(sql, sessionIds, log),
  ]);

  return { antiPatterns, patterns, sessionExcerpts };
}

interface AntiPatternRow {
  id: string;
  name: string;
  severity: string;
  suggestion: string;
}

interface SampleErrorRow {
  anti_pattern_id: string;
  error: string | null;
  rn: number | string;
}

async function fetchAntiPatterns(
  sql: SQL,
  ids: string[],
  log: (msg: string, fields?: Record<string, unknown>) => void
): Promise<EvidenceDetail["antiPatterns"]> {
  if (ids.length === 0) return [];
  try {
    const rows = (await sql`
      SELECT id, name, severity, suggestion
      FROM anti_patterns
      WHERE id IN (${inList(ids)})`) as AntiPatternRow[];

    // Batched sample-error fetch: window ROW_NUMBER() per anti-pattern so a
    // single query yields the top N tool.fail events linked to each AP.
    const errorRows = (await sql`
      SELECT anti_pattern_id, error, rn FROM (
        SELECT
          sapm.anti_pattern_id,
          e.payload->>'error' AS error,
          ROW_NUMBER() OVER (
            PARTITION BY sapm.anti_pattern_id
            ORDER BY e.created_at DESC
          ) AS rn
        FROM session_anti_pattern_matches sapm
        JOIN events e ON e.session_id = sapm.session_id
        WHERE sapm.anti_pattern_id IN (${inList(ids)})
          AND e.event_type = 'tool.fail'
          AND e.payload->>'error' IS NOT NULL
      ) t
      WHERE rn <= ${MAX_SAMPLE_ERRORS_PER_AP}`) as SampleErrorRow[];

    const errorsByAp = new Map<string, string[]>();
    for (const r of errorRows) {
      if (!r.error) continue;
      const arr = errorsByAp.get(r.anti_pattern_id) ?? [];
      arr.push(truncateError(r.error));
      errorsByAp.set(r.anti_pattern_id, arr);
    }

    return rows.map((r) => ({
      name: r.name,
      severity: r.severity,
      suggestion: r.suggestion,
      sampleErrors: errorsByAp.get(r.id)?.slice(0, MAX_SAMPLE_ERRORS_PER_AP) ?? [],
    }));
  } catch (err) {
    log("buildEvidenceDetail: anti-pattern fetch failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

interface PatternRow {
  name: string;
  description: string;
  effectiveness: string;
}

async function fetchPatterns(
  sql: SQL,
  ids: string[],
  log: (msg: string, fields?: Record<string, unknown>) => void
): Promise<EvidenceDetail["patterns"]> {
  if (ids.length === 0) return [];
  try {
    const rows = (await sql`
      SELECT name, description, effectiveness
      FROM session_patterns
      WHERE id IN (${inList(ids)})`) as PatternRow[];
    return rows.map((r) => ({
      name: r.name,
      description: r.description,
      effectiveness: r.effectiveness,
    }));
  } catch (err) {
    log("buildEvidenceDetail: pattern fetch failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

interface SessionExcerptRow {
  session_id: string;
  tool_name: string | null;
  subcommand: string | null;
  error: string | null;
  created_at: string | Date;
  rn: number | string;
}

async function fetchSessionExcerpts(
  sql: SQL,
  sessionIds: string[],
  log: (msg: string, fields?: Record<string, unknown>) => void
): Promise<EvidenceDetail["sessionExcerpts"]> {
  if (sessionIds.length === 0) return [];
  try {
    // Top N tool.fail events per session via window function. Falls back to
    // any tool.* event with an error if there are fewer than N failures.
    const rows = (await sql`
      SELECT session_id, tool_name, subcommand, error, created_at, rn FROM (
        SELECT
          e.session_id,
          e.payload->>'toolName' AS tool_name,
          e.payload->>'toolSubcommand' AS subcommand,
          e.payload->>'error' AS error,
          e.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY e.session_id
            ORDER BY
              CASE WHEN e.event_type = 'tool.fail' THEN 0 ELSE 1 END,
              e.created_at DESC
          ) AS rn
        FROM events e
        WHERE e.session_id IN (${inList(sessionIds)})
          AND e.event_type IN ('tool.fail', 'tool.complete')
          AND e.payload->>'toolName' IS NOT NULL
      ) t
      WHERE rn <= ${MAX_EVENTS_PER_SESSION}
      ORDER BY session_id, rn`) as SessionExcerptRow[];

    return rows.map((r) => {
      const tool =
        r.subcommand && r.tool_name
          ? `${r.tool_name}:${r.subcommand}`
          : r.tool_name ?? "(unknown)";
      const ts =
        r.created_at instanceof Date
          ? r.created_at.toISOString()
          : String(r.created_at);
      return {
        sessionId: r.session_id,
        toolCall: tool,
        error: truncateError(r.error ?? ""),
        timestamp: ts,
      };
    });
  } catch (err) {
    log("buildEvidenceDetail: session excerpt fetch failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function truncateError(s: string): string {
  if (s.length <= ERROR_TRUNCATE_LEN) return s;
  return s.slice(0, ERROR_TRUNCATE_LEN) + "…";
}
