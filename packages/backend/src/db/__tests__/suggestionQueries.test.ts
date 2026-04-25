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
  test("insertCandidate serializes JSON fields, applies defaults, returns canonical row via RETURNING *", async () => {
    // Postgres returns snake_case; the mapper converts to canonical camelCase.
    const dbRow = {
      id: "c-1",
      repo_installation_id: "ri-1",
      kind: "claude_md",
      evidence_refs: { sessions: ["s1"] },
      evidence_score: 0.42,
      evidence_breakdown: { recurrence: 0.5 },
      summary: "tighten rule",
      status: "queued",
      priority: 0,
      suppression_key: "sk-1",
      created_at: "2026-04-25T00:00:00Z",
      claimed_at: null,
      claim_expires_at: null,
    };
    const sql = makeSql([{ match: /INSERT INTO suggestion_candidates/, rows: [dbRow] }]);

    const row = await insertCandidate(sql, {
      id: "c-1",
      repoInstallationId: "ri-1",
      kind: "claude_md",
      evidenceRefs: {
        patternIds: [],
        antiPatternIds: [],
        sessionIds: ["s1"],
        insightIds: [],
      },
      evidenceScore: 0.42,
      evidenceBreakdown: {
        breadth: 0.5,
        engineerDiversity: 0.5,
        recency: 0.5,
        consistency: 0.5,
        severity: 0.5,
      },
      summary: "tighten rule",
      suppressionKey: "sk-1",
    });

    expect(row.id).toBe("c-1");
    expect(row.status).toBe("queued");
    expect(row.repoInstallationId).toBe("ri-1");
    expect(sql.calls).toHaveLength(1); // single round-trip via RETURNING *
    const insertCall = sql.calls[0];
    expect(insertCall.query).toMatch(/INSERT INTO suggestion_candidates/);
    expect(insertCall.query).toMatch(/RETURNING \*/);
    // evidence_refs JSON-serialized for the ::jsonb cast
    expect(
      (insertCall.values as unknown[]).some(
        v => typeof v === "string" && v.startsWith("{") && v.includes('"sessionIds"')
      )
    ).toBe(true);
    expect(insertCall.values).toContain("queued"); // default status
    expect(insertCall.values).toContain(0); // default priority
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
    await claimNextCandidate(sql);
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
    const result = await claimNextCandidate(sql);
    expect(result).toBeNull();
  });

  test("returns the claimed row (mapped to canonical) when one was queued", async () => {
    const claimed = {
      id: "c-1",
      repo_installation_id: "ri-1",
      kind: "claude_md",
      evidence_refs: {},
      evidence_score: 0,
      evidence_breakdown: {},
      summary: "",
      status: "in_progress",
      priority: 0,
      suppression_key: "sk-1",
      created_at: "2026-04-25T00:00:00Z",
      claimed_at: "2026-04-25T00:00:00Z",
      claim_expires_at: null,
    };
    const sql = makeSql([{ match: /UPDATE suggestion_candidates/, rows: [claimed] }]);
    const result = await claimNextCandidate(sql);
    expect(result?.id).toBe("c-1");
    expect(result?.status).toBe("in_progress");
    expect(result?.claimedAt).toBe("2026-04-25T00:00:00Z");
  });

  test("inner SELECT only considers rows with status='queued' (skips in_progress)", async () => {
    // We can't truly test DB semantics in a unit test, but we can assert the
    // query restricts to queued so it cannot pick already-in-progress rows.
    const sql = makeSql();
    await claimNextCandidate(sql);
    expect(sql.calls[0].query).toMatch(/WHERE status = 'queued'/);
  });
});

// ---------------------------------------------------------------------------
// artifacts
// ---------------------------------------------------------------------------

describe("suggestion_artifacts", () => {
  test("insertArtifact serializes verification_results, respects nullable rubric, returns canonical row via RETURNING *", async () => {
    const dbRow = {
      id: "a-1",
      candidate_id: "c-1",
      patch: "diff --git a b",
      files_changed: ["CLAUDE.md"],
      title: "t",
      body: "b",
      model: "claude",
      verification_results: [],
      rubric_scores: null,
      quality_ranking: null,
      status: "ready",
      github_pr_number: null,
      github_branch: null,
      published_at: null,
      created_at: "2026-04-25T00:00:00Z",
    };
    const sql = makeSql([{ match: /INSERT INTO suggestion_artifacts/, rows: [dbRow] }]);

    const row = await insertArtifact(sql, {
      id: "a-1",
      candidateId: "c-1",
      patch: "diff --git a b",
      filesChanged: ["CLAUDE.md"],
      title: "t",
      body: "b",
      model: "claude",
      verificationResults: [
        { gate: "lint", pass: true, reason: "ok" },
      ],
      status: "ready",
    });

    expect(row.id).toBe("a-1");
    expect(row.candidateId).toBe("c-1");
    expect(row.filesChanged).toEqual(["CLAUDE.md"]);
    expect(sql.calls).toHaveLength(1); // single round-trip via RETURNING *
    const insertCall = sql.calls[0];
    expect(insertCall.query).toMatch(/INSERT INTO suggestion_artifacts/);
    expect(insertCall.query).toMatch(/RETURNING \*/);
    // verification_results JSON-serialized
    expect(
      (insertCall.values as unknown[]).some(
        v => typeof v === "string" && v.includes('"gate"') && v.includes('"lint"')
      )
    ).toBe(true);
    // rubric_scores omitted → bound as null with ::jsonb cast
    expect(insertCall.values).toContain(null);
    // files_changed should be passed as a JS array (Bun.sql handles text[])
    expect(insertCall.values).toContainEqual(["CLAUDE.md"]);
  });
});

// ---------------------------------------------------------------------------
// outcomes
// ---------------------------------------------------------------------------

describe("suggestion_outcomes", () => {
  test("upsertOutcome uses ON CONFLICT (artifact_id) to merge and returns canonical row via RETURNING *", async () => {
    const dbRow = {
      id: "o-1",
      artifact_id: "a-1",
      pr_state: "merged",
      merged_at: "2026-04-20T00:00:00Z",
      reviewer_verdict: null,
      reviewer_comment: null,
      persisted_30d: null,
      reverted_at: null,
      measured_at: null,
      created_at: "2026-04-25T00:00:00Z",
    };
    const sql = makeSql([{ match: /INSERT INTO suggestion_outcomes/, rows: [dbRow] }]);

    const row = await upsertOutcome(sql, {
      id: "o-1",
      artifactId: "a-1",
      prState: "merged",
      mergedAt: "2026-04-20T00:00:00Z",
    });

    expect(row.id).toBe("o-1");
    expect(row.artifactId).toBe("a-1");
    expect(row.prState).toBe("merged");
    expect(sql.calls).toHaveLength(1); // single round-trip via RETURNING *
    const upsertCall = sql.calls[0];
    expect(upsertCall.query).toMatch(/INSERT INTO suggestion_outcomes/);
    expect(upsertCall.query).toMatch(/ON CONFLICT \(artifact_id\) DO UPDATE/);
    expect(upsertCall.query).toMatch(/RETURNING \*/);
    expect(upsertCall.values).toContain("merged");
  });
});
