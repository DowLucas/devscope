import type { SQL } from "bun";
import { sql as Sql } from "bun";
import type { SessionPattern, SessionPatternMatch } from "@devscope/shared";
import { inList } from "./utils";

// --- Tool Sequence Extraction ---

export interface ToolEvent {
  tool_name: string;
  event_type: string;
  success: boolean;
  created_at: string;
}

export async function getSessionToolSequence(
  sql: SQL,
  sessionId: string
): Promise<ToolEvent[]> {
  const rows = await sql`
    SELECT
      e.payload->>'toolName' as tool_name,
      e.event_type,
      CASE WHEN e.event_type = 'tool.complete' THEN TRUE ELSE FALSE END as success,
      e.created_at
    FROM events e
    WHERE e.session_id = ${sessionId}
      AND e.event_type IN ('tool.complete', 'tool.fail')
      AND e.payload->>'toolName' IS NOT NULL
    ORDER BY e.created_at ASC`;
  return rows as ToolEvent[];
}

export interface SessionSequence {
  session_id: string;
  developer_id: string;
  project_name: string;
  tools: ToolEvent[];
  tool_names: string[];
  success_rate: number;
}

export async function getRecentSessionSequences(
  sql: SQL,
  days: number = 1,
  limit: number = 200,
  developerIds?: string[]
): Promise<SessionSequence[]> {
  let sessionsQuery;
  if (developerIds && developerIds.length > 0) {
    sessionsQuery = sql`
      SELECT s.id as session_id, s.developer_id, s.project_name
      FROM sessions s
      WHERE s.status = 'ended'
        AND s.ended_at >= NOW() - make_interval(days => ${days})
        AND s.developer_id IN (${inList(developerIds)})
      ORDER BY s.ended_at DESC
      LIMIT ${limit}`;
  } else {
    sessionsQuery = sql`
      SELECT s.id as session_id, s.developer_id, s.project_name
      FROM sessions s
      WHERE s.status = 'ended'
        AND s.ended_at >= NOW() - make_interval(days => ${days})
      ORDER BY s.ended_at DESC
      LIMIT ${limit}`;
  }

  const sessions = await sessionsQuery;
  const sequences: SessionSequence[] = [];

  for (const session of sessions) {
    const tools = await getSessionToolSequence(sql, (session as any).session_id);
    if (tools.length < 3) continue; // Skip trivial sessions

    const successCount = tools.filter(t => t.success).length;
    const successRate = tools.length > 0 ? successCount / tools.length : 0;

    sequences.push({
      session_id: (session as any).session_id,
      developer_id: (session as any).developer_id,
      project_name: (session as any).project_name ?? "",
      tools,
      tool_names: tools.map(t => t.tool_name),
      success_rate: Math.round(successRate * 1000) / 1000,
    });
  }

  return sequences;
}

// --- Pattern CRUD ---

export async function upsertPattern(
  sql: SQL,
  pattern: {
    name: string;
    description: string;
    tool_sequence: string[];
    avg_success_rate: number;
    occurrence_count: number;
    effectiveness: string;
    category?: string;
    data_context?: Record<string, unknown>;
  }
): Promise<SessionPattern> {
  // Try to find an existing pattern with the same tool sequence
  const seqStr = pattern.tool_sequence.join(",");
  const existing = await sql`
    SELECT * FROM session_patterns
    WHERE array_to_string(tool_sequence, ',') = ${seqStr}
    LIMIT 1`;

  if (existing.length > 0) {
    const ex = existing[0] as any;
    const newCount = ex.occurrence_count + pattern.occurrence_count;
    const newRate = (ex.avg_success_rate * ex.occurrence_count + pattern.avg_success_rate * pattern.occurrence_count) / newCount;

    await sql`
      UPDATE session_patterns SET
        occurrence_count = ${newCount},
        avg_success_rate = ${Math.round(newRate * 1000) / 1000},
        effectiveness = ${pattern.effectiveness},
        updated_at = NOW()
      WHERE id = ${ex.id}`;

    const [updated] = await sql`SELECT * FROM session_patterns WHERE id = ${ex.id}`;
    return updated as SessionPattern;
  }

  const id = crypto.randomUUID();
  const dataContext = JSON.stringify(pattern.data_context ?? {});
  const toolSeq = `{${pattern.tool_sequence.map(t => `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

  await sql`
    INSERT INTO session_patterns (id, name, description, tool_sequence, avg_success_rate, occurrence_count, effectiveness, category, data_context)
    VALUES (${id}, ${pattern.name}, ${pattern.description},
      ${Sql.unsafe(`'${toolSeq.replace(/'/g, "''")}'`)}::TEXT[],
      ${pattern.avg_success_rate}, ${pattern.occurrence_count},
      ${pattern.effectiveness}, ${pattern.category ?? null},
      ${dataContext}::JSONB)`;

  const [row] = await sql`SELECT * FROM session_patterns WHERE id = ${id}`;
  return row as SessionPattern;
}

export async function createPatternMatch(
  sql: SQL,
  sessionId: string,
  patternId: string,
  confidence: number = 1.0,
  successRate?: number
): Promise<SessionPatternMatch> {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO session_pattern_matches (id, session_id, pattern_id, match_confidence, tool_success_rate)
    VALUES (${id}, ${sessionId}, ${patternId}, ${confidence}, ${successRate ?? null})`;

  const [row] = await sql`SELECT * FROM session_pattern_matches WHERE id = ${id}`;
  return row as SessionPatternMatch;
}

export async function getPatterns(
  sql: SQL,
  opts?: {
    effectiveness?: string;
    category?: string;
    limit?: number;
    minOccurrences?: number;
  }
): Promise<SessionPattern[]> {
  const limit = opts?.limit ?? 50;
  const minOcc = opts?.minOccurrences ?? 1;

  if (opts?.effectiveness && opts?.category) {
    return (await sql`
      SELECT * FROM session_patterns
      WHERE effectiveness = ${opts.effectiveness}
        AND category = ${opts.category}
        AND occurrence_count >= ${minOcc}
      ORDER BY occurrence_count DESC, avg_success_rate DESC
      LIMIT ${limit}`) as SessionPattern[];
  }
  if (opts?.effectiveness) {
    return (await sql`
      SELECT * FROM session_patterns
      WHERE effectiveness = ${opts.effectiveness}
        AND occurrence_count >= ${minOcc}
      ORDER BY occurrence_count DESC, avg_success_rate DESC
      LIMIT ${limit}`) as SessionPattern[];
  }
  if (opts?.category) {
    return (await sql`
      SELECT * FROM session_patterns
      WHERE category = ${opts.category}
        AND occurrence_count >= ${minOcc}
      ORDER BY occurrence_count DESC, avg_success_rate DESC
      LIMIT ${limit}`) as SessionPattern[];
  }
  return (await sql`
    SELECT * FROM session_patterns
    WHERE occurrence_count >= ${minOcc}
    ORDER BY occurrence_count DESC, avg_success_rate DESC
    LIMIT ${limit}`) as SessionPattern[];
}

export async function getPatternById(
  sql: SQL,
  id: string
): Promise<SessionPattern | null> {
  const [row] = await sql`SELECT * FROM session_patterns WHERE id = ${id}`;
  return (row as SessionPattern) ?? null;
}

export async function getPatternStats(
  sql: SQL,
  days: number = 30
): Promise<{
  total_patterns: number;
  effective_count: number;
  ineffective_count: number;
  top_patterns: SessionPattern[];
  recent_matches: number;
}> {
  const [counts] = await sql`
    SELECT
      COUNT(*)::INT as total_patterns,
      SUM(CASE WHEN effectiveness = 'effective' THEN 1 ELSE 0 END)::INT as effective_count,
      SUM(CASE WHEN effectiveness = 'ineffective' THEN 1 ELSE 0 END)::INT as ineffective_count
    FROM session_patterns`;

  const topPatterns = await sql`
    SELECT * FROM session_patterns
    WHERE effectiveness = 'effective'
    ORDER BY occurrence_count DESC
    LIMIT 5`;

  const [matchCount] = await sql`
    SELECT COUNT(*)::INT as cnt
    FROM session_pattern_matches
    WHERE created_at >= NOW() - make_interval(days => ${days})`;

  return {
    total_patterns: (counts as any)?.total_patterns ?? 0,
    effective_count: (counts as any)?.effective_count ?? 0,
    ineffective_count: (counts as any)?.ineffective_count ?? 0,
    top_patterns: topPatterns as SessionPattern[],
    recent_matches: (matchCount as any)?.cnt ?? 0,
  };
}

export async function getSessionPatterns(
  sql: SQL,
  sessionId: string
): Promise<(SessionPattern & { match_confidence: number })[]> {
  return (await sql`
    SELECT sp.*, spm.match_confidence
    FROM session_patterns sp
    JOIN session_pattern_matches spm ON sp.id = spm.pattern_id
    WHERE spm.session_id = ${sessionId}
    ORDER BY spm.match_confidence DESC`) as (SessionPattern & { match_confidence: number })[];
}

// --- Developer Skill Queries (Phase 4) ---

export async function getDeveloperToolMastery(
  sql: SQL,
  developerId: string,
  weeks: number = 12
): Promise<{
  week: string;
  tool_name: string;
  successes: number;
  total: number;
  success_rate: number;
}[]> {
  return (await sql`
    SELECT
      date_trunc('week', e.created_at)::DATE as week,
      e.payload->>'toolName' as tool_name,
      SUM(CASE WHEN e.event_type = 'tool.complete' THEN 1 ELSE 0 END)::INT as successes,
      COUNT(*)::INT as total,
      ROUND(SUM(CASE WHEN e.event_type = 'tool.complete' THEN 1 ELSE 0 END)::FLOAT / GREATEST(COUNT(*), 1), 3)::FLOAT as success_rate
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    WHERE s.developer_id = ${developerId}
      AND e.event_type IN ('tool.complete', 'tool.fail')
      AND e.payload->>'toolName' IS NOT NULL
      AND e.created_at >= NOW() - make_interval(weeks => ${weeks})
    GROUP BY week, tool_name
    ORDER BY week ASC, total DESC`) as any[];
}

export async function getDeveloperPatternAdoption(
  sql: SQL,
  developerId: string,
  weeks: number = 12
): Promise<{
  week: string;
  effective_count: number;
  ineffective_count: number;
  neutral_count: number;
}[]> {
  return (await sql`
    SELECT
      date_trunc('week', spm.created_at)::DATE as week,
      SUM(CASE WHEN sp.effectiveness = 'effective' THEN 1 ELSE 0 END)::INT as effective_count,
      SUM(CASE WHEN sp.effectiveness = 'ineffective' THEN 1 ELSE 0 END)::INT as ineffective_count,
      SUM(CASE WHEN sp.effectiveness = 'neutral' THEN 1 ELSE 0 END)::INT as neutral_count
    FROM session_pattern_matches spm
    JOIN session_patterns sp ON spm.pattern_id = sp.id
    JOIN sessions s ON spm.session_id = s.id
    WHERE s.developer_id = ${developerId}
      AND spm.created_at >= NOW() - make_interval(weeks => ${weeks})
    GROUP BY week
    ORDER BY week ASC`) as any[];
}

export async function getDeveloperSessionQuality(
  sql: SQL,
  developerId: string,
  weeks: number = 12
): Promise<{
  week: string;
  sessions: number;
  avg_success_rate: number;
  avg_tool_calls: number;
}[]> {
  return (await sql`
    SELECT
      date_trunc('week', s.started_at)::DATE as week,
      COUNT(DISTINCT s.id)::INT as sessions,
      ROUND(
        (SUM(CASE WHEN e.event_type = 'tool.complete' THEN 1 ELSE 0 END)::FLOAT /
        GREATEST(SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.fail') THEN 1 ELSE 0 END), 1))::NUMERIC, 3
      )::FLOAT as avg_success_rate,
      ROUND(
        (COUNT(CASE WHEN e.event_type IN ('tool.complete', 'tool.fail') THEN 1 END)::FLOAT /
        GREATEST(COUNT(DISTINCT s.id), 1))::NUMERIC, 1
      )::FLOAT as avg_tool_calls
    FROM sessions s
    LEFT JOIN events e ON e.session_id = s.id
      AND e.event_type IN ('tool.complete', 'tool.fail')
    WHERE s.developer_id = ${developerId}
      AND s.started_at >= NOW() - make_interval(weeks => ${weeks})
    GROUP BY week
    ORDER BY week ASC`) as any[];
}
