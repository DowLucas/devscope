/**
 * Fill command_runs (migration 058) from the Bash tool.complete / tool.fail
 * events already stored, so command trends start with history rather than
 * from the day of the deploy.
 *
 * Each event goes through the same recordCommandRun as live ingestion: the
 * signature is sanitized the same way and private sessions keep only the
 * program. History predates plugin 0.38.0, so rows carry the program only
 * (toolSubcommand) and legacy_timing (the old plugin timer, which mixed up
 * parallel calls of one session). Background commands from that time were
 * recorded at the moment they were backgrounded and count as finished there.
 *
 * DATA SAFETY. Only inserts into command_runs; ON CONFLICT DO NOTHING, so it
 * is idempotent and never touches rows ingestion already wrote. Events that
 * retention has purged are gone, and so are their rows.
 *
 * Usage:
 *   DATABASE_URL=... bun run scripts/command-runs-backfill.ts            # dry run: report only
 *   DATABASE_URL=... bun run scripts/command-runs-backfill.ts --write    # insert the rows
 */

import { SQL } from "bun";
import type { DevscopeEvent } from "@devscope/shared";
import { recordCommandRun } from "../src/db/commandQueries";

const BATCH = 500;

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

async function main() {
  const { write } = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(2);
  }
  const sql = new SQL(url);

  const [counts] = (await sql`
    SELECT
      COUNT(*)::INT AS events,
      COUNT(cr.event_id)::INT AS already,
      MIN(e.created_at) AS first_at
    FROM events e
    LEFT JOIN command_runs cr ON cr.event_id = e.id
    WHERE e.event_type IN ('tool.complete', 'tool.fail')
      AND e.payload->>'toolName' = 'Bash'
  `) as Array<{ events: number; already: number; first_at: Date | null }>;
  console.log(
    `Bash tool events: ${counts!.events} (since ${counts!.first_at?.toISOString?.() ?? "-"}), ` +
      `already in command_runs: ${counts!.already}, to add: ${counts!.events - counts!.already}`,
  );
  if (!write) {
    console.log("Dry run. Re-run with --write to insert.");
    await sql.close();
    return;
  }

  let cursor: { at: Date; id: string } | null = null;
  let added = 0;
  for (;;) {
    const rows = (await sql`
      SELECT e.id, e.session_id, e.event_type, e.payload, e.created_at
      FROM events e
      WHERE e.event_type IN ('tool.complete', 'tool.fail')
        AND e.payload->>'toolName' = 'Bash'
        AND NOT EXISTS (SELECT 1 FROM command_runs cr WHERE cr.event_id = e.id)
        AND (${cursor?.at ?? null}::timestamptz IS NULL
             OR (e.created_at, e.id) > (${cursor?.at ?? null}::timestamptz, ${cursor?.id ?? ""}))
      ORDER BY e.created_at, e.id
      LIMIT ${BATCH}
    `) as Array<{ id: string; session_id: string; event_type: string; payload: unknown; created_at: Date }>;
    if (rows.length === 0) break;
    for (const r of rows) {
      const payload = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
      await recordCommandRun(sql, {
        id: r.id,
        sessionId: r.session_id,
        eventType: r.event_type,
        timestamp: new Date(r.created_at).toISOString(),
        payload,
      } as unknown as DevscopeEvent);
    }
    added += rows.length;
    const last = rows[rows.length - 1]!;
    cursor = { at: last.created_at, id: last.id };
    console.log(`  ${added} processed`);
  }
  const [after] = (await sql`SELECT COUNT(*)::INT AS n FROM command_runs`) as Array<{ n: number }>;
  console.log(`Done. command_runs now has ${after!.n} rows.`);
  await sql.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
