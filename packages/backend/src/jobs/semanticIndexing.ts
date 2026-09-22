import type { SQL } from "bun";
import {
  buildTurns,
  purgePrivateTurns,
  getPendingEmbeddings,
  upsertTurnEmbeddings,
  recordEmbeddingFailure,
  refreshSessionEmbeddings,
  withSemanticIndexLock,
  type EmbeddingRow,
  type PendingEmbedding,
} from "../db";
import {
  EMBEDDING_MODEL,
  isEmbeddingAvailable,
  embedDocuments,
  preparePromptText,
  prepareResponseText,
  contentHash,
  toVectorLiteral,
} from "../ai/embeddings";

const CHECK_INTERVAL_MS = 60_000;
const TURN_BUILD_LIMIT = 500;
const EMBED_BATCH_SIZE = 32;
const MAX_BATCHES_PER_TICK = 20;
const SESSION_REFRESH_LIMIT = 200;

export interface IndexStats {
  turnsBuilt: number;
  embedded: number;
  /** Texts the embedder rejected on their own; recorded and skipped from now on. */
  rejected: number;
  sessionsRefreshed: number;
  /** True when Ollama failed as a whole; the next run resumes where this stopped. */
  embedderUnavailable: boolean;
  /** True when another process (job or backfill) held the index lock. */
  skippedLocked: boolean;
}

function prepare(p: PendingEmbedding): string {
  return p.kind === "prompt" ? preparePromptText(p.text) : prepareResponseText(p.text);
}

function toRow(p: PendingEmbedding, prepared: string, vector: number[]): EmbeddingRow {
  return {
    turn_id: p.turn_id,
    kind: p.kind,
    content_hash: contentHash(prepared),
    vector: toVectorLiteral(vector),
  };
}

/**
 * Embed one batch. If the whole batch fails, retry item by item: if every
 * item still fails the embedder itself is down (return null, record nothing);
 * otherwise the items that fail alone are poison inputs and get recorded so
 * they can't wedge the queue.
 */
async function embedBatch(
  sql: SQL,
  pending: PendingEmbedding[],
): Promise<{ rows: EmbeddingRow[]; rejected: number } | null> {
  const prepared = pending.map(prepare);
  const vectors = await embedDocuments(prepared);
  if (vectors) {
    return { rows: pending.map((p, i) => toRow(p, prepared[i]!, vectors[i]!)), rejected: 0 };
  }

  const rows: EmbeddingRow[] = [];
  const failed: PendingEmbedding[] = [];
  for (const [i, p] of pending.entries()) {
    const single = await embedDocuments([prepared[i]!]);
    if (single) rows.push(toRow(p, prepared[i]!, single[0]!));
    else failed.push(p);
  }
  if (rows.length === 0) return null;
  for (const p of failed) await recordEmbeddingFailure(sql, EMBEDDING_MODEL, p);
  if (failed.length > 0) {
    console.warn(`[semantic] ${failed.length} text(s) rejected by the embedder; skipping them`);
  }
  return { rows, rejected: failed.length };
}

/**
 * One indexing pass: purge newly private turns, materialise settled turns,
 * embed pending texts, refresh session vectors. Holds an advisory lock so the
 * live job and the backfill script never run a pass concurrently. Every step
 * is idempotent, so a crash or Ollama outage at any point just leaves work for
 * the next pass.
 */
export async function indexOnce(
  sql: SQL,
  opts: { maxBatches?: number; turnBuildLimit?: number } = {},
): Promise<IndexStats> {
  const stats: IndexStats = {
    turnsBuilt: 0,
    embedded: 0,
    rejected: 0,
    sessionsRefreshed: 0,
    embedderUnavailable: false,
    skippedLocked: false,
  };

  const ran = await withSemanticIndexLock(sql, async () => {
    const maxBatches = opts.maxBatches ?? MAX_BATCHES_PER_TICK;
    await purgePrivateTurns(sql);
    stats.turnsBuilt = await buildTurns(sql, opts.turnBuildLimit ?? TURN_BUILD_LIMIT);

    for (let batch = 0; batch < maxBatches; batch++) {
      const pending = await getPendingEmbeddings(sql, EMBEDDING_MODEL, EMBED_BATCH_SIZE);
      if (pending.length === 0) break;

      const result = await embedBatch(sql, pending);
      if (!result) {
        stats.embedderUnavailable = true;
        break;
      }
      await upsertTurnEmbeddings(sql, EMBEDDING_MODEL, result.rows);
      stats.embedded += result.rows.length;
      stats.rejected += result.rejected;
    }

    stats.sessionsRefreshed = await refreshSessionEmbeddings(
      sql,
      EMBEDDING_MODEL,
      SESSION_REFRESH_LIMIT,
    );
    return true;
  });

  if (ran === null) stats.skippedLocked = true;
  return stats;
}

export function startSemanticIndexing(sql: SQL) {
  const g = globalThis as any;
  if (g.__gc_semantic_interval) clearInterval(g.__gc_semantic_interval);

  if (process.env.DISABLE_SEMANTIC_INDEXING === "1") {
    console.log("[semantic] Skipped — DISABLE_SEMANTIC_INDEXING=1");
    return;
  }
  if (!isEmbeddingAvailable()) {
    console.log("[semantic] Skipped — EMBEDDING_URL not set");
    return;
  }

  let running = false;

  async function check() {
    // A slow pass (e.g. the model loading) must not overlap the next tick.
    if (running) return;
    running = true;
    try {
      const s = await indexOnce(sql);
      if (s.turnsBuilt || s.embedded || s.sessionsRefreshed || s.rejected) {
        console.log(
          `[semantic] turns +${s.turnsBuilt}, embeddings +${s.embedded}, sessions +${s.sessionsRefreshed}` +
            (s.rejected ? `, rejected ${s.rejected}` : "") +
            (s.embedderUnavailable ? " (embedder unavailable, will retry)" : ""),
        );
      }
    } catch (err) {
      console.error("[semantic] Failed:", err);
    } finally {
      running = false;
    }
  }

  setTimeout(() => void check(), 45_000);
  g.__gc_semantic_interval = setInterval(check, CHECK_INTERVAL_MS);
  console.log(`[semantic] Indexing every ${CHECK_INTERVAL_MS / 1000}s with ${EMBEDDING_MODEL}`);
}
