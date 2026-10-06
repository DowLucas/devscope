/**
 * Token accounting v2 (migration 055, tokenUsageQueries.ts).
 *
 * `estimateUsage` is pure and always runs. The rest is gated on
 * TEST_DATABASE_URL, like tokenPricing.test.ts:
 *
 *   TEST_DATABASE_URL=postgres://devscope:devscope@localhost:5432/devscope_test \
 *     bun test packages/backend/src/db/__tests__/tokenUsage.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { initializeDatabase } from "../schema";
import { updateSessionTokens } from "../queries";
import {
  applyUsageSnapshot,
  backfillExactUsage,
  estimateSession,
  estimateUsage,
  getLegacySessions,
  type EstimatorEvent,
} from "../tokenUsageQueries";

const usage = (ctx: number, out: number, write = 0) => ({
  inputTokens: 0,
  outputTokens: out,
  cacheCreationTokens: write,
  cacheReadTokens: ctx - write,
});
const ev = (event_type: string, token_usage: EstimatorEvent["token_usage"] = null): EstimatorEvent => ({
  event_type,
  token_usage,
});

describe("estimateUsage", () => {
  test("re-reads the growing context once per API call", () => {
    const est = estimateUsage([
      ev("prompt.submit"),
      ev("response.complete", usage(100_000, 200)), // 1 call at 100k
      ev("prompt.submit"),
      ev("tool.start"),
      ev("tool.start"),
      ev("response.complete", usage(120_000, 300, 1_000)), // 3 calls, 100k -> 120k
    ])!;
    expect(est.calls).toBe(4);
    expect(est.cacheRead).toBe(100_000 + 3 * 110_000);
    expect(est.output).toBe(200 + 3 * 300);
    // Context growth is written to cache once, plus the last call's own write.
    expect(est.cacheWrite1h).toBe(100_000 + 20_000 + 1_000);
  });

  test("compaction resets the context baseline", () => {
    const est = estimateUsage([
      ev("response.complete", usage(150_000, 100)),
      ev("compact.complete"),
      ev("response.complete", usage(30_000, 100)),
    ])!;
    expect(est.cacheRead).toBe(150_000 + 30_000);
  });

  test("null without any per-turn usage", () => {
    expect(estimateUsage([ev("prompt.submit"), ev("response.complete")])).toBeNull();
  });
});

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

d("session_token_usage — snapshots, rollup, estimates, backfill", () => {
  let sqlPromise: ReturnType<typeof initializeDatabase> | null = null;
  const getSql = () => (sqlPromise ??= initializeDatabase(dbUrl!));

  const run = crypto.randomUUID().slice(0, 8);
  const devA = `t-tok-a-${run}`;
  const devB = `t-tok-b-${run}`;
  const s = (n: string) => `t-tok-${n}-${run}`;
  const sessionIds = ["exact", "legacy", "empty", "other", "multi"].map(s);

  const snap = (transcriptId: string, model: string, n: number) => ({
    transcriptId,
    byModel: { [model]: { input: n, output: n, cacheWrite5m: 0, cacheWrite1h: n, cacheRead: 10 * n, calls: 1 } },
  });

  async function session(id: string) {
    const sql = await getSql();
    const [row] = await sql`SELECT * FROM sessions WHERE id = ${id}`;
    return row as any;
  }

  beforeAll(async () => {
    const sql = await getSql();
    for (const dev of [devA, devB]) {
      await sql`INSERT INTO developers (id, name, email) VALUES (${dev}, 'tok', ${`${dev}@test.local`})`;
    }
    const rows: Array<[string, string, string | null]> = [
      [s("exact"), devA, "claude-opus-5-5[1m]"],
      [s("legacy"), devA, "claude-opus-5-5[1m]"],
      [s("empty"), devA, null],
      [s("other"), devB, "claude-opus-5-5"],
      [s("multi"), devA, "claude-opus-5-5"],
    ];
    for (const [id, dev, model] of rows) {
      await sql`
        INSERT INTO sessions (id, developer_id, project_path, project_name, started_at, ended_at, status, model)
        VALUES (${id}, ${dev}, '/p', 'proj', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 'ended', ${model})`;
    }
  });

  afterAll(async () => {
    if (!sqlPromise) return;
    const sql = await sqlPromise;
    for (const id of sessionIds) {
      await sql`DELETE FROM events WHERE session_id = ${id}`;
      await sql`DELETE FROM sessions WHERE id = ${id}`;
    }
    await sql`DELETE FROM developers WHERE id IN (${devA}, ${devB})`;
  });

  test("a snapshot sets exact totals and an API-equivalent cost", async () => {
    const sql = await getSql();
    await applyUsageSnapshot(sql, s("exact"), {
      transcriptId: "cc-1",
      byModel: {
        "claude-opus-5-5": { input: 1_000, output: 100_000, cacheWrite5m: 0, cacheWrite1h: 500_000, cacheRead: 10_000_000, calls: 80 },
      },
    });
    const row = await session(s("exact"));
    expect(row.token_source).toBe("exact");
    expect(Number(row.total_output_tokens)).toBe(100_000);
    expect(Number(row.total_cache_creation_tokens)).toBe(500_000);
    expect(Number(row.total_cache_read_tokens)).toBe(10_000_000);
    // Opus 5.5: $4 in, $20 out, $8 1h write, $0.20 read per MTok.
    expect(Number(row.estimated_cost_usd)).toBeCloseTo(0.004 + 2 + 4 + 2, 4);
  });

  test("snapshots are cumulative: a stale one never lowers a total", async () => {
    const sql = await getSql();
    await applyUsageSnapshot(sql, s("exact"), snap("cc-1", "claude-opus-5-5", 10));
    expect(Number((await session(s("exact"))).total_output_tokens)).toBe(100_000);
  });

  test("totals sum across transcripts and models", async () => {
    const sql = await getSql();
    await applyUsageSnapshot(sql, s("multi"), snap("cc-a", "claude-opus-5-5", 100));
    await applyUsageSnapshot(sql, s("multi"), snap("cc-b", "claude-opus-5-5", 200));
    await applyUsageSnapshot(sql, s("multi"), snap("cc-b", "claude-haiku-4-5", 1_000));
    expect(Number((await session(s("multi"))).total_output_tokens)).toBe(1_300);
  });

  test("the legacy path never touches a session with exact figures", async () => {
    const sql = await getSql();
    await updateSessionTokens(sql, s("exact"), {
      inputTokens: 9, outputTokens: 999_999_999, cacheCreationTokens: 0, cacheReadTokens: 0,
    });
    const row = await session(s("exact"));
    expect(row.token_source).toBe("exact");
    expect(Number(row.total_output_tokens)).toBe(100_000);
  });

  test("legacy sessions are estimated from their events", async () => {
    const sql = await getSql();
    await updateSessionTokens(sql, s("legacy"), usage(120_000, 300, 1_000));
    expect((await session(s("legacy"))).token_source).toBe("legacy");

    const events: Array<[string, object | null]> = [
      ["prompt.submit", null],
      ["response.complete", usage(100_000, 200)],
      ["prompt.submit", null],
      ["tool.start", null],
      ["tool.start", null],
      ["response.complete", usage(120_000, 300, 1_000)],
    ];
    let i = 0;
    for (const [type, tu] of events) {
      await sql`
        INSERT INTO events (id, session_id, event_type, payload, created_at)
        VALUES (${`${s("legacy")}-e${i}`}, ${s("legacy")}, ${type}, ${tu ? { tokenUsage: tu } : {}},
                NOW() - INTERVAL '90 minutes' + make_interval(secs => ${i++}))`;
    }

    expect(await getLegacySessions(sql, { limit: 100, settledMinutes: 15 })).toContain(s("legacy"));

    const dry = await estimateSession(sql, s("legacy"), false);
    expect(dry!.estimate!.calls).toBe(4);
    expect((await session(s("legacy"))).token_source).toBe("legacy");

    const r = await estimateSession(sql, s("legacy"), true);
    const row = await session(s("legacy"));
    expect(row.token_source).toBe("estimated");
    expect(Number(row.total_cache_read_tokens)).toBe(100_000 + 3 * 110_000);
    expect(Number(row.estimated_cost_usd)).toBeCloseTo(r!.costUsd, 4);
    expect(await getLegacySessions(sql, { limit: 100, settledMinutes: 15 })).not.toContain(s("legacy"));
  });

  test("exact data replaces an estimate", async () => {
    const sql = await getSql();
    await applyUsageSnapshot(sql, s("legacy"), snap("cc-x", "claude-opus-5-5", 7));
    const row = await session(s("legacy"));
    expect(row.token_source).toBe("exact");
    expect(Number(row.total_output_tokens)).toBe(7);
  });

  test("a legacy session with nothing to estimate from is cleared", async () => {
    const sql = await getSql();
    await updateSessionTokens(sql, s("empty"), usage(50_000, 100));
    await estimateSession(sql, s("empty"), true);
    const row = await session(s("empty"));
    expect(row.token_source).toBeNull();
    expect(Number(row.estimated_cost_usd)).toBe(0);
  });

  test("backfill only updates the caller's own sessions", async () => {
    const sql = await getSql();
    const res = await backfillExactUsage(sql, [devA], [
      snap(s("other"), "claude-opus-5-5", 5),
      { ...snap("cc-z", "claude-opus-5-5", 50), sessionId: s("empty") },
      snap(`unknown-${run}`, "claude-opus-5-5", 5),
    ]);
    expect(res).toEqual({ applied: 1, skipped: 2 });
    expect((await session(s("other"))).token_source).toBeNull();
    expect(Number((await session(s("empty"))).total_output_tokens)).toBe(50);
  });
});
