import { describe, expect, test, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import { dbStubs } from "../../__test_helpers__/mockStubs";

// ---------------------------------------------------------------------------
// Mocks -- must be set up BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockGetAllDevelopers = mock(() => Promise.resolve([] as any[]));

mock.module("../../db", () => dbStubs({
  getAllDevelopers: mockGetAllDevelopers,
}));

// Import AFTER mocks are registered
const { developersRoutes } = await import("../developers");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fake SQL object -- the route passes it through to getAllDevelopers. */
const fakeSql = Symbol("fakeSql") as any;

/**
 * Build a Hono app that sets orgDeveloperIds on context (mimicking
 * orgScopeMiddleware) then mounts the developers routes.
 */
function buildApp(orgDeveloperIds?: string[]) {
  const app = new Hono();

  // Middleware to inject orgDeveloperIds like orgScopeMiddleware does
  app.use("/*", async (c, next) => {
    if (orgDeveloperIds !== undefined) {
      c.set("orgDeveloperIds" as never, orgDeveloperIds as never);
    }
    await next();
  });

  app.route("/", developersRoutes(fakeSql));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /developers", () => {
  beforeEach(() => {
    mockGetAllDevelopers.mockReset();
    mockGetAllDevelopers.mockImplementation(() => Promise.resolve([]));
  });

  test("returns mapped developer list with camelCase fields", async () => {
    const dbRows = [
      {
        id: "dev-aaa",
        name: "Alice",
        email: "alice@example.com",
        first_seen: "2026-01-01T00:00:00Z",
        last_seen: "2026-03-01T12:00:00Z",
        active_sessions: 2,
      },
      {
        id: "dev-bbb",
        name: "Bob",
        email: "bob@example.com",
        first_seen: "2026-02-15T00:00:00Z",
        last_seen: "2026-03-02T09:30:00Z",
        active_sessions: 0,
      },
    ];
    mockGetAllDevelopers.mockImplementation(() => Promise.resolve(dbRows));

    const app = buildApp(["dev-aaa", "dev-bbb"]);
    const res = await app.request("/");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([
      {
        id: "dev-aaa",
        name: "Alice",
        email: "alice@example.com",
        firstSeen: "2026-01-01T00:00:00Z",
        lastSeen: "2026-03-01T12:00:00Z",
        activeSessions: 2,
      },
      {
        id: "dev-bbb",
        name: "Bob",
        email: "bob@example.com",
        firstSeen: "2026-02-15T00:00:00Z",
        lastSeen: "2026-03-02T09:30:00Z",
        activeSessions: 0,
      },
    ]);
  });

  test("passes orgDeveloperIds to getAllDevelopers", async () => {
    const devIds = ["dev-111", "dev-222"];
    const app = buildApp(devIds);

    await app.request("/");

    expect(mockGetAllDevelopers).toHaveBeenCalledTimes(1);
    expect(mockGetAllDevelopers).toHaveBeenCalledWith(fakeSql, devIds);
  });

  test("passes undefined when orgDeveloperIds is not set on context", async () => {
    const app = buildApp(); // no orgDeveloperIds
    await app.request("/");

    expect(mockGetAllDevelopers).toHaveBeenCalledTimes(1);
    expect(mockGetAllDevelopers).toHaveBeenCalledWith(fakeSql, undefined);
  });

  test("returns empty array when no developers found", async () => {
    mockGetAllDevelopers.mockImplementation(() => Promise.resolve([]));

    const app = buildApp(["dev-none"]);
    const res = await app.request("/");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  test("handles null/undefined fields in DB rows gracefully", async () => {
    const dbRows = [
      {
        id: "dev-ccc",
        name: null,
        email: null,
        first_seen: null,
        last_seen: null,
        active_sessions: 0,
      },
    ];
    mockGetAllDevelopers.mockImplementation(() => Promise.resolve(dbRows));

    const app = buildApp([]);
    const res = await app.request("/");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([
      {
        id: "dev-ccc",
        name: null,
        email: null,
        firstSeen: null,
        lastSeen: null,
        activeSessions: 0,
      },
    ]);
  });
});
