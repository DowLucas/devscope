/**
 * Replace the legacy token undercount with a server-side estimate for every
 * session still marked token_source = 'legacy' (see migration 055).
 *
 * Plugins before 0.23.0 recorded the usage of only the last API call per
 * session, about 40x below the real API-equivalent cost. The estimator
 * rebuilds each session from the per-turn tokenUsage on its response.complete
 * events plus tool counts. Calibrated against transcripts it lands within a
 * few percent in total; single sessions can be off ~2x, which is why they are
 * marked 'estimated'. Exact figures (from plugin 0.23.0+ or
 * /devscope:backfill-usage) always win and are never overwritten.
 *
 * DATA SAFETY. Touches only session_token_usage rows with source='estimated'
 * and the rolled-up token columns of legacy sessions. Idempotent: re-running
 * recomputes the same estimate. Sessions with no per-turn usage at all get
 * their (meaningless) legacy totals zeroed and token_source cleared.
 *
 * Usage:
 *   DATABASE_URL=... bun run scripts/token-backfill.ts            # dry run: report only
 *   DATABASE_URL=... bun run scripts/token-backfill.ts --write    # store the estimates
 */

import { SQL } from "bun";
import { estimateSession, getLegacySessions } from "../src/db";

const BATCH = 200;

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

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
  const { write } = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(2);
  }
  const sql = new SQL(url);

  const byMonth = new Map<string, { sessions: number; before: number; after: number; empty: number }>();
  const months = new Map(
    ((await sql`
      SELECT id, to_char(date_trunc('month', started_at), 'YYYY-MM') AS month
      FROM sessions WHERE token_source = 'legacy'`) as { id: string; month: string }[]).map((r) => [r.id, r.month]),
  );
  console.log(`${months.size} legacy session(s) to estimate${write ? "" : " (dry run)"}`);

  // A dry run never changes token_source, so page by id instead of re-querying.
  const queue = write ? null : [...months.keys()];
  let done = 0;
  for (;;) {
    const ids = queue
      ? queue.splice(0, BATCH)
      : await getLegacySessions(sql, { limit: BATCH, settledMinutes: 15 });
    if (ids.length === 0) break;
    for (const id of ids) {
      const r = await estimateSession(sql, id, write);
      if (!r) continue;
      const m = months.get(id) ?? "unknown";
      const agg = byMonth.get(m) ?? { sessions: 0, before: 0, after: 0, empty: 0 };
      agg.sessions++;
      agg.before += r.before.costUsd;
      agg.after += r.costUsd;
      if (!r.estimate) agg.empty++;
      byMonth.set(m, agg);
    }
    done += ids.length;
    process.stdout.write(`\r  ${done}/${months.size}`);
    // Active legacy sessions are skipped by getLegacySessions; stop once only those remain.
    if (!queue && ids.length < BATCH) break;
  }
  process.stdout.write("\n\n");

  let before = 0;
  let after = 0;
  console.log("month    sessions   no data        stored    estimated");
  for (const [m, a] of [...byMonth].sort()) {
    console.log(
      `${m}  ${String(a.sessions).padStart(8)}  ${String(a.empty).padStart(8)}  ${usd(a.before).padStart(12)}  ${usd(a.after).padStart(11)}`,
    );
    before += a.before;
    after += a.after;
  }
  console.log(`total    ${" ".repeat(18)}${usd(before).padStart(12)}  ${usd(after).padStart(11)}`);
  if (!write) console.log("\nDry run: nothing written. Re-run with --write to store the estimates.");
  await sql.close();
}

await main();
