import { describe, expect, test, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Mocks -- must be set up BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockUpsertDeveloper = mock(() => Promise.resolve());
const mockCreateSession = mock(() => Promise.resolve());
const mockEndSession = mock(() => Promise.resolve());
const mockInsertEvent = mock(() => Promise.resolve());
const mockGetRecentEvents = mock(() => Promise.resolve([] as any[]));
const mockCheckAlertThresholds = mock(() => Promise.resolve(null as any));

mock.module("../../db", () => ({
  upsertDeveloper: mockUpsertDeveloper,
  createSession: mockCreateSession,
  endSession: mockEndSession,
  insertEvent: mockInsertEvent,
  getRecentEvents: mockGetRecentEvents,
  checkAlertThresholds: mockCheckAlertThresholds,
}));

const mockBroadcastToOrg = mock(() => {});

mock.module("../../ws/handler", () => ({
  broadcastToOrg: mockBroadcastToOrg,
}));

const mockAutoLinkDeveloperToOrg = mock(() => Promise.resolve());

mock.module("../../services/developerLink", () => ({
  autoLinkDeveloperToOrg: mockAutoLinkDeveloperToOrg,
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
const { eventsRoutes } = await import("../events");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock sql tagged-template function that returns configurable results.
 *
 * The route calls sql as a tagged template in two places:
 * 1. `sql\`SELECT status FROM sessions WHERE id = ...\`` — session lookup
 * 2. `sql\`SELECT organization_id FROM organization_developer WHERE ...\`` — org lookup
 *
 * We use `_setSessionRows` and `_setOrgRows` to control results. The mock
 * dispatches based on the query text (checking for "sessions" or "organization_developer").
 */
function makeMockSql(
  sessionRows: unknown[] = [],
  orgRows: unknown[] = [],
) {
  let sRows = sessionRows;
  let oRows = orgRows;

  const fn = mock((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("sessions")) {
      return Promise.resolve(sRows);
    }
    if (query.includes("organization_developer")) {
      return Promise.resolve(oRows);
    }
    return Promise.resolve([]);
  });

  (fn as any)._setSessionRows = (r: unknown[]) => {
    sRows = r;
  };
  (fn as any)._setOrgRows = (r: unknown[]) => {
    oRows = r;
  };

  return fn as typeof fn & {
    _setSessionRows: (r: unknown[]) => void;
    _setOrgRows: (r: unknown[]) => void;
  };
}

/** A valid event body for POST / */
function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    timestamp: "2026-03-03T12:00:00Z",
    sessionId: "sess-1",
    developerId: "abc123def456",
    developerName: "Alice",
    developerEmail: "alice@example.com",
    projectPath: "/home/user/project",
    projectName: "my-project",
    eventType: "session.start",
    payload: {},
    ...overrides,
  };
}

/**
 * Build a Hono app that optionally sets apiKeyUserId and orgDeveloperIds
 * on context (mimicking auth + orgScope middleware), then mounts the events routes.
 */
function buildApp(
  sql: any,
  opts: { apiKeyUserId?: string; orgDeveloperIds?: string[] } = {},
) {
  const app = new Hono();

  app.use("/*", async (c, next) => {
    if (opts.apiKeyUserId !== undefined) {
      c.set("apiKeyUserId" as never, opts.apiKeyUserId as never);
    }
    if (opts.orgDeveloperIds !== undefined) {
      c.set("orgDeveloperIds" as never, opts.orgDeveloperIds as never);
    }
    await next();
  });

  app.route("/", eventsRoutes(sql));
  return app;
}

// ---------------------------------------------------------------------------
// POST / -- Event ingestion
// ---------------------------------------------------------------------------

describe("POST /events", () => {
  beforeEach(() => {
    mockUpsertDeveloper.mockReset();
    mockUpsertDeveloper.mockImplementation(() => Promise.resolve());
    mockCreateSession.mockReset();
    mockCreateSession.mockImplementation(() => Promise.resolve());
    mockEndSession.mockReset();
    mockEndSession.mockImplementation(() => Promise.resolve());
    mockInsertEvent.mockReset();
    mockInsertEvent.mockImplementation(() => Promise.resolve());
    mockCheckAlertThresholds.mockReset();
    mockCheckAlertThresholds.mockImplementation(() => Promise.resolve(null));
    mockBroadcastToOrg.mockReset();
    mockAutoLinkDeveloperToOrg.mockReset();
    mockAutoLinkDeveloperToOrg.mockImplementation(() => Promise.resolve());
    mockStripSensitivePayload.mockReset();
    mockStripSensitivePayload.mockImplementation(
      (payload: Record<string, unknown>) => {
        const stripped = { ...payload };
        delete stripped.promptText;
        delete stripped.toolInput;
        delete stripped.responseText;
        return stripped;
      },
    );
  });

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  test("rejects empty body with 400", async () => {
    const sql = makeMockSql();
    const app = buildApp(sql);

    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  test("rejects body missing required fields with 400", async () => {
    const sql = makeMockSql();
    const app = buildApp(sql);

    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "evt-1" }), // missing everything else
    });

    expect(res.status).toBe(400);
  });

  test("rejects invalid eventType with 400", async () => {
    const sql = makeMockSql();
    const app = buildApp(sql);

    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent({ eventType: "invalid.type" })),
    });

    expect(res.status).toBe(400);
  });

  test("rejects empty id with 400", async () => {
    const sql = makeMockSql();
    const app = buildApp(sql);

    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent({ id: "" })),
    });

    expect(res.status).toBe(400);
  });

  // -----------------------------------------------------------------------
  // Valid session.start event
  // -----------------------------------------------------------------------

  test("accepts valid event and returns { ok: true }", async () => {
    const sql = makeMockSql([], []); // no existing session, no org rows
    const app = buildApp(sql);

    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent()),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("calls upsertDeveloper with correct arguments", async () => {
    const sql = makeMockSql();
    const app = buildApp(sql);
    const event = validEvent();

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    expect(mockUpsertDeveloper).toHaveBeenCalledTimes(1);
    expect(mockUpsertDeveloper).toHaveBeenCalledWith(
      sql,
      "abc123def456",
      "Alice",
      "alice@example.com",
    );
  });

  test("calls createSession for session.start when no existing session", async () => {
    const sql = makeMockSql([], []); // no existing session
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent()),
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledWith(
      sql,
      "sess-1",
      "abc123def456",
      "/home/user/project",
      "my-project",
      null, // permissionMode not set in default payload
    );
  });

  test("passes permissionMode from session.start payload to createSession", async () => {
    const sql = makeMockSql([], []);
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        validEvent({ payload: { permissionMode: "plan" } }),
      ),
    });

    expect(mockCreateSession).toHaveBeenCalledWith(
      sql,
      "sess-1",
      "abc123def456",
      "/home/user/project",
      "my-project",
      "plan",
    );
  });

  test("calls insertEvent with the event", async () => {
    const sql = makeMockSql();
    const app = buildApp(sql);
    const event = validEvent();

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    // insertEvent receives the parsed event object
    const calledWith = mockInsertEvent.mock.calls[0];
    expect(calledWith[0]).toBe(sql);
    expect(calledWith[1]).toMatchObject({
      id: "evt-1",
      sessionId: "sess-1",
      eventType: "session.start",
    });
  });

  // -----------------------------------------------------------------------
  // Auto-link developer to org
  // -----------------------------------------------------------------------

  test("calls autoLinkDeveloperToOrg when apiKeyUserId is set", async () => {
    const sql = makeMockSql();
    const app = buildApp(sql, { apiKeyUserId: "user-owner-1" });

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent()),
    });

    expect(mockAutoLinkDeveloperToOrg).toHaveBeenCalledTimes(1);
    expect(mockAutoLinkDeveloperToOrg).toHaveBeenCalledWith(
      sql,
      "user-owner-1",
      "abc123def456",
    );
  });

  test("does NOT call autoLinkDeveloperToOrg when apiKeyUserId is absent", async () => {
    const sql = makeMockSql();
    const app = buildApp(sql); // no apiKeyUserId

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent()),
    });

    expect(mockAutoLinkDeveloperToOrg).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Session reactivation (ended session receiving new events)
  // -----------------------------------------------------------------------

  test("reactivates an ended session by calling createSession", async () => {
    const sql = makeMockSql(
      [{ status: "ended" }], // existing session is ended
      [],
    );
    const app = buildApp(sql);

    // Send a non-session.start event to an ended session
    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent({ eventType: "prompt.submit" })),
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  test("does NOT create session when active session exists and event is not session.start", async () => {
    const sql = makeMockSql(
      [{ status: "active" }], // existing active session
      [],
    );
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent({ eventType: "prompt.submit" })),
    });

    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // session.end handling
  // -----------------------------------------------------------------------

  test("calls endSession on session.end without continuation reason", async () => {
    const sql = makeMockSql(
      [{ status: "active" }], // session exists and is active
      [],
    );
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        validEvent({
          eventType: "session.end",
          payload: { endReason: "user_exit" },
        }),
      ),
    });

    expect(mockEndSession).toHaveBeenCalledTimes(1);
    expect(mockEndSession).toHaveBeenCalledWith(sql, "sess-1");
  });

  test("does NOT call endSession when endReason is a continuation (clear)", async () => {
    const sql = makeMockSql([{ status: "active" }], []);
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        validEvent({
          eventType: "session.end",
          payload: { endReason: "clear" },
        }),
      ),
    });

    expect(mockEndSession).not.toHaveBeenCalled();
  });

  test("does NOT call endSession when endReason is resume", async () => {
    const sql = makeMockSql([{ status: "active" }], []);
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        validEvent({
          eventType: "session.end",
          payload: { endReason: "resume" },
        }),
      ),
    });

    expect(mockEndSession).not.toHaveBeenCalled();
  });

  test("does NOT call endSession when endReason is compact", async () => {
    const sql = makeMockSql([{ status: "active" }], []);
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        validEvent({
          eventType: "session.end",
          payload: { endReason: "compact" },
        }),
      ),
    });

    expect(mockEndSession).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Broadcasting
  // -----------------------------------------------------------------------

  test("broadcasts session.update and event.new to developer orgs on session.start", async () => {
    const sql = makeMockSql(
      [], // no existing session
      [{ organization_id: "org-abc" }], // developer belongs to org-abc
    );
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent()),
    });

    // Should broadcast: session.update (active), developer.update, event.new
    const calls = mockBroadcastToOrg.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(3);

    const messages = calls.map((c: any) => c[1]);
    const types = messages.map((m: any) => m.type);

    expect(types).toContain("session.update");
    expect(types).toContain("developer.update");
    expect(types).toContain("event.new");

    // All broadcasts go to org-abc
    for (const call of calls) {
      expect(call[0]).toBe("org-abc");
    }
  });

  test("does NOT broadcast when developer has no org", async () => {
    const sql = makeMockSql(
      [], // no existing session
      [], // no org rows
    );
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent()),
    });

    expect(mockBroadcastToOrg).not.toHaveBeenCalled();
  });

  test("broadcasts session.update with ended status on session.end", async () => {
    const sql = makeMockSql(
      [{ status: "active" }],
      [{ organization_id: "org-xyz" }],
    );
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        validEvent({
          eventType: "session.end",
          payload: { endReason: "user_exit" },
        }),
      ),
    });

    const calls = mockBroadcastToOrg.mock.calls;
    const messages = calls.map((c: any) => c[1]);

    const sessionUpdate = messages.find(
      (m: any) => m.type === "session.update",
    );
    expect(sessionUpdate).toBeDefined();
    expect(sessionUpdate.data.status).toBe("ended");
  });

  test("strips sensitive payload from event.new broadcast", async () => {
    const sql = makeMockSql(
      [{ status: "active" }],
      [{ organization_id: "org-1" }],
    );
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        validEvent({
          eventType: "prompt.submit",
          payload: { promptText: "secret", promptLength: 6 },
        }),
      ),
    });

    // stripSensitivePayload should have been called
    expect(mockStripSensitivePayload).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // tool.fail alert thresholds
  // -----------------------------------------------------------------------

  test("checks alert thresholds on tool.fail event", async () => {
    const sql = makeMockSql([{ status: "active" }], []);
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        validEvent({
          eventType: "tool.fail",
          payload: { toolName: "Read" },
        }),
      ),
    });

    expect(mockCheckAlertThresholds).toHaveBeenCalledTimes(1);
    expect(mockCheckAlertThresholds).toHaveBeenCalledWith(
      sql,
      "sess-1",
      "Read",
    );
  });

  test("broadcasts alert when checkAlertThresholds returns data", async () => {
    const alertData = {
      id: "alert-1",
      toolName: "Read",
      threshold: 5,
      count: 6,
    };
    mockCheckAlertThresholds.mockImplementation(() =>
      Promise.resolve(alertData),
    );

    const sql = makeMockSql(
      [{ status: "active" }],
      [{ organization_id: "org-alert" }],
    );
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        validEvent({
          eventType: "tool.fail",
          payload: { toolName: "Read" },
        }),
      ),
    });

    const calls = mockBroadcastToOrg.mock.calls;
    const messages = calls.map((c: any) => c[1]);
    const alertMsg = messages.find((m: any) => m.type === "alert.triggered");
    expect(alertMsg).toBeDefined();
    expect(alertMsg.data).toEqual(alertData);
  });

  test("does NOT check alert thresholds for non tool.fail events", async () => {
    const sql = makeMockSql([{ status: "active" }], []);
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent({ eventType: "prompt.submit" })),
    });

    expect(mockCheckAlertThresholds).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Optional developerEmail
  // -----------------------------------------------------------------------

  test("defaults developerEmail to empty string when omitted", async () => {
    const sql = makeMockSql();
    const app = buildApp(sql);

    const event = validEvent();
    delete (event as any).developerEmail;

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    expect(mockUpsertDeveloper).toHaveBeenCalledWith(
      sql,
      "abc123def456",
      "Alice",
      "",
    );
  });

  // -----------------------------------------------------------------------
  // Multiple orgs broadcasting
  // -----------------------------------------------------------------------

  test("broadcasts to all developer orgs", async () => {
    const sql = makeMockSql(
      [], // no existing session
      [{ organization_id: "org-1" }, { organization_id: "org-2" }],
    );
    const app = buildApp(sql);

    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent()),
    });

    const orgIds = mockBroadcastToOrg.mock.calls.map((c: any) => c[0]);
    expect(orgIds).toContain("org-1");
    expect(orgIds).toContain("org-2");
  });
});

// ---------------------------------------------------------------------------
// GET /recent -- Recent events
// ---------------------------------------------------------------------------

describe("GET /events/recent", () => {
  beforeEach(() => {
    mockGetRecentEvents.mockReset();
    mockGetRecentEvents.mockImplementation(() => Promise.resolve([]));
    mockStripSensitivePayload.mockReset();
    mockStripSensitivePayload.mockImplementation(
      (payload: Record<string, unknown>) => {
        const stripped = { ...payload };
        delete stripped.promptText;
        delete stripped.toolInput;
        delete stripped.responseText;
        return stripped;
      },
    );
  });

  test("returns mapped events with camelCase fields", async () => {
    const dbRows = [
      {
        id: "evt-1",
        created_at: "2026-03-03T12:00:00Z",
        session_id: "sess-1",
        developer_id: "dev-aaa",
        developer_name: "Alice",
        developer_email: "alice@example.com",
        project_path: "/home/user/project",
        project_name: "my-project",
        event_type: "session.start",
        payload: {},
      },
    ];
    mockGetRecentEvents.mockImplementation(() => Promise.resolve(dbRows));

    const sql = makeMockSql();
    const app = buildApp(sql, { orgDeveloperIds: ["dev-aaa"] });

    const res = await app.request("/recent");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([
      {
        id: "evt-1",
        timestamp: "2026-03-03T12:00:00Z",
        sessionId: "sess-1",
        developerId: "dev-aaa",
        developerName: "Alice",
        developerEmail: "alice@example.com",
        projectPath: "/home/user/project",
        projectName: "my-project",
        eventType: "session.start",
        payload: {},
      },
    ]);
  });

  test("passes limit and orgDeveloperIds to getRecentEvents", async () => {
    const sql = makeMockSql();
    const devIds = ["dev-111", "dev-222"];
    const app = buildApp(sql, { orgDeveloperIds: devIds });

    await app.request("/recent?limit=10");

    expect(mockGetRecentEvents).toHaveBeenCalledTimes(1);
    expect(mockGetRecentEvents).toHaveBeenCalledWith(sql, 10, devIds);
  });

  test("uses default limit of 50 when not specified", async () => {
    const sql = makeMockSql();
    const app = buildApp(sql);

    await app.request("/recent");

    expect(mockGetRecentEvents).toHaveBeenCalledWith(sql, 50, undefined);
  });

  test("clamps limit to max 500", async () => {
    const sql = makeMockSql();
    const app = buildApp(sql);

    await app.request("/recent?limit=9999");

    expect(mockGetRecentEvents).toHaveBeenCalledWith(sql, 500, undefined);
  });

  test("uses default when limit is invalid", async () => {
    const sql = makeMockSql();
    const app = buildApp(sql);

    await app.request("/recent?limit=abc");

    expect(mockGetRecentEvents).toHaveBeenCalledWith(sql, 50, undefined);
  });

  test("returns empty array when no events", async () => {
    const sql = makeMockSql();
    const app = buildApp(sql);

    const res = await app.request("/recent");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  test("strips sensitive payload from returned events", async () => {
    const dbRows = [
      {
        id: "evt-1",
        created_at: "2026-03-03T12:00:00Z",
        session_id: "sess-1",
        developer_id: "dev-aaa",
        developer_name: "Alice",
        developer_email: "alice@example.com",
        project_path: "/home/user/project",
        project_name: "my-project",
        event_type: "prompt.submit",
        payload: { promptText: "secret", promptLength: 6 },
      },
    ];
    mockGetRecentEvents.mockImplementation(() => Promise.resolve(dbRows));

    const sql = makeMockSql();
    const app = buildApp(sql);

    const res = await app.request("/recent");
    const body = await res.json();

    expect(res.status).toBe(200);
    // stripSensitivePayload removes promptText
    expect(body[0].payload).toEqual({ promptLength: 6 });
    expect(body[0].payload.promptText).toBeUndefined();
  });

  test("parses string payload from DB row", async () => {
    const dbRows = [
      {
        id: "evt-2",
        created_at: "2026-03-03T13:00:00Z",
        session_id: "sess-2",
        developer_id: "dev-bbb",
        developer_name: "Bob",
        developer_email: "bob@example.com",
        project_path: "/home/bob/project",
        project_name: "other-project",
        event_type: "tool.complete",
        payload: JSON.stringify({ toolName: "Bash", duration: 1200 }),
      },
    ];
    mockGetRecentEvents.mockImplementation(() => Promise.resolve(dbRows));

    const sql = makeMockSql();
    const app = buildApp(sql);

    const res = await app.request("/recent");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].payload).toEqual({ toolName: "Bash", duration: 1200 });
  });

  test("handles null developer_id gracefully", async () => {
    const dbRows = [
      {
        id: "evt-3",
        created_at: "2026-03-03T14:00:00Z",
        session_id: "sess-3",
        developer_id: null,
        developer_name: "Unknown",
        developer_email: null,
        project_path: null,
        project_name: "orphan-project",
        event_type: "notification",
        payload: {},
      },
    ];
    mockGetRecentEvents.mockImplementation(() => Promise.resolve(dbRows));

    const sql = makeMockSql();
    const app = buildApp(sql);

    const res = await app.request("/recent");
    const body = await res.json();

    expect(res.status).toBe(200);
    // developer_id null → fallback to ""
    expect(body[0].developerId).toBe("");
    // project_path null → fallback to ""
    expect(body[0].projectPath).toBe("");
  });
});
