/**
 * Integration tests for hybrid session search (migrations 053/054,
 * sessionSearchQueries.ts). Gated on TEST_DATABASE_URL with pgvector, like
 * semanticQueries.test.ts:
 *
 *   TEST_DATABASE_URL=postgres://devscope:devscope@localhost:5432/devscope_test \
 *     bun test packages/backend/src/db/__tests__/sessionSearchQueries.test.ts
 */
import { afterAll, describe, expect, test } from "bun:test";
import { initializeDatabase } from "../schema";
import { buildTurns, upsertTurnEmbeddings } from "../semanticQueries";
import {
  keywordSearchTurns,
  vectorSearchTurns,
  fetchSearchHits,
  getSearchableProjects,
} from "../sessionSearchQueries";

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

const MODEL = "test-search-model";
const DIM = 1024;

function oneHot(i: number, j?: number): string {
  const v = new Array(DIM).fill(0);
  v[i] = 1;
  if (j !== undefined) v[j] = 0.5;
  return `[${v.join(",")}]`;
}

d("sessionSearchQueries — keyword + vector search", () => {
  let sqlPromise: ReturnType<typeof initializeDatabase> | null = null;
  const getSql = () => (sqlPromise ??= initializeDatabase(dbUrl!));

  const run = crypto.randomUUID().slice(0, 8);
  const devA = `t-srch-a-${run}`;
  const devB = `t-srch-b-${run}`;
  const s = (n: string) => `t-srch-${n}-${run}`;
  const ev = (n: string) => `t-srch-ev-${n}-${run}`;
  const sessionIds = ["main", "other", "private", "old"].map(s);
  const t = (day: number, min = 0) => new Date(Date.UTC(2026, 0, day, 0, min)).toISOString();
  const proj = `proj-${run}`;
  const all = { allOrigins: true };

  async function turnId(promptEvent: string): Promise<string> {
    const sql = await getSql();
    const [row] = await sql`SELECT id::TEXT AS id FROM prompt_turns WHERE prompt_event_id = ${ev(promptEvent)}`;
    return (row as { id: string }).id;
  }

  afterAll(async () => {
    if (!sqlPromise) return;
    const sql = await sqlPromise;
    for (const id of sessionIds) {
      await sql`DELETE FROM prompt_turns WHERE session_id = ${id}`;
      await sql`DELETE FROM events WHERE session_id = ${id}`;
      await sql`DELETE FROM sessions WHERE id = ${id}`;
    }
    await sql`DELETE FROM developers WHERE id IN (${devA}, ${devB})`;
  });

  test("seeds settled turns", async () => {
    const sql = await getSql();
    for (const dev of [devA, devB]) {
      await sql`INSERT INTO developers (id, name, email) VALUES (${dev}, 'srch', ${`${dev}@test.local`})`;
    }
    const sessions: Array<[string, string, string, string]> = [
      [s("main"), devA, "open", t(10)],
      [s("other"), devB, "open", t(10)],
      [s("private"), devA, "private", t(10)],
      [s("old"), devA, "open", t(1)],
    ];
    for (const [id, dev, mode, start] of sessions) {
      await sql`
        INSERT INTO sessions (id, developer_id, project_path, project_name, started_at, ended_at, status, privacy_mode)
        VALUES (${id}, ${dev}, '/p', ${id === s("old") ? `${proj}-old` : proj}, ${start}, ${start}, 'ended', ${mode})`;
    }
    const events: Array<[string, string, string, string, object]> = [
      ["p1", s("main"), "prompt.submit", t(10, 1), { promptText: "why does withSemanticIndexLock deadlock" }],
      ["r1", s("main"), "response.complete", t(10, 2), { responseText: "The advisory lock was never released." }],
      ["p2", s("main"), "prompt.submit", t(10, 3), { promptText: "configure caddy basic auth" }],
      ["r2", s("main"), "response.complete", t(10, 4), { responseText: "Added a basic_auth block with a bcrypt hash." }],
      ["p3", s("main"), "prompt.submit", t(10, 5), { promptText: "<task-notification>build done</task-notification> lock" }],
      ["r3", s("main"), "response.complete", t(10, 6), { responseText: "ok" }],
      ["p4", s("other"), "prompt.submit", t(10, 1), { promptText: "withSemanticIndexLock again" }],
      ["r4", s("other"), "response.complete", t(10, 2), { responseText: "teammate" }],
      ["p5", s("private"), "prompt.submit", t(10, 1), { promptText: "withSemanticIndexLock secret" }],
      ["r5", s("private"), "response.complete", t(10, 2), { responseText: "secret" }],
      ["p6", s("old"), "prompt.submit", t(1, 1), { promptText: "old lock question" }],
      ["r6", s("old"), "response.complete", t(1, 2), { responseText: "advisory locks explained" }],
    ];
    for (const [id, session, type, at, payload] of events) {
      await sql`
        INSERT INTO events (id, session_id, event_type, payload, created_at)
        VALUES (${ev(id)}, ${session}, ${type}, ${payload}, ${at})`;
    }
    await buildTurns(sql, 10_000);
    // The private session never becomes a turn; insert one directly to prove
    // the query-time privacy filter as well.
    await sql`
      INSERT INTO prompt_turns (session_id, prompt_event_id, prompt_at, prompt_text, response_text)
      VALUES (${s("private")}, ${ev("p5")}, ${t(10, 1)}, 'withSemanticIndexLock secret', 'secret')
      ON CONFLICT DO NOTHING`;
    expect(await turnId("p1")).toBeTruthy();
  });

  test("keyword search matches identifiers, prefixes and responses, scoped to devIds", async () => {
    const sql = await getSql();
    const exact = await keywordSearchTurns(sql, {
      query: "withSemanticIndexLock", field: "both", devIds: [devA], filters: all, limit: 10,
    });
    expect(exact.map((r) => r.turn_id)).toEqual([await turnId("p1")]);

    const prefix = await keywordSearchTurns(sql, {
      query: "withSemantic", field: "both", devIds: [devA], filters: all, limit: 10,
    });
    expect(prefix.map((r) => r.turn_id)).toEqual([await turnId("p1")]);

    const both = await keywordSearchTurns(sql, {
      query: "withSemanticIndexLock", field: "both", devIds: [devA, devB], filters: all, limit: 10,
    });
    expect(both.map((r) => r.turn_id).sort()).toEqual([await turnId("p1"), await turnId("p4")].sort());
  });

  test("field restricts to the prompt or the response", async () => {
    const sql = await getSql();
    const q = { query: "bcrypt", devIds: [devA], filters: all, limit: 10 };
    expect(await keywordSearchTurns(sql, { ...q, field: "prompt" })).toEqual([]);
    const resp = await keywordSearchTurns(sql, { ...q, field: "response" });
    expect(resp.map((r) => r.turn_id)).toEqual([await turnId("p2")]);
  });

  test("filters: origin, project and date range", async () => {
    const sql = await getSql();
    const base = { query: "lock", field: "both" as const, devIds: [devA], limit: 10 };
    const human = await keywordSearchTurns(sql, { ...base, filters: {} });
    expect(human.map((r) => r.turn_id)).not.toContain(await turnId("p3"));
    const withAll = await keywordSearchTurns(sql, { ...base, filters: all });
    expect(withAll.map((r) => r.turn_id)).toContain(await turnId("p3"));

    const oldOnly = await keywordSearchTurns(sql, { ...base, filters: { ...all, project: `${proj}-old` } });
    expect(oldOnly.map((r) => r.turn_id)).toEqual([await turnId("p6")]);

    const recent = await keywordSearchTurns(sql, { ...base, filters: { ...all, from: t(5) } });
    expect(recent.map((r) => r.turn_id)).not.toContain(await turnId("p6"));
  });

  test("vector search applies the similarity floor and window", async () => {
    const sql = await getSql();
    await upsertTurnEmbeddings(sql, MODEL, [
      { turn_id: await turnId("p1"), kind: "prompt", content_hash: "h1", vector: oneHot(0) },
      { turn_id: await turnId("p2"), kind: "prompt", content_hash: "h2", vector: oneHot(0, 1) },
      { turn_id: await turnId("p6"), kind: "prompt", content_hash: "h6", vector: oneHot(7) },
    ]);
    const hits = await vectorSearchTurns(sql, {
      vector: oneHot(0), model: MODEL, kind: "prompt", devIds: [devA], filters: all,
      limit: 10, minSimilarity: 0.5, relativeWindow: 0.5,
    });
    // p1 = 1.0, p2 ≈ 0.89, p6 = 0 (below the floor).
    expect(hits.map((r) => r.turn_id)).toEqual([await turnId("p1"), await turnId("p2")]);

    const tight = await vectorSearchTurns(sql, {
      vector: oneHot(0), model: MODEL, kind: "prompt", devIds: [devA], filters: all,
      limit: 10, minSimilarity: 0.5, relativeWindow: 0.05,
    });
    expect(tight.map((r) => r.turn_id)).toEqual([await turnId("p1")]);
  });

  test("hydrated hits carry highlights and never leak out-of-scope turns", async () => {
    const sql = await getSql();
    const ids = [await turnId("p1"), await turnId("p2"), await turnId("p4")];
    const rows = await fetchSearchHits(sql, { turnIds: ids, query: "advisory", devIds: [devA] });
    expect(rows.map((r) => r.turn_id).sort()).toEqual([ids[0], ids[1]].sort());
    const p1 = rows.find((r) => r.turn_id === ids[0])!;
    expect(p1.prompt_event_id).toBe(ev("p1"));
    expect(p1.response_snippet).toContain("«advisory»");
    // No keyword match in the prompt: plain opening text.
    expect(p1.prompt_snippet).toBe("why does withSemanticIndexLock deadlock");
    expect(JSON.stringify(rows)).not.toContain(devA);
  });

  test("searchable projects exclude private sessions and other developers", async () => {
    const sql = await getSql();
    const projects = await getSearchableProjects(sql, [devA]);
    expect(projects).toContain(proj);
    expect(projects).toContain(`${proj}-old`);
    expect(await getSearchableProjects(sql, [])).toEqual([]);
  });
});
