import { beforeEach, describe, expect, mock, test } from "bun:test";
import { wsHandlerStubs } from "../../__test_helpers__/mockStubs";

process.env.PATTERN_ANALYSIS_SCHEDULE = "0";

const mockBroadcast = mock((_msg: unknown) => {});
const mockBroadcastToOrg = mock((_orgId: string, _msg: any) => {});
mock.module("../../ws/handler", () =>
  wsHandlerStubs({ broadcast: mockBroadcast, broadcastToOrg: mockBroadcastToOrg }),
);

const realGemini = await import("../../ai/gemini");
mock.module("../../ai/gemini", () => ({ ...realGemini, isAiAvailable: () => true }));

const mockPatterns = mock((_sql: unknown, orgId: string, _days: number) =>
  Promise.resolve([{ id: `p-${orgId}`, data_context: { top_details: { files: ["/secret.ts"] } } }] as any[]));
const mockAnti = mock((_sql: unknown, orgId: string, _days: number) =>
  Promise.resolve([{ id: `ap-${orgId}`, data_context: {} }] as any[]));
const mockPlaybooks = mock((_sql: unknown, orgId: string) => Promise.resolve([{ id: `pb-${orgId}` }] as any[]));
const mockHallucinated = mock((_sql: unknown, _orgId: string, _days: number) => Promise.resolve(0));
mock.module("../../ai/workflows/patternWorkflow", () => ({
  createPatternWorkflow: mock(() => ({})),
  runPatternWorkflow: mockPatterns,
}));
mock.module("../../ai/workflows/antiPatternWorkflow", () => ({
  createAntiPatternWorkflow: mock(() => ({})),
  runAntiPatternWorkflow: mockAnti,
}));
mock.module("../../ai/workflows/playbookWorkflow", () => ({
  createPlaybookWorkflow: mock(() => ({})),
  runPlaybookWorkflow: mockPlaybooks,
}));
mock.module("../../ai/workflows/hallucinatedSuccessWorkflow", () => ({
  runHallucinatedSuccessDetection: mockHallucinated,
}));
const mockSkillGen = mock((_sql: unknown, orgId: string) => Promise.resolve([{ id: `sk-${orgId}` }] as any[]));
mock.module("../../ai/workflows/skillGenerationWorkflow", () => ({
  createSkillGenerationWorkflow: mock(() => ({})),
  runSkillGenerationWorkflow: mockSkillGen,
}));
mock.module("../../ai/workflows/skillRefinementWorkflow", () => ({
  createSkillRefinementWorkflow: mock(() => ({})),
  runSkillRefinementWorkflow: mock(() => Promise.resolve(null)),
}));
const realTeamSkills = await import("../../db/teamSkillQueries");
mock.module("../../db/teamSkillQueries", () => ({
  ...realTeamSkills,
  getTeamSkills: mock(() => Promise.resolve([])),
}));

const { startPatternAnalysis } = await import("../patternAnalysis");

const fakeSql = (() =>
  Promise.resolve([{ organization_id: "org-a" }, { organization_id: "org-b" }])) as any;

async function runCheckOnce(monday: boolean) {
  const g = globalThis as any;
  const realSetInterval = globalThis.setInterval;
  let tick: (() => Promise<void>) | undefined;
  (globalThis as any).setInterval = ((fn: () => Promise<void>) => { tick = fn; return 0; }) as any;
  const RealDate = Date;
  if (monday) {
    // 2026-09-28 is a Monday: also triggers the weekly playbook + skill pass
    const fixed = new RealDate("2026-09-28T12:00:00Z").getTime();
    (globalThis as any).Date = class extends RealDate {
      constructor(...a: any[]) { super((a.length ? a[0] : fixed) as any); }
      static now() { return fixed; }
    };
  }
  try {
    startPatternAnalysis(fakeSql);
    await tick!();
  } finally {
    globalThis.setInterval = realSetInterval;
    (globalThis as any).Date = RealDate;
    clearInterval(g.__gc_pattern_analysis_interval);
  }
}

beforeEach(() => {
  for (const m of [mockBroadcast, mockBroadcastToOrg, mockPatterns, mockAnti, mockPlaybooks, mockHallucinated, mockSkillGen]) m.mockClear();
});

describe("pattern analysis job", () => {
  test("runs each workflow once per org and broadcasts only to that org", async () => {
    await runCheckOnce(true);

    expect(mockPatterns.mock.calls.map((c) => c[1])).toEqual(["org-a", "org-b"]);
    expect(mockAnti.mock.calls.map((c) => c[1])).toEqual(["org-a", "org-b"]);
    expect(mockHallucinated.mock.calls.map((c) => c[1])).toEqual(["org-a", "org-b"]);
    expect(mockPlaybooks.mock.calls.map((c) => c[1])).toEqual(["org-a", "org-b"]);

    // Never a global broadcast
    expect(mockBroadcast).not.toHaveBeenCalled();

    const sent = mockBroadcastToOrg.mock.calls.map(([orgId, msg]) => `${orgId}:${msg.type}:${msg.data.id}`);
    expect(sent).toContain("org-a:ai.pattern.new:p-org-a");
    expect(sent).toContain("org-b:ai.antipattern.new:ap-org-b");
    expect(sent).toContain("org-a:ai.playbook.new:pb-org-a");
    expect(sent).toContain("org-b:ai.skill.new:sk-org-b");
    // An org never receives another org's rows
    expect(sent.filter((s) => s.startsWith("org-a:") && s.includes("org-b")).length).toBe(0);
    expect(sent.filter((s) => s.startsWith("org-b:") && s.includes("org-a")).length).toBe(0);
  });

  test("mined file paths (data_context) are not pushed to clients", async () => {
    await runCheckOnce(false);
    const payloads = mockBroadcastToOrg.mock.calls.map(([, msg]) => JSON.stringify(msg));
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) expect(p).not.toContain("/secret.ts");
  });
});
