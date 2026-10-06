import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { dbStubs, developerLinkStubs } from "../../__test_helpers__/mockStubs";
import { __resetAllStuckState, setPendingNudge } from "../../services/sessionStuckState";

const mockSearchTurns = mock(() => Promise.resolve([] as any[]));
const mockSharing = mock(() => Promise.resolve([] as string[]));
mock.module("../../db", () =>
  dbStubs({ searchSimilarTurns: mockSearchTurns, getSharingDeveloperIds: mockSharing }),
);

const mockOwn = mock(() => Promise.resolve(["dev-a"] as string[]));
mock.module("../../services/developerLink", () => developerLinkStubs({ getAllDeveloperIdsForUser: mockOwn }));

const mockResolve = mock((_sql: unknown, id: string, devIds: string[]) =>
  Promise.resolve(
    devIds.includes("dev-a") && id === "cc-1"
      ? { id: "ds-1", privacy_mode: "standard" }
      : devIds.includes("dev-a") && id === "cc-private"
        ? { id: "ds-p", privacy_mode: "private" }
        : null,
  ),
);
const mockInsertLabel = mock(() => Promise.resolve());
const mockInsertVcs = mock(() => Promise.resolve());
const mockOpenPrs = mock(() => Promise.resolve(["https://github.com/o/r/pull/7"]));
const mockUpdateStatus = mock(() => Promise.resolve(1));
const mockNextIds = mock(() => Promise.resolve([] as Array<{ source_turn_id: string; turn_id: string }>));
const mockOpeningIds = mock(() => Promise.resolve([] as string[]));
const mockSuggestionRows = mock(() => Promise.resolve([] as any[]));
mock.module("../../db/liveQueries", () => ({
  LABEL_MATCH_SECONDS: 120,
  resolveOwnedSession: mockResolve,
  insertTurnLabel: mockInsertLabel,
  insertVcsLink: mockInsertVcs,
  getOpenPrRefs: mockOpenPrs,
  updatePrStatus: mockUpdateStatus,
  getNextTurnIds: mockNextIds,
  getOpeningTurnIds: mockOpeningIds,
  getTurnSuggestionRows: mockSuggestionRows,
}));

const mockGetTeamSkills = mock(() => Promise.resolve([] as any[]));
mock.module("../../db/teamSkillQueries", () => ({
  createTeamSkill: mock(async () => null),
  getTeamSkills: mockGetTeamSkills,
  getTeamSkillById: mock(async () => null),
  updateTeamSkill: mock(async () => null),
  archiveTeamSkill: mock(async () => false),
  approveTeamSkill: mock(async () => null),
  linkSkillToPattern: mock(async () => null),
  getSkillPatternLinks: mock(async () => []),
  getSkillVersionHistory: mock(async () => []),
  getOrgSkillStats: mock(async () => ({})),
  getActiveSkillNames: mock(async () => []),
}));

let available = true;
const mockEmbedDocs = mock(() => Promise.resolve([[0.5, 0.5]] as number[][] | null));
mock.module("../../ai/embeddings", () => ({
  EMBEDDING_MODEL: "test-model",
  EMBEDDING_DIM: 1024,
  isEmbeddingAvailable: () => available,
  embedQuery: mock(() => Promise.resolve([0.1])),
  embedDocuments: mockEmbedDocs,
  preparePromptText: (t: string) => t,
  prepareErrorText: (tool: string, msg: string) => `${tool}: ${msg}`,
  prepareResponseText: (t: string) => t,
  contentHash: () => "h",
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

const { liveRoutes } = await import("../live");

function buildApp(devIds: string[] = ["dev-a"]) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("orgDeveloperIds" as never, devIds as never);
    c.set("orgId" as never, "org-1" as never);
    c.set("user" as never, { id: "user-1" } as never);
    await next();
  });
  app.route("/live", liveRoutes({} as any));
  return app;
}

function post(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const row = (over: Record<string, unknown> = {}) => ({
  turn_id: "t2",
  prompt_text: "now run the tests",
  prompt_at: "2026-10-01T10:00:00Z",
  tool_calls: 4,
  tool_failures: 0,
  project_name: "proj",
  label: null,
  has_merged_pr: false,
  ...over,
});

beforeEach(() => {
  available = true;
  __resetAllStuckState();
  for (const m of [
    mockSearchTurns, mockSharing, mockOwn, mockResolve, mockInsertLabel, mockInsertVcs, mockOpenPrs,
    mockUpdateStatus, mockNextIds, mockOpeningIds, mockSuggestionRows, mockGetTeamSkills, mockEmbedDocs,
  ]) m.mockClear();
  mockOwn.mockImplementation(() => Promise.resolve(["dev-a"]));
  mockSearchTurns.mockImplementation(() => Promise.resolve([]));
  mockNextIds.mockImplementation(() => Promise.resolve([]));
  mockSuggestionRows.mockImplementation(() => Promise.resolve([]));
  mockEmbedDocs.mockImplementation(() => Promise.resolve([[0.5, 0.5]]));
});

describe("session ownership", () => {
  test("404 for a session the caller does not own, same as a missing one", async () => {
    const app = buildApp();
    for (const id of ["someone-elses", "missing"]) {
      const res = await post(app, "/live/labels", {
        session_id: id,
        turn_started_at: "2026-10-01T10:00:00Z",
        label: "up",
        source: "explicit",
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Session not found" });
    }
    expect(mockInsertLabel).not.toHaveBeenCalled();
  });

  test("resolves against the caller's own ids within the org only", async () => {
    mockOwn.mockImplementation(() => Promise.resolve(["dev-a", "dev-other-org"]));
    await buildApp(["dev-a", "dev-b"]).request("/live/nudge?session_id=cc-1");
    expect((mockResolve.mock.calls[0] as unknown[])[2]).toEqual(["dev-a"]);
  });

  test("private sessions are refused for labels, links and suggestions", async () => {
    const app = buildApp();
    const label = await post(app, "/live/labels", {
      session_id: "cc-private",
      turn_started_at: "2026-10-01T10:00:00Z",
      label: "down",
      source: "implicit",
    });
    const vcs = await post(app, "/live/vcs", { session_id: "cc-private", kind: "commit", ref: "abc1234" });
    const next = await post(app, "/live/next-prompts", { session_id: "cc-private", after: "fix it" });
    expect([label.status, vcs.status, next.status]).toEqual([404, 404, 404]);
  });

  test("the nudge works for private sessions (it carries no content)", async () => {
    setPendingNudge("ds-p", { rule: "repeated_failure", severity: "warning", message: "m" });
    const res = await buildApp().request("/live/nudge?session_id=cc-private");
    expect((await res.json()).nudge.rule).toBe("repeated_failure");
  });
});

describe("GET /team-skills", () => {
  test("active skills of the caller's org with rendered SKILL.md", async () => {
    mockGetTeamSkills.mockImplementation(() =>
      Promise.resolve([
        { id: "k1", name: "Release Checklist", description: "Ship safely", trigger_phrases: ["cut a release"], skill_body: "1. Tag" },
      ]),
    );
    const res = await buildApp().request("/live/team-skills");
    const body = await res.json();
    expect((mockGetTeamSkills.mock.calls[0] as unknown[])[1]).toBe("org-1");
    expect((mockGetTeamSkills.mock.calls[0] as unknown[])[2]).toEqual({ status: "active", limit: 100 });
    expect(body.skills[0]).toMatchObject({ id: "k1", name: "Release Checklist", triggerPhrases: ["cut a release"] });
    expect(body.skills[0].content).toContain("name: release-checklist");
    expect(body.skills[0].content).toContain("1. Tag");
  });

  test("fails open to an empty list", async () => {
    mockGetTeamSkills.mockImplementation(() => Promise.reject(new Error("db down")));
    expect(await (await buildApp().request("/live/team-skills")).json()).toEqual({ skills: [] });
  });
});

describe("GET /nudge", () => {
  test("takes the held nudge once", async () => {
    setPendingNudge("ds-1", { rule: "repeated_failure", severity: "warning", message: "Try reading the error" });
    const app = buildApp();
    const first = await (await app.request("/live/nudge?session_id=cc-1")).json();
    const second = await (await app.request("/live/nudge?session_id=cc-1")).json();
    expect(first).toEqual({ nudge: { rule: "repeated_failure", severity: "warning", message: "Try reading the error" } });
    expect(second).toEqual({ nudge: null });
  });

  test("400 without session_id", async () => {
    expect((await buildApp().request("/live/nudge")).status).toBe(400);
  });
});

describe("POST /next-prompts", () => {
  test("proposes the next turn of similar sessions, best first, without developer identity", async () => {
    mockSearchTurns.mockImplementation(() =>
      Promise.resolve([
        { turn_id: "s1", similarity: 0.9 },
        { turn_id: "s2", similarity: 0.85 },
        { turn_id: "s3", similarity: 0.5 },
      ]),
    );
    mockNextIds.mockImplementation(() =>
      Promise.resolve([
        { source_turn_id: "s1", turn_id: "n1" },
        { source_turn_id: "s2", turn_id: "n2" },
      ]),
    );
    mockSuggestionRows.mockImplementation(() =>
      Promise.resolve([row({ turn_id: "n1", prompt_text: "add a test" }), row({ turn_id: "n2", prompt_text: "commit it", label: "up" })]),
    );
    const res = await post(buildApp(), "/live/next-prompts", { session_id: "cc-1", after: "fix the auth bug" });
    const body = await res.json();
    // s3 is below the similarity floor and never looked up.
    expect((mockNextIds.mock.calls[0] as unknown[])[1]).toEqual(["s1", "s2"]);
    // The current DevScope session is excluded from the search.
    expect((mockSearchTurns.mock.calls[0] as any[])[1].excludeSessionId).toBe("ds-1");
    expect(body.suggestions.map((s: any) => s.text)).toEqual(["commit it", "add a test"]);
    // Only what the mod shows: a teammate's own label and session title stay on the server.
    expect(Object.keys(body.suggestions[0]).sort()).toEqual(["project", "text"]);
  });

  test("opening prompts of the project when there is no previous prompt", async () => {
    mockOpeningIds.mockImplementation(() => Promise.resolve(["o1", "o2"]));
    mockSuggestionRows.mockImplementation(() =>
      Promise.resolve([
        row({ turn_id: "o1", prompt_text: "older", prompt_at: "2026-09-01T00:00:00Z" }),
        row({ turn_id: "o2", prompt_text: "newer", prompt_at: "2026-10-01T00:00:00Z" }),
      ]),
    );
    const res = await post(buildApp(), "/live/next-prompts", { session_id: "cc-1", project: "proj", limit: 1 });
    expect((await res.json()).suggestions.map((s: any) => s.text)).toEqual(["newer"]);
    expect(mockEmbedDocs).not.toHaveBeenCalled();
  });

  test("empty without embeddings, on embed failure, and on errors", async () => {
    const app = buildApp();
    available = false;
    expect(await (await post(app, "/live/next-prompts", { session_id: "cc-1", after: "x" })).json()).toEqual({ suggestions: [] });
    available = true;
    mockEmbedDocs.mockImplementation(() => Promise.resolve(null));
    expect(await (await post(app, "/live/next-prompts", { session_id: "cc-1", after: "x" })).json()).toEqual({ suggestions: [] });
    mockEmbedDocs.mockImplementation(() => Promise.resolve([[1]]));
    mockSearchTurns.mockImplementation(() => Promise.reject(new Error("boom")));
    expect(await (await post(app, "/live/next-prompts", { session_id: "cc-1", after: "x" })).json()).toEqual({ suggestions: [] });
  });

  test("400 for an out-of-range limit", async () => {
    expect((await post(buildApp(), "/live/next-prompts", { session_id: "cc-1", limit: 9 })).status).toBe(400);
  });
});

describe("POST /labels", () => {
  test("stores the label against the DevScope session", async () => {
    const res = await post(buildApp(), "/live/labels", {
      session_id: "cc-1",
      turn_started_at: "2026-10-01T10:00:00+02:00",
      label: "partial",
      source: "explicit",
    });
    expect(await res.json()).toEqual({ ok: true });
    expect(mockInsertLabel.mock.calls[0]).toEqual([
      {},
      { sessionId: "ds-1", turnStartedAt: "2026-10-01T10:00:00+02:00", label: "partial", source: "explicit" },
    ] as any);
  });

  test("400 for an unknown label", async () => {
    const res = await post(buildApp(), "/live/labels", {
      session_id: "cc-1",
      turn_started_at: "2026-10-01T10:00:00Z",
      label: "great",
      source: "explicit",
    });
    expect(res.status).toBe(400);
  });
});

describe("VCS links", () => {
  test("records a commit and a PR", async () => {
    const app = buildApp();
    expect((await post(app, "/live/vcs", { session_id: "cc-1", kind: "commit", ref: "45b54fa" })).status).toBe(200);
    expect(
      (await post(app, "/live/vcs", {
        session_id: "cc-1",
        kind: "pr",
        ref: "https://github.com/o/r/pull/7",
        repo_remote: "git@github.com:o/r.git",
      })).status,
    ).toBe(200);
    expect((mockInsertVcs.mock.calls[1] as any[])[1]).toEqual({
      sessionId: "ds-1",
      kind: "pr",
      ref: "https://github.com/o/r/pull/7",
      repoRemote: "git@github.com:o/r.git",
    });
  });

  test("400 when the ref does not fit the kind", async () => {
    const app = buildApp();
    expect((await post(app, "/live/vcs", { session_id: "cc-1", kind: "commit", ref: "not-a-sha" })).status).toBe(400);
    expect((await post(app, "/live/vcs", { session_id: "cc-1", kind: "pr", ref: "pull/7" })).status).toBe(400);
  });

  test("open PRs are the caller's own", async () => {
    const res = await buildApp().request("/live/vcs/open-prs?repo_remote=git%40github.com%3Ao%2Fr.git");
    expect(await res.json()).toEqual({ prs: [{ ref: "https://github.com/o/r/pull/7" }] });
    expect(mockOpenPrs.mock.calls[0]).toEqual([{}, ["dev-a"], "git@github.com:o/r.git", 20] as any);
  });

  test("status update", async () => {
    const res = await post(buildApp(), "/live/vcs/status", {
      ref: "https://github.com/o/r/pull/7",
      state: "merged",
      merged_at: "2026-10-02T09:00:00Z",
    });
    expect(await res.json()).toEqual({ ok: true });
    expect((mockUpdateStatus.mock.calls[0] as any[])[2]).toEqual({
      ref: "https://github.com/o/r/pull/7",
      state: "merged",
      mergedAt: "2026-10-02T09:00:00Z",
      closedAt: null,
    });
  });

  test("open PRs fail open", async () => {
    mockOpenPrs.mockImplementation(() => Promise.reject(new Error("db down")));
    expect(await (await buildApp().request("/live/vcs/open-prs?repo_remote=x")).json()).toEqual({ prs: [] });
  });
});
