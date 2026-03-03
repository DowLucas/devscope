import type { SQL } from "bun";
import type { AntiPattern, SessionAntiPatternMatch } from "@devscope/shared";

export async function upsertAntiPattern(sql: SQL, ap: {
  name: string; description: string; detection_rule: string; severity: string;
  suggestion: string; occurrence_count?: number; data_context?: Record<string, unknown>;
}): Promise<AntiPattern> {
  const existing = await sql`SELECT * FROM anti_patterns WHERE name = ${ap.name} AND detection_rule = ${ap.detection_rule} LIMIT 1`;
  if (existing.length > 0) {
    const ex = existing[0] as any;
    const newCount = ex.occurrence_count + (ap.occurrence_count ?? 1);
    await sql`UPDATE anti_patterns SET occurrence_count = ${newCount}, severity = ${ap.severity}, suggestion = ${ap.suggestion}, updated_at = NOW() WHERE id = ${ex.id}`;
    const [updated] = await sql`SELECT * FROM anti_patterns WHERE id = ${ex.id}`;
    return updated as AntiPattern;
  }
  const id = crypto.randomUUID();
  const dataContext = JSON.stringify(ap.data_context ?? {});
  await sql`INSERT INTO anti_patterns (id, name, description, detection_rule, severity, suggestion, occurrence_count, data_context)
    VALUES (${id}, ${ap.name}, ${ap.description}, ${ap.detection_rule}, ${ap.severity}, ${ap.suggestion}, ${ap.occurrence_count ?? 1}, ${dataContext}::JSONB)`;
  const [row] = await sql`SELECT * FROM anti_patterns WHERE id = ${id}`;
  return row as AntiPattern;
}

export async function createAntiPatternMatch(sql: SQL, sessionId: string, antiPatternId: string, details: Record<string, unknown> = {}): Promise<SessionAntiPatternMatch> {
  const id = crypto.randomUUID();
  const detailsJson = JSON.stringify(details);
  await sql`INSERT INTO session_anti_pattern_matches (id, session_id, anti_pattern_id, details) VALUES (${id}, ${sessionId}, ${antiPatternId}, ${detailsJson}::JSONB)`;
  const [row] = await sql`SELECT * FROM session_anti_pattern_matches WHERE id = ${id}`;
  return row as SessionAntiPatternMatch;
}

export async function getAntiPatterns(sql: SQL, opts?: { severity?: string; detection_rule?: string; limit?: number }): Promise<AntiPattern[]> {
  const limit = opts?.limit ?? 50;
  if (opts?.severity && opts?.detection_rule) {
    return (await sql`SELECT * FROM anti_patterns WHERE severity = ${opts.severity} AND detection_rule = ${opts.detection_rule} ORDER BY occurrence_count DESC LIMIT ${limit}`) as AntiPattern[];
  }
  if (opts?.severity) return (await sql`SELECT * FROM anti_patterns WHERE severity = ${opts.severity} ORDER BY occurrence_count DESC LIMIT ${limit}`) as AntiPattern[];
  if (opts?.detection_rule) return (await sql`SELECT * FROM anti_patterns WHERE detection_rule = ${opts.detection_rule} ORDER BY occurrence_count DESC LIMIT ${limit}`) as AntiPattern[];
  return (await sql`SELECT * FROM anti_patterns ORDER BY occurrence_count DESC LIMIT ${limit}`) as AntiPattern[];
}

export async function getAntiPatternById(sql: SQL, id: string): Promise<AntiPattern | null> {
  const [row] = await sql`SELECT * FROM anti_patterns WHERE id = ${id}`;
  return (row as AntiPattern) ?? null;
}

export async function getAntiPatternStats(sql: SQL, days: number = 30): Promise<{
  total_anti_patterns: number; critical_count: number; warning_count: number;
  top_anti_patterns: AntiPattern[]; recent_matches: number; by_rule: { detection_rule: string; count: number }[];
}> {
  const [counts] = await sql`SELECT COUNT(*)::INT as total_anti_patterns, SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END)::INT as critical_count, SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END)::INT as warning_count FROM anti_patterns`;
  const topAntiPatterns = await sql`SELECT * FROM anti_patterns ORDER BY occurrence_count DESC LIMIT 5`;
  const [matchCount] = await sql`SELECT COUNT(*)::INT as cnt FROM session_anti_pattern_matches WHERE created_at >= NOW() - make_interval(days => ${days})`;
  const byRule = await sql`SELECT detection_rule, COUNT(*)::INT as count FROM anti_patterns GROUP BY detection_rule ORDER BY count DESC`;
  return {
    total_anti_patterns: (counts as any)?.total_anti_patterns ?? 0, critical_count: (counts as any)?.critical_count ?? 0,
    warning_count: (counts as any)?.warning_count ?? 0, top_anti_patterns: topAntiPatterns as AntiPattern[],
    recent_matches: (matchCount as any)?.cnt ?? 0, by_rule: byRule as any[],
  };
}

export async function getAntiPatternTrends(sql: SQL, days: number = 30): Promise<{ day: string; detection_rule: string; count: number }[]> {
  return (await sql`SELECT sapm.created_at::DATE as day, ap.detection_rule, COUNT(*)::INT as count
    FROM session_anti_pattern_matches sapm JOIN anti_patterns ap ON sapm.anti_pattern_id = ap.id
    WHERE sapm.created_at >= NOW() - make_interval(days => ${days}) GROUP BY day, ap.detection_rule ORDER BY day ASC`) as any[];
}

export async function getDeveloperAntiPatterns(sql: SQL, developerId: string, weeks: number = 12): Promise<{ week: string; count: number; by_rule: Record<string, number> }[]> {
  const rows = await sql`SELECT date_trunc('week', sapm.created_at)::DATE as week, ap.detection_rule, COUNT(*)::INT as count
    FROM session_anti_pattern_matches sapm JOIN anti_patterns ap ON sapm.anti_pattern_id = ap.id JOIN sessions s ON sapm.session_id = s.id
    WHERE s.developer_id = ${developerId} AND sapm.created_at >= NOW() - make_interval(weeks => ${weeks})
    GROUP BY week, ap.detection_rule ORDER BY week ASC`;
  const weekMap = new Map<string, { count: number; by_rule: Record<string, number> }>();
  for (const row of rows as any[]) {
    if (!weekMap.has(row.week)) weekMap.set(row.week, { count: 0, by_rule: {} });
    const entry = weekMap.get(row.week)!;
    entry.count += row.count;
    entry.by_rule[row.detection_rule] = row.count;
  }
  return Array.from(weekMap.entries()).map(([week, data]) => ({ week, ...data }));
}
