/**
 * Backfill semantic retrieval (prompt_turns + embeddings) over all history.
 *
 * The live `jobs/semanticIndexing.ts` pass already has no age cap, but it
 * embeds at most ~640 texts a minute so it doesn't hog the shared GPU. This
 * runs the same `indexOnce` pass in a tight loop to chew through history in
 * one go, printing progress.
 *
 * PRIVACY. Embeddings are computed by the homelab's own Ollama, so no content
 * leaves the box. Private sessions store no prompt text and are never turned
 * into turns.
 *
 * DATA SAFETY. Purely additive: it only INSERTs into prompt_turns,
 * turn_embeddings and session_embeddings, and never updates or deletes any
 * existing table, except removing turns of sessions that have since switched
 * to private. Every step is idempotent, so it is safe to interrupt and re-run.
 * It shares an advisory lock with the live job, so the two never index at the
 * same time; while the job holds it, this waits.
 *
 * Usage:
 *   DATABASE_URL=... EMBEDDING_URL=http://ollama:11434 bun run scripts/semantic-backfill.ts
 *   ...                                                                    --write   # actually index
 *
 * Dry run is the default and only reports what is pending.
 */

import { SQL } from "bun";
import { indexOnce } from "../src/jobs/semanticIndexing";
import { EMBEDDING_MODEL, isEmbeddingAvailable } from "../src/ai/embeddings";
import { MIN_ERROR_CHARS } from "../src/db";

const BATCHES_PER_PASS = 50;
const TURNS_PER_PASS = 2_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const RETRY_DELAY_MS = 15_000;
const LOCK_WAIT_MS = 5_000;

function parseArgs(argv: string[]) {
  const out = { write: false };
  for (const a of argv) {
    if (a === "--write") out.write = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

async function report(sql: SQL) {
  const [r] = await sql`
    SELECT
      (SELECT COUNT(*)::INT FROM events e JOIN sessions s ON s.id = e.session_id
        WHERE e.event_type = 'prompt.submit'
          AND COALESCE(s.privacy_mode, 'standard') <> 'private'
          AND length(btrim(COALESCE(e.payload->>'promptText', ''), E' \\t\\r\\n')) > 0) AS eligible_prompts,
      (SELECT COUNT(*)::INT FROM prompt_turns) AS turns,
      (SELECT COUNT(*)::INT FROM prompt_turns WHERE response_text IS NOT NULL) AS turns_with_response,
      (SELECT COUNT(*)::INT FROM turn_embeddings WHERE model = ${EMBEDDING_MODEL}) AS embeddings,
      (SELECT COUNT(*)::INT FROM turn_embedding_failures WHERE model = ${EMBEDDING_MODEL}) AS rejected,
      (SELECT COUNT(*)::INT FROM session_embeddings WHERE model = ${EMBEDDING_MODEL}) AS session_vectors,
      (SELECT COUNT(*)::INT FROM events e JOIN sessions s ON s.id = e.session_id
        WHERE e.event_type = 'tool.fail'
          AND COALESCE(s.privacy_mode, 'standard') <> 'private'
          AND length(COALESCE(e.payload->>'errorMessage', '')) >= ${MIN_ERROR_CHARS}) AS eligible_errors,
      (SELECT COUNT(*)::INT FROM error_embeddings WHERE model = ${EMBEDDING_MODEL}) AS error_embeddings,
      (SELECT COUNT(*)::INT FROM error_embedding_failures WHERE model = ${EMBEDDING_MODEL}) AS errors_rejected`;
  return r as {
    eligible_prompts: number;
    turns: number;
    turns_with_response: number;
    embeddings: number;
    rejected: number;
    session_vectors: number;
    eligible_errors: number;
    error_embeddings: number;
    errors_rejected: number;
  };
}

function printReport(label: string, r: Awaited<ReturnType<typeof report>>) {
  const expectedEmbeddings = r.turns + r.turns_with_response;
  console.log(`${label}`);
  console.log(`  eligible prompts: ${r.eligible_prompts}`);
  console.log(`  turns built:      ${r.turns} (${r.turns_with_response} with a response)`);
  console.log(`  embeddings:       ${r.embeddings} / ${expectedEmbeddings} for built turns (${r.rejected} rejected)`);
  console.log(`  session vectors:  ${r.session_vectors}`);
  console.log(`  error embeddings: ${r.error_embeddings} / ${r.eligible_errors} tool failures (${r.errors_rejected} rejected)\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Refusing to run.");
    process.exit(1);
  }
  if (!isEmbeddingAvailable()) {
    console.error("EMBEDDING_URL is not set. Nothing to embed with.");
    process.exit(1);
  }

  const sql = new SQL({ url, max: 4 });
  console.log(`mode:  ${args.write ? "WRITE" : "DRY RUN (pass --write to index)"}`);
  console.log(`model: ${EMBEDDING_MODEL}\n`);
  printReport("before", await report(sql));

  if (!args.write) {
    await sql.close();
    return;
  }

  const started = Date.now();
  let totalEmbedded = 0;
  let failures = 0;

  while (true) {
    const s = await indexOnce(sql, {
      maxBatches: BATCHES_PER_PASS,
      turnBuildLimit: TURNS_PER_PASS,
    });
    if (s.skippedLocked) {
      console.log("live indexing job holds the lock — waiting");
      await Bun.sleep(LOCK_WAIT_MS);
      continue;
    }
    totalEmbedded += s.embedded + s.errorsEmbedded;

    const elapsedMin = (Date.now() - started) / 60_000;
    console.log(
      `turns +${s.turnsBuilt}, embeddings +${s.embedded}, errors +${s.errorsEmbedded} (total ${totalEmbedded}, ` +
        `${Math.round(totalEmbedded / Math.max(elapsedMin, 0.01))}/min), sessions +${s.sessionsRefreshed}` +
        (s.rejected ? `, rejected ${s.rejected}` : ""),
    );

    if (s.embedderUnavailable) {
      failures++;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`Embedder failed ${failures} times in a row — stopping. Re-run to resume.`);
        break;
      }
      await Bun.sleep(RETRY_DELAY_MS);
      continue;
    }
    failures = 0;

    if (!s.turnsBuilt && !s.embedded && !s.errorsEmbedded && !s.rejected && !s.sessionsRefreshed) break;
  }

  printReport("after", await report(sql));
  await sql.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
