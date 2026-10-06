import { sql as Sql, type SQL } from "bun";
import { inList } from "./utils";
import { setScanOptions, type TurnKind } from "./semanticQueries";

// Hybrid session search (GET /api/similar/search): a keyword ranking over
// prompt_turns.search_tsv (migration 053) and KNN rankings over
// turn_embeddings, fused by the route. Same scoping as semanticQueries:
// org via sessions.developer_id, private sessions excluded, and no developer
// identity in the results.

export type SearchField = "prompt" | "response" | "both";

export interface SearchFilters {
  /** Exact project name. */
  project?: string | null;
  /** ISO timestamps bounding prompt_at, inclusive from / exclusive to. */
  from?: string | null;
  to?: string | null;
  /** Include harness/agent/scheduled prompts, not just ones typed by a human. */
  allOrigins?: boolean;
}

/** One ranked candidate; rank order is the array order. */
export interface SearchCandidate {
  turn_id: string;
  score: number;
}

const KIND_PREDICATE: Record<TurnKind, ReturnType<typeof Sql.unsafe>> = {
  prompt: Sql.unsafe("te.kind = 'prompt'"),
  response: Sql.unsafe("te.kind = 'response'"),
};

/** Characters of text ts_headline scans per field; bounds its cost. */
const HEADLINE_SCAN_CHARS = 50_000;
/** Shown when a turn has no keyword match (semantic-only hit). */
const PLAIN_SNIPPET_CHARS = 300;

function filterSql(f: SearchFilters) {
  const project = f.project ?? null;
  const from = f.from ?? null;
  const to = f.to ?? null;
  const allOrigins = f.allOrigins ?? false;
  return Sql`
    AND (${project}::TEXT IS NULL OR s.project_name = ${project}::TEXT)
    AND (${from}::TIMESTAMPTZ IS NULL OR t.prompt_at >= ${from}::TIMESTAMPTZ)
    AND (${to}::TIMESTAMPTZ IS NULL OR t.prompt_at < ${to}::TIMESTAMPTZ)
    AND (${allOrigins}::BOOLEAN OR COALESCE(t.origin, 'human') = 'human')`;
}

/**
 * The search query as a tsquery. websearch syntax ("phrase", OR, -term),
 * with every lexeme of 3+ characters turned into a prefix match so a
 * half-typed identifier still hits (shorter ones would match nearly anything). Falls back to the plain query if a lexeme contains a quote,
 * which the rewrite cannot handle safely.
 */
function tsQuerySql(q: string) {
  return Sql`(
    SELECT CASE
      WHEN w::TEXT = '' OR position('''''' IN w::TEXT) > 0 THEN w
      ELSE to_tsquery('simple', regexp_replace(w::TEXT, '''([^'']{3,})''', '''\\1'':*', 'g'))
    END
    FROM websearch_to_tsquery('simple', ${q}) AS w
  )`;
}

/** Turns whose text matches `query`, best ts_rank_cd first. */
export async function keywordSearchTurns(
  sql: SQL,
  opts: { query: string; field: SearchField; devIds: string[]; filters: SearchFilters; limit: number },
): Promise<SearchCandidate[]> {
  if (opts.devIds.length === 0) return [];
  // Weight A is the prompt, B the response (see migration 053); ts_filter
  // narrows the GIN-matched rows to the requested half.
  const fieldFilter =
    opts.field === "prompt"
      ? Sql`AND ts_filter(t.search_tsv, '{a}') @@ q.tsq`
      : opts.field === "response"
        ? Sql`AND ts_filter(t.search_tsv, '{b}') @@ q.tsq`
        : Sql``;
  const rows = await sql`
    WITH q AS (SELECT ${tsQuerySql(opts.query)} AS tsq)
    SELECT t.id::TEXT AS turn_id, ts_rank_cd(t.search_tsv, q.tsq)::REAL AS score
    FROM q, prompt_turns t
    JOIN sessions s ON s.id = t.session_id
    WHERE t.search_tsv @@ q.tsq
      ${fieldFilter}
      AND s.developer_id IN (${inList(opts.devIds)})
      AND COALESCE(s.privacy_mode, 'standard') <> 'private'
      ${filterSql(opts.filters)}
    ORDER BY score DESC, t.prompt_at DESC
    LIMIT ${opts.limit}`;
  return rows as SearchCandidate[];
}

/** Turns nearest to `vector` on one embedding kind, most similar first. */
export async function vectorSearchTurns(
  sql: SQL,
  opts: {
    vector: string;
    model: string;
    kind: TurnKind;
    devIds: string[];
    filters: SearchFilters;
    limit: number;
    /** Absolute similarity floor. */
    minSimilarity: number;
    /** Also drop hits more than this far below the best hit. */
    relativeWindow: number;
  },
): Promise<SearchCandidate[]> {
  if (opts.devIds.length === 0) return [];
  const rows = await sql.begin(async (tx) => {
    await setScanOptions(tx);
    return tx`
      SELECT t.id::TEXT AS turn_id, (1 - (te.embedding <=> ${opts.vector}::vector))::REAL AS score
      FROM turn_embeddings te
      JOIN prompt_turns t ON t.id = te.turn_id
      JOIN sessions s ON s.id = t.session_id
      WHERE ${KIND_PREDICATE[opts.kind]}
        AND te.model = ${opts.model}
        AND s.developer_id IN (${inList(opts.devIds)})
        AND COALESCE(s.privacy_mode, 'standard') <> 'private'
        ${filterSql(opts.filters)}
      ORDER BY te.embedding <=> ${opts.vector}::vector
      LIMIT ${opts.limit}`;
  });
  // relaxed_order can return slightly out-of-order rows; restore strict order.
  const sorted = (rows as SearchCandidate[]).sort((a, b) => b.score - a.score);
  const floor = Math.max(opts.minSimilarity, (sorted[0]?.score ?? 0) - opts.relativeWindow);
  return sorted.filter((r) => r.score >= floor);
}

export interface SearchHitRow {
  turn_id: string;
  session_id: string;
  prompt_event_id: string;
  prompt_at: string;
  prompt_snippet: string;
  response_snippet: string | null;
  tool_calls: number;
  tool_failures: number;
  tools_used: string[];
  /** BIGINT column; Bun returns it as a string. */
  duration_ms: string | number | null;
  session_title: string | null;
  project_name: string;
}

/**
 * Hydrate the final hits with highlighted snippets. Matched terms are wrapped
 * in « »; a field without a match gets its opening text. Re-applies the org
 * and privacy scope so ids alone can never leak a turn.
 */
export async function fetchSearchHits(
  sql: SQL,
  opts: { turnIds: string[]; query: string; devIds: string[] },
): Promise<SearchHitRow[]> {
  if (opts.turnIds.length === 0 || opts.devIds.length === 0) return [];
  const opt = "StartSel=«, StopSel=», MaxWords=35, MinWords=12, MaxFragments=2, FragmentDelimiter=\" … \"";
  const rows = await sql`
    WITH q AS (SELECT ${tsQuerySql(opts.query)} AS tsq)
    SELECT
      t.id::TEXT AS turn_id,
      t.session_id,
      t.prompt_event_id,
      t.prompt_at,
      CASE WHEN to_tsvector('simple', left(t.prompt_text, ${HEADLINE_SCAN_CHARS})) @@ q.tsq
        THEN ts_headline('simple', left(t.prompt_text, ${HEADLINE_SCAN_CHARS}), q.tsq, ${opt})
        ELSE left(t.prompt_text, ${PLAIN_SNIPPET_CHARS})
      END AS prompt_snippet,
      CASE
        WHEN t.response_text IS NULL THEN NULL
        WHEN to_tsvector('simple', left(t.response_text, ${HEADLINE_SCAN_CHARS})) @@ q.tsq
          THEN ts_headline('simple', left(t.response_text, ${HEADLINE_SCAN_CHARS}), q.tsq, ${opt})
        ELSE left(t.response_text, ${PLAIN_SNIPPET_CHARS})
      END AS response_snippet,
      t.tool_calls,
      t.tool_failures,
      t.tools_used,
      t.duration_ms,
      s.current_title AS session_title,
      s.project_name
    FROM q, prompt_turns t
    JOIN sessions s ON s.id = t.session_id
    WHERE t.id IN (${inList(opts.turnIds)})
      AND s.developer_id IN (${inList(opts.devIds)})
      AND COALESCE(s.privacy_mode, 'standard') <> 'private'`;
  return rows as SearchHitRow[];
}

/** Projects that have searchable turns, most recently active first. */
export async function getSearchableProjects(sql: SQL, devIds: string[]): Promise<string[]> {
  if (devIds.length === 0) return [];
  const rows = await sql`
    SELECT s.project_name
    FROM sessions s
    WHERE s.developer_id IN (${inList(devIds)})
      AND COALESCE(s.privacy_mode, 'standard') <> 'private'
      AND EXISTS (SELECT 1 FROM prompt_turns t WHERE t.session_id = s.id)
    GROUP BY s.project_name
    ORDER BY max(s.started_at) DESC
    LIMIT 200`;
  return (rows as { project_name: string }[]).map((r) => r.project_name);
}
