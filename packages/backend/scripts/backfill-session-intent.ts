/**
 * Backfill `sessions.session_intent` for sessions the hourly job can never reach.
 *
 * `jobs/sessionIntentClassification.ts` caps at MAX_AGE_DAYS = 30, but the
 * Contribution Pillars chart looks back up to 52 weeks and groups by
 * COALESCE(session_intent, 'unclassified'). Everything older than 30 days is
 * therefore permanently unclassified and the chart renders as one flat bar.
 *
 * Two things this does that the live job does not:
 *
 *  1. **Richer state.** The job sends title + duration + counts + top tool
 *     names. Most old sessions have no title at all, so that is close to no
 *     signal. Where privacy mode permits, this also sends the first prompt and
 *     the files touched, which is what actually separates "build" from "debug".
 *
 *  2. **Skips the hopeless.** Sessions with no title, no tools and no prompts
 *     carry nothing to judge. They are left unclassified rather than guessed
 *     at, because a confident-looking wrong answer is worse for the chart than
 *     an honest gap.
 *
 * PRIVACY. Content egress follows the session's own recorded mode, not a flag:
 *
 *   private          -> excluded entirely, never read
 *   open / full      -> prompt text and file paths may be sent ('full' is the
 *                       pre-6cc3667 name for 'open')
 *   standard / NULL  -> metadata only. NULL is legacy data from before the
 *                       column existed and defaults to standard, so it must
 *                       never be treated as open.
 *
 * Note that this sends historical content to a processor that did not exist
 * when the data was collected. That is a consent question, not a technical
 * one, and it was decided before this script was written.
 *
 * Usage:
 *   DATABASE_URL=... TYPESAFE_API_KEY=... bun run scripts/backfill-session-intent.ts
 *   ...                                                      --write        # actually persist
 *   ...                                                      --limit=100    # cap sessions
 *
 * Dry run is the default. Re-running is safe: it only ever selects rows where
 * session_intent IS NULL, so an interrupted run resumes where it stopped.
 */

import { SQL } from "bun";
import { choice } from "@typesafe-ai/sdk";
import { askSystemOne, isTypeSafeAvailable, CONFIDENCE } from "../src/ai/typesafe";

const INTENT_CRITERIA = {
  debug: "fixing a specific bug, investigating an error, reproducing a failure",
  build: "implementing new functionality or features",
  refactor: "restructuring existing code without changing behavior",
  doc: "writing or editing documentation, comments, READMEs",
  review: "reviewing a PR or diff, providing feedback",
  exploration: "reading/searching/learning the codebase, no clear write goal",
  tooling: "configuring CI, build setup, dev environment, scripts",
  other: "none of the above fit",
} as const;

type Intent = keyof typeof INTENT_CRITERIA;
const VALID = new Set<string>(Object.keys(INTENT_CRITERIA));

/** Sessions per request. Questions run in parallel, so this is a context budget. */
const BATCH_SIZE = 40;
/** First prompt is the strongest signal; the tail adds tokens without adding much. */
const MAX_PROMPT_CHARS = 400;
const MAX_FILES = 6;
const MAX_TOOLS = 6;

const CONTENT_MODES = new Set(["open", "full"]);

interface Row {
  id: string;
  privacy_mode: string | null;
  title: string | null;
  project_name: string | null;
  duration_min: number | null;
  prompt_count: number;
  tool_count: number;
  fail_count: number;
  top_tools: string | null;
  first_prompt: string | null;
  top_files: string | null;
}

function parseArgs(argv: string[]) {
  const out = { write: false, limit: Number.POSITIVE_INFINITY };
  for (const a of argv) {
    if (a === "--write") out.write = true;
    else if (a.startsWith("--limit=")) out.limit = Number(a.slice(8));
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

/**
 * Candidate sessions, newest first.
 *
 * `first_prompt` and `top_files` are resolved in SQL but only for sessions
 * whose privacy mode permits content, so restricted content is never even
 * read out of the database.
 */
async function fetchCandidates(sql: SQL, limit: number): Promise<Row[]> {
  const cap = Number.isFinite(limit) ? Math.floor(limit) : 100000;
  return (await sql`
    SELECT
      s.id,
      s.privacy_mode,
      s.current_title AS title,
      s.project_name,
      ROUND(EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60)::INT AS duration_min,
      (SELECT COUNT(*)::INT FROM events e
        WHERE e.session_id = s.id AND e.event_type = 'prompt.submit') AS prompt_count,
      (SELECT COUNT(*)::INT FROM events e
        WHERE e.session_id = s.id AND e.event_type IN ('tool.complete','tool.fail')) AS tool_count,
      (SELECT COUNT(*)::INT FROM events e
        WHERE e.session_id = s.id AND e.event_type = 'tool.fail') AS fail_count,
      (SELECT STRING_AGG(tool_name, ',' ORDER BY n DESC) FROM (
          SELECT e2.payload->>'toolName' AS tool_name, COUNT(*) AS n
          FROM events e2
          WHERE e2.session_id = s.id
            AND e2.event_type IN ('tool.complete','tool.fail')
            AND e2.payload->>'toolName' IS NOT NULL
          GROUP BY tool_name ORDER BY n DESC LIMIT ${MAX_TOOLS}) t) AS top_tools,
      CASE WHEN s.privacy_mode IN ('open','full') THEN (
        SELECT e3.payload->>'promptText' FROM events e3
        WHERE e3.session_id = s.id AND e3.event_type = 'prompt.submit'
          AND e3.payload->>'promptText' IS NOT NULL
        ORDER BY e3.created_at ASC LIMIT 1) END AS first_prompt,
      CASE WHEN s.privacy_mode IN ('open','full') THEN (
        SELECT STRING_AGG(DISTINCT fp, ',') FROM (
          SELECT e4.payload->'toolInput'->>'file_path' AS fp
          FROM events e4
          WHERE e4.session_id = s.id
            AND e4.event_type IN ('tool.complete','tool.fail')
            AND e4.payload->'toolInput'->>'file_path' IS NOT NULL
          LIMIT ${MAX_FILES}) f) END AS top_files
    FROM sessions s
    WHERE s.session_intent IS NULL
      AND s.ended_at IS NOT NULL
      AND (s.privacy_mode IS DISTINCT FROM 'private')
    ORDER BY s.ended_at DESC
    LIMIT ${cap}`) as Row[];
}

/** Nothing to judge: no title, no tools, no prompts. */
function isEmptyShell(r: Row): boolean {
  return !r.title && r.tool_count === 0 && r.prompt_count === 0;
}

/** Build the per-session state entry, honouring the session's own privacy mode. */
function toStateEntry(r: Row, index: number) {
  const contentAllowed = CONTENT_MODES.has(r.privacy_mode ?? "");
  const basename = (p: string) => p.split("/").slice(-2).join("/");

  return {
    ref: `s${index}`,
    title: r.title?.slice(0, 120) ?? null,
    project: r.project_name?.slice(0, 60) ?? null,
    duration_minutes: r.duration_min,
    prompt_count: r.prompt_count,
    tool_count: r.tool_count,
    failed_tool_calls: r.fail_count,
    top_tools: r.top_tools ? r.top_tools.split(",").slice(0, MAX_TOOLS) : [],
    // Only present for open/full sessions; absent entirely otherwise.
    ...(contentAllowed && r.first_prompt
      ? { first_prompt: r.first_prompt.slice(0, MAX_PROMPT_CHARS) }
      : {}),
    ...(contentAllowed && r.top_files
      ? { files_touched: r.top_files.split(",").slice(0, MAX_FILES).map(basename) }
      : {}),
  };
}

interface Classified {
  id: string;
  intent: Intent;
  confidence: number;
}

async function classifyBatch(batch: Row[]): Promise<Classified[] | null> {
  const state = batch.map(toStateEntry);
  const questions: Record<string, ReturnType<typeof choice>> = {};
  for (let i = 0; i < batch.length; i++) {
    questions[`s${i}`] = choice(
      `Which intent bucket best describes the coding session with ref "s${i}"? Judge only that session.`,
      INTENT_CRITERIA,
    );
  }

  const result = await askSystemOne(state, questions, { timeoutMs: 60_000 });
  if (!result) return null;

  const out: Classified[] = [];
  for (let i = 0; i < batch.length; i++) {
    const a = result.answers[`s${i}`];
    if (!a || a.type !== "choice" || !VALID.has(a.choice)) continue;
    out.push({
      id: batch[i]!.id,
      intent: a.choice as Intent,
      confidence: a.confidence,
    });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Refusing to run.");
    process.exit(1);
  }
  if (!isTypeSafeAvailable()) {
    console.error("TYPESAFE_API_KEY is not set. Nothing to classify with.");
    process.exit(1);
  }

  const sql = new SQL({ url, max: 4 });

  const all = await fetchCandidates(sql, args.limit);
  const skipped = all.filter(isEmptyShell);
  const rows = all.filter((r) => !isEmptyShell(r));

  const withContent = rows.filter((r) => CONTENT_MODES.has(r.privacy_mode ?? "")).length;

  console.log(`mode:        ${args.write ? "WRITE" : "DRY RUN (pass --write to persist)"}`);
  console.log(`candidates:  ${all.length}`);
  console.log(`  skipped:   ${skipped.length} (no title, no tools, no prompts)`);
  console.log(`  to class:  ${rows.length}`);
  console.log(`  w/ content:${withContent} (open/full — prompt text + files sent)`);
  console.log(`  metadata:  ${rows.length - withContent} (standard/legacy-null)`);
  console.log(`batches:     ${Math.ceil(rows.length / BATCH_SIZE)} of ${BATCH_SIZE}\n`);

  if (rows.length === 0) {
    await sql.close();
    return;
  }

  const results: Classified[] = [];
  let inputTokens = 0;
  let failedBatches = 0;

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const n = Math.floor(start / BATCH_SIZE) + 1;
    process.stdout.write(`batch ${n}/${Math.ceil(rows.length / BATCH_SIZE)} (${batch.length})... `);

    const classified = await classifyBatch(batch);
    if (!classified) {
      failedBatches++;
      console.log("FAILED — skipping");
      continue;
    }
    results.push(...classified);
    console.log(`${classified.length} answered`);

    if (args.write) {
      for (const c of classified) {
        await sql`
          UPDATE sessions
          SET session_intent = ${c.intent},
              session_intent_confidence = ${c.confidence}
          WHERE id = ${c.id} AND session_intent IS NULL`;
      }
    }
  }

  // Report the confidence spread so a bad run is visible before it is trusted.
  const byIntent = new Map<string, { n: number; conf: number; low: number }>();
  for (const r of results) {
    const e = byIntent.get(r.intent) ?? { n: 0, conf: 0, low: 0 };
    e.n++;
    e.conf += r.confidence;
    if (r.confidence < CONFIDENCE.floor) e.low++;
    byIntent.set(r.intent, e);
  }

  console.log(`\n${"intent".padEnd(14)}${"n".padStart(6)}${"avg_conf".padStart(10)}${"below_floor".padStart(13)}`);
  console.log("-".repeat(43));
  for (const [intent, e] of [...byIntent.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      intent.padEnd(14) +
        String(e.n).padStart(6) +
        (e.conf / e.n).toFixed(2).padStart(10) +
        String(e.low).padStart(13),
    );
  }

  const lowTotal = results.filter((r) => r.confidence < CONFIDENCE.floor).length;
  console.log("-".repeat(43));
  console.log(
    `total ${results.length} classified, ${lowTotal} below the ${CONFIDENCE.floor} floor ` +
      `(${((100 * lowTotal) / Math.max(1, results.length)).toFixed(1)}%)`,
  );
  if (failedBatches > 0) console.log(`${failedBatches} batch(es) failed and were skipped.`);
  if (inputTokens > 0) console.log(`input tokens: ${inputTokens}`);

  if (!args.write) {
    console.log("\nDry run — nothing was written. Re-run with --write to persist.");
  }

  await sql.close();
}

void main();
