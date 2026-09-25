import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { dbStubs, developerLinkStubs } from "../../__test_helpers__/mockStubs";

const mockSearchTurns = mock(() => Promise.resolve([] as any[]));
const mockSearchSessions = mock(() => Promise.resolve([] as any[] | null));
const mockInOrg = mock(() => Promise.resolve(true));
const mockSearchErrors = mock(() => Promise.resolve([] as any[]));
const mockChains = mock(() => Promise.resolve([] as any[]));
const mockSharing = mock(() => Promise.resolve([] as string[]));

mock.module("../../db", () =>
  dbStubs({
    searchSimilarTurns: mockSearchTurns,
    searchSimilarSessions: mockSearchSessions,
    isSessionInOrg: mockInOrg,
    searchSimilarErrors: mockSearchErrors,
    getSkillChains: mockChains,
    getSharingDeveloperIds: mockSharing,
  }),
);

const mockOwn = mock(() => Promise.resolve(["dev-a"] as string[]));
mock.module("../../services/developerLink", () => developerLinkStubs({ getAllDeveloperIdsForUser: mockOwn }));

let available = true;
const mockEmbedDocs = mock(() => Promise.resolve([[0.5, 0.5]] as number[][] | null));
const mockEmbedQuery = mock(() => Promise.resolve([0.1, 0.2] as number[] | null));

mock.module("../../ai/embeddings", () => ({
  EMBEDDING_MODEL: "test-model",
  EMBEDDING_DIM: 1024,
  isEmbeddingAvailable: () => available,
  embedQuery: mockEmbedQuery,
  embedDocuments: mockEmbedDocs,
  preparePromptText: (t: string) => t,
  prepareErrorText: (tool: string, msg: string) => `${tool}: ${msg}`,
  prepareResponseText: (t: string) => t,
  contentHash: () => "h",
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

const { similarRoutes } = await import("../similar");

function buildApp(devIds: string[] = ["dev-a"]) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("orgDeveloperIds" as never, devIds as never);
    c.set("user" as never, { id: "user-1" } as never);
    await next();
  });
  app.route("/similar", similarRoutes({} as any));
  return app;
}

const turnRow = {
  turn_id: "42",
  session_id: "s1",
  prompt_at: "2026-01-01T00:00:00Z",
  prompt_text: "fix the auth test",
  response_text: "fixed",
  tool_calls: 3,
  tool_failures: 1,
  tools_used: ["Bash"],
  duration_ms: 1000,
  session_title: "Auth fix",
  session_intent: "debug",
  project_name: "proj",
  similarity: 0.93,
};

beforeEach(() => {
  available = true;
  mockSearchTurns.mockClear();
  mockSearchSessions.mockClear();
  mockEmbedQuery.mockClear();
  mockEmbedQuery.mockImplementation(() => Promise.resolve([0.1, 0.2]));
  mockInOrg.mockImplementation(() => Promise.resolve(true));
  mockSharing.mockImplementation(() => Promise.resolve([]));
});

describe("GET /similar/prompts", () => {
  test("embeds the query and returns org-scoped, attribution-free results", async () => {
    mockSearchTurns.mockImplementation(() => Promise.resolve([turnRow]));
    mockSharing.mockImplementation(() => Promise.resolve(["dev-b"]));
    const res = await buildApp(["dev-a", "dev-b"]).request("/similar/prompts?q=auth%20test&limit=5");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.results[0]).toMatchObject({
      turnId: "42",
      sessionId: "s1",
      promptText: "fix the auth test",
      outcome: { toolCalls: 3, toolFailures: 1, toolsUsed: ["Bash"], durationMs: 1000 },
      similarity: 0.93,
    });
    expect(JSON.stringify(body)).not.toContain("developer");
    const call = (mockSearchTurns.mock.calls[0] as any[])[1];
    expect(call).toMatchObject({ devIds: ["dev-a", "dev-b"], kind: "prompt", limit: 5, vector: "[0.1,0.2]" });
  });

  test("searches only the caller and teammates who opted in to sharing", async () => {
    const res = await buildApp(["dev-a", "dev-b", "dev-c"]).request("/similar/prompts?q=auth");
    expect(res.status).toBe(200);
    expect((mockSearchTurns.mock.calls.at(-1) as any[])[1].devIds).toEqual(["dev-a"]);
  });

  test.each([
    ["missing q", "/similar/prompts"],
    ["blank q", "/similar/prompts?q=%20%20"],
    ["bad kind", "/similar/prompts?q=x&kind=secrets"],
    ["limit too high", "/similar/prompts?q=x&limit=500"],
    ["q too long", `/similar/prompts?q=${"x".repeat(8001)}`],
  ])("rejects %s with 400", async (_label, url) => {
    const res = await buildApp().request(url);
    expect(res.status).toBe(400);
    expect(mockEmbedQuery).not.toHaveBeenCalled();
  });

  test("503 when not configured", async () => {
    available = false;
    const res = await buildApp().request("/similar/prompts?q=x");
    expect(res.status).toBe(503);
  });

  test("503 when the embedder fails", async () => {
    mockEmbedQuery.mockImplementation(() => Promise.resolve(null));
    const res = await buildApp().request("/similar/prompts?q=x");
    expect(res.status).toBe(503);
    expect(mockSearchTurns).not.toHaveBeenCalled();
  });
});

describe("GET /similar/sessions/:id", () => {
  test("404 for a session outside the org", async () => {
    mockInOrg.mockImplementation(() => Promise.resolve(false));
    const res = await buildApp().request("/similar/sessions/foreign");
    expect(res.status).toBe(404);
    expect(mockSearchSessions).not.toHaveBeenCalled();
  });

  test("indexed:false when the session has no vector yet", async () => {
    mockSearchSessions.mockImplementation(() => Promise.resolve(null));
    const res = await buildApp().request("/similar/sessions/s1");
    expect(await res.json()).toEqual({ indexed: false, results: [] });
  });

  test("maps similar sessions", async () => {
    mockSearchSessions.mockImplementation(() =>
      Promise.resolve([
        {
          session_id: "s2",
          session_title: null,
          session_intent: "build",
          project_name: "proj",
          started_at: "2026-01-01T00:00:00Z",
          ended_at: "2026-01-01T01:00:00Z",
          estimated_cost_usd: "1.250000",
          turn_count: 4,
          tool_calls: 10,
          tool_failures: 2,
          similarity: 0.8,
        },
      ]),
    );
    const res = await buildApp().request("/similar/sessions/s1?limit=3");
    const body = await res.json();
    expect(body.indexed).toBe(true);
    expect(body.results[0]).toMatchObject({ sessionId: "s2", estimatedCostUsd: 1.25, turnCount: 4 });
  });
});


describe("POST /similar/preflight", () => {
  const post = (body: unknown, devIds?: string[]) =>
    buildApp(devIds).request("/similar/preflight", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
  const hit = (over: Record<string, unknown> = {}) => ({
    ...turnRow, prompt_at: "2026-09-12T10:00:00Z", response_tail: "Done, it deployed.", similarity: 0.94, ...over,
  });
  beforeEach(() => {
    mockEmbedDocs.mockImplementation(() => Promise.resolve([[0.5, 0.5]]));
    mockOwn.mockImplementation(() => Promise.resolve(["dev-a"]));
    mockSearchTurns.mockImplementation(() => Promise.resolve([hit()]));
  });

  test("returns a note for a strong match from the user's own sessions", async () => {
    const res = await post({ prompt: "deploy the android build to play", session_id: "cur" }, ["dev-a", "dev-b"]);
    const body = await res.json();
    expect(body.context).toContain("asked something very similar before");
    expect(body.repeat_days).toBe(1);
    const opts = (mockSearchTurns.mock.calls.at(-1) as any[])[1];
    expect(opts.devIds).toEqual(["dev-a"]);            // own sessions only, not teammates
    expect(opts.excludeSessionId).toBe("cur");
    expect(Date.parse(opts.before)).toBeLessThan(Date.now() - 3_500_000);
  });

  test("short prompts never trigger", async () => {
    mockSearchTurns.mockClear();
    const body = await (await post({ prompt: "yes go on", session_id: "cur" })).json();
    expect(body.context).toBeNull();
    expect(mockSearchTurns).not.toHaveBeenCalled();
  });

  test("weak matches give no note", async () => {
    mockSearchTurns.mockImplementation(() => Promise.resolve([hit({ similarity: 0.8 })]));
    expect((await (await post({ prompt: "deploy the android build to play", session_id: "cur" })).json()).context).toBeNull();
  });

  test("no own developer ids in the org gives nothing", async () => {
    mockOwn.mockImplementation(() => Promise.resolve(["someone-else"]));
    expect((await (await post({ prompt: "deploy the android build to play", session_id: "cur" })).json()).context).toBeNull();
  });

  test("fails open when the embedder or search fails", async () => {
    mockEmbedDocs.mockImplementation(() => Promise.resolve(null));
    const a = await post({ prompt: "deploy the android build to play", session_id: "cur" });
    expect(a.status).toBe(200);
    expect((await a.json()).context).toBeNull();
    mockEmbedDocs.mockImplementation(() => Promise.resolve([[0.5, 0.5]]));
    mockSearchTurns.mockImplementation(() => Promise.reject(new Error("db down")));
    const b = await post({ prompt: "deploy the android build to play", session_id: "cur" });
    expect(b.status).toBe(200);
    expect((await b.json()).context).toBeNull();
  });

  test("invalid body is rejected", async () => {
    expect((await post({ session_id: "cur" })).status).toBe(400);
  });
});

describe("POST /similar/error", () => {
  const post = (body: unknown, devIds?: string[]) =>
    buildApp(devIds).request("/similar/error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const errRow = {
    event_id: "e1",
    session_id: "old",
    created_at: "2026-07-01T10:00:00Z",
    tool: "Bash",
    message: "bun: command not found: tsc",
    similarity: 0.95,
    resolved: true,
    fix_input: "bun add -d typescript",
    session_title: "Build fix",
  };

  beforeEach(() => {
    mockSearchErrors.mockClear();
    mockEmbedDocs.mockClear();
    mockEmbedDocs.mockImplementation(() => Promise.resolve([[0.5, 0.5]]));
    mockOwn.mockImplementation(() => Promise.resolve(["dev-a"]));
  });

  test("searches own history, excluding this session, and returns a note", async () => {
    mockSearchErrors.mockImplementation(() => Promise.resolve([errRow]));
    const res = await post({ tool: "Bash", error: "bun: command not found: tsc", session_id: "cur" }, ["dev-a", "dev-b"]);
    const body = await res.json();
    expect((mockEmbedDocs.mock.calls[0] as any[])[0]).toEqual(["Bash: bun: command not found: tsc"]);
    expect((mockSearchErrors.mock.calls[0] as any[])[1]).toMatchObject({ devIds: ["dev-a"], excludeSessionId: "cur" });
    expect(body.matches).toHaveLength(1);
    expect(body.context).toContain("bun add -d typescript");
  });

  test("fails open when the embedder is down or nothing is close", async () => {
    mockEmbedDocs.mockImplementation(() => Promise.resolve(null));
    expect(await (await post({ tool: "Bash", error: "boom boom", session_id: "s" })).json()).toEqual({ matches: [], context: null });
    mockEmbedDocs.mockImplementation(() => Promise.resolve([[1]]));
    mockSearchErrors.mockImplementation(() => Promise.resolve([{ ...errRow, similarity: 0.5 }]));
    expect((await (await post({ tool: "Bash", error: "boom boom", session_id: "s" })).json()).context).toBeNull();
  });

  test("returns nothing for a caller with no developer in the org", async () => {
    mockOwn.mockImplementation(() => Promise.resolve(["dev-x"]));
    const body = await (await post({ tool: "Bash", error: "boom boom", session_id: "s" })).json();
    expect(body.context).toBeNull();
    expect(mockSearchErrors).not.toHaveBeenCalled();
  });

  test("rejects a malformed body", async () => {
    expect((await post({ tool: "Bash" })).status).toBe(400);
  });
});

describe("GET /similar/skill-chains", () => {
  test("returns the caller's own chains", async () => {
    mockOwn.mockImplementation(() => Promise.resolve(["dev-a"]));
    mockChains.mockImplementation(() => Promise.resolve([{ from: "ship", to: "code-review", count: 5, share: 0.5 }]));
    const res = await buildApp(["dev-a", "dev-b"]).request("/similar/skill-chains");
    expect(await res.json()).toEqual({ chains: [{ from: "ship", to: "code-review", count: 5, share: 0.5 }] });
    expect((mockChains.mock.calls[0] as any[])[1]).toEqual(["dev-a"]);
  });
});
