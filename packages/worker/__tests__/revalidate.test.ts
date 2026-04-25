import { describe, expect, test } from "bun:test";
import type { SuggestionCandidate } from "@devscope/shared";
import { revalidate } from "../src/revalidate";

type Call = { query: string; values: unknown[] };

/**
 * Tagged-template SQL stub. Each entry's `match` is tested against the joined
 * query string in order; the first hit's `rows` is returned.
 */
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

function candidate(overrides: Partial<SuggestionCandidate> = {}): SuggestionCandidate {
  return {
    id: "cand-1",
    repoInstallationId: "ri-1",
    kind: "claude_md",
    evidenceRefs: {
      patternIds: [],
      antiPatternIds: ["ap-1"],
      sessionIds: [],
      insightIds: [],
    },
    evidenceScore: 0.7,
    evidenceBreakdown: {
      breadth: 0.5,
      engineerDiversity: 0.5,
      recency: 0.5,
      consistency: 0.5,
      severity: 0.5,
    },
    summary: "tighten",
    status: "in_progress",
    priority: 0,
    suppressionKey: "sk-1",
    createdAt: "2026-04-20T00:00:00Z",
    claimedAt: "2026-04-25T00:00:00Z",
    claimExpiresAt: "2026-04-25T00:10:00Z",
    ...overrides,
  };
}

describe("revalidate", () => {
  test("returns ok when suppression is absent and evidence is fresh", async () => {
    const sql = makeSql([
      { match: /SELECT \* FROM suppression_ledger/, rows: [] },
      { match: /session_anti_pattern_matches/, rows: [{ recent_matches: 3 }] },
    ]);

    const result = await revalidate(sql, candidate());
    expect(result.ok).toBe(true);
  });

  test("returns stale when anti-pattern matches dropped to zero in trailing window", async () => {
    const sql = makeSql([
      { match: /SELECT \* FROM suppression_ledger/, rows: [] },
      { match: /session_anti_pattern_matches/, rows: [{ recent_matches: 0 }] },
    ]);

    const result = await revalidate(sql, candidate());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.markStatus).toBe("stale");
      expect(result.reason).toMatch(/no anti-pattern matches/i);
    }
  });

  test("returns dismissed when suppression entry created after candidate enqueue", async () => {
    const sql = makeSql([
      {
        match: /SELECT \* FROM suppression_ledger/,
        rows: [
          {
            suppression_key: "sk-1",
            repo_installation_id: "ri-1",
            kind: "claude_md",
            // After the candidate's createdAt of 2026-04-20.
            last_rejected_at: "2026-04-22T00:00:00Z",
            rejection_reason: "team rejected",
            rejection_count: 1,
            next_eligible_at: "2026-05-22T00:00:00Z",
          },
        ],
      },
    ]);

    const result = await revalidate(sql, candidate());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.markStatus).toBe("dismissed");
    }
  });

  test("ignores suppression older than candidate.createdAt and still checks evidence", async () => {
    const sql = makeSql([
      {
        match: /SELECT \* FROM suppression_ledger/,
        rows: [
          {
            suppression_key: "sk-1",
            repo_installation_id: "ri-1",
            kind: "claude_md",
            // Before the candidate's createdAt of 2026-04-20.
            last_rejected_at: "2026-04-15T00:00:00Z",
            rejection_reason: null,
            rejection_count: 1,
            next_eligible_at: "2026-04-16T00:00:00Z",
          },
        ],
      },
      { match: /session_anti_pattern_matches/, rows: [{ recent_matches: 5 }] },
    ]);

    const result = await revalidate(sql, candidate());
    expect(result.ok).toBe(true);
  });

  test("skips evidence query when no antiPatternIds cited", async () => {
    const sql = makeSql([{ match: /SELECT \* FROM suppression_ledger/, rows: [] }]);

    const result = await revalidate(
      sql,
      candidate({
        evidenceRefs: {
          patternIds: ["p1"],
          antiPatternIds: [],
          sessionIds: [],
          insightIds: [],
        },
      })
    );
    expect(result.ok).toBe(true);
    // Only the suppression query should have run.
    expect(sql.calls).toHaveLength(1);
  });
});
