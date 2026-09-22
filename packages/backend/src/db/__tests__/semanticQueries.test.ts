/**
 * Integration tests for semantic retrieval (migration 045, semanticQueries.ts).
 *
 * Gated on TEST_DATABASE_URL, and the database must have pgvector available
 * (docker/postgres.Dockerfile). To run:
 *
 *   TEST_DATABASE_URL=postgres://devscope:devscope@localhost:5432/devscope_test \
 *     bun test packages/backend/src/db/__tests__/semanticQueries.test.ts
 *
 * Vectors are synthetic one-hot vectors so nearest-neighbour order is exact.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { initializeDatabase } from "../schema";
import {
  buildTurns,
  upsertTurnEmbeddings,
  refreshSessionEmbeddings,
  deleteOrphanedSessionEmbeddings,
  searchSimilarTurns,
  searchSimilarSessions,
  isSessionInOrg,
} from "../semanticQueries";

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

const MODEL = "test-model";
const DIM = 1024;

function oneHot(i: number, j?: number): string {
  const v = new Array(DIM).fill(0);
  v[i] = 1;
  if (j !== undefined) v[j] = 0.5;
  return `[${v.join(",")}]`;
}

d("semanticQueries — turns, embeddings, org-scoped search", () => {
  let sqlPromise: ReturnType<typeof initializeDatabase> | null = null;
  const getSql = () => (sqlPromise ??= initializeDatabase(dbUrl!));

  const run = crypto.randomUUID().slice(0, 8);
  const devA = `t-sem-a-${run}`;
  const devB = `t-sem-b-${run}`;
  const s = (n: string) => `t-sem-${n}-${run}`;
  const ev = (n: string) => `t-sem-ev-${n}-${run}`;
  const sessionIds = ["ended", "active", "private", "other", "twin"].map(s);
  const t = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min)).toISOString();

  async function turnFor(promptEvent: string) {
    const sql = await getSql();
    const [row] = await sql`SELECT * FROM prompt_turns WHERE prompt_event_id = ${ev(promptEvent)}`;
    return row as any;
  }

  afterAll(async () => {
    if (!sqlPromise) return;
    const sql = await sqlPromise;
    for (const id of sessionIds) {
      await sql`DELETE FROM session_embeddings WHERE session_id = ${id}`;
      await sql`DELETE FROM prompt_turns WHERE session_id = ${id}`;
      await sql`DELETE FROM events WHERE session_id = ${id}`;
      await sql`DELETE FROM sessions WHERE id = ${id}`;
    }
    await sql`DELETE FROM developers WHERE id IN (${devA}, ${devB})`;
  });

  test("seeds sessions and events", async () => {
    const sql = await getSql();
    for (const dev of [devA, devB]) {
      await sql`INSERT INTO developers (id, name, email) VALUES (${dev}, 'sem', ${`${dev}@test.local`})`;
    }
    const sessions: Array<[string, string, string | null, string | null]> = [
      // [id, developer, privacy_mode, ended_at]
      [s("ended"), devA, "open", t(60)],
      [s("active"), devA, "standard", null],
      [s("private"), devA, "private", t(60)],
      [s("other"), devB, "open", t(60)],
      [s("twin"), devA, null, t(60)],
    ];
    for (const [id, dev, mode, ended] of sessions) {
      await sql`
        INSERT INTO sessions (id, developer_id, project_path, project_name, started_at, ended_at, status, privacy_mode)
        VALUES (${id}, ${dev}, '/p', 'proj', ${t(0)}, ${ended}, ${ended ? "ended" : "active"}, ${mode})`;
    }
    const events: Array<[string, string, string, number, object]> = [
      // ended: a full turn with tools, then a prompt that never got a response
      ["p1", s("ended"), "prompt.submit", 1, { promptText: "fix the failing auth test" }],
      ["t1", s("ended"), "tool.complete", 2, { toolName: "Bash" }],
      ["t2", s("ended"), "tool.fail", 3, { toolName: "Edit" }],
      ["r1", s("ended"), "response.complete", 4, { responseText: "Fixed the token expiry check." }],
      ["p2", s("ended"), "prompt.submit", 5, { promptText: "add dark mode" }],
      ["t3", s("ended"), "tool.complete", 6, { toolName: "Read" }],
      // active: first prompt closed by the second; second still open
      ["p3", s("active"), "prompt.submit", 1, { promptText: "explore the repo" }],
      ["p4", s("active"), "prompt.submit", 2, { promptText: "still going" }],
      // private: must never become a turn
      ["p5", s("private"), "prompt.submit", 1, { promptText: "secret" }],
      ["r5", s("private"), "response.complete", 2, { responseText: "secret" }],
      // other org
      ["p6", s("other"), "prompt.submit", 1, { promptText: "fix the failing auth test" }],
      ["r6", s("other"), "response.complete", 2, { responseText: "done" }],
      // same org, second ended session
      ["p7", s("twin"), "prompt.submit", 1, { promptText: "auth test is flaky" }],
      ["r7", s("twin"), "response.complete", 2, { responseText: "Added a retry." }],
      ["p8", s("twin"), "prompt.submit", 3, { promptText: "   " }],
    ];
    for (const [id, session, type, min, payload] of events) {
      await sql`
        INSERT INTO events (id, session_id, event_type, payload, created_at)
        VALUES (${ev(id)}, ${session}, ${type}, ${payload}::jsonb, ${t(min)}::timestamptz)`;
    }
  });

  test("buildTurns pairs prompts with responses and tool outcomes", async () => {
    const sql = await getSql();
    await buildTurns(sql, 10_000);

    const p1 = await turnFor("p1");
    expect(p1.response_event_id).toBe(ev("r1"));
    expect(p1.response_text).toBe("Fixed the token expiry check.");
    expect(p1.tool_calls).toBe(2);
    expect(p1.tool_failures).toBe(1);
    expect([...p1.tools_used].sort()).toEqual(["Bash", "Edit"]);
    expect(p1.duration_ms).toBe(3 * 60_000);

    // No response, closed by session end; tool window runs to ended_at.
    const p2 = await turnFor("p2");
    expect(p2.response_event_id).toBeNull();
    expect(p2.tool_calls).toBe(1);

    // Closed by the next prompt; the last prompt of an active session waits.
    expect(await turnFor("p3")).toBeDefined();
    expect(await turnFor("p4")).toBeUndefined();

    // Private and whitespace-only prompts never become turns.
    expect(await turnFor("p5")).toBeUndefined();
    expect(await turnFor("p8")).toBeUndefined();
  });

  test("buildTurns is idempotent", async () => {
    const sql = await getSql();
    await buildTurns(sql, 10_000);
    const [row] = await sql`
      SELECT COUNT(*)::INT AS n FROM prompt_turns WHERE session_id IN (${s("ended")}, ${s("twin")})`;
    expect((row as any).n).toBe(3);
  });

  test("search is org-scoped, nearest-first, and excludes private sessions", async () => {
    const sql = await getSql();
    const p1 = await turnFor("p1");
    const p2 = await turnFor("p2");
    const p6 = await turnFor("p6");
    const p7 = await turnFor("p7");
    await upsertTurnEmbeddings(sql, MODEL, [
      { turn_id: p1.id, kind: "prompt", content_hash: "h1", vector: oneHot(0) },
      { turn_id: p2.id, kind: "prompt", content_hash: "h2", vector: oneHot(5) },
      { turn_id: p6.id, kind: "prompt", content_hash: "h6", vector: oneHot(0) },
      { turn_id: p7.id, kind: "prompt", content_hash: "h7", vector: oneHot(0, 1) },
    ]);

    const hits = await searchSimilarTurns(sql, {
      vector: oneHot(0),
      model: MODEL,
      kind: "prompt",
      devIds: [devA],
      limit: 10,
    });
    const ids = hits.map((h) => h.session_id);
    expect(hits[0]!.prompt_text).toBe("fix the failing auth test");
    expect(hits[0]!.session_id).toBe(s("ended"));
    expect(hits[0]!.similarity).toBeCloseTo(1, 5);
    expect(hits[1]!.session_id).toBe(s("twin"));
    expect(ids).not.toContain(s("other"));
    expect(ids).not.toContain(s("private"));
    expect(Object.keys(hits[0]!)).not.toContain("developer_id");

    const excluded = await searchSimilarTurns(sql, {
      vector: oneHot(0),
      model: MODEL,
      kind: "prompt",
      devIds: [devA],
      limit: 10,
      excludeSessionId: s("ended"),
    });
    expect(excluded.map((h) => h.session_id)).not.toContain(s("ended"));

    expect(
      await searchSimilarTurns(sql, { vector: oneHot(0), model: MODEL, kind: "prompt", devIds: [], limit: 10 }),
    ).toEqual([]);
  });

  test("session vectors: ended sessions only, similar sessions within org", async () => {
    const sql = await getSql();
    await refreshSessionEmbeddings(sql, MODEL, 10_000);

    const rows = await sql`
      SELECT session_id, turn_count FROM session_embeddings
      WHERE session_id IN (${s("ended")}, ${s("active")}, ${s("twin")}, ${s("other")})`;
    const byId = new Map((rows as any[]).map((r) => [r.session_id, r.turn_count]));
    expect(byId.get(s("ended"))).toBe(2);
    expect(byId.get(s("twin"))).toBe(1);
    expect(byId.has(s("active"))).toBe(false);

    const similar = await searchSimilarSessions(sql, {
      sessionId: s("ended"),
      model: MODEL,
      devIds: [devA],
      limit: 10,
    });
    expect(similar!.map((r) => r.session_id)).toEqual([s("twin")]);
    expect(similar![0]!.turn_count).toBe(1);

    expect(
      await searchSimilarSessions(sql, { sessionId: s("active"), model: MODEL, devIds: [devA], limit: 10 }),
    ).toBeNull();
  });

  test("isSessionInOrg", async () => {
    const sql = await getSql();
    expect(await isSessionInOrg(sql, s("ended"), [devA])).toBe(true);
    expect(await isSessionInOrg(sql, s("other"), [devA])).toBe(false);
    expect(await isSessionInOrg(sql, s("ended"), [])).toBe(false);
  });

  test("retention purge cascades turns, embeddings and session vectors", async () => {
    const sql = await getSql();
    const p7 = await turnFor("p7");
    await sql`DELETE FROM events WHERE session_id = ${s("twin")}`;

    expect(await turnFor("p7")).toBeUndefined();
    const [emb] = await sql`SELECT COUNT(*)::INT AS n FROM turn_embeddings WHERE turn_id = ${p7.id}`;
    expect((emb as any).n).toBe(0);

    await deleteOrphanedSessionEmbeddings(sql);
    const [sv] = await sql`SELECT COUNT(*)::INT AS n FROM session_embeddings WHERE session_id = ${s("twin")}`;
    expect((sv as any).n).toBe(0);
    const [kept] = await sql`SELECT COUNT(*)::INT AS n FROM session_embeddings WHERE session_id = ${s("ended")}`;
    expect((kept as any).n).toBe(1);
  });
});
