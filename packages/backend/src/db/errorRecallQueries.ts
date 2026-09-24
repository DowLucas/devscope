import type { SQL } from "bun";
import { inList } from "./utils";

// Error recall over tool failures (pgvector, migration 047). Rows are derived
// from tool.fail events of non-private sessions; results carry no developer
// identity and are always scoped through sessions.developer_id.

/** Error messages shorter than this ("Exit code 1") carry too little signal. */
export const MIN_ERROR_CHARS = 20;

export interface PendingError {
  event_id: string;
  tool: string;
  message: string;
}

/** Tool failures with no embedding (and no recorded rejection), newest first. */
export async function getPendingErrors(sql: SQL, model: string, limit: number): Promise<PendingError[]> {
  return (await sql`
    SELECT e.id AS event_id, e.payload->>'toolName' AS tool, e.payload->>'errorMessage' AS message
    FROM events e
    JOIN sessions s ON s.id = e.session_id
    WHERE e.event_type = 'tool.fail'
      AND length(COALESCE(e.payload->>'errorMessage', '')) >= ${MIN_ERROR_CHARS}
      AND COALESCE(s.privacy_mode, 'standard') <> 'private'
      AND NOT EXISTS (SELECT 1 FROM error_embeddings x WHERE x.event_id = e.id AND x.model = ${model})
      AND NOT EXISTS (SELECT 1 FROM error_embedding_failures f WHERE f.event_id = e.id AND f.model = ${model})
    ORDER BY e.created_at DESC
    LIMIT ${limit}`) as PendingError[];
}

export interface ErrorEmbeddingRow {
  event_id: string;
  content_hash: string;
  vector: string;
}

export async function upsertErrorEmbeddings(sql: SQL, model: string, rows: ErrorEmbeddingRow[]): Promise<void> {
  if (rows.length === 0) return;
  await sql.begin(async (tx) => {
    for (const r of rows) {
      await tx`
        INSERT INTO error_embeddings (event_id, model, content_hash, embedding)
        VALUES (${r.event_id}, ${model}, ${r.content_hash}, ${r.vector}::vector)
        ON CONFLICT (event_id, model) DO NOTHING`;
    }
  });
}

export async function recordErrorEmbeddingFailure(sql: SQL, model: string, eventId: string): Promise<void> {
  await sql`
    INSERT INTO error_embedding_failures (event_id, model) VALUES (${eventId}, ${model})
    ON CONFLICT DO NOTHING`;
}

export interface SimilarErrorRow {
  event_id: string;
  session_id: string;
  created_at: string;
  tool: string;
  message: string;
  similarity: number;
  /** The same tool succeeded later in that session within 30 minutes. */
  resolved: boolean;
  /**
   * Input of that first successful call (command, file path, or raw input),
   * usually the fix itself: the quoted glob, the corrected command.
   */
  fix_input: string | null;
  session_title: string | null;
}

/** Nearest past failures among the given developers' non-private sessions. */
export async function searchSimilarErrors(
  sql: SQL,
  opts: { vector: string; model: string; devIds: string[]; limit: number; excludeSessionId?: string | null },
): Promise<SimilarErrorRow[]> {
  if (opts.devIds.length === 0) return [];
  const exclude = opts.excludeSessionId ?? null;
  const rows = await sql.begin(async (tx) => {
    await tx`SET LOCAL hnsw.iterative_scan = relaxed_order`;
    await tx`SET LOCAL hnsw.ef_search = 100`;
    return tx`
      WITH nearest AS (
        SELECT x.event_id, (1 - (x.embedding <=> ${opts.vector}::vector))::REAL AS similarity
        FROM error_embeddings x
        JOIN events e ON e.id = x.event_id
        JOIN sessions s ON s.id = e.session_id
        WHERE x.model = ${opts.model}
          AND s.developer_id IN (${inList(opts.devIds)})
          AND COALESCE(s.privacy_mode, 'standard') <> 'private'
          AND (${exclude}::TEXT IS NULL OR e.session_id <> ${exclude}::TEXT)
        ORDER BY x.embedding <=> ${opts.vector}::vector
        LIMIT ${opts.limit}
      )
      SELECT
        e.id AS event_id, e.session_id, e.created_at,
        e.payload->>'toolName' AS tool,
        left(e.payload->>'errorMessage', 300) AS message,
        n.similarity,
        ok.id IS NOT NULL AS resolved,
        left(COALESCE(
          ok.payload->'toolInput'->>'command',
          ok.payload->'toolInput'->>'file_path',
          (ok.payload->'toolInput')::TEXT
        ), 300) AS fix_input,
        s.current_title AS session_title
      FROM nearest n
      JOIN events e ON e.id = n.event_id
      JOIN sessions s ON s.id = e.session_id
      LEFT JOIN LATERAL (
        SELECT o.id, o.payload
        FROM events o
        WHERE o.session_id = e.session_id
          AND o.event_type = 'tool.complete'
          AND o.payload->>'toolName' = e.payload->>'toolName'
          AND o.created_at > e.created_at
          AND o.created_at <= e.created_at + INTERVAL '30 minutes'
        ORDER BY o.created_at
        LIMIT 1
      ) ok ON true`;
  });
  return (rows as SimilarErrorRow[]).sort((a, b) => b.similarity - a.similarity);
}

export interface SkillChain {
  from: string;
  to: string;
  /** Times `to` was the next skill after `from` in the same session. */
  count: number;
  /** Share of `from` invocations that were followed by `to` next. */
  share: number;
}

/**
 * "After skill A you usually run B", learned from the order of Skill tool
 * calls in the given developers' sessions. Only pairs seen at least
 * `minCount` times and following at least `minShare` of A's uses.
 */
export async function getSkillChains(
  sql: SQL,
  devIds: string[],
  opts: { minCount: number; minShare: number; perSkill: number },
): Promise<SkillChain[]> {
  if (devIds.length === 0) return [];
  return (await sql`
    WITH calls AS (
      SELECT e.session_id, e.created_at, lower(ltrim(e.payload->'toolInput'->>'skill', '/')) AS skill
      FROM events e
      JOIN sessions s ON s.id = e.session_id
      WHERE e.event_type = 'tool.complete'
        AND e.payload->>'toolName' = 'Skill'
        AND e.payload->'toolInput'->>'skill' IS NOT NULL
        AND s.developer_id IN (${inList(devIds)})
    ),
    seq AS (
      SELECT skill, LEAD(skill) OVER (PARTITION BY session_id ORDER BY created_at) AS next_skill
      FROM calls
    ),
    pairs AS (
      SELECT skill, next_skill, COUNT(*)::INT AS n FROM seq
      WHERE next_skill IS NOT NULL AND next_skill <> skill
      GROUP BY skill, next_skill
    ),
    totals AS (SELECT skill, COUNT(*)::INT AS n FROM calls GROUP BY skill),
    ranked AS (
      SELECT p.skill, p.next_skill, p.n, (p.n::REAL / t.n) AS share,
             ROW_NUMBER() OVER (PARTITION BY p.skill ORDER BY p.n DESC, p.next_skill) AS rk
      FROM pairs p JOIN totals t ON t.skill = p.skill
    )
    SELECT skill AS "from", next_skill AS "to", n AS count, share
    FROM ranked
    WHERE n >= ${opts.minCount} AND share >= ${opts.minShare} AND rk <= ${opts.perSkill}
    ORDER BY skill, n DESC`) as SkillChain[];
}
