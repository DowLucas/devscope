import { describe, expect, test } from "bun:test";
import {
  insertCandidate,
  getCandidate,
  updateCandidateStatus,
  claimNextCandidate,
  insertArtifact,
  upsertOutcome,
} from "../suggestionQueries";

type Call = { query: string; values: unknown[] };

function makeSql(rowsByMatch: Array<{ match: RegExp; rows: unknown[] }> = []) {
  const calls: Call[] = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    const hit = rowsByMatch.find(r => r.match.test(query));
    return Promise.resolve(hit ? hit.rows : []);
  }) as any;
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------------------
// candidates
// ---------------------------------------------------------------------------

describe("suggestion_candidates", () => {
  test("insertCandidate serializes JSON fields and applies defaults", async () => {
    const expected = { id: "c-1", status: "queued" };
    const sql = makeSql([{ match: /SELECT \* FROM suggestion_candidates/, rows: [expected] }]);

    const row = await insertCandidate(sql, {
      id: "c-1",
      repo_installation_id: "ri-1",
      kind: "claude_md",
      evidence_refs: { sessions: ["s1"] },
      evidence_score: 0.42,
      evidence_breakdown: { recurrence: 0.5 },
      summary: "tighten rule",
      suppression_key: "sk-1",
    });

    expect(row).toEqual(expected as any);
    const insertCall = sql.calls.find((c: Call) => /INSERT INTO suggestion_candidates/.test(c.query));
    expect(insertCall).toBeDefined();
    expect(insertCall!.values).toContain(JSON.stringify({ sessions: ["s1"] }));
    expect(insertCall!.values).toContain(JSON.stringify({ recurrence: 0.5 }));
    expect(insertCall!.values).toContain("queued"); // default status
    expect(insertCall!.values).toContain(0); // default priority
  });

  test("getCandidate returns null when no row", async () => {
    const sql = makeSql();
    const row = await getCandidate(sql, "missing");
    expect(row).toBeNull();
  });

  test("updateCandidateStatus issues a single UPDATE with status param", async () => {
    const sql = makeSql();
    await updateCandidateStatus(sql, "c-1", "artifact_ready");
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0].query).toMatch(/UPDATE suggestion_candidates SET status/);
    expect(sql.calls[0].values).toContain("artifact_ready");
    expect(sql.calls[0].values).toContain("c-1");
  });
});

// ---------------------------------------------------------------------------
// claimNextCandidate — atomicity & semantics
// ---------------------------------------------------------------------------

describe("claimNextCandidate", () => {
  test("issues a single atomic statement with FOR UPDATE SKIP LOCKED", async () => {
    const sql = makeSql();
    await claimNextCandidate(sql, "worker-a");
    expect(sql.calls).toHaveLength(1); // genuinely atomic — one statement
    const q = sql.calls[0].query;
    expect(q).toMatch(/UPDATE suggestion_candidates/);
    expect(q).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(q).toMatch(/LIMIT 1/);
    expect(q).toMatch(/RETURNING/);
    expect(q).toMatch(/status = 'queued'/);
    expect(q).toMatch(/'in_progress'/);
    expect(q).toMatch(/INTERVAL '10 minutes'/);
  });

  test("returns null when queue empty (RETURNING produced no rows)", async () => {
    const sql = makeSql(); // default: every query returns []
    const result = await claimNextCandidate(sql, "worker-a");
    expect(result).toBeNull();
  });

  test("returns the claimed row when one was queued", async () => {
    const claimed = {
      id: "c-1",
      status: "in_progress",
      claimed_at: "2026-04-25T00:00:00Z",
    };
    const sql = makeSql([{ match: /UPDATE suggestion_candidates/, rows: [claimed] }]);
    const result = await claimNextCandidate(sql, "worker-a");
    expect(result).toEqual(claimed as any);
  });

  test("inner SELECT only considers rows with status='queued' (skips in_progress)", async () => {
    // We can't truly test DB semantics in a unit test, but we can assert the
    // query restricts to queued so it cannot pick already-in-progress rows.
    const sql = makeSql();
    await claimNextCandidate(sql, "worker-a");
    expect(sql.calls[0].query).toMatch(/WHERE status = 'queued'/);
  });
});

// ---------------------------------------------------------------------------
// artifacts
// ---------------------------------------------------------------------------

describe("suggestion_artifacts", () => {
  test("insertArtifact serializes verification_results and respects nullable rubric", async () => {
    const expected = { id: "a-1" };
    const sql = makeSql([{ match: /SELECT \* FROM suggestion_artifacts/, rows: [expected] }]);

    await insertArtifact(sql, {
      id: "a-1",
      candidate_id: "c-1",
      patch: "diff --git a b",
      files_changed: ["CLAUDE.md"],
      title: "t",
      body: "b",
      model: "claude",
      verification_results: { lint: "pass" },
      status: "ready",
    });

    const insertCall = sql.calls.find((c: Call) => /INSERT INTO suggestion_artifacts/.test(c.query));
    expect(insertCall).toBeDefined();
    expect(insertCall!.values).toContain(JSON.stringify({ lint: "pass" }));
    // files_changed should be passed as a JS array (Bun.sql handles text[])
    expect(insertCall!.values).toContainEqual(["CLAUDE.md"]);
  });
});

// ---------------------------------------------------------------------------
// outcomes
// ---------------------------------------------------------------------------

describe("suggestion_outcomes", () => {
  test("upsertOutcome uses ON CONFLICT (artifact_id) to merge", async () => {
    const expected = { id: "o-1", artifact_id: "a-1" };
    const sql = makeSql([{ match: /SELECT \* FROM suggestion_outcomes/, rows: [expected] }]);

    const row = await upsertOutcome(sql, {
      id: "o-1",
      artifact_id: "a-1",
      pr_state: "merged",
      merged_at: "2026-04-20T00:00:00Z",
    });

    expect(row).toEqual(expected as any);
    const upsertCall = sql.calls.find((c: Call) => /INSERT INTO suggestion_outcomes/.test(c.query));
    expect(upsertCall).toBeDefined();
    expect(upsertCall!.query).toMatch(/ON CONFLICT \(artifact_id\) DO UPDATE/);
    expect(upsertCall!.values).toContain("merged");
  });
});
