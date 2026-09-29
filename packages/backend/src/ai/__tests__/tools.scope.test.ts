import { describe, expect, mock, test } from "bun:test";
import { dbStubs } from "../../__test_helpers__/mockStubs";

const mockConcrete = mock(() => Promise.resolve({ topFiles: [] }));
const mockClusters = mock(() => Promise.resolve([]));
const mockActivity = mock(() => Promise.resolve([]));
const mockProjects = mock(() => Promise.resolve([]));
const secret = { top_details: { files: ["/secret/path.ts"] } };
const mockPatterns = mock((_sql: unknown, _orgId: string, _opts: unknown) =>
  Promise.resolve([{ id: "p", name: "n", data_context: secret }] as any[]));
const mockPatternStats = mock((_sql: unknown, _orgId: string, _days: number) =>
  Promise.resolve({ total_patterns: 1, top_patterns: [{ id: "p", data_context: secret }] } as any));
const mockAntiPatterns = mock((_sql: unknown, _orgId: string, _opts: unknown) =>
  Promise.resolve([{ id: "ap", data_context: secret }] as any[]));
const mockAntiPatternStats = mock((_sql: unknown, _orgId: string, _days: number) =>
  Promise.resolve({ total_anti_patterns: 1, top_anti_patterns: [{ id: "ap", data_context: secret }] } as any));

mock.module("../../db", () =>
  dbStubs({
    getConcreteToolDetails: mockConcrete,
    getFailureClusters: mockClusters,
    getDeveloperActivityOverTime: mockActivity,
    getProjectsOverview: mockProjects,
    getPatterns: mockPatterns,
    getPatternStats: mockPatternStats,
    getAntiPatterns: mockAntiPatterns,
    getAntiPatternStats: mockAntiPatternStats,
  }),
);

const { findTool } = await import("../tools");

const scope = { orgDevIds: ["me", "open", "closed"], viewerDevIds: ["me"], searchableDevIds: ["me", "open"], orgId: "org-a" };
const run = (name: string, args: Record<string, unknown> = {}) => findTool(name)!.execute({} as any, args, scope);
const runWith = (name: string, sc: any, args: Record<string, unknown> = {}) => findTool(name)!.execute({} as any, args, sc);

describe("AI chat tool scoping", () => {
  test("per-developer breakdowns are self-only", async () => {
    mockActivity.mockClear();
    expect(JSON.parse(await run("getDeveloperActivityOverTime", { developerId: "closed" })).error).toBeDefined();
    expect(mockActivity).not.toHaveBeenCalled();

    await run("getDeveloperActivityOverTime", { developerId: "me" });
    expect(mockActivity).toHaveBeenCalledTimes(1);
  });

  test("file paths and commands only come from own and opted-in developers", async () => {
    mockConcrete.mockClear();
    await run("getConcreteToolDetails");
    expect((mockConcrete.mock.calls[0] as any[])[2]).toEqual(["me", "open"]);
  });

  test("failure clusters (error text) only come from own and opted-in developers", async () => {
    mockClusters.mockClear();
    await run("getFailureClusters");
    expect((mockClusters.mock.calls[0] as any[])[2]).toEqual(["me", "open"]);
  });

  test("project tools name projects as this viewer may see them", async () => {
    mockProjects.mockClear();
    await run("getProjectsOverview");
    const args = mockProjects.mock.calls[0] as any[];
    expect(args[2]).toEqual(["me", "open", "closed"]);
    expect(args[3]).toEqual(["me"]);
  });

  test("pattern and anti-pattern tools read the caller's org and never return data_context", async () => {
    for (const m of [mockPatterns, mockPatternStats, mockAntiPatterns, mockAntiPatternStats]) m.mockClear();

    const out = [
      await run("getSessionPatterns", { effectiveness: "effective" }),
      await run("getSessionPatterns"),
      await run("getAntiPatternData", { severity: "critical" }),
      await run("getAntiPatternData"),
    ];

    for (const m of [mockPatterns, mockPatternStats, mockAntiPatterns, mockAntiPatternStats]) {
      expect(m).toHaveBeenCalledTimes(1);
      expect((m.mock.calls[0] as any[])[1]).toBe("org-a");
    }
    for (const o of out) expect(o).not.toContain("/secret/path.ts");
  });

  test("pattern tools fail closed without an org", async () => {
    for (const m of [mockPatterns, mockPatternStats, mockAntiPatterns, mockAntiPatternStats]) m.mockClear();
    const noOrg = { ...scope, orgId: undefined };

    expect(JSON.parse(await runWith("getSessionPatterns", noOrg)).error).toBeDefined();
    expect(JSON.parse(await runWith("getAntiPatternData", noOrg)).error).toBeDefined();
    for (const m of [mockPatterns, mockPatternStats, mockAntiPatterns, mockAntiPatternStats]) {
      expect(m).not.toHaveBeenCalled();
    }
  });
});
