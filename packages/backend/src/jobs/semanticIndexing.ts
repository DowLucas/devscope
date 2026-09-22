import type { SQL } from "bun";
import {
  buildTurns,
  getPendingEmbeddings,
  upsertTurnEmbeddings,
  refreshSessionEmbeddings,
  type EmbeddingRow,
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
  sessionsRefreshed: number;
  /** True when Ollama failed mid-run; the next run resumes where this stopped. */
  embedderUnavailable: boolean;
}

/**
 * One indexing pass: materialise closed turns, embed pending texts, refresh
 * session vectors. Every step is idempotent, so a crash or Ollama outage at
 * any point just leaves work for the next pass. Shared with the backfill
 * script, which calls it in a loop with a larger batch budget.
 */
export async function indexOnce(
  sql: SQL,
  opts: { maxBatches?: number; turnBuildLimit?: number } = {},
): Promise<IndexStats> {
  const maxBatches = opts.maxBatches ?? MAX_BATCHES_PER_TICK;
  const stats: IndexStats = {
    turnsBuilt: 0,
    embedded: 0,
    sessionsRefreshed: 0,
    embedderUnavailable: false,
  };

  stats.turnsBuilt = await buildTurns(sql, opts.turnBuildLimit ?? TURN_BUILD_LIMIT);

  for (let batch = 0; batch < maxBatches; batch++) {
    const pending = await getPendingEmbeddings(sql, EMBEDDING_MODEL, EMBED_BATCH_SIZE);
    if (pending.length === 0) break;

    const prepared = pending.map((p) =>
      p.kind === "prompt" ? preparePromptText(p.text) : prepareResponseText(p.text),
    );
    const vectors = await embedDocuments(prepared);
    if (!vectors) {
      stats.embedderUnavailable = true;
      break;
    }

    const rows: EmbeddingRow[] = pending.map((p, i) => ({
      turn_id: p.turn_id,
      kind: p.kind,
      content_hash: contentHash(prepared[i]!),
      vector: toVectorLiteral(vectors[i]!),
    }));
    await upsertTurnEmbeddings(sql, EMBEDDING_MODEL, rows);
    stats.embedded += rows.length;
  }

  stats.sessionsRefreshed = await refreshSessionEmbeddings(
    sql,
    EMBEDDING_MODEL,
    SESSION_REFRESH_LIMIT,
  );
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
      if (s.turnsBuilt || s.embedded || s.sessionsRefreshed) {
        console.log(
          `[semantic] turns +${s.turnsBuilt}, embeddings +${s.embedded}, sessions +${s.sessionsRefreshed}` +
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
