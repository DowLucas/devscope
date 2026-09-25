import { describe, expect, mock, test } from "bun:test";
import { dbStubs } from "../../__test_helpers__/mockStubs";

const mockConcrete = mock(() => Promise.resolve({ topFiles: [] }));
const mockClusters = mock(() => Promise.resolve([]));
const mockActivity = mock(() => Promise.resolve([]));
const mockProjects = mock(() => Promise.resolve([]));

mock.module("../../db", () =>
  dbStubs({
    getConcreteToolDetails: mockConcrete,
    getFailureClusters: mockClusters,
    getDeveloperActivityOverTime: mockActivity,
    getProjectsOverview: mockProjects,
  }),
);

const { findTool } = await import("../tools");

const scope = { orgDevIds: ["me", "open", "closed"], viewerDevIds: ["me"], searchableDevIds: ["me", "open"] };
const run = (name: string, args: Record<string, unknown> = {}) => findTool(name)!.execute({} as any, args, scope);

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
});
