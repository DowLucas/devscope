import { describe, expect, test, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Mocks — must be set up BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockGetAllSessions = mock(() => Promise.resolve([] as any[]));
const mockGetActiveSessions = mock(() => Promise.resolve([] as any[]));
const mockGetActiveAgents = mock(() => Promise.resolve([] as any[]));
const mockGetSessionDetail = mock(() => Promise.resolve(null as any));
const mockGetSessionTitleHistory = mock(() => Promise.resolve([] as any[]));

mock.module("../../db", () => ({
  getAllSessions: mockGetAllSessions,
  getActiveSessions: mockGetActiveSessions,
  getActiveAgents: mockGetActiveAgents,
  getSessionDetail: mockGetSessionDetail,
  getSessionTitleHistory: mockGetSessionTitleHistory,
}));

const mockGetDeveloperIdForUser = mock(() => Promise.resolve(null as string | null));

mock.module("../../services/developerLink", () => ({
  getDeveloperIdForUser: mockGetDeveloperIdForUser,
}));

const mockStripSensitivePayload = mock((payload: Record<string, unknown>) => {
  const stripped = { ...payload };
  delete stripped.promptText;
  delete stripped.toolInput;
  delete stripped.responseText;
  return stripped;
});

mock.module("../../utils/stripSensitiveFields", () => ({
  stripSensitivePayload: mockStripSensitivePayload,
}));

// Import AFTER mocks are registered
const { sessionsRoutes } = await import("../sessions");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fake sql object — the real queries are mocked, so this is just passed through. */
const fakeSql = {} as any;

/**
 * Build a test Hono app that injects context variables (orgDeveloperIds, user)
 * via middleware, then mounts the sessions routes.
 */
function buildApp(opts: { orgDeveloperIds?: string[]; user?: any } = {}) {
  const app = new Hono();

  // Middleware to inject context vars the routes expect
  app.use("/sessions/*", async (c, next) => {
    if (opts.orgDeveloperIds !== undefined) {
      c.set("orgDeveloperIds" as never, opts.orgDeveloperIds as never);
    }
    if (opts.user !== undefined) {
      c.set("user" as never, opts.user as never);
    }
    await next();
  });

  app.route("/sessions", sessionsRoutes(fakeSql));
  return app;
}

/** Make a session row in the snake_case shape returned by DB queries. */
function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    developer_id: "dev-aaa",
    project_path: "/home/user/project",
    project_name: "my-project",
    started_at: "2026-03-01T10:00:00Z",
    ended_at: null,
    status: "active",
    permission_mode: "default",
    developer_name: "Alice",
    developer_email: "alice@example.com",
    event_count: 5,
    context_clear_count: 1,
    current_title: "Fixing auth bug",
    ...overrides,
  };
}

/** Make an event row as returned by DB queries. */
function makeEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    event_type: "tool.use",
    payload: { toolName: "Read", promptText: "secret prompt", toolInput: "secret input" },
    created_at: "2026-03-01T10:01:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGetAllSessions.mockReset();
  mockGetActiveSessions.mockReset();
  mockGetActiveAgents.mockReset();
  mockGetSessionDetail.mockReset();
  mockGetSessionTitleHistory.mockReset();
  mockGetDeveloperIdForUser.mockReset();
  mockStripSensitivePayload.mockReset();

  // Restore default implementations
  mockGetAllSessions.mockImplementation(() => Promise.resolve([]));
  mockGetActiveSessions.mockImplementation(() => Promise.resolve([]));
  mockGetActiveAgents.mockImplementation(() => Promise.resolve([]));
  mockGetSessionDetail.mockImplementation(() => Promise.resolve(null));
  mockGetSessionTitleHistory.mockImplementation(() => Promise.resolve([]));
  mockGetDeveloperIdForUser.mockImplementation(() => Promise.resolve(null));
  mockStripSensitivePayload.mockImplementation((payload: Record<string, unknown>) => {
    const stripped = { ...payload };
    delete stripped.promptText;
    delete stripped.toolInput;
    delete stripped.responseText;
    return stripped;
  });
});

// ---------------------------------------------------------------------------
// GET /sessions (getAllSessions)
// ---------------------------------------------------------------------------

describe("GET /sessions", () => {
  test("returns empty array when no sessions exist", async () => {
    const app = buildApp({ orgDeveloperIds: ["dev-aaa"] });
    const res = await app.request("/sessions");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("returns mapped sessions with camelCase keys", async () => {
    const row = makeSessionRow();
    mockGetAllSessions.mockImplementation(() => Promise.resolve([row]));

    const app = buildApp({ orgDeveloperIds: ["dev-aaa"] });
    const res = await app.request("/sessions");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      id: "sess-1",
      developerId: "dev-aaa",
      projectPath: "/home/user/project",
      projectName: "my-project",
      startedAt: "2026-03-01T10:00:00Z",
      endedAt: null,
      status: "active",
      permissionMode: "default",
      privacyMode: null,
      developerName: "Alice",
      developerEmail: "alice@example.com",
      eventCount: 5,
      contextClearCount: 1,
      currentTitle: "Fixing auth bug",
    });
  });

  test("passes orgDeveloperIds to getAllSessions", async () => {
    const devIds = ["dev-aaa", "dev-bbb"];
    const app = buildApp({ orgDeveloperIds: devIds });
    await app.request("/sessions");

    expect(mockGetAllSessions).toHaveBeenCalledWith(fakeSql, 50, devIds);
  });

  test("uses default limit of 50", async () => {
    const app = buildApp();
    await app.request("/sessions");

    expect(mockGetAllSessions).toHaveBeenCalledWith(fakeSql, 50, undefined);
  });

  test("respects custom limit query param", async () => {
    const app = buildApp();
    await app.request("/sessions?limit=10");

    expect(mockGetAllSessions).toHaveBeenCalledWith(fakeSql, 10, undefined);
  });

  test("clamps limit to max 500", async () => {
    const app = buildApp();
    await app.request("/sessions?limit=9999");

    expect(mockGetAllSessions).toHaveBeenCalledWith(fakeSql, 500, undefined);
  });

  test("uses default limit for invalid limit value", async () => {
    const app = buildApp();
    await app.request("/sessions?limit=abc");

    expect(mockGetAllSessions).toHaveBeenCalledWith(fakeSql, 50, undefined);
  });

  test("defaults contextClearCount to 0 when missing", async () => {
    const row = makeSessionRow({ context_clear_count: undefined });
    mockGetAllSessions.mockImplementation(() => Promise.resolve([row]));

    const app = buildApp();
    const res = await app.request("/sessions");
    const body = await res.json();

    expect(body[0].contextClearCount).toBe(0);
  });

  test("defaults currentTitle to null when missing", async () => {
    const row = makeSessionRow({ current_title: undefined });
    mockGetAllSessions.mockImplementation(() => Promise.resolve([row]));

    const app = buildApp();
    const res = await app.request("/sessions");
    const body = await res.json();

    expect(body[0].currentTitle).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /sessions/active
// ---------------------------------------------------------------------------

describe("GET /sessions/active", () => {
  test("returns empty array when no active sessions", async () => {
    const app = buildApp({ orgDeveloperIds: ["dev-aaa"] });
    const res = await app.request("/sessions/active");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("returns active sessions with empty activeAgents when no agents", async () => {
    const row = makeSessionRow({ status: "active" });
    mockGetActiveSessions.mockImplementation(() => Promise.resolve([row]));
    mockGetActiveAgents.mockImplementation(() => Promise.resolve([]));

    const app = buildApp({ orgDeveloperIds: ["dev-aaa"] });
    const res = await app.request("/sessions/active");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].activeAgents).toEqual([]);
    expect(body[0].id).toBe("sess-1");
  });

  test("groups agents by session ID", async () => {
    const sess1 = makeSessionRow({ id: "sess-1" });
    const sess2 = makeSessionRow({ id: "sess-2", developer_id: "dev-bbb" });
    mockGetActiveSessions.mockImplementation(() => Promise.resolve([sess1, sess2]));

    const agents = [
      { agent_id: "agent-1", agent_type: "sub", session_id: "sess-1", started_at: "2026-03-01T10:05:00Z" },
      { agent_id: "agent-2", agent_type: "main", session_id: "sess-1", started_at: "2026-03-01T10:06:00Z" },
      { agent_id: "agent-3", agent_type: "sub", session_id: "sess-2", started_at: "2026-03-01T10:07:00Z" },
    ];
    mockGetActiveAgents.mockImplementation(() => Promise.resolve(agents));

    const app = buildApp({ orgDeveloperIds: ["dev-aaa", "dev-bbb"] });
    const res = await app.request("/sessions/active");
    const body = await res.json();

    expect(body).toHaveLength(2);

    // sess-1 should have 2 agents
    const s1 = body.find((s: any) => s.id === "sess-1");
    expect(s1.activeAgents).toHaveLength(2);
    expect(s1.activeAgents[0]).toEqual({
      agentId: "agent-1",
      agentType: "sub",
      sessionId: "sess-1",
      startedAt: "2026-03-01T10:05:00Z",
    });

    // sess-2 should have 1 agent
    const s2 = body.find((s: any) => s.id === "sess-2");
    expect(s2.activeAgents).toHaveLength(1);
    expect(s2.activeAgents[0].agentId).toBe("agent-3");
  });

  test("passes orgDeveloperIds to getActiveSessions", async () => {
    const devIds = ["dev-aaa"];
    const app = buildApp({ orgDeveloperIds: devIds });
    await app.request("/sessions/active");

    expect(mockGetActiveSessions).toHaveBeenCalledWith(fakeSql, devIds);
  });
});

// ---------------------------------------------------------------------------
// GET /sessions/:id (session detail)
// ---------------------------------------------------------------------------

describe("GET /sessions/:id", () => {
  test("returns 404 when session not found", async () => {
    mockGetSessionDetail.mockImplementation(() => Promise.resolve(null));

    const app = buildApp({ orgDeveloperIds: ["dev-aaa"] });
    const res = await app.request("/sessions/nonexistent");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Session not found" });
  });

  test("returns 404 when session developer not in orgDeveloperIds (access control)", async () => {
    const session = makeSessionRow({ developer_id: "dev-other" });
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events: [] })
    );

    // orgDeveloperIds does NOT include "dev-other"
    const app = buildApp({ orgDeveloperIds: ["dev-aaa", "dev-bbb"] });
    const res = await app.request("/sessions/sess-1");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Session not found" });
  });

  test("allows access when orgDeveloperIds is undefined (no org scope)", async () => {
    const session = makeSessionRow();
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events: [] })
    );

    // No orgDeveloperIds set
    const app = buildApp({ user: { id: "user-1" } });
    const res = await app.request("/sessions/sess-1");

    expect(res.status).toBe(200);
  });

  test("allows access when orgDeveloperIds is empty (no org scope filtering)", async () => {
    const session = makeSessionRow();
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events: [] })
    );

    const app = buildApp({ orgDeveloperIds: [], user: { id: "user-1" } });
    const res = await app.request("/sessions/sess-1");

    expect(res.status).toBe(200);
  });

  test("returns session detail with mapped session when developer is in org", async () => {
    const session = makeSessionRow({ developer_id: "dev-aaa" });
    const event = makeEventRow();
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events: [event] })
    );

    const app = buildApp({ orgDeveloperIds: ["dev-aaa"], user: { id: "user-1" } });
    const res = await app.request("/sessions/sess-1");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session.developerId).toBe("dev-aaa");
    expect(body.session.projectName).toBe("my-project");
    expect(body.events).toHaveLength(1);
    expect(body.events[0].id).toBe("evt-1");
    expect(body.events[0].event_type).toBe("tool.use");
  });

  // -----------------------------------------------------------------------
  // Self-view vs non-self-view
  // -----------------------------------------------------------------------

  test("self-view: payload is NOT stripped when viewer is the session developer", async () => {
    const session = makeSessionRow({ developer_id: "dev-aaa" });
    const event = makeEventRow({
      payload: { toolName: "Read", promptText: "secret prompt", toolInput: "secret input" },
    });
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events: [event] })
    );
    mockGetDeveloperIdForUser.mockImplementation(() => Promise.resolve("dev-aaa"));

    const app = buildApp({ orgDeveloperIds: ["dev-aaa"], user: { id: "user-1" } });
    const res = await app.request("/sessions/sess-1");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isSelfView).toBe(true);
    // Payload should contain sensitive fields (not stripped)
    expect(body.events[0].payload.promptText).toBe("secret prompt");
    expect(body.events[0].payload.toolInput).toBe("secret input");
    // stripSensitivePayload should NOT have been called
    expect(mockStripSensitivePayload).not.toHaveBeenCalled();
  });

  test("non-self-view: payload IS stripped when viewer is a different developer", async () => {
    const session = makeSessionRow({ developer_id: "dev-aaa" });
    const event = makeEventRow({
      payload: { toolName: "Read", promptText: "secret prompt", toolInput: "secret input" },
    });
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events: [event] })
    );
    // Viewer is dev-bbb, session belongs to dev-aaa
    mockGetDeveloperIdForUser.mockImplementation(() => Promise.resolve("dev-bbb"));

    const app = buildApp({ orgDeveloperIds: ["dev-aaa", "dev-bbb"], user: { id: "user-2" } });
    const res = await app.request("/sessions/sess-1");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isSelfView).toBe(false);
    // Payload should have sensitive fields stripped
    expect(body.events[0].payload.promptText).toBeUndefined();
    expect(body.events[0].payload.toolInput).toBeUndefined();
    expect(body.events[0].payload.toolName).toBe("Read");
    expect(mockStripSensitivePayload).toHaveBeenCalledTimes(1);
  });

  test("non-self-view when viewer has no developer link (getDeveloperIdForUser returns null)", async () => {
    const session = makeSessionRow({ developer_id: "dev-aaa" });
    const event = makeEventRow({
      payload: { toolName: "Read", promptText: "secret" },
    });
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events: [event] })
    );
    mockGetDeveloperIdForUser.mockImplementation(() => Promise.resolve(null));

    const app = buildApp({ orgDeveloperIds: ["dev-aaa"], user: { id: "user-1" } });
    const res = await app.request("/sessions/sess-1");
    const body = await res.json();

    expect(body.isSelfView).toBe(false);
    expect(mockStripSensitivePayload).toHaveBeenCalled();
  });

  test("non-self-view when no user in context", async () => {
    const session = makeSessionRow({ developer_id: "dev-aaa" });
    const event = makeEventRow({
      payload: { toolName: "Read", promptText: "secret" },
    });
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events: [event] })
    );

    // No user set in context
    const app = buildApp({ orgDeveloperIds: ["dev-aaa"] });
    const res = await app.request("/sessions/sess-1");
    const body = await res.json();

    expect(body.isSelfView).toBe(false);
    expect(mockStripSensitivePayload).toHaveBeenCalled();
  });

  test("parses JSON string payloads", async () => {
    const session = makeSessionRow({ developer_id: "dev-aaa" });
    const event = makeEventRow({
      payload: JSON.stringify({ toolName: "Write", promptText: "hidden" }),
    });
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events: [event] })
    );
    mockGetDeveloperIdForUser.mockImplementation(() => Promise.resolve("dev-aaa"));

    const app = buildApp({ orgDeveloperIds: ["dev-aaa"], user: { id: "user-1" } });
    const res = await app.request("/sessions/sess-1");
    const body = await res.json();

    // Self-view: payload should be parsed and unstripped
    expect(body.events[0].payload.toolName).toBe("Write");
    expect(body.events[0].payload.promptText).toBe("hidden");
  });

  test("handles multiple events with mixed self/non-self stripping", async () => {
    const session = makeSessionRow({ developer_id: "dev-aaa" });
    const events = [
      makeEventRow({ id: "evt-1", payload: { toolName: "Read", promptText: "p1" } }),
      makeEventRow({ id: "evt-2", payload: { toolName: "Write", toolInput: "i2" } }),
    ];
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events })
    );
    // Non-self-view
    mockGetDeveloperIdForUser.mockImplementation(() => Promise.resolve("dev-bbb"));

    const app = buildApp({ orgDeveloperIds: ["dev-aaa", "dev-bbb"], user: { id: "user-2" } });
    const res = await app.request("/sessions/sess-1");
    const body = await res.json();

    expect(body.events).toHaveLength(2);
    // Both events should be stripped
    expect(mockStripSensitivePayload).toHaveBeenCalledTimes(2);
    expect(body.events[0].payload.promptText).toBeUndefined();
    expect(body.events[1].payload.toolInput).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GET /sessions/:id/titles
// ---------------------------------------------------------------------------

describe("GET /sessions/:id/titles", () => {
  test("returns 404 when session not found", async () => {
    mockGetSessionDetail.mockImplementation(() => Promise.resolve(null));

    const app = buildApp({ orgDeveloperIds: ["dev-aaa"] });
    const res = await app.request("/sessions/nonexistent/titles");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Session not found" });
  });

  test("returns 404 when session developer not in orgDeveloperIds", async () => {
    const session = makeSessionRow({ developer_id: "dev-other" });
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events: [] })
    );

    const app = buildApp({ orgDeveloperIds: ["dev-aaa"] });
    const res = await app.request("/sessions/sess-1/titles");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Session not found" });
  });

  test("returns empty array when no titles exist", async () => {
    const session = makeSessionRow({ developer_id: "dev-aaa" });
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events: [] })
    );
    mockGetSessionTitleHistory.mockImplementation(() => Promise.resolve([]));

    const app = buildApp({ orgDeveloperIds: ["dev-aaa"] });
    const res = await app.request("/sessions/sess-1/titles");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  test("returns mapped title history with camelCase keys", async () => {
    const session = makeSessionRow({ developer_id: "dev-aaa" });
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events: [] })
    );

    const titles = [
      { id: "t-1", session_id: "sess-1", title: "Initial title", generated_at: "2026-03-01T10:00:00Z" },
      { id: "t-2", session_id: "sess-1", title: "Updated title", generated_at: "2026-03-01T10:30:00Z" },
    ];
    mockGetSessionTitleHistory.mockImplementation(() => Promise.resolve(titles));

    const app = buildApp({ orgDeveloperIds: ["dev-aaa"] });
    const res = await app.request("/sessions/sess-1/titles");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({
      id: "t-1",
      sessionId: "sess-1",
      title: "Initial title",
      generatedAt: "2026-03-01T10:00:00Z",
    });
    expect(body[1]).toEqual({
      id: "t-2",
      sessionId: "sess-1",
      title: "Updated title",
      generatedAt: "2026-03-01T10:30:00Z",
    });
  });

  test("allows access when orgDeveloperIds is empty", async () => {
    const session = makeSessionRow({ developer_id: "dev-aaa" });
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events: [] })
    );
    mockGetSessionTitleHistory.mockImplementation(() => Promise.resolve([]));

    const app = buildApp({ orgDeveloperIds: [] });
    const res = await app.request("/sessions/sess-1/titles");

    expect(res.status).toBe(200);
  });

  test("passes correct session ID to getSessionTitleHistory", async () => {
    const session = makeSessionRow({ developer_id: "dev-aaa" });
    mockGetSessionDetail.mockImplementation(() =>
      Promise.resolve({ session, events: [] })
    );
    mockGetSessionTitleHistory.mockImplementation(() => Promise.resolve([]));

    const app = buildApp({ orgDeveloperIds: ["dev-aaa"] });
    await app.request("/sessions/my-session-id/titles");

    expect(mockGetSessionTitleHistory).toHaveBeenCalledWith(fakeSql, "my-session-id");
  });
});
