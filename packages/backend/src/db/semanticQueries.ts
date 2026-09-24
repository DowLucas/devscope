import { sql as Sql, type SQL } from "bun";
import { inList } from "./utils";

// Semantic retrieval over prompt/response turns (pgvector, migration 045).
//
// Privacy: private sessions never become turns, turns of sessions that later
// switch to private are purged, and private sessions are filtered again at
// query time. Results never carry a developer identity; org scoping always
// goes through sessions.developer_id.

export type TurnKind = "prompt" | "response";

// HNSW partial indexes only match a literal predicate, so the kind filter is
// inlined from this fixed whitelist rather than bound as a parameter.
const KIND_PREDICATE: Record<TurnKind, ReturnType<typeof Sql.unsafe>> = {
  prompt: Sql.unsafe("te.kind = 'prompt'"),
  response: Sql.unsafe("te.kind = 'response'"),
};

/** Max characters of prompt/response text returned per search hit. */
const EXCERPT_CHARS = 4_000;
/** End of the response, where Claude usually states how it went. */
const TAIL_CHARS = 400;

/**
 * A turn whose only closing signal is its last response waits this long, so
 * late async tool events and follow-up Stop events land before it freezes.
 */
const TURN_SETTLE_MINUTES = 10;

/**
 * Upper bound on index tuples an iterative HNSW scan may visit after the org
 * filter. Well above the whole corpus today, so small orgs get exact results.
 */
const MAX_SCAN_TUPLES = 200_000;

/**
 * Materialise settled turns from events. A turn is a prompt.submit plus the
 * last response.complete before the next prompt in the same session; tool
 * events in that window form its outcome. A turn is only built once settled
 * (a later prompt exists, the session ended, or its last response is older
 * than TURN_SETTLE_MINUTES), so it never needs updating. Idempotent via the
 * unique prompt_event_id.
 *
 * Whitespace checks use E' \t\r\n' so SQL and JS agree on "blank".
 *
 * Returns the number of turns inserted.
 */
export async function buildTurns(sql: SQL, limit: number): Promise<number> {
  const rows = await sql`
    WITH unindexed AS MATERIALIZED (
      -- Prompts without a turn. The text is projected after the anti-join, so
      -- steady-state ticks only de-TOAST this small remainder, and nothing
      -- below re-joins events (the planner overestimates this CTE ~40x and
      -- would otherwise seq-scan the whole events table to join back).
      SELECT p.id, p.session_id, p.payload->>'promptText' AS prompt_text
      FROM events p
      WHERE p.event_type = 'prompt.submit'
        AND NOT EXISTS (SELECT 1 FROM prompt_turns pt WHERE pt.prompt_event_id = p.id)
    ),
    pending_sessions AS MATERIALIZED (
      SELECT DISTINCT u.session_id
      FROM unindexed u
      JOIN sessions ps ON ps.id = u.session_id
      WHERE COALESCE(ps.privacy_mode, 'standard') <> 'private'
        AND length(btrim(COALESCE(u.prompt_text, ''), E' \\t\\r\\n')) > 0
    ),
    prompts AS (
      -- All prompts of pending sessions: LEAD needs the full ordering to know
      -- where each pending prompt's turn ends.
      SELECT
        e.id,
        e.session_id,
        e.created_at,
        e.payload->>'promptText' AS prompt_text,
        LEAD(e.created_at) OVER (
          PARTITION BY e.session_id ORDER BY e.created_at, e.id
        ) AS next_prompt_at
      FROM events e
      WHERE e.event_type = 'prompt.submit'
        AND e.session_id IN (SELECT session_id FROM pending_sessions)
    ),
    candidates AS (
      SELECT p.*, s.ended_at
      FROM prompts p
      JOIN sessions s ON s.id = p.session_id
      WHERE COALESCE(s.privacy_mode, 'standard') <> 'private'
        AND length(btrim(COALESCE(p.prompt_text, ''), E' \\t\\r\\n')) > 0
        AND NOT EXISTS (SELECT 1 FROM prompt_turns pt WHERE pt.prompt_event_id = p.id)
    )
    INSERT INTO prompt_turns (
      session_id, prompt_event_id, response_event_id, prompt_at,
      prompt_text, response_text, tool_calls, tool_failures, tools_used, duration_ms
    )
    SELECT
      c.session_id,
      c.id,
      r.id,
      c.created_at,
      c.prompt_text,
      NULLIF(btrim(r.payload->>'responseText', E' \\t\\r\\n'), ''),
      COALESCE(tools.tool_calls, 0),
      COALESCE(tools.tool_failures, 0),
      COALESCE(tools.tools_used, '{}'),
      -- BIGINT: timestamps are client-supplied, so the gap can be arbitrary.
      CASE WHEN r.id IS NOT NULL
        THEN (EXTRACT(EPOCH FROM (r.created_at - c.created_at)) * 1000)::BIGINT
      END
    FROM candidates c
    LEFT JOIN LATERAL (
      SELECT re.id, re.created_at, re.payload
      FROM events re
      WHERE re.session_id = c.session_id
        AND re.event_type = 'response.complete'
        AND re.created_at >= c.created_at
        AND (c.next_prompt_at IS NULL OR re.created_at < c.next_prompt_at)
      ORDER BY re.created_at DESC, re.id DESC
      LIMIT 1
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::INT AS tool_calls,
        COUNT(*) FILTER (WHERE ev.event_type = 'tool.fail')::INT AS tool_failures,
        ARRAY_AGG(DISTINCT ev.payload->>'toolName')
          FILTER (WHERE ev.payload->>'toolName' IS NOT NULL) AS tools_used
      FROM events ev
      WHERE ev.session_id = c.session_id
        AND ev.event_type IN ('tool.complete', 'tool.fail')
        AND ev.created_at >= c.created_at
        AND ev.created_at <= COALESCE(r.created_at, c.next_prompt_at, c.ended_at)
    ) tools ON true
    WHERE c.next_prompt_at IS NOT NULL
       OR c.ended_at IS NOT NULL
       OR r.created_at < NOW() - make_interval(mins => ${TURN_SETTLE_MINUTES})
    ORDER BY c.created_at
    LIMIT ${limit}
    ON CONFLICT (prompt_event_id) DO NOTHING
    RETURNING id`;
  return (rows as unknown[]).length;
}

/**
 * Drop stored turns (and, by cascade, their embeddings) for sessions that
 * switched to private after they were indexed, plus their session and error
 * vectors.
 */
export async function purgePrivateTurns(sql: SQL): Promise<void> {
  await sql`
    DELETE FROM session_embeddings se
    USING sessions s
    WHERE s.id = se.session_id AND s.privacy_mode = 'private'`;
  await sql`
    DELETE FROM prompt_turns t
    USING sessions s
    WHERE s.id = t.session_id AND s.privacy_mode = 'private'`;
  await sql`
    DELETE FROM error_embeddings x
    USING events e, sessions s
    WHERE e.id = x.event_id AND s.id = e.session_id AND s.privacy_mode = 'private'`;
}

export interface PendingEmbedding {
  turn_id: string;
  kind: TurnKind;
  text: string;
}

/** Turn texts with no embedding (and no recorded failure) for `model`. */
export async function getPendingEmbeddings(
  sql: SQL,
  model: string,
  limit: number,
): Promise<PendingEmbedding[]> {
  return (await sql`
    SELECT turn_id, kind, text FROM (
      SELECT t.id AS turn_id, 'prompt' AS kind, t.prompt_text AS text
      FROM prompt_turns t
      UNION ALL
      SELECT t.id, 'response', t.response_text
      FROM prompt_turns t
      WHERE t.response_text IS NOT NULL
    ) candidate
    WHERE NOT EXISTS (
        SELECT 1 FROM turn_embeddings te
        WHERE te.turn_id = candidate.turn_id AND te.kind = candidate.kind AND te.model = ${model}
      )
      AND NOT EXISTS (
        SELECT 1 FROM turn_embedding_failures f
        WHERE f.turn_id = candidate.turn_id AND f.kind = candidate.kind AND f.model = ${model}
      )
    ORDER BY turn_id, kind
    LIMIT ${limit}`) as PendingEmbedding[];
}

export interface EmbeddingRow {
  turn_id: string;
  kind: TurnKind;
  content_hash: string;
  /** pgvector literal from `toVectorLiteral`. */
  vector: string;
}

/** Upsert a batch of turn embeddings atomically. */
export async function upsertTurnEmbeddings(
  sql: SQL,
  model: string,
  rows: EmbeddingRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await sql.begin(async (tx) => {
    for (const r of rows) {
      await tx`
        INSERT INTO turn_embeddings (turn_id, kind, model, content_hash, embedding)
        VALUES (${r.turn_id}, ${r.kind}, ${model}, ${r.content_hash}, ${r.vector}::vector)
        ON CONFLICT (turn_id, kind, model) DO UPDATE
          SET content_hash = EXCLUDED.content_hash,
              embedding = EXCLUDED.embedding,
              embedded_at = NOW()
          WHERE turn_embeddings.content_hash <> EXCLUDED.content_hash`;
    }
  });
}

/** Record a text the embedder rejected on its own, so it leaves the queue. */
export async function recordEmbeddingFailure(
  sql: SQL,
  model: string,
  item: { turn_id: string; kind: TurnKind },
): Promise<void> {
  await sql`
    INSERT INTO turn_embedding_failures (turn_id, kind, model)
    VALUES (${item.turn_id}, ${item.kind}, ${model})
    ON CONFLICT DO NOTHING`;
}

/**
 * Recompute session vectors (mean of prompt vectors) for ended sessions whose
 * embedded prompt count differs from the stored one. Count-based rather than
 * timestamp-based, so it can't miss a turn embedded concurrently. Returns
 * rows written.
 */
export async function refreshSessionEmbeddings(
  sql: SQL,
  model: string,
  limit: number,
): Promise<number> {
  const rows = await sql`
    WITH counts AS (
      SELECT t.session_id, COUNT(*)::INT AS n
      FROM turn_embeddings te
      JOIN prompt_turns t ON t.id = te.turn_id
      WHERE te.model = ${model} AND te.kind = 'prompt'
      GROUP BY t.session_id
    ),
    stale AS (
      SELECT c.session_id
      FROM counts c
      JOIN sessions s ON s.id = c.session_id AND s.ended_at IS NOT NULL
      LEFT JOIN session_embeddings se
        ON se.session_id = c.session_id AND se.model = ${model}
      WHERE se.turn_count IS DISTINCT FROM c.n
      ORDER BY c.session_id
      LIMIT ${limit}
    )
    INSERT INTO session_embeddings (session_id, model, turn_count, embedding, computed_at)
    SELECT t.session_id, ${model}, COUNT(*)::INT, AVG(te.embedding), NOW()
    FROM stale
    JOIN prompt_turns t ON t.session_id = stale.session_id
    JOIN turn_embeddings te
      ON te.turn_id = t.id AND te.kind = 'prompt' AND te.model = ${model}
    GROUP BY t.session_id
    ON CONFLICT (session_id, model) DO UPDATE
      SET turn_count = EXCLUDED.turn_count,
          embedding = EXCLUDED.embedding,
          computed_at = EXCLUDED.computed_at
    RETURNING session_id`;
  return (rows as unknown[]).length;
}

/**
 * Drop session vectors whose turns are all gone (data retention purged the
 * underlying events). Turn rows themselves cascade from events.
 */
export async function deleteOrphanedSessionEmbeddings(sql: SQL): Promise<void> {
  await sql`
    DELETE FROM session_embeddings se
    WHERE NOT EXISTS (SELECT 1 FROM prompt_turns t WHERE t.session_id = se.session_id)`;
}

/** Whether a non-private session `sessionId` belongs to one of `devIds`. */
export async function isSessionInOrg(
  sql: SQL,
  sessionId: string,
  devIds: string[],
): Promise<boolean> {
  if (devIds.length === 0) return false;
  const [row] = await sql`
    SELECT 1 FROM sessions
    WHERE id = ${sessionId}
      AND developer_id IN (${inList(devIds)})
      AND COALESCE(privacy_mode, 'standard') <> 'private'`;
  return !!row;
}

/** Scan settings for KNN over the post-filtered (org-scoped) HNSW indexes. */
async function setScanOptions(tx: SQL): Promise<void> {
  // The org filter is applied after the index scan; iterative scan keeps
  // walking the graph until enough rows survive it.
  await tx`SET LOCAL hnsw.iterative_scan = relaxed_order`;
  await tx`SET LOCAL hnsw.ef_search = 100`;
  await tx.unsafe(`SET LOCAL hnsw.max_scan_tuples = ${MAX_SCAN_TUPLES}`);
}

export interface SimilarTurnRow {
  turn_id: string;
  session_id: string;
  prompt_at: string;
  prompt_text: string;
  response_text: string | null;
  response_tail: string | null;
  tool_calls: number;
  tool_failures: number;
  tools_used: string[];
  /** BIGINT column; Bun returns it as a string. */
  duration_ms: string | number | null;
  session_title: string | null;
  session_intent: string | null;
  project_name: string;
  similarity: number;
}

/** Nearest turns to `vector` within the org's sessions. */
export async function searchSimilarTurns(
  sql: SQL,
  opts: {
    vector: string;
    model: string;
    kind: TurnKind;
    devIds: string[];
    limit: number;
    excludeSessionId?: string | null;
    /** Only turns prompted strictly before this ISO timestamp. */
    before?: string | null;
  },
): Promise<SimilarTurnRow[]> {
  if (opts.devIds.length === 0) return [];
  const exclude = opts.excludeSessionId ?? null;
  const before = opts.before ?? null;
  const rows = await sql.begin(async (tx) => {
    await setScanOptions(tx);
    return tx`
      SELECT
        t.id AS turn_id,
        t.session_id,
        t.prompt_at,
        left(t.prompt_text, ${EXCERPT_CHARS}) AS prompt_text,
        left(t.response_text, ${EXCERPT_CHARS}) AS response_text,
        right(t.response_text, ${TAIL_CHARS}) AS response_tail,
        t.tool_calls,
        t.tool_failures,
        t.tools_used,
        t.duration_ms,
        s.current_title AS session_title,
        s.session_intent,
        s.project_name,
        (1 - (te.embedding <=> ${opts.vector}::vector))::REAL AS similarity
      FROM turn_embeddings te
      JOIN prompt_turns t ON t.id = te.turn_id
      JOIN sessions s ON s.id = t.session_id
      WHERE ${KIND_PREDICATE[opts.kind]}
        AND te.model = ${opts.model}
        AND s.developer_id IN (${inList(opts.devIds)})
        AND COALESCE(s.privacy_mode, 'standard') <> 'private'
        AND (${exclude}::TEXT IS NULL OR t.session_id <> ${exclude}::TEXT)
        AND (${before}::TIMESTAMPTZ IS NULL OR t.prompt_at < ${before}::TIMESTAMPTZ)
      ORDER BY te.embedding <=> ${opts.vector}::vector
      LIMIT ${opts.limit}`;
  });
  // relaxed_order can return slightly out-of-order rows; restore strict order.
  return (rows as SimilarTurnRow[]).sort((a, b) => b.similarity - a.similarity);
}

export interface SimilarSessionRow {
  session_id: string;
  session_title: string | null;
  session_intent: string | null;
  project_name: string;
  started_at: string;
  ended_at: string | null;
  estimated_cost_usd: string | null;
  turn_count: number;
  tool_calls: number;
  tool_failures: number;
  similarity: number;
}

/**
 * Sessions nearest to `sessionId`'s session vector within the org. Returns
 * null when the source session has no vector yet (still active or unindexed).
 * The caller must already have verified `sessionId` with `isSessionInOrg`.
 */
export async function searchSimilarSessions(
  sql: SQL,
  opts: { sessionId: string; model: string; devIds: string[]; limit: number },
): Promise<SimilarSessionRow[] | null> {
  if (opts.devIds.length === 0) return [];
  const [source] = await sql`
    SELECT embedding::TEXT AS vector FROM session_embeddings
    WHERE session_id = ${opts.sessionId} AND model = ${opts.model}`;
  if (!source) return null;
  const vector = (source as { vector: string }).vector;

  const rows = await sql.begin(async (tx) => {
    await setScanOptions(tx);
    return tx`
      WITH nearest AS (
        SELECT se.session_id, (1 - (se.embedding <=> ${vector}::vector))::REAL AS similarity
        FROM session_embeddings se
        JOIN sessions s ON s.id = se.session_id
        WHERE se.model = ${opts.model}
          AND se.session_id <> ${opts.sessionId}
          AND s.developer_id IN (${inList(opts.devIds)})
          AND COALESCE(s.privacy_mode, 'standard') <> 'private'
        ORDER BY se.embedding <=> ${vector}::vector
        LIMIT ${opts.limit}
      )
      SELECT
        s.id AS session_id,
        s.current_title AS session_title,
        s.session_intent,
        s.project_name,
        s.started_at,
        s.ended_at,
        s.estimated_cost_usd,
        agg.turn_count,
        agg.tool_calls,
        agg.tool_failures,
        n.similarity
      FROM nearest n
      JOIN sessions s ON s.id = n.session_id
      JOIN LATERAL (
        SELECT
          COUNT(*)::INT AS turn_count,
          COALESCE(SUM(t.tool_calls), 0)::INT AS tool_calls,
          COALESCE(SUM(t.tool_failures), 0)::INT AS tool_failures
        FROM prompt_turns t WHERE t.session_id = n.session_id
      ) agg ON true`;
  });
  return (rows as SimilarSessionRow[]).sort((a, b) => b.similarity - a.similarity);
}

/** Arbitrary constant key for the semantic indexing advisory lock. */
const INDEX_LOCK_KEY = 7_302_645_118;

/**
 * Run `fn` holding a session-level advisory lock, so the live job and the
 * backfill script never index concurrently (no double GPU work, no competing
 * upserts). Returns null without running `fn` if another holder has it. The
 * lock lives on a reserved connection and is released even if `fn` throws;
 * if the process dies the connection closes and Postgres drops the lock.
 */
export async function withSemanticIndexLock<T>(
  sql: SQL,
  fn: () => Promise<T>,
): Promise<T | null> {
  const conn = await sql.reserve();
  try {
    const [row] = await conn`SELECT pg_try_advisory_lock(${INDEX_LOCK_KEY}) AS locked`;
    if (!(row as { locked: boolean }).locked) return null;
    try {
      return await fn();
    } finally {
      await conn`SELECT pg_advisory_unlock(${INDEX_LOCK_KEY})`;
    }
  } finally {
    conn.release();
  }
}
