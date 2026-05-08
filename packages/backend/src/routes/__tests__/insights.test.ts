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
const mockGetSessionTokenUsageSummary = mock(() => Promise.resolve(null as any));
const mockGetSessionTokenUsageOverTime = mock(() => Promise.resolve([] as any[]));

mock.module("../../db", () =>
  dbStubs({
    getDeveloperActivityOverTime: mockGetDeveloperActivityOverTime,
    getSessionTokenUsageSummary: mockGetSessionTokenUsageSummary,
    getSessionTokenUsageOverTime: mockGetSessionTokenUsageOverTime,
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
  mockGetSessionTokenUsageSummary.mockReset();
  mockGetSessionTokenUsageSummary.mockImplementation(() =>
    Promise.resolve({
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cache_creation_tokens: 0,
      total_cache_read_tokens: 0,
      total_estimated_cost_usd: 0,
      avg_cost_per_session_usd: 0,
      cache_hit_rate: 0,
      sessions_with_token_data: 0,
      avg_burn_rate: 0,
      max_burn_rate: 0,
      sessions_compacted: 0,
      total_compactions: 0,
      avg_peak_context_tokens: 0,
      max_peak_context_tokens: 0,
    }),
  );
  mockGetSessionTokenUsageOverTime.mockReset();
  mockGetSessionTokenUsageOverTime.mockImplementation(() => Promise.resolve([]));
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

// ---------------------------------------------------------------------------
// /insights/tokens — aggregate-only regression (DEV-98 mission gate)
//
// Tokens + cost are an individual productivity proxy. The mission gate
// (`team workflow visibility, not individual surveillance`) requires these
// endpoints to return ONLY the org-wide aggregate scoped by `orgDeveloperIds`.
// They must ignore any `?developerId=` query parameter — there is no per-dev
// slicing surface, even self-only, for tokens/cost on these routes.
// If a future change adds developerId support here, the leaderboard guardrail
// is broken and this test must be the thing that catches it.
// ---------------------------------------------------------------------------

describe("GET /insights/tokens (aggregate-only mission gate)", () => {
  test("ignores ?developerId= and queries only by orgDeveloperIds", async () => {
    const app = buildApp({
      orgDeveloperIds: ["dev-aaa", "dev-bbb"],
      user: { id: "user-1" },
    });

    const res = await app.request(
      "/insights/tokens?developerId=dev-aaa&days=14",
    );

    expect(res.status).toBe(200);
    expect(mockGetSessionTokenUsageSummary).toHaveBeenCalledTimes(1);
    // Signature: (sql, days, developerIds[]) — there is no developerId
    // parameter at all. The `developerId` query string MUST NOT influence
    // the call, and the developer scope MUST be the full org set.
    expect(mockGetSessionTokenUsageSummary).toHaveBeenCalledWith(
      fakeSql,
      14,
      ["dev-aaa", "dev-bbb"],
    );
    // Defence in depth: the call args must not contain the requested dev id
    // alone (which would indicate single-dev slicing).
    const args = mockGetSessionTokenUsageSummary.mock.calls[0];
    expect(args[2]).toEqual(["dev-aaa", "dev-bbb"]);
    expect(args[2]).not.toEqual(["dev-aaa"]);
  });

  test("returns zeroed aggregate (200) when org has no developers, without DB call", async () => {
    const app = buildApp({ orgDeveloperIds: [], user: { id: "user-1" } });

    const res = await app.request("/insights/tokens?developerId=dev-aaa");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_input_tokens).toBe(0);
    expect(body.total_estimated_cost_usd).toBe(0);
    // No developer scope → don't even touch the DB.
    expect(mockGetSessionTokenUsageSummary).not.toHaveBeenCalled();
  });
});

describe("GET /insights/tokens/over-time (aggregate-only mission gate)", () => {
  test("ignores ?developerId= and queries only by orgDeveloperIds", async () => {
    const app = buildApp({
      orgDeveloperIds: ["dev-aaa", "dev-bbb"],
      user: { id: "user-1" },
    });

    const res = await app.request(
      "/insights/tokens/over-time?developerId=dev-bbb&days=7",
    );

    expect(res.status).toBe(200);
    expect(mockGetSessionTokenUsageOverTime).toHaveBeenCalledTimes(1);
    expect(mockGetSessionTokenUsageOverTime).toHaveBeenCalledWith(
      fakeSql,
      7,
      ["dev-aaa", "dev-bbb"],
    );
    const args = mockGetSessionTokenUsageOverTime.mock.calls[0];
    expect(args[2]).not.toEqual(["dev-bbb"]);
  });

  test("returns empty array (200) without DB call when org has no developers", async () => {
    const app = buildApp({ orgDeveloperIds: [], user: { id: "user-1" } });

    const res = await app.request(
      "/insights/tokens/over-time?developerId=dev-bbb",
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
    expect(mockGetSessionTokenUsageOverTime).not.toHaveBeenCalled();
  });
});
