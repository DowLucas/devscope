/**
 * DEV-86 — Output-side identity-leak guardrail.
 *
 * Premise: the input-side guardrail (`assertNoDeveloperIdentities`) is already
 * wired in front of every weekly-buyer LLM call (see
 * `reportWorkflow.guardrail.test.ts`). Gap #2 from the [DEV-84 brief] is that
 * we have no automated assertion that the LLM **output** rows persisted to
 * `ai_insights`, `ai_reports`, and the pattern surfaces are themselves
 * identity-free. A model that hallucinates a developer name into the
 * generated narrative would slip past the input-side check.
 *
 * This file does NOT call the live model in CI (per the task constraints).
 * Instead it:
 *
 *   1. **Golden fixture regression** — frozen, hand-written representative
 *      output bodies for each AI surface (ai_insight title+narrative,
 *      ai_report title+content_markdown, ai_pattern name+narrative). Each
 *      fixture is run through `detectDeveloperIdentities` against a synthetic
 *      team roster and MUST return zero hits. Failing means the fixture itself
 *      was authored with an identity-leak — file a follow-up bug.
 *
 *   2. **Property test of the detector** — for a battery of synthetic
 *      identity strings (emails, first names, 64-hex SHA-256 ids, apikey
 *      tokens), embed each verbatim into a fake output body and assert the
 *      detector flags it. This proves the guardrail we plan to apply on the
 *      output side will actually catch a leak, and that any future change to
 *      detector internals does not regress on these classes.
 *
 * Mission-gate: every assertion is an *absence* assertion (or, in the property
 * case, an assertion that the detector *finds* a leak we deliberately
 * injected). Nothing here requires a name to be present in any user-facing
 * surface.
 *
 * If a fixture-driven assertion fails, that is evidence of an actual leak in
 * the recorded output. Per the DEV-86 acceptance criteria, file a follow-up
 * bug issue against the responsible engineer rather than patching the fixture.
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";
import { dbStubs } from "../../../__test_helpers__/mockStubs";
import {
  detectDeveloperIdentities,
  _resetMissionRosterCache,
} from "../../grounding/missionGuardrail";

// ---------------------------------------------------------------------------
// Synthetic team — same shape as `reportWorkflow.guardrail.test.ts` so the
// two guardrail tests share an interpretation of "identity".
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

// Module mock is required because `detectDeveloperIdentities` reads from `sql`
// directly. We do not exercise reportWorkflow here — only the guardrail
// helper — but mocking the db barrel keeps us aligned with the sibling test
// file's pattern and avoids surprise imports.
mock.module("../../../db", () => dbStubs());

function createMockSql() {
  const fn = (...args: unknown[]) => {
    const parts = args[0] as TemplateStringsArray | undefined;
    const joined = parts ? parts.join("") : "";
    if (joined.includes("FROM developers")) {
      return Promise.resolve(TEAM);
    }
    return Promise.resolve([]);
  };
  return Object.assign(fn, {
    begin: async (cb: (tx: unknown) => Promise<void>) => {
      await cb((..._a: unknown[]) => Promise.resolve([]));
    },
  }) as any;
}

// ---------------------------------------------------------------------------
// Golden frozen fixtures — one per AI surface.
//
// Each fixture is the shape that would land in the persisted row's
// user-facing fields (title + narrative/markdown). Numbers, project names,
// tool names, and aggregate verbs are intentionally rich; identity-bearing
// strings are intentionally absent. If a future model run produces an output
// resembling these shapes that DOES include identity, the runtime guardrail
// is responsible for rejecting it — these fixtures only assert that
// identity-free outputs of this shape pass cleanly (no false positives) and
// that the detector wiring is intact.
// ---------------------------------------------------------------------------

const AI_INSIGHT_FIXTURE = {
  surface: "ai_insight" as const,
  type: "trend" as const,
  severity: "info" as const,
  title: "Bash tool failure rate climbed 18% week-over-week",
  narrative:
    "Across the team this week, Bash exit-code-1 failures rose from a 24% " +
    "rate to a 28% rate. The cluster is concentrated in the billing-service " +
    "project, where retry loops on `npm install` account for most of the " +
    "delta. Recommendation: review the project's CLAUDE.md for an explicit " +
    "package-manager pin so subsequent sessions don't re-discover the same " +
    "failure path.",
  data_context: {
    period: { start: "2026-04-27", end: "2026-05-03" },
    failure_rate: { current: 0.28, previous: 0.24, delta: 0.04 },
    cluster: "tool.fail Bash exit 1",
    top_project: "billing-service",
  },
};

const AI_REPORT_FIXTURE = {
  surface: "ai_report" as const,
  report_type: "weekly" as const,
  title: "Weekly Buyer Report — Week of 2026-04-27",
  content_markdown:
    "## Velocity\n\n" +
    "- Sessions: 142 (+20% vs prior week)\n" +
    "- Prompts: 1,820 (+13%)\n" +
    "- Tool calls: 3,420 (+15%)\n\n" +
    "## Tooling health\n\n" +
    "- Bash exit-1 cluster concentrated in billing-service (18 sessions).\n" +
    "- Auth-service tool-failure rate 35%; review of authentication " +
    "fixtures recommended.\n\n" +
    "## Pattern adoption\n\n" +
    "- The outline-then-implement pattern was used in 24 sessions and is " +
    "trending up.\n" +
    "- One anti-pattern (thrash-edits) accounted for 4 of the long-tail " +
    "sessions.\n",
  data_context: {
    period: { start: "2026-04-27", end: "2026-05-03" },
    project_breakdown: [
      { project_name: "billing-service", sessions: 42 },
      { project_name: "auth-service", sessions: 31 },
      { project_name: "checkout-web", sessions: 28 },
    ],
  },
};

const AI_PATTERN_FIXTURE = {
  surface: "ai_pattern" as const,
  name: "outline-then-implement",
  effectiveness: "effective" as const,
  narrative:
    "Sessions that begin with a short outline before any Edit or Write call " +
    "complete in 23% fewer tool calls and have a 41% lower thrash-edit " +
    "incidence than sessions that begin with an immediate Edit. The pattern " +
    "is observed across the billing-service, auth-service, and checkout-web " +
    "projects.",
  details: {
    uses: 24,
    avg_tool_call_reduction_pct: 23,
    thrash_edit_reduction_pct: 41,
    sample_session_id: "7dac753a-5888-4824-846e-f6aba44ff39e",
  },
};

const SURFACE_FIXTURES = [
  AI_INSIGHT_FIXTURE,
  AI_REPORT_FIXTURE,
  AI_PATTERN_FIXTURE,
] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DEV-86 output guardrail: frozen fixtures are identity-free", () => {
  beforeEach(() => {
    _resetMissionRosterCache();
  });

  for (const fixture of SURFACE_FIXTURES) {
    test(`${fixture.surface}: golden output passes detector with zero hits`, async () => {
      const sql = createMockSql();

      const hits = await detectDeveloperIdentities(sql, fixture);

      // Mission-gate: an *absence* assertion. If this fails, the fixture
      // contains an identity-bearing string — file a follow-up bug rather
      // than editing the fixture to mask the leak.
      expect(hits).toEqual([]);

      // Belt-and-braces serialization-level checks so a future detector
      // refactor that loosens any one rule still leaves these surface-level
      // invariants enforced.
      const serialized = JSON.stringify(fixture);
      for (const dev of TEAM) {
        expect(serialized).not.toContain(dev.email);
        expect(serialized).not.toContain(dev.id);
        const firstName = dev.name.split(/\s+/)[0];
        expect(serialized).not.toContain(firstName);
      }
      expect(/\bapikey-[A-Za-z0-9_-]+/.test(serialized)).toBe(false);
      expect(/[0-9a-fA-F]{16,}/.test(serialized)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Property test: the detector flags every class of identity-bearing string
// when it appears verbatim in an otherwise innocuous output body. This is
// the dual of the fixture test — fixtures prove no false positives on safe
// shapes; this proves no false negatives on leaky shapes.
//
// Constructed by taking a known-good fixture and substituting one identity
// token into the free-form narrative field. A future detector change that
// regresses on any class will turn these into red.
// ---------------------------------------------------------------------------

interface InjectionCase {
  label: string;
  // The synthetic identity string to inject into output text.
  identity: string;
  // The leak class we expect the detector to report.
  expectedKind:
    | "developer_email"
    | "developer_name"
    | "developer_id_hash"
    | "api_key_token";
}

const INJECTION_CASES: InjectionCase[] = [
  {
    label: "developer email echoed verbatim",
    identity: TEAM[0].email,
    expectedKind: "developer_email",
  },
  {
    label: "developer first name echoed verbatim",
    identity: TEAM[1].name.split(/\s+/)[0],
    expectedKind: "developer_name",
  },
  {
    label: "developer SHA-256 id echoed verbatim",
    identity: TEAM[2].id,
    expectedKind: "developer_id_hash",
  },
  {
    label: "better-auth apikey token echoed verbatim",
    // `apikey-` prefix + base64-ish suffix, matches the runtime regex.
    identity: "apikey-AbCdEf0123456789",
    expectedKind: "api_key_token",
  },
];

describe("DEV-86 output guardrail: property — detector flags injected identities", () => {
  beforeEach(() => {
    _resetMissionRosterCache();
  });

  for (const c of INJECTION_CASES) {
    test(c.label, async () => {
      const sql = createMockSql();

      // Take a benign output and splice the identity into the narrative.
      // We do this on a clone so the golden fixture stays untouched.
      const leakyOutput = {
        ...AI_INSIGHT_FIXTURE,
        narrative:
          AI_INSIGHT_FIXTURE.narrative +
          ` (cross-referenced with ${c.identity} in the source aggregate)`,
      };

      const hits = await detectDeveloperIdentities(sql, leakyOutput);

      // Mission-gate phrasing: assert the detector *would have caught* a
      // leak if one occurred. This does not require the leak text in any
      // production surface — only that the guard layer is present and
      // sensitive to this class of identity.
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.map((h) => h.kind)).toContain(c.expectedKind);
    });
  }
});
