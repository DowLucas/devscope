import type { SQL } from "bun";
import {
  buildTurns,
  purgePrivateTurns,
  getPendingEmbeddings,
  upsertTurnEmbeddings,
  recordEmbeddingFailure,
  refreshSessionEmbeddings,
  withSemanticIndexLock,
  getPendingErrors,
  upsertErrorEmbeddings,
  recordErrorEmbeddingFailure,
  type EmbeddingRow,
  type PendingEmbedding,
  type PendingError,
} from "../db";
import {
  EMBEDDING_MODEL,
  isEmbeddingAvailable,
  embedDocuments,
  preparePromptText,
  prepareResponseText,
  prepareErrorText,
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
  /** Tool-failure messages embedded for error recall. */
  errorsEmbedded: number;
  /** Texts the embedder rejected on their own; recorded and skipped from now on. */
  rejected: number;
  sessionsRefreshed: number;
  /** True when Ollama failed as a whole; the next run resumes where this stopped. */
  embedderUnavailable: boolean;
  /** True when another process (job or backfill) held the index lock. */
  skippedLocked: boolean;
}

const prepareTurn = (p: PendingEmbedding) =>
  p.kind === "prompt" ? preparePromptText(p.text) : prepareResponseText(p.text);

/**
 * Embed one batch of prepared texts. If the whole batch fails, retry item by
 * item: if every item still fails the embedder itself is down (return null,
 * record nothing); otherwise the items that fail alone are poison inputs and
 * go to `onReject` so they can't wedge the queue.
 */
async function embedBatch<T>(
  items: T[],
  prepare: (item: T) => string,
  onReject: (item: T) => Promise<void>,
): Promise<{ embedded: { item: T; hash: string; vector: string }[]; rejected: number } | null> {
  const prepared = items.map(prepare);
  const toEntry = (i: number, v: number[]) => ({
    item: items[i]!,
    hash: contentHash(prepared[i]!),
    vector: toVectorLiteral(v),
  });

  const vectors = await embedDocuments(prepared);
  if (vectors) return { embedded: vectors.map((v, i) => toEntry(i, v)), rejected: 0 };

  const embedded = [];
  const failed: T[] = [];
  for (const [i, text] of prepared.entries()) {
    const single = await embedDocuments([text]);
    if (single) embedded.push(toEntry(i, single[0]!));
    else failed.push(items[i]!);
  }
  if (embedded.length === 0) return null;
  for (const item of failed) await onReject(item);
  if (failed.length > 0) {
    console.warn(`[semantic] ${failed.length} text(s) rejected by the embedder; skipping them`);
  }
  return { embedded, rejected: failed.length };
}

/**
 * Drain a pending queue in batches until empty, out of budget, or the
 * embedder is down. Returns false when the embedder was unavailable.
 */
async function drainQueue<T>(
  maxBatches: number,
  stats: IndexStats,
  counter: "embedded" | "errorsEmbedded",
  queue: {
    next: () => Promise<T[]>;
    prepare: (item: T) => string;
    reject: (item: T) => Promise<void>;
    save: (embedded: { item: T; hash: string; vector: string }[]) => Promise<void>;
  },
): Promise<boolean> {
  for (let batch = 0; batch < maxBatches; batch++) {
    const pending = await queue.next();
    if (pending.length === 0) break;
    const result = await embedBatch(pending, queue.prepare, queue.reject);
    if (!result) return false;
    await queue.save(result.embedded);
    stats[counter] += result.embedded.length;
    stats.rejected += result.rejected;
  }
  return true;
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
    errorsEmbedded: 0,
    rejected: 0,
    sessionsRefreshed: 0,
    embedderUnavailable: false,
    skippedLocked: false,
  };

  const ran = await withSemanticIndexLock(sql, async () => {
    const maxBatches = opts.maxBatches ?? MAX_BATCHES_PER_TICK;
    await purgePrivateTurns(sql);
    stats.turnsBuilt = await buildTurns(sql, opts.turnBuildLimit ?? TURN_BUILD_LIMIT);

    const turnsOk = await drainQueue<PendingEmbedding>(maxBatches, stats, "embedded", {
      next: () => getPendingEmbeddings(sql, EMBEDDING_MODEL, EMBED_BATCH_SIZE),
      prepare: prepareTurn,
      reject: (p) => recordEmbeddingFailure(sql, EMBEDDING_MODEL, p),
      save: (done) =>
        upsertTurnEmbeddings(
          sql,
          EMBEDDING_MODEL,
          done.map(({ item, hash, vector }): EmbeddingRow => ({
            turn_id: item.turn_id,
            kind: item.kind,
            content_hash: hash,
            vector,
          })),
        ),
    });
    // Errors come second so a large error backlog never delays turn recall.
    const errorsOk =
      turnsOk &&
      (await drainQueue<PendingError>(maxBatches, stats, "errorsEmbedded", {
        next: () => getPendingErrors(sql, EMBEDDING_MODEL, EMBED_BATCH_SIZE),
        prepare: (e) => prepareErrorText(e.tool, e.message),
        reject: (e) => recordErrorEmbeddingFailure(sql, EMBEDDING_MODEL, e.event_id),
        save: (done) =>
          upsertErrorEmbeddings(
            sql,
            EMBEDDING_MODEL,
            done.map(({ item, hash, vector }) => ({ event_id: item.event_id, content_hash: hash, vector })),
          ),
      }));
    stats.embedderUnavailable = !errorsOk;

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
      if (s.turnsBuilt || s.embedded || s.errorsEmbedded || s.sessionsRefreshed || s.rejected) {
        console.log(
          `[semantic] turns +${s.turnsBuilt}, embeddings +${s.embedded}, errors +${s.errorsEmbedded}, sessions +${s.sessionsRefreshed}` +
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
