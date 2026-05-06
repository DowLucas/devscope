import { describe, expect, test, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import { dbStubs, developerLinkStubs } from "../../__test_helpers__/mockStubs";

// ---------------------------------------------------------------------------
// Mocks – set up BEFORE importing the module under test.
// We exercise the gate end-to-end through a representative endpoint
// (`/insights/activity`); the gate's full unit coverage lives in
// middleware/__tests__/selfDeveloperGate.test.ts.
// ---------------------------------------------------------------------------

const mockGetDeveloperActivityOverTime = mock(() => Promise.resolve([] as any[]));

mock.module("../../db", () =>
  dbStubs({
    getDeveloperActivityOverTime: mockGetDeveloperActivityOverTime,
  }),
);

const mockGetAllDeveloperIdsForUser = mock(() => Promise.resolve([] as string[]));

mock.module("../../services/developerLink", () =>
  developerLinkStubs({
    getAllDeveloperIdsForUser: mockGetAllDeveloperIdsForUser,
  }),
);

// Import AFTER mocks are registered
const { insightsRoutes } = await import("../insights");

const fakeSql = {} as any;

function buildApp(opts: { orgDeveloperIds?: string[]; user?: any } = {}) {
  const app = new Hono();
  app.use("/insights/*", async (c, next) => {
    if (opts.orgDeveloperIds !== undefined) {
      c.set("orgDeveloperIds" as never, opts.orgDeveloperIds as never);
    }
    if (opts.user !== undefined) {
      c.set("user" as never, opts.user as never);
    }
    await next();
  });
  app.route("/insights", insightsRoutes(fakeSql));
  return app;
}

beforeEach(() => {
  mockGetDeveloperActivityOverTime.mockReset();
  mockGetDeveloperActivityOverTime.mockImplementation(() => Promise.resolve([]));
  mockGetAllDeveloperIdsForUser.mockReset();
  mockGetAllDeveloperIdsForUser.mockImplementation(() => Promise.resolve([]));
});

// ---------------------------------------------------------------------------
// /insights/activity — self-or-deny gate (DEV-31)
// ---------------------------------------------------------------------------

describe("GET /insights/activity (self-or-deny gate)", () => {
  test("returns team-aggregate (200) when no developerId is set", async () => {
    const app = buildApp({
      orgDeveloperIds: ["dev-aaa", "dev-bbb"],
      user: { id: "user-1" },
    });

    const res = await app.request("/insights/activity");

    expect(res.status).toBe(200);
    expect(mockGetDeveloperActivityOverTime).toHaveBeenCalledWith(
      fakeSql,
      undefined, // no developerId — team aggregate
      30,
      ["dev-aaa", "dev-bbb"],
    );
  });

  test("returns 403 when developerId is set but viewer does not own it", async () => {
    // Viewer owns dev-bbb, asks for dev-aaa.
    mockGetAllDeveloperIdsForUser.mockImplementation(() => Promise.resolve(["dev-bbb"]));
    const app = buildApp({
      orgDeveloperIds: ["dev-aaa", "dev-bbb"],
      user: { id: "user-2" },
    });

    const res = await app.request("/insights/activity?developerId=dev-aaa");

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      error: "Per-developer detail is restricted to the developer themselves.",
    });
    // Must not have hit the DB query — the gate short-circuits.
    expect(mockGetDeveloperActivityOverTime).not.toHaveBeenCalled();
  });

  test("returns 200 with developerId-scoped data when viewer is self", async () => {
    mockGetAllDeveloperIdsForUser.mockImplementation(() => Promise.resolve(["dev-aaa"]));
    const app = buildApp({
      orgDeveloperIds: ["dev-aaa", "dev-bbb"],
      user: { id: "user-1" },
    });

    const res = await app.request("/insights/activity?developerId=dev-aaa&days=14");

    expect(res.status).toBe(200);
    expect(mockGetDeveloperActivityOverTime).toHaveBeenCalledWith(
      fakeSql,
      "dev-aaa",
      14,
      ["dev-aaa", "dev-bbb"],
    );
  });

  test("returns 403 when developerId is set but no user on context", async () => {
    const app = buildApp({ orgDeveloperIds: ["dev-aaa"] });

    const res = await app.request("/insights/activity?developerId=dev-aaa");

    expect(res.status).toBe(403);
    expect(mockGetDeveloperActivityOverTime).not.toHaveBeenCalled();
  });
});
