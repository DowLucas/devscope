import { describe, expect, test } from "bun:test";

import {
  buildSuppressionKey,
  promoteForInstallation,
  runPromoterOnce,
} from "../suggestionPromoter";
import { normalizeRepoFromGitRemote } from "../../utils/git";

// ---------------------------------------------------------------------------
// Mock SQL helper. Routes by query-text regex; each handler receives the
// template values and returns rows. Falls through to [].
// ---------------------------------------------------------------------------

type Handler = (values: unknown[]) => unknown[];

interface MockOptions {
  routes: Array<{ match: RegExp; handler: Handler }>;
}

function makeSql(opts: MockOptions) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    for (const r of opts.routes) {
      if (r.match.test(query)) return Promise.resolve(r.handler(values));
    }
    return Promise.resolve([]);
  }) as any;
  fn.calls = calls;
  return fn;
}

const ACTIVE_INSTALL = {
  id: "ri-1",
  organization_id: "org-1",
  github_install_id: 999,
  owner: "acme",
  repo: "widgets",
  default_branch: "main",
  cwd_patterns: [],
  is_live: true,
  auto_open_pr_kinds: [],
  convention_profile: {},
  installed_at: new Date("2026-04-01T00:00:00Z"),
  suspended_at: null,
};

function evidenceRow(overrides: Partial<{
  session_id: string;
  developer_id: string;
  anti_pattern_id: string;
  anti_pattern_name: string;
  anti_pattern_severity: string;
  matched_at: string;
  top_tool: string | null;
}>): Record<string, unknown> {
  return {
    session_id: overrides.session_id ?? "sess-1",
    developer_id: overrides.developer_id ?? "dev-1",
    session_ended_at: "2026-04-24T10:00:00Z",
    anti_pattern_id: overrides.anti_pattern_id ?? "ap-bash",
    anti_pattern_name: overrides.anti_pattern_name ?? "repeated_bash_failure",
    anti_pattern_severity: overrides.anti_pattern_severity ?? "warning",
    matched_at: overrides.matched_at ?? "2026-04-24T10:00:00Z",
    top_tool: overrides.top_tool ?? "railway",
  };
}

// 5 rich rows: 4 distinct developers, 4 distinct sessions, recent timestamps.
// Designed to clear the claude_md threshold (engineerDiversity >= 0.4 needs
// ≈2+ distinct users; score >= 0.3 is comfortable with this much evidence).
function richEvidence(): Record<string, unknown>[] {
  return [
    evidenceRow({ session_id: "s1", developer_id: "d1" }),
    evidenceRow({ session_id: "s2", developer_id: "d2" }),
    evidenceRow({ session_id: "s3", developer_id: "d3" }),
    evidenceRow({ session_id: "s4", developer_id: "d4" }),
    evidenceRow({ session_id: "s4", developer_id: "d4" }),
  ];
}

// Sparse: single user, single session — fails diversity threshold.
function sparseEvidence(): Record<string, unknown>[] {
  return [evidenceRow({ session_id: "s1", developer_id: "d1" })];
}

// ---------------------------------------------------------------------------
// 1. No active installs → no candidates created.
// ---------------------------------------------------------------------------

describe("suggestionPromoter — runPromoterOnce", () => {
  test("no active installs → no INSERTs", async () => {
    const sql = makeSql({
      routes: [
        // listActiveInstallations returns nothing
        { match: /FROM repo_installations/, handler: () => [] },
      ],
    });
    await runPromoterOnce(sql);
    const inserts = (sql as any).calls.filter((c: any) =>
      /INSERT INTO suggestion_candidates/.test(c.query)
    );
    expect(inserts).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 7. Suspended install → skipped entirely (the SQL filters them out).
  // -------------------------------------------------------------------------
  test("listActiveInstallations only returns non-suspended rows", async () => {
    const sql = makeSql({
      routes: [
        {
          match: /FROM repo_installations\s+WHERE suspended_at IS NULL/,
          handler: () => [], // no rows because all installs are suspended
        },
      ],
    });
    await runPromoterOnce(sql);
    expect(
      (sql as any).calls.some((c: any) =>
        /WHERE suspended_at IS NULL/.test(c.query)
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Active install + matching evidence → candidate created
// ---------------------------------------------------------------------------

describe("suggestionPromoter — promoteForInstallation", () => {
  test("active install + rich evidence → candidate INSERTed with correct fields", async () => {
    let inserted: { values: unknown[]; query: string } | null = null;

    const sql = makeSql({
      routes: [
        // 1. evidence query
        { match: /FROM session_anti_pattern_matches/, handler: () => richEvidence() },
        // 2. suppression check — none exists
        { match: /FROM suppression_ledger/, handler: () => [] },
        // 3. findActiveCandidate — none exists
        {
          match: /FROM suggestion_candidates\s+WHERE suppression_key/,
          handler: () => [],
        },
        // 4. INSERT INTO suggestion_candidates RETURNING *
        {
          match: /INSERT INTO suggestion_candidates/,
          handler: (values) => {
            inserted = { values, query: "" };
            return [
              {
                id: values[0],
                repo_installation_id: values[1],
                kind: values[2],
                evidence_refs: { sessions: ["s1"] },
                evidence_score: values[4],
                evidence_breakdown: {},
                summary: values[6],
                status: values[7],
                priority: values[8],
                suppression_key: values[9],
                created_at: new Date().toISOString(),
                claimed_at: null,
                claim_expires_at: null,
              },
            ];
          },
        },
      ],
    });

    const count = await promoteForInstallation(sql, {
      id: "ri-1",
      owner: "acme",
      repo: "widgets",
    }, new Date("2026-04-25T00:00:00Z"));

    expect(count).toBe(1);
    expect(inserted).not.toBeNull();
    // kind, evidence_score in expected range
    const v = inserted!.values;
    expect(v[2]).toBe("claude_md");
    const score = v[4] as number;
    expect(score).toBeGreaterThanOrEqual(0.3);
    expect(score).toBeLessThanOrEqual(1);
    // suppression_key matches the pure helper
    const expectedKey = buildSuppressionKey(
      "ri-1",
      "claude_md",
      "claude_md|repeated_bash_failure|railway"
    );
    expect(v[9]).toBe(expectedKey);
    // priority = round(score * 100)
    expect(v[8]).toBe(Math.round(score * 100));
  });

  // -------------------------------------------------------------------------
  // 3. Suppression active → skipped
  // -------------------------------------------------------------------------
  test("suppression with future next_eligible_at and no growth → skipped", async () => {
    const futureIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    // Prior settled candidate has a HIGH evidence_score, so the new score
    // can't beat priorScore * 1.5 — suppression stays in effect.
    const sql = makeSql({
      routes: [
        { match: /FROM session_anti_pattern_matches/, handler: () => richEvidence() },
        {
          match: /FROM suppression_ledger/,
          handler: () => [
            {
              suppression_key: "k",
              repo_installation_id: "ri-1",
              kind: "claude_md",
              last_rejected_at: new Date().toISOString(),
              rejection_reason: null,
              rejection_count: 1,
              next_eligible_at: futureIso,
            },
          ],
        },
        {
          // findLastSettledCandidate — returns a prior dismissed candidate
          // with a high evidence_score so the >50% growth override fails.
          match: /FROM suggestion_candidates\s+WHERE suppression_key.*'dismissed'/s,
          handler: () => [
            {
              id: "old",
              repo_installation_id: "ri-1",
              kind: "claude_md",
              evidence_refs: {},
              evidence_score: 1.0,
              evidence_breakdown: {},
              summary: "x",
              status: "dismissed",
              priority: 100,
              suppression_key: "k",
              created_at: new Date().toISOString(),
              claimed_at: null,
              claim_expires_at: null,
            },
          ],
        },
      ],
    });
    const count = await promoteForInstallation(sql, {
      id: "ri-1",
      owner: "acme",
      repo: "widgets",
    });
    expect(count).toBe(0);
    const inserts = (sql as any).calls.filter((c: any) =>
      /INSERT INTO suggestion_candidates\s*\(/.test(c.query)
    );
    expect(inserts).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 4. Suppression expired → allowed
  // -------------------------------------------------------------------------
  test("suppression with past next_eligible_at → allowed (candidate inserted)", async () => {
    const pastIso = new Date(Date.now() - 1000).toISOString();
    let didInsert = false;
    const sql = makeSql({
      routes: [
        { match: /FROM session_anti_pattern_matches/, handler: () => richEvidence() },
        {
          match: /FROM suppression_ledger/,
          handler: () => [
            {
              suppression_key: "k",
              repo_installation_id: "ri-1",
              kind: "claude_md",
              last_rejected_at: pastIso,
              rejection_reason: null,
              rejection_count: 1,
              next_eligible_at: pastIso,
            },
          ],
        },
        { match: /FROM suggestion_candidates\s+WHERE suppression_key/, handler: () => [] },
        {
          match: /INSERT INTO suggestion_candidates/,
          handler: (values) => {
            didInsert = true;
            return [
              {
                id: values[0],
                repo_installation_id: values[1],
                kind: values[2],
                evidence_refs: {},
                evidence_score: values[4],
                evidence_breakdown: {},
                summary: values[6],
                status: values[7],
                priority: values[8],
                suppression_key: values[9],
                created_at: new Date().toISOString(),
                claimed_at: null,
                claim_expires_at: null,
              },
            ];
          },
        },
      ],
    });

    const count = await promoteForInstallation(sql, {
      id: "ri-1",
      owner: "acme",
      repo: "widgets",
    });
    expect(count).toBe(1);
    expect(didInsert).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 5. Below per-kind threshold → skipped
  // -------------------------------------------------------------------------
  test("sparse evidence (1 user, 1 session) → below threshold, no insert", async () => {
    const sql = makeSql({
      routes: [
        { match: /FROM session_anti_pattern_matches/, handler: () => sparseEvidence() },
        { match: /FROM suppression_ledger/, handler: () => [] },
        { match: /FROM suggestion_candidates/, handler: () => [] },
      ],
    });
    const count = await promoteForInstallation(sql, {
      id: "ri-1",
      owner: "acme",
      repo: "widgets",
    });
    expect(count).toBe(0);
    const inserts = (sql as any).calls.filter((c: any) =>
      /INSERT INTO suggestion_candidates/.test(c.query)
    );
    expect(inserts).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 6. Already-active candidate with same suppression_key → not re-queued
  // -------------------------------------------------------------------------
  test("active candidate already present → does not re-queue", async () => {
    const sql = makeSql({
      routes: [
        { match: /FROM session_anti_pattern_matches/, handler: () => richEvidence() },
        { match: /FROM suppression_ledger/, handler: () => [] },
        {
          match: /FROM suggestion_candidates\s+WHERE suppression_key/,
          handler: () => [
            {
              id: "existing",
              repo_installation_id: "ri-1",
              kind: "claude_md",
              evidence_refs: {},
              evidence_score: 0.5,
              evidence_breakdown: {},
              summary: "x",
              status: "queued",
              priority: 50,
              suppression_key: "k",
              created_at: new Date().toISOString(),
              claimed_at: null,
              claim_expires_at: null,
            },
          ],
        },
      ],
    });
    const count = await promoteForInstallation(sql, {
      id: "ri-1",
      owner: "acme",
      repo: "widgets",
    });
    expect(count).toBe(0);
    const inserts = (sql as any).calls.filter((c: any) =>
      /INSERT INTO suggestion_candidates/.test(c.query)
    );
    expect(inserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. normalizeRepoFromGitRemote — both forms, plus negatives
// ---------------------------------------------------------------------------

describe("normalizeRepoFromGitRemote", () => {
  test("parses https remotes (with and without .git)", () => {
    expect(normalizeRepoFromGitRemote("https://github.com/Acme/Widgets")).toEqual({
      owner: "acme",
      repo: "widgets",
    });
    expect(normalizeRepoFromGitRemote("https://github.com/acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
    });
  });

  test("parses ssh remotes (with and without .git)", () => {
    expect(normalizeRepoFromGitRemote("git@github.com:Acme/Widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
    });
    expect(normalizeRepoFromGitRemote("git@github.com:acme/widgets")).toEqual({
      owner: "acme",
      repo: "widgets",
    });
  });

  test("returns null for non-GitHub or malformed remotes", () => {
    expect(normalizeRepoFromGitRemote("https://gitlab.com/acme/widgets")).toBeNull();
    expect(normalizeRepoFromGitRemote("git@bitbucket.org:acme/widgets.git")).toBeNull();
    expect(normalizeRepoFromGitRemote("")).toBeNull();
    expect(normalizeRepoFromGitRemote(null)).toBeNull();
    expect(normalizeRepoFromGitRemote("not-a-url")).toBeNull();
  });
});
