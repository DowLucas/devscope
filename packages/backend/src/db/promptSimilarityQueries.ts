import type { SQL } from "bun";
import { inList } from "./utils";

// Keyword-based prompt similarity (Phase 1 — no embeddings yet).
//
// Scope: same developer + same project_path, ended sessions only, last 30 days.
// Ranking: Postgres full-text similarity on the prompt text combined with
// session outcome (success rate over tool calls). We pull a candidate pool
// then score in JS to keep the query simple.
//
// Privacy: respects per-session privacy_mode — only sessions whose
// privacy_mode is NULL or 'standard' or 'open' are considered. Private
// sessions don't store prompt text.

export interface SimilarPromptMatch {
  session_id: string;
  prompt_text: string;
  success_rate: number;
  tool_count: number;
  similarity: number;
}

const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","of","to","for","in","on","at",
  "is","it","this","that","with","as","by","be","are","was","were","i","you",
  "we","my","your","our","do","does","did","please","can","could","would",
  "should","make","just","like","want","need","help","also","new","add",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export async function findSimilarPrompts(
  sql: SQL,
  opts: {
    developerId: string;
    projectPath: string;
    promptText: string;
    excludeSessionId: string;
    limit?: number;
    days?: number;
  },
): Promise<SimilarPromptMatch[]> {
  const limit = opts.limit ?? 3;
  const days = opts.days ?? 30;

  const queryTokens = new Set(tokenize(opts.promptText));
  if (queryTokens.size === 0) return [];

  // Pull recent prompts from same dev + project. We use simple ILIKE
  // pre-filtering on the strongest token to bound the result set.
  const tokens = [...queryTokens];
  const probe = tokens.sort((a, b) => b.length - a.length)[0] ?? "";

  const rows = await sql`
    SELECT
      e.session_id,
      e.payload->>'promptText' as prompt_text,
      e.created_at
    FROM events e
    JOIN sessions s ON s.id = e.session_id
    WHERE s.developer_id = ${opts.developerId}
      AND s.project_path = ${opts.projectPath}
      AND s.id <> ${opts.excludeSessionId}
      AND COALESCE(s.privacy_mode, 'standard') <> 'private'
      AND e.event_type = 'prompt.submit'
      AND e.payload->>'promptText' IS NOT NULL
      AND e.created_at >= NOW() - make_interval(days => ${days})
      AND (e.payload->>'promptText') ILIKE ${"%" + probe + "%"}
    ORDER BY e.created_at DESC
    LIMIT 50`;

  if ((rows as any[]).length === 0) return [];

  const sessionIds = [...new Set((rows as any[]).map((r) => r.session_id as string))];
  if (sessionIds.length === 0) return [];

  // Fetch outcomes for each candidate session.
  const outcomeRows = await sql`
    SELECT session_id,
       SUM(CASE WHEN event_type = 'tool.complete' THEN 1 ELSE 0 END)::INT as success_count,
       COUNT(*)::INT as total
     FROM events
     WHERE session_id IN (${inList(sessionIds)})
       AND event_type IN ('tool.complete','tool.fail')
     GROUP BY session_id`;

  const outcomeMap = new Map<string, { success: number; total: number }>();
  for (const r of outcomeRows as any[]) {
    outcomeMap.set(r.session_id, { success: r.success_count, total: r.total });
  }

  const scored: SimilarPromptMatch[] = [];
  for (const r of rows as any[]) {
    const candTokens = new Set(tokenize(r.prompt_text as string));
    const sim = jaccard(queryTokens, candTokens);
    if (sim < 0.15) continue;
    const o = outcomeMap.get(r.session_id) ?? { success: 0, total: 0 };
    scored.push({
      session_id: r.session_id,
      prompt_text: r.prompt_text,
      success_rate: o.total > 0 ? o.success / o.total : 0,
      tool_count: o.total,
      similarity: Math.round(sim * 1000) / 1000,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}
