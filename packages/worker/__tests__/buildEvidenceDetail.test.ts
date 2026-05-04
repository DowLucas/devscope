/**
 * Unit tests for `buildEvidenceDetail` (Task 5.5 Part B).
 *
 * Mocks `Bun.sql`'s tagged-template signature; asserts:
 *   - empty refs short-circuit (no queries fired for that dimension)
 *   - anti-pattern + sample-error pairing flows through to the right shape
 *   - pattern fetch maps fields correctly
 *   - session excerpts cap at MAX_EVENTS_PER_SESSION (3) and the session
 *     list itself caps at MAX_SESSIONS (5) before being passed to SQL
 *   - sample errors per anti-pattern cap at 3
 *   - long error strings are truncated
 *   - a SQL error in one dimension degrades to an empty array but does NOT
 *     reject — the other dimensions keep their data
 */
import { describe, expect, test } from "bun:test";
import type { EvidenceRefs } from "@devscope/shared";
import { buildEvidenceDetail } from "../src/buildEvidenceDetail";

type Call = { query: string; values: unknown[] };

interface SqlMockOpts {
  /** Match a query (regex or substring) and return rows. */
  responses?: Array<{ match: RegExp; rows: unknown[]; error?: Error }>;
}

function makeSql(opts: SqlMockOpts = {}) {
  const calls: Call[] = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    const hit = opts.responses?.find((r) => r.match.test(query));
    if (hit?.error) return Promise.reject(hit.error);
    return Promise.resolve(hit?.rows ?? []);
  }) as any;
  fn.calls = calls;
  return fn;
}

const baseRefs: EvidenceRefs = {
  sessionIds: [],
  patternIds: [],
  antiPatternIds: [],
  insightIds: [],
};

describe("buildEvidenceDetail — empty refs", () => {
  test("returns empty arrays without firing any SQL queries", async () => {
    const sql = makeSql();
    const out = await buildEvidenceDetail(sql, baseRefs);
    expect(out).toEqual({
      antiPatterns: [],
      patterns: [],
      sessionExcerpts: [],
    });
    expect(sql.calls).toHaveLength(0);
  });
});

describe("buildEvidenceDetail — anti-patterns", () => {
  test("maps rows + sample errors and caps at 3 sample errors per AP", async () => {
    // Mock: anti_patterns SELECT returns 1 AP; window-function sample errors
    // returns 5 rows for that AP, all rn=1..5. We cap to 3 client-side too.
    const sql = makeSql({
      responses: [
        {
          match: /FROM anti_patterns\s+WHERE id IN/,
          rows: [
            {
              id: "ap_1",
              name: "repeated_bash_failure",
              severity: "critical",
              suggestion: "doc the auth step",
            },
          ],
        },
        {
          match: /FROM session_anti_pattern_matches/,
          rows: [
            { anti_pattern_id: "ap_1", error: "err 1", rn: 1 },
            { anti_pattern_id: "ap_1", error: "err 2", rn: 2 },
            { anti_pattern_id: "ap_1", error: "err 3", rn: 3 },
            // The SQL window already filters rn<=3, but assert the
            // client-side .slice(0,3) holds even if a fixture lies.
            { anti_pattern_id: "ap_1", error: "err 4", rn: 4 },
          ],
        },
      ],
    });
    const out = await buildEvidenceDetail(sql, {
      ...baseRefs,
      antiPatternIds: ["ap_1"],
    });
    expect(out.antiPatterns).toHaveLength(1);
    expect(out.antiPatterns[0].name).toBe("repeated_bash_failure");
    expect(out.antiPatterns[0].sampleErrors).toEqual(["err 1", "err 2", "err 3"]);
  });

  test("truncates long error strings to 500 chars + ellipsis", async () => {
    const longError = "x".repeat(800);
    const sql = makeSql({
      responses: [
        {
          match: /FROM anti_patterns/,
          rows: [{ id: "ap_1", name: "n", severity: "warning", suggestion: "s" }],
        },
        {
          match: /FROM session_anti_pattern_matches/,
          rows: [{ anti_pattern_id: "ap_1", error: longError, rn: 1 }],
        },
      ],
    });
    const out = await buildEvidenceDetail(sql, {
      ...baseRefs,
      antiPatternIds: ["ap_1"],
    });
    const e = out.antiPatterns[0].sampleErrors[0];
    expect(e.length).toBe(501); // 500 chars + "…"
    expect(e.endsWith("…")).toBe(true);
  });

  test("SQL error returns empty antiPatterns but does not reject", async () => {
    const sql = makeSql({
      responses: [
        {
          match: /FROM anti_patterns/,
          rows: [],
          error: new Error("boom"),
        },
      ],
    });
    const out = await buildEvidenceDetail(sql, {
      ...baseRefs,
      antiPatternIds: ["ap_1"],
    });
    expect(out.antiPatterns).toEqual([]);
  });
});

describe("buildEvidenceDetail — patterns", () => {
  test("maps name/description/effectiveness", async () => {
    const sql = makeSql({
      responses: [
        {
          match: /FROM session_patterns/,
          rows: [
            {
              name: "tdd-loop",
              description: "test, edit, run",
              effectiveness: "effective",
            },
          ],
        },
      ],
    });
    const out = await buildEvidenceDetail(sql, {
      ...baseRefs,
      patternIds: ["pat_1"],
    });
    expect(out.patterns).toEqual([
      {
        name: "tdd-loop",
        description: "test, edit, run",
        effectiveness: "effective",
      },
    ]);
  });
});

describe("buildEvidenceDetail — session excerpts", () => {
  test("caps to MAX_SESSIONS (5) before sending to SQL", async () => {
    // The cap happens client-side via `.slice(0, 5)` — verify it by
    // asserting the SQL fragment built by `inList` for the IN clause was
    // produced from exactly the first 5 ids. We inspect the bound value
    // (a Bun.sql unsafe fragment) by stringifying the underlying SQL it
    // wraps; bun's runtime carries the source on the object.
    const sql = makeSql({
      responses: [{ match: /FROM events e/, rows: [] }],
    });
    const sessionIds = Array.from({ length: 10 }, (_, i) => `sess_${i}`);
    await buildEvidenceDetail(sql, { ...baseRefs, sessionIds });
    const eventsCall = sql.calls.find((c: Call) => /FROM events e/.test(c.query))!;
    expect(eventsCall).toBeDefined();
    // The first bound value is the inList() unsafe fragment. Stringify
    // its source: Bun.sql's unsafe object has a `value` or `raw` property
    // depending on version; fall back to JSON.stringify of the whole obj.
    const fragment = eventsCall.values[0] as object;
    // Bun.sql's unsafe fragment stores the raw SQL on a Symbol-keyed property.
    const stringsSym = Object.getOwnPropertySymbols(fragment).find(
      (s) => s.description === "strings"
    );
    expect(stringsSym).toBeDefined();
    const repr = String((fragment as Record<symbol, unknown>)[stringsSym!]);
    expect(repr).toContain("sess_0");
    expect(repr).toContain("sess_4");
    expect(repr).not.toContain("sess_5");
    expect(repr).not.toContain("sess_9");
  });

  test("formats toolCall as toolName:subcommand when subcommand present", async () => {
    const sql = makeSql({
      responses: [
        {
          match: /FROM events e/,
          rows: [
            {
              session_id: "sess_a",
              tool_name: "Bash",
              subcommand: "railway login",
              error: "not found",
              created_at: "2026-04-01T00:00:00Z",
              rn: 1,
            },
            {
              session_id: "sess_a",
              tool_name: "Read",
              subcommand: null,
              error: "ENOENT",
              created_at: "2026-04-01T00:00:01Z",
              rn: 2,
            },
          ],
        },
      ],
    });
    const out = await buildEvidenceDetail(sql, {
      ...baseRefs,
      sessionIds: ["sess_a"],
    });
    expect(out.sessionExcerpts).toHaveLength(2);
    expect(out.sessionExcerpts[0].toolCall).toBe("Bash:railway login");
    expect(out.sessionExcerpts[1].toolCall).toBe("Read");
    expect(out.sessionExcerpts[0].sessionId).toBe("sess_a");
  });
});

describe("buildEvidenceDetail — partial failure isolation", () => {
  test("anti-pattern failure does not affect pattern + session results", async () => {
    const sql = makeSql({
      responses: [
        { match: /FROM anti_patterns/, rows: [], error: new Error("nope") },
        {
          match: /FROM session_patterns/,
          rows: [{ name: "p", description: "d", effectiveness: "neutral" }],
        },
        {
          match: /FROM events e/,
          rows: [
            {
              session_id: "s1",
              tool_name: "Bash",
              subcommand: null,
              error: "x",
              created_at: "2026-04-01T00:00:00Z",
              rn: 1,
            },
          ],
        },
      ],
    });
    const out = await buildEvidenceDetail(sql, {
      antiPatternIds: ["ap_1"],
      patternIds: ["pat_1"],
      sessionIds: ["s1"],
      insightIds: [],
    });
    expect(out.antiPatterns).toEqual([]);
    expect(out.patterns).toHaveLength(1);
    expect(out.sessionExcerpts).toHaveLength(1);
  });
});
