import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { dbStubs } from "../../__test_helpers__/mockStubs";

const mockSearchTurns = mock(() => Promise.resolve([] as any[]));
const mockSearchSessions = mock(() => Promise.resolve([] as any[] | null));
const mockInOrg = mock(() => Promise.resolve(true));

mock.module("../../db", () =>
  dbStubs({
    searchSimilarTurns: mockSearchTurns,
    searchSimilarSessions: mockSearchSessions,
    isSessionInOrg: mockInOrg,
  }),
);

let available = true;
const mockEmbedQuery = mock(() => Promise.resolve([0.1, 0.2] as number[] | null));

mock.module("../../ai/embeddings", () => ({
  EMBEDDING_MODEL: "test-model",
  EMBEDDING_DIM: 1024,
  isEmbeddingAvailable: () => available,
  embedQuery: mockEmbedQuery,
  embedDocuments: mock(() => Promise.resolve(null)),
  preparePromptText: (t: string) => t,
  prepareResponseText: (t: string) => t,
  contentHash: () => "h",
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

const { similarRoutes } = await import("../similar");

function buildApp(devIds: string[] = ["dev-a"]) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("orgDeveloperIds" as never, devIds as never);
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
});

describe("GET /similar/prompts", () => {
  test("embeds the query and returns org-scoped, attribution-free results", async () => {
    mockSearchTurns.mockImplementation(() => Promise.resolve([turnRow]));
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
