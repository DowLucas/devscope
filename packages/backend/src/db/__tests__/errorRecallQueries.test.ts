/**
 * Integration tests for error recall and skill chains (migration 047,
 * errorRecallQueries.ts). Gated on TEST_DATABASE_URL with pgvector available;
 * see semanticQueries.test.ts for how to run.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { initializeDatabase } from "../schema";
import {
  getPendingErrors,
  upsertErrorEmbeddings,
  recordErrorEmbeddingFailure,
  searchSimilarErrors,
  getSkillChains,
} from "../errorRecallQueries";

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

d("errorRecallQueries", () => {
  let sqlPromise: ReturnType<typeof initializeDatabase> | null = null;
  const getSql = () => (sqlPromise ??= initializeDatabase(dbUrl!));

  const run = crypto.randomUUID().slice(0, 8);
  const devA = `t-err-a-${run}`;
  const devB = `t-err-b-${run}`;
  const s = (n: string) => `t-err-${n}-${run}`;
  const ev = (n: string) => `t-err-ev-${n}-${run}`;
  const sessionIds = ["fixed", "stuck", "private", "other", "current", "skills1", "skills2"].map(s);
  const t = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min)).toISOString();
  const tsc = "bun: command not found: tsc (exit 127)";

  afterAll(async () => {
    if (!sqlPromise) return;
    const sql = await sqlPromise;
    for (const id of sessionIds) {
      await sql`DELETE FROM events WHERE session_id = ${id}`;
      await sql`DELETE FROM sessions WHERE id = ${id}`;
    }
    await sql`DELETE FROM developers WHERE id IN (${devA}, ${devB})`;
  });

  test("seeds sessions and events", async () => {
    const sql = await getSql();
    for (const dev of [devA, devB]) {
      await sql`INSERT INTO developers (id, name, email) VALUES (${dev}, 'err', ${`${dev}@test.local`})`;
    }
    const sessions: Array<[string, string, string]> = [
      [s("fixed"), devA, "open"],
      [s("stuck"), devA, "standard"],
      [s("private"), devA, "private"],
      [s("other"), devB, "open"],
      [s("current"), devA, "open"],
      [s("skills1"), devA, "open"],
      [s("skills2"), devA, "open"],
    ];
    for (const [id, dev, mode] of sessions) {
      await sql`
        INSERT INTO sessions (id, developer_id, project_path, project_name, started_at, ended_at, status, privacy_mode, current_title)
        VALUES (${id}, ${dev}, '/p', 'proj', ${t(0)}, ${t(600)}, 'ended', ${mode}, ${`title ${id}`})`;
    }
    const skill = (name: string) => ({ toolName: "Skill", toolInput: { skill: name } });
    const events: Array<[string, string, string, string, object]> = [
      // fixed: fails, then Bash succeeds 5 minutes later (the fix), then again
      ["f1", s("fixed"), "tool.fail", t(2), { toolName: "Bash", errorMessage: tsc }],
      ["ok1", s("fixed"), "tool.complete", t(7), { toolName: "Bash", toolInput: { command: "bun add -d typescript" } }],
      ["ok1b", s("fixed"), "tool.complete", t(9), { toolName: "Bash", toolInput: { command: "later, unrelated" } }],
      // stuck: same failure, Bash never succeeds within 30 min
      ["f2", s("stuck"), "tool.fail", t(2), { toolName: "Bash", errorMessage: tsc }],
      ["ok2", s("stuck"), "tool.complete", t(90), { toolName: "Bash" }],
      // excluded: private session, other developer, too short, current session
      ["f3", s("private"), "tool.fail", t(2), { toolName: "Bash", errorMessage: tsc }],
      ["f4", s("other"), "tool.fail", t(2), { toolName: "Bash", errorMessage: tsc }],
      ["f5", s("fixed"), "tool.fail", t(3), { toolName: "Bash", errorMessage: "Exit code 1" }],
      ["f6", s("current"), "tool.fail", t(2), { toolName: "Bash", errorMessage: tsc }],
      // skill sequences: ship → code-review twice, then ship → qa once, plus a self-repeat
      ["k1", s("skills1"), "tool.complete", t(1), skill("ship")],
      ["k2", s("skills1"), "tool.complete", t(2), skill("/code-review")],
      ["k3", s("skills1"), "tool.complete", t(3), skill("ship")],
      ["k4", s("skills1"), "tool.complete", t(4), skill("code-review")],
      ["k5", s("skills2"), "tool.complete", t(1), skill("ship")],
      ["k6", s("skills2"), "tool.complete", t(2), skill("code-review")],
      ["k7", s("skills2"), "tool.complete", t(3), skill("ship")],
      ["k8", s("skills2"), "tool.complete", t(4), skill("qa")],
      ["k9", s("skills2"), "tool.complete", t(5), skill("qa")],
    ];
    for (const [id, session, type, at, payload] of events) {
      await sql`
        INSERT INTO events (id, session_id, event_type, payload, created_at)
        VALUES (${ev(id)}, ${session}, ${type}, ${payload}::jsonb, ${at}::timestamptz)`;
    }
  });

  const mine = async () => {
    const sql = await getSql();
    const all = await getPendingErrors(sql, MODEL, 10_000);
    return all.filter((p) => p.event_id.endsWith(run)).map((p) => p.event_id);
  };

  test("pending: non-private tool failures with a real message", async () => {
    expect((await mine()).sort()).toEqual([ev("f1"), ev("f2"), ev("f4"), ev("f6")].sort());
  });

  test("embedded and rejected errors leave the queue", async () => {
    const sql = await getSql();
    await upsertErrorEmbeddings(sql, MODEL, [
      { event_id: ev("f1"), content_hash: "h", vector: oneHot(0, 1) },
      { event_id: ev("f2"), content_hash: "h", vector: oneHot(0) },
      { event_id: ev("f6"), content_hash: "h", vector: oneHot(0) },
    ]);
    await recordErrorEmbeddingFailure(sql, MODEL, ev("f4"));
    // Re-running is a no-op.
    await upsertErrorEmbeddings(sql, MODEL, [{ event_id: ev("f1"), content_hash: "h", vector: oneHot(0, 1) }]);
    expect(await mine()).toEqual([]);
  });

  test("search: own sessions only, excludes the current one, reports the first call that worked", async () => {
    const sql = await getSql();
    const rows = await searchSimilarErrors(sql, {
      vector: oneHot(0),
      model: MODEL,
      devIds: [devA],
      limit: 10,
      excludeSessionId: s("current"),
    });
    const got = rows.filter((r) => r.event_id.endsWith(run));
    expect(got.map((r) => r.event_id)).toEqual([ev("f2"), ev("f1")]);
    const [stuck, fixed] = got;
    expect(stuck!.resolved).toBe(false);
    expect(stuck!.fix_input).toBeNull();
    expect(fixed!.resolved).toBe(true);
    expect(fixed!.fix_input).toBe("bun add -d typescript");
    expect(fixed!.session_title).toBe(`title ${s("fixed")}`);
    expect(fixed!.similarity).toBeLessThan(stuck!.similarity);
    expect(await searchSimilarErrors(sql, { vector: oneHot(0), model: MODEL, devIds: [], limit: 5 })).toEqual([]);
  });

  test("errors of a session that turned private are purged", async () => {
    const sql = await getSql();
    const { purgePrivateTurns } = await import("../semanticQueries");
    await sql`UPDATE sessions SET privacy_mode = 'private' WHERE id = ${s("stuck")}`;
    await purgePrivateTurns(sql);
    const left = await sql`SELECT 1 FROM error_embeddings WHERE event_id = ${ev("f2")}`;
    expect(left).toHaveLength(0);
  });

  test("skill chains: next distinct skill per session, thresholded", async () => {
    const sql = await getSql();
    const chains = await getSkillChains(sql, [devA], { minCount: 2, minShare: 0.25, perSkill: 2 });
    // ship ran 4 times: followed by code-review 3 times, qa once (below minCount).
    expect(chains.filter((c) => c.from === "ship")).toEqual([
      { from: "ship", to: "code-review", count: 3, share: 0.75 },
    ]);
    // code-review → ship twice out of 3 runs.
    expect(chains.find((c) => c.from === "code-review")).toMatchObject({ to: "ship", count: 2 });
    expect(await getSkillChains(sql, [devB], { minCount: 1, minShare: 0, perSkill: 2 })).toEqual([]);
  });
});
