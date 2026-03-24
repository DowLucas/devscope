import type { SQL } from "bun";
import { sql as Sql } from "bun";
import type { SessionPattern, SessionPatternMatch } from "@devscope/shared";
import { inList } from "./utils";
import { extractPromptFeatures, type PromptFeatures } from "../ai/detection/promptFeatures";

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

export interface PromptEvent {
  prompt_length: number;
  is_continuation: boolean;
}

export interface AgentEvent {
  agent_type: string;
  agent_id: string;
  event_type: string; // agent.start or agent.stop
}

/** Per-session concrete tool usage details — what commands, files, patterns were actually used. */
export interface SessionConcreteDetails {
  bash_subcommands: Record<string, number>;
  top_files: string[];
  top_directories: string[];
  search_patterns: string[];
  skill_names: string[];
}

export interface SessionSequence {
  session_id: string;
  developer_id: string;
  project_name: string;
  tools: ToolEvent[];
  tool_names: string[];
  success_rate: number;
  prompt_count: number;
  avg_prompt_length: number;
  continuation_ratio: number;
  agent_delegations: number;
  agent_types: string[];
  duration_minutes: number;
  prompt_features: PromptFeatures | null;
  concrete_details: SessionConcreteDetails;
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
      SELECT s.id as session_id, s.developer_id, s.project_name,
        ROUND(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at)) / 60)::FLOAT as duration_minutes
      FROM sessions s
      WHERE s.status = 'ended'
        AND s.ended_at >= NOW() - make_interval(days => ${days})
        AND s.developer_id IN (${inList(developerIds)})
      ORDER BY s.ended_at DESC
      LIMIT ${limit}`;
  } else {
    sessionsQuery = sql`
      SELECT s.id as session_id, s.developer_id, s.project_name,
        ROUND(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at)) / 60)::FLOAT as duration_minutes
      FROM sessions s
      WHERE s.status = 'ended'
        AND s.ended_at >= NOW() - make_interval(days => ${days})
      ORDER BY s.ended_at DESC
      LIMIT ${limit}`;
  }

  const sessions = await sessionsQuery;
  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((s: any) => s.session_id as string);

  // Batch-fetch all event data in 5 queries instead of 5×N
  const [allTools, allPrompts, allAgents, allPromptTexts, allToolDetails] = await Promise.all([
    sql`
      SELECT
        e.session_id,
        e.payload->>'toolName' as tool_name,
        e.event_type,
        CASE WHEN e.event_type = 'tool.complete' THEN TRUE ELSE FALSE END as success,
        e.created_at
      FROM events e
      WHERE e.session_id IN (${inList(sessionIds)})
        AND e.event_type IN ('tool.complete', 'tool.fail')
        AND e.payload->>'toolName' IS NOT NULL
      ORDER BY e.created_at ASC`,
    sql`
      SELECT
        e.session_id,
        COALESCE((e.payload->>'promptLength')::INT, 0) as prompt_length,
        COALESCE((e.payload->>'isContinuation')::BOOLEAN, FALSE) as is_continuation
      FROM events e
      WHERE e.session_id IN (${inList(sessionIds)})
        AND e.event_type = 'prompt.submit'
      ORDER BY e.created_at ASC`,
    sql`
      SELECT
        e.session_id,
        e.payload->>'agentType' as agent_type,
        e.payload->>'agentId' as agent_id,
        e.event_type
      FROM events e
      WHERE e.session_id IN (${inList(sessionIds)})
        AND e.event_type IN ('agent.start', 'agent.stop')
      ORDER BY e.created_at ASC`,
    sql`
      SELECT e.session_id, e.payload->>'promptText' as prompt_text
      FROM events e
      WHERE e.session_id IN (${inList(sessionIds)})
        AND e.event_type = 'prompt.submit'
      ORDER BY e.created_at ASC`,
    // 5th query: concrete tool details (subcommands, file paths, patterns)
    // Join sessions to exclude private sessions from file_path/glob_path/search_pattern
    sql`
      SELECT
        e.session_id,
        e.payload->>'toolName' as tool_name,
        e.payload->>'toolSubcommand' as tool_subcommand,
        CASE WHEN s.privacy_mode IS DISTINCT FROM 'private'
          THEN e.payload->'toolInput'->>'file_path' ELSE NULL END as file_path,
        CASE WHEN s.privacy_mode IS DISTINCT FROM 'private'
          THEN e.payload->'toolInput'->>'path' ELSE NULL END as glob_path,
        CASE WHEN s.privacy_mode IS DISTINCT FROM 'private'
          THEN e.payload->'toolInput'->>'pattern' ELSE NULL END as search_pattern,
        e.payload->'toolInput'->>'skill' as skill_name
      FROM events e
      JOIN sessions s ON s.id = e.session_id
      WHERE e.session_id IN (${inList(sessionIds)})
        AND e.event_type IN ('tool.complete', 'tool.fail')
        AND e.payload->>'toolName' IS NOT NULL
      ORDER BY e.created_at ASC`,
  ]);

  // Group results by session_id
  const toolsBySession = new Map<string, ToolEvent[]>();
  for (const row of allTools as any[]) {
    const sid = row.session_id;
    if (!toolsBySession.has(sid)) toolsBySession.set(sid, []);
    toolsBySession.get(sid)!.push({ tool_name: row.tool_name, event_type: row.event_type, success: row.success, created_at: row.created_at });
  }

  const promptsBySession = new Map<string, PromptEvent[]>();
  for (const row of allPrompts as any[]) {
    const sid = row.session_id;
    if (!promptsBySession.has(sid)) promptsBySession.set(sid, []);
    promptsBySession.get(sid)!.push({ prompt_length: row.prompt_length, is_continuation: row.is_continuation });
  }

  const agentsBySession = new Map<string, AgentEvent[]>();
  for (const row of allAgents as any[]) {
    const sid = row.session_id;
    if (!agentsBySession.has(sid)) agentsBySession.set(sid, []);
    agentsBySession.get(sid)!.push({ agent_type: row.agent_type, agent_id: row.agent_id, event_type: row.event_type });
  }

  const promptTextsBySession = new Map<string, (string | null)[]>();
  for (const row of allPromptTexts as any[]) {
    const sid = row.session_id;
    if (!promptTextsBySession.has(sid)) promptTextsBySession.set(sid, []);
    promptTextsBySession.get(sid)!.push(row.prompt_text ?? null);
  }

  // Group concrete tool details by session
  interface RawToolDetail {
    session_id: string;
    tool_name: string;
    tool_subcommand: string | null;
    file_path: string | null;
    glob_path: string | null;
    search_pattern: string | null;
    skill_name: string | null;
  }
  const toolDetailsBySession = new Map<string, RawToolDetail[]>();
  for (const row of allToolDetails as RawToolDetail[]) {
    const sid = row.session_id;
    if (!toolDetailsBySession.has(sid)) toolDetailsBySession.set(sid, []);
    toolDetailsBySession.get(sid)!.push(row);
  }

  const sequences: SessionSequence[] = [];

  for (const session of sessions) {
    const sid = (session as any).session_id;
    const tools = toolsBySession.get(sid) ?? [];
    const prompts = promptsBySession.get(sid) ?? [];
    const agents = agentsBySession.get(sid) ?? [];
    const promptTexts = promptTextsBySession.get(sid) ?? [];

    if (tools.length < 3) continue; // Skip trivial sessions

    const successCount = tools.filter(t => t.success).length;
    const successRate = tools.length > 0 ? successCount / tools.length : 0;

    const promptCount = prompts.length;
    const avgPromptLength = promptCount > 0
      ? Math.round(prompts.reduce((sum, p) => sum + p.prompt_length, 0) / promptCount)
      : 0;
    const continuationCount = prompts.filter(p => p.is_continuation).length;
    const continuationRatio = promptCount > 0
      ? Math.round((continuationCount / promptCount) * 1000) / 1000
      : 0;

    const agentStarts = agents.filter(a => a.event_type === "agent.start");
    const agentTypes = [...new Set(agentStarts.map(a => a.agent_type).filter(Boolean))];

    // Extract prompt features locally (never sends raw text to LLM)
    const hasAnyText = promptTexts.some(t => t !== null);
    const promptFeatures = hasAnyText ? extractPromptFeatures(promptTexts) : null;

    // Aggregate concrete tool details for this session
    const details = toolDetailsBySession.get(sid) ?? [];
    const bashSubs: Record<string, number> = {};
    const fileCounts: Record<string, number> = {};
    const dirCounts: Record<string, number> = {};
    const patternCounts: Record<string, number> = {};
    const skillSet = new Set<string>();

    for (const d of details) {
      if (d.tool_name === "Bash" && d.tool_subcommand) {
        bashSubs[d.tool_subcommand] = (bashSubs[d.tool_subcommand] ?? 0) + 1;
      }
      if (d.file_path && ["Read", "Write", "Edit"].includes(d.tool_name)) {
        fileCounts[d.file_path] = (fileCounts[d.file_path] ?? 0) + 1;
      }
      if (d.glob_path && d.tool_name === "Glob") {
        dirCounts[d.glob_path] = (dirCounts[d.glob_path] ?? 0) + 1;
      }
      if (d.search_pattern && ["Grep", "Glob"].includes(d.tool_name)) {
        patternCounts[d.search_pattern] = (patternCounts[d.search_pattern] ?? 0) + 1;
      }
      if (d.skill_name) {
        skillSet.add(d.skill_name);
      }
    }

    const topN = (obj: Record<string, number>, n: number) =>
      Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

    const concreteDetails: SessionConcreteDetails = {
      bash_subcommands: bashSubs,
      top_files: topN(fileCounts, 5),
      top_directories: topN(dirCounts, 5),
      search_patterns: topN(patternCounts, 5),
      skill_names: [...skillSet],
    };

    sequences.push({
      session_id: sid,
      developer_id: (session as any).developer_id,
      project_name: (session as any).project_name ?? "",
      tools,
      tool_names: tools.map(t => t.tool_name),
      success_rate: Math.round(successRate * 1000) / 1000,
      prompt_count: promptCount,
      avg_prompt_length: avgPromptLength,
      continuation_ratio: continuationRatio,
      agent_delegations: agentStarts.length,
      agent_types: agentTypes,
      duration_minutes: (session as any).duration_minutes ?? 0,
      prompt_features: promptFeatures,
      concrete_details: concreteDetails,
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
    const updatedContext = JSON.stringify(pattern.data_context ?? ex.data_context ?? {});

    await sql`
      UPDATE session_patterns SET
        name = ${pattern.name},
        description = ${pattern.description},
        occurrence_count = ${newCount},
        avg_success_rate = ${Math.round(newRate * 1000) / 1000},
        effectiveness = ${pattern.effectiveness},
        category = ${pattern.category ?? ex.category ?? null},
        data_context = ${updatedContext}::JSONB,
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
      ROUND((SUM(CASE WHEN e.event_type = 'tool.complete' THEN 1 ELSE 0 END)::FLOAT / GREATEST(COUNT(*), 1))::NUMERIC, 3)::FLOAT as success_rate
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

// --- Team Skills Queries ---

export async function getTeamSessionProductivity(
  sql: SQL,
  devIds: string[],
  weeks: number = 12
): Promise<{
  week: string;
  sessions: number;
  avg_duration_minutes: number;
  active_devs: number;
}[]> {
  if (devIds.length === 0) return [];
  return (await sql`
    SELECT
      date_trunc('week', s.started_at)::DATE as week,
      COUNT(*)::INT as sessions,
      ROUND(
        AVG(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at)) / 60)::NUMERIC, 1
      )::FLOAT as avg_duration_minutes,
      COUNT(DISTINCT s.developer_id)::INT as active_devs
    FROM sessions s
    WHERE s.developer_id IN (${inList(devIds)})
      AND s.started_at >= NOW() - make_interval(weeks => ${weeks})
    GROUP BY week
    ORDER BY week ASC`) as any[];
}

export async function getTeamSessionOutcomes(
  sql: SQL,
  devIds: string[],
  weeks: number = 12
): Promise<{
  week: string;
  total_sessions: number;
  completed_sessions: number;
  completion_rate: number;
}[]> {
  if (devIds.length === 0) return [];
  return (await sql`
    SELECT
      date_trunc('week', s.started_at)::DATE as week,
      COUNT(*)::INT as total_sessions,
      SUM(CASE WHEN s.status = 'ended' THEN 1 ELSE 0 END)::INT as completed_sessions,
      ROUND(
        (SUM(CASE WHEN s.status = 'ended' THEN 1 ELSE 0 END)::FLOAT /
        GREATEST(COUNT(*), 1))::NUMERIC, 3
      )::FLOAT as completion_rate
    FROM sessions s
    WHERE s.developer_id IN (${inList(devIds)})
      AND s.started_at >= NOW() - make_interval(weeks => ${weeks})
    GROUP BY week
    ORDER BY week ASC`) as any[];
}

export async function getTeamPatternAdoption(
  sql: SQL,
  devIds: string[],
  weeks: number = 12
): Promise<{
  week: string;
  effective_count: number;
  ineffective_count: number;
  neutral_count: number;
}[]> {
  if (devIds.length === 0) return [];
  return (await sql`
    SELECT
      date_trunc('week', spm.created_at)::DATE as week,
      SUM(CASE WHEN sp.effectiveness = 'effective' THEN 1 ELSE 0 END)::INT as effective_count,
      SUM(CASE WHEN sp.effectiveness = 'ineffective' THEN 1 ELSE 0 END)::INT as ineffective_count,
      SUM(CASE WHEN sp.effectiveness = 'neutral' THEN 1 ELSE 0 END)::INT as neutral_count
    FROM session_pattern_matches spm
    JOIN session_patterns sp ON spm.pattern_id = sp.id
    JOIN sessions s ON spm.session_id = s.id
    WHERE s.developer_id IN (${inList(devIds)})
      AND spm.created_at >= NOW() - make_interval(weeks => ${weeks})
    GROUP BY week
    ORDER BY week ASC`) as any[];
}

export async function getTeamTopPatterns(
  sql: SQL,
  devIds: string[],
  weeks: number = 12,
  limit: number = 10
): Promise<{
  id: string;
  name: string;
  description: string;
  effectiveness: string;
  team_match_count: number;
  avg_success_rate: number;
}[]> {
  if (devIds.length === 0) return [];
  return (await sql`
    SELECT
      sp.id,
      sp.name,
      sp.description,
      sp.effectiveness,
      COUNT(spm.id)::INT as team_match_count,
      sp.avg_success_rate
    FROM session_patterns sp
    JOIN session_pattern_matches spm ON sp.id = spm.pattern_id
    JOIN sessions s ON spm.session_id = s.id
    WHERE s.developer_id IN (${inList(devIds)})
      AND sp.effectiveness = 'effective'
      AND spm.created_at >= NOW() - make_interval(weeks => ${weeks})
    GROUP BY sp.id, sp.name, sp.description, sp.effectiveness, sp.avg_success_rate
    ORDER BY team_match_count DESC
    LIMIT ${limit}`) as any[];
}

export async function getTeamSkillsSummary(
  sql: SQL,
  devIds: string[],
  weeks: number = 4
): Promise<{
  total_sessions: number;
  completion_rate: number;
  avg_duration_minutes: number;
  patterns_detected: number;
  anti_patterns_detected: number;
  prev_total_sessions: number;
  prev_completion_rate: number;
  prev_avg_duration_minutes: number;
  prev_patterns_detected: number;
  prev_anti_patterns_detected: number;
}> {
  if (devIds.length === 0) {
    return {
      total_sessions: 0, completion_rate: 0, avg_duration_minutes: 0,
      patterns_detected: 0, anti_patterns_detected: 0,
      prev_total_sessions: 0, prev_completion_rate: 0, prev_avg_duration_minutes: 0,
      prev_patterns_detected: 0, prev_anti_patterns_detected: 0,
    };
  }

  const [current] = await sql`
    SELECT
      COUNT(*)::INT as total_sessions,
      ROUND(
        (SUM(CASE WHEN s.status = 'ended' THEN 1 ELSE 0 END)::FLOAT /
        GREATEST(COUNT(*), 1))::NUMERIC, 3
      )::FLOAT as completion_rate,
      ROUND(
        AVG(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at)) / 60)::NUMERIC, 1
      )::FLOAT as avg_duration_minutes
    FROM sessions s
    WHERE s.developer_id IN (${inList(devIds)})
      AND s.started_at >= NOW() - make_interval(weeks => ${weeks})`;

  const [prev] = await sql`
    SELECT
      COUNT(*)::INT as total_sessions,
      ROUND(
        (SUM(CASE WHEN s.status = 'ended' THEN 1 ELSE 0 END)::FLOAT /
        GREATEST(COUNT(*), 1))::NUMERIC, 3
      )::FLOAT as completion_rate,
      ROUND(
        AVG(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at)) / 60)::NUMERIC, 1
      )::FLOAT as avg_duration_minutes
    FROM sessions s
    WHERE s.developer_id IN (${inList(devIds)})
      AND s.started_at >= NOW() - make_interval(weeks => ${weeks * 2})
      AND s.started_at < NOW() - make_interval(weeks => ${weeks})`;

  const [currentPatterns] = await sql`
    SELECT COUNT(*)::INT as cnt
    FROM session_pattern_matches spm
    JOIN sessions s ON spm.session_id = s.id
    WHERE s.developer_id IN (${inList(devIds)})
      AND spm.created_at >= NOW() - make_interval(weeks => ${weeks})`;

  const [prevPatterns] = await sql`
    SELECT COUNT(*)::INT as cnt
    FROM session_pattern_matches spm
    JOIN sessions s ON spm.session_id = s.id
    WHERE s.developer_id IN (${inList(devIds)})
      AND spm.created_at >= NOW() - make_interval(weeks => ${weeks * 2})
      AND spm.created_at < NOW() - make_interval(weeks => ${weeks})`;

  const [currentAnti] = await sql`
    SELECT COUNT(*)::INT as cnt
    FROM session_anti_pattern_matches sapm
    JOIN sessions s ON sapm.session_id = s.id
    WHERE s.developer_id IN (${inList(devIds)})
      AND sapm.created_at >= NOW() - make_interval(weeks => ${weeks})`;

  const [prevAnti] = await sql`
    SELECT COUNT(*)::INT as cnt
    FROM session_anti_pattern_matches sapm
    JOIN sessions s ON sapm.session_id = s.id
    WHERE s.developer_id IN (${inList(devIds)})
      AND sapm.created_at >= NOW() - make_interval(weeks => ${weeks * 2})
      AND sapm.created_at < NOW() - make_interval(weeks => ${weeks})`;

  return {
    total_sessions: (current as any)?.total_sessions ?? 0,
    completion_rate: (current as any)?.completion_rate ?? 0,
    avg_duration_minutes: (current as any)?.avg_duration_minutes ?? 0,
    patterns_detected: (currentPatterns as any)?.cnt ?? 0,
    anti_patterns_detected: (currentAnti as any)?.cnt ?? 0,
    prev_total_sessions: (prev as any)?.total_sessions ?? 0,
    prev_completion_rate: (prev as any)?.completion_rate ?? 0,
    prev_avg_duration_minutes: (prev as any)?.avg_duration_minutes ?? 0,
    prev_patterns_detected: (prevPatterns as any)?.cnt ?? 0,
    prev_anti_patterns_detected: (prevAnti as any)?.cnt ?? 0,
  };
}
