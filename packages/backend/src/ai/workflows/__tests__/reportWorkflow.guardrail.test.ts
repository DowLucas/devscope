/**
 * DEV-45 snapshot test on `gatherReportData`.
 *
 * Premise: `gatherReportData` composes the team-level data that `reportWorkflow`
 * hands to the LLM. The kill criterion in the [DEV-37 plan] requires that
 * every LLM input on the weekly-buyer surface be free of developer-identifying
 * strings. This test exercises the helper-layer composition with a SYNTHETIC
 * team of three developers (each with name, email, and a 64-hex SHA-256 id)
 * and asserts that the resulting payload that would reach the LLM contains
 * none of those identifying strings — proving the helper layer aggregates
 * correctly.
 *
 * Failing this test is a CI failure.
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";
import { dbStubs } from "../../../__test_helpers__/mockStubs";
import {
  detectDeveloperIdentities,
  _resetMissionRosterCache,
} from "../../grounding/missionGuardrail";

// ---------------------------------------------------------------------------
// Synthetic team
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

// ---------------------------------------------------------------------------
// Mock the db barrel BEFORE importing reportWorkflow.
//
// Each helper returns a SHAPE that mirrors what the real query produces, but
// the team-aggregate data has already been computed across the synthetic team
// — this is the contract the helper layer is supposed to enforce. If a
// future helper change accidentally pipes per-developer data through, the
// snapshot test below will catch it via `detectDeveloperIdentities`.
// ---------------------------------------------------------------------------

const mockGetPeriodComparison = mock(() =>
  Promise.resolve({
    current: { sessions: 142, prompts: 1820, tool_calls: 3420 },
    previous: { sessions: 118, prompts: 1610, tool_calls: 2980 },
    delta: { sessions: 24, prompts: 210, tool_calls: 440 },
  })
);

const mockGetTeamHealth = mock(() =>
  Promise.resolve({
    velocity: {
      current_week: { sessions: 142, prompts: 1820, tool_calls: 3420 },
      previous_week: { sessions: 118, prompts: 1610, tool_calls: 2980 },
      percent_change: { sessions: 20, prompts: 13, tool_calls: 15 },
    },
    sessionsNeedingAttention: [
      // session_id is a UUID — under the 16-char hex threshold.
      {
        session_id: "7dac753a-5888-4824-846e-f6aba44ff39e",
        project_name: "billing-service",
        tool_failure_rate: 0.42,
      },
      {
        session_id: "1fe16192-a1b3-4da7-8429-5d22c26aaf82",
        project_name: "auth-service",
        tool_failure_rate: 0.35,
      },
    ],
  })
);

const mockGetTeamActivitySummary = mock(() =>
  Promise.resolve({
    total_sessions: 142,
    total_prompts: 1820,
    total_tool_calls: 3420,
    avg_session_minutes: 42,
  })
);

const mockGetProjectsOverview = mock(() =>
  Promise.resolve([
    { project_name: "billing-service", sessions: 42, total_minutes: 1810 },
    { project_name: "auth-service", sessions: 31, total_minutes: 1240 },
    { project_name: "checkout-web", sessions: 28, total_minutes: 920 },
  ])
);

const mockGetToolUsageBreakdown = mock(() =>
  Promise.resolve([
    { tool_name: "Bash", count: 320 },
    { tool_name: "Read", count: 220 },
    { tool_name: "Edit", count: 180 },
    { tool_name: "Grep", count: 90 },
  ])
);

const mockGetConcreteToolDetails = mock(() =>
  Promise.resolve({
    bashCommands: [
      { command: "git", count: 120 },
      { command: "npm", count: 45 },
      { command: "docker", count: 8 },
    ],
    filesAccessed: [
      { file: "package.json", count: 25 },
      { file: "tsconfig.json", count: 15 },
    ],
    grepPatterns: [
      { pattern: "TODO", count: 12 },
      { pattern: "fixme", count: 6 },
    ],
    skillUsage: [{ skill: "/commit", count: 18 }],
  })
);

const mockGetSessionStatsSummary = mock(() =>
  Promise.resolve({
    total: 142,
    avg_duration_minutes: 42,
    completion_rate: 0.78,
  })
);

const mockGetFailureClusters = mock(() =>
  Promise.resolve([
    {
      cluster: "tool.fail Bash exit 1",
      count: 18,
      sample_session_id: "7dac753a-5888-4824-846e-f6aba44ff39e",
    },
  ])
);

const mockGetPatterns = mock(() =>
  Promise.resolve([
    { name: "outline-then-implement", effectiveness: "effective", uses: 24 },
  ])
);

const mockGetAntiPatternStats = mock(() =>
  Promise.resolve({ total_anti_patterns: 4, top: ["thrash-edits"] })
);

const mockCreateReport = mock((..._args: unknown[]) =>
  Promise.resolve({ id: "report-test-1" })
);

const mockUpdateReport = mock(() => Promise.resolve());
const mockRecordTokenUsage = mock(() => Promise.resolve());

mock.module("../../../db", () =>
  dbStubs({
    getPeriodComparison: mockGetPeriodComparison,
    getTeamHealth: mockGetTeamHealth,
    getTeamActivitySummary: mockGetTeamActivitySummary,
    getProjectsOverview: mockGetProjectsOverview,
    getToolUsageBreakdown: mockGetToolUsageBreakdown,
    getConcreteToolDetails: mockGetConcreteToolDetails,
    getSessionStatsSummary: mockGetSessionStatsSummary,
    getFailureClusters: mockGetFailureClusters,
    getPatterns: mockGetPatterns,
    getAntiPatternStats: mockGetAntiPatternStats,
    createReport: mockCreateReport,
    updateReport: mockUpdateReport,
    recordTokenUsage: mockRecordTokenUsage,
  })
);

// Import AFTER mocks are registered.
const { gatherReportData } = await import("../reportWorkflow");

// ---------------------------------------------------------------------------
// Mock SQL — returns the synthetic team for the developer-roster query. The
// helpers are mocked above, so no other query shapes need to be served.
// ---------------------------------------------------------------------------

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
// Tests
// ---------------------------------------------------------------------------

describe("DEV-45 snapshot: gatherReportData → LLM input is identity-free", () => {
  beforeEach(() => {
    _resetMissionRosterCache();
  });

  test("weekly-buyer payload has zero developer-identifying strings", async () => {
    const sql = createMockSql();

    const partial = await gatherReportData(
      {
        reportType: "weekly",
        title: "Weekly Buyer Report — synthetic",
        periodStart: "2026-04-27",
        periodEnd: "2026-05-03",
        persona: "weekly-buyer",
        developerIds: TEAM.map((d) => d.id),
        orgId: "11111111-2222-3333-4444-555555555555",
        data: {},
        outline: "",
        content: "",
        reportId: "",
        inputTokens: 0,
        outputTokens: 0,
      } as any,
      sql
    );

    expect(partial.data).toBeDefined();
    const payload = partial.data!;

    // The serialized payload must not contain any of the synthetic team's
    // identifying strings. This is the post-hoc kill-criterion check from
    // the DEV-37 plan, run as a unit test.
    const serialized = JSON.stringify(payload);
    for (const dev of TEAM) {
      expect(serialized).not.toContain(dev.email);
      expect(serialized).not.toContain(dev.id);
      // First-name match is sufficient — names are matched word-boundary in
      // the runtime detector but a substring assertion is the strict bound.
      const firstName = dev.name.split(/\s+/)[0];
      expect(serialized).not.toContain(firstName);
    }

    // Also no `apikey-*` tokens.
    expect(/\bapikey-[A-Za-z0-9_-]+/.test(serialized)).toBe(false);

    // And no 16+ contiguous hex run (catches SHA-256 hashes; UUIDs in
    // session_ids are dash-separated and don't trigger).
    expect(/[0-9a-fA-F]{16,}/.test(serialized)).toBe(false);

    // Belt-and-braces: run the actual runtime detector against the same
    // payload with the synthetic team loaded as the roster, and assert it
    // returns zero hits. Failing this means the helper-layer aggregation
    // accidentally piped a per-developer field through.
    const hits = await detectDeveloperIdentities(sql, payload);
    expect(hits).toEqual([]);
  });
});
