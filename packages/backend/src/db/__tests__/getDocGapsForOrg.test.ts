/**
 * DEV-48 — `getDocGapsForOrg` deterministic + mission-guardrail snapshot.
 *
 * The helper feeds the `weekly-buyer` persona's `docGaps` prompt slot. The
 * acceptance criteria from DEV-48 are:
 *
 *   1. Deterministic results on a synthetic seed dataset.
 *   2. Output passes the mission-guardrail snapshot test (no per-dev strings).
 *   3. Zero new event types or rollup jobs added — the helper rides on the
 *      existing `events` + `claude_md_snapshots` tables.
 *
 * This test mocks `sql` to serve the helper the four query shapes it issues
 * (latest snapshot text, grep patterns, file basenames, glob directories)
 * with a synthetic team of three developers underneath. The helper's output
 * is asserted to be:
 *   - exactly the deterministic top-N list (count desc, kind asc, term asc),
 *   - free of any synthetic team's identifying strings, and
 *   - additionally clean per the runtime mission-guardrail detector.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { getDocGapsForOrg } from "../claudeMdQueries";
import {
  detectDeveloperIdentities,
  _resetMissionRosterCache,
} from "../../ai/grounding/missionGuardrail";

// ---------------------------------------------------------------------------
// Synthetic team — same shape as DEV-45 fixture so a future helper change
// that accidentally piped per-developer data through would be caught here too.
// ---------------------------------------------------------------------------

const TEAM = [
  {
    id: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    name: "Alice Johnson",
    email: "alice@acme.test",
  },
  {
    id: "b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1",
    name: "Bob Patel",
    email: "bob@acme.test",
  },
  {
    id: "c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2",
    name: "Carol Lee",
    email: "carol@acme.test",
  },
];

// Latest CLAUDE.md content for the org, lower-cased on read by the helper.
// "deploy" and "stripe" are explicitly documented; everything else in the
// candidate rows below should fall through as gap candidates.
const CLAUDE_MD_CORPUS = `
# Project conventions

Use \`bun test\` to run the unit suite.
Deployment uses the deploy.sh script in tools/.
Stripe webhooks are mocked in tests/fixtures/stripe.

## Architecture

Read packages/backend/CLAUDE.md before touching the API surface.
`;

// The four query shapes the helper issues. Order matters because the helper
// calls them in the order: snapshots, grep, files, dirs.
function createMockSql() {
  let callIndex = 0;
  const responses: unknown[][] = [
    // 1. Snapshots — latest content_text per project_path for the org.
    [{ content_text: CLAUDE_MD_CORPUS }],

    // 2. Grep/Glob patterns. "deploy" and "stripe" are covered by the corpus
    //    and MUST be filtered out by the helper. Sample sessions are UUIDs
    //    (under the 16-hex SHA-256 threshold of the mission guardrail).
    [
      {
        term: "telemetry",
        count: 42,
        sample_session_ids: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
      },
      {
        term: "feature_flag",
        count: 31,
        sample_session_ids: ["33333333-3333-4333-8333-333333333333"],
      },
      {
        term: "deploy",
        count: 28,
        sample_session_ids: ["44444444-4444-4444-8444-444444444444"],
      },
      {
        term: "rate_limit",
        count: 14,
        sample_session_ids: ["55555555-5555-4555-8555-555555555555"],
      },
    ],

    // 3. File basenames (the helper strips the directory).
    [
      {
        term: "ratelimiter.ts",
        count: 22,
        sample_session_ids: ["66666666-6666-4666-8666-666666666666"],
      },
      {
        term: "stripe.ts",
        count: 18, // covered by corpus ("stripe") — should drop
        sample_session_ids: ["77777777-7777-4777-8777-777777777777"],
      },
      {
        term: "telemetry-shim.ts",
        count: 9, // covered transitively via "telemetry" but the corpus
        // doesn't contain "telemetry-shim" — should NOT drop, because the
        // helper checks the full term against the corpus, not a substring.
        sample_session_ids: ["88888888-8888-4888-8888-888888888888"],
      },
    ],

    // 4. Glob directories.
    [
      {
        term: "infra/terraform",
        count: 16,
        sample_session_ids: ["99999999-9999-4999-8999-999999999999"],
      },
    ],
  ];

  const fn = (..._args: unknown[]) => {
    const next = responses[callIndex] ?? [];
    callIndex += 1;
    return Promise.resolve(next);
  };
  return Object.assign(fn, {
    begin: async (cb: (tx: unknown) => Promise<void>) => {
      await cb((..._a: unknown[]) => Promise.resolve([]));
    },
  }) as any;
}

// Mission-guardrail mock SQL — separate fn that always returns the synthetic
// roster from the developers table so `detectDeveloperIdentities` can score
// the helper output against it.
function createRosterSql() {
  const fn = (..._args: unknown[]) => Promise.resolve(TEAM);
  return Object.assign(fn, {
    begin: async (cb: (tx: unknown) => Promise<void>) => {
      await cb((..._a: unknown[]) => Promise.resolve([]));
    },
  }) as any;
}

describe("DEV-48 getDocGapsForOrg", () => {
  beforeEach(() => {
    _resetMissionRosterCache();
  });

  test("deterministic ranking and CLAUDE.md filtering on synthetic seed", async () => {
    const sql = createMockSql();
    const period = { start: "2026-04-27T00:00:00Z", end: "2026-05-03T00:00:00Z" };

    const gaps = await getDocGapsForOrg(sql, "org-test-1", period);

    // Expected result: covered terms ("deploy", "stripe.ts") dropped; the rest
    // ranked by count desc with ties broken on (kind asc, term asc).
    expect(gaps).toEqual([
      {
        term: "telemetry",
        kind: "grep_pattern",
        count: 42,
        sample_session_ids: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
      },
      {
        term: "feature_flag",
        kind: "grep_pattern",
        count: 31,
        sample_session_ids: ["33333333-3333-4333-8333-333333333333"],
      },
      {
        term: "ratelimiter.ts",
        kind: "file_path",
        count: 22,
        sample_session_ids: ["66666666-6666-4666-8666-666666666666"],
      },
      {
        term: "infra/terraform",
        kind: "directory",
        count: 16,
        sample_session_ids: ["99999999-9999-4999-8999-999999999999"],
      },
      {
        term: "rate_limit",
        kind: "grep_pattern",
        count: 14,
        sample_session_ids: ["55555555-5555-4555-8555-555555555555"],
      },
      {
        term: "telemetry-shim.ts",
        kind: "file_path",
        count: 9,
        sample_session_ids: ["88888888-8888-4888-8888-888888888888"],
      },
    ]);
  });

  test("returns [] when org has no CLAUDE.md snapshot", async () => {
    let callIndex = 0;
    const fn = (..._args: unknown[]) => {
      callIndex += 1;
      return Promise.resolve([]); // empty snapshots → bail
    };
    const sql = Object.assign(fn, {
      begin: async () => {},
    }) as any;

    const gaps = await getDocGapsForOrg(sql, "org-empty", {
      start: "2026-04-27T00:00:00Z",
      end: "2026-05-03T00:00:00Z",
    });
    expect(gaps).toEqual([]);
    // Bailed out after the snapshot query — must not have run the candidate
    // queries (this is the "no CLAUDE.md, don't declare every search a gap"
    // contract).
    expect(callIndex).toBe(1);
  });

  test("respects custom limit", async () => {
    const sql = createMockSql();
    const gaps = await getDocGapsForOrg(
      sql,
      "org-test-1",
      { start: "2026-04-27T00:00:00Z", end: "2026-05-03T00:00:00Z" },
      3
    );
    expect(gaps).toHaveLength(3);
    expect(gaps.map((g) => g.term)).toEqual([
      "telemetry",
      "feature_flag",
      "ratelimiter.ts",
    ]);
  });

  test("mission guardrail: helper output has zero developer-identifying strings", async () => {
    const sql = createMockSql();
    const gaps = await getDocGapsForOrg(sql, "org-test-1", {
      start: "2026-04-27T00:00:00Z",
      end: "2026-05-03T00:00:00Z",
    });

    const serialized = JSON.stringify(gaps);
    for (const dev of TEAM) {
      expect(serialized).not.toContain(dev.email);
      expect(serialized).not.toContain(dev.id);
      const firstName = dev.name.split(/\s+/)[0];
      expect(serialized).not.toContain(firstName);
    }
    expect(/\bapikey-[A-Za-z0-9_-]+/.test(serialized)).toBe(false);
    // No 16+ contiguous hex run — UUIDs in sample_session_ids are
    // dash-separated and don't trigger the mission guardrail.
    expect(/[0-9a-fA-F]{16,}/.test(serialized)).toBe(false);

    // Belt-and-braces: run the runtime detector against the helper output
    // with the synthetic team loaded as the roster.
    const rosterSql = createRosterSql();
    const hits = await detectDeveloperIdentities(rosterSql, gaps);
    expect(hits).toEqual([]);
  });
});
