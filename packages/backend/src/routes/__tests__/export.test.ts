import { describe, expect, test, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import { dbStubs, developerLinkStubs } from "../../__test_helpers__/mockStubs";

// ---------------------------------------------------------------------------
// Mocks – set up BEFORE importing the module under test.
// Covers DEV-31's CSV/JSON export gating; full gate semantics are tested in
// middleware/__tests__/selfDeveloperGate.test.ts.
// ---------------------------------------------------------------------------

const mockGetExportData = mock(() => Promise.resolve([] as any[]));

mock.module("../../db", () =>
  dbStubs({
    getExportData: mockGetExportData,
  }),
);

const mockGetAllDeveloperIdsForUser = mock(() => Promise.resolve([] as string[]));

mock.module("../../services/developerLink", () =>
  developerLinkStubs({
    getAllDeveloperIdsForUser: mockGetAllDeveloperIdsForUser,
  }),
);

// Import AFTER mocks are registered
const { exportRoutes } = await import("../export");

const fakeSql = {} as any;

function buildApp(opts: { orgDeveloperIds?: string[]; user?: any } = {}) {
  const app = new Hono();
  app.use("/export/*", async (c, next) => {
    if (opts.orgDeveloperIds !== undefined) {
      c.set("orgDeveloperIds" as never, opts.orgDeveloperIds as never);
    }
    if (opts.user !== undefined) {
      c.set("user" as never, opts.user as never);
    }
    await next();
  });
  app.route("/export", exportRoutes(fakeSql));
  return app;
}

beforeEach(() => {
  mockGetExportData.mockReset();
  mockGetExportData.mockImplementation(() =>
    Promise.resolve([{ day: "2026-05-01", total: 1 }]),
  );
  mockGetAllDeveloperIdsForUser.mockReset();
  mockGetAllDeveloperIdsForUser.mockImplementation(() => Promise.resolve([]));
});

// ---------------------------------------------------------------------------
// /export/:dataType/csv — self-or-deny gate (DEV-31)
// ---------------------------------------------------------------------------

describe("GET /export/:dataType/csv (self-or-deny gate)", () => {
  test("returns team-aggregate CSV (200) when no developerId is set", async () => {
    const app = buildApp({
      orgDeveloperIds: ["dev-aaa", "dev-bbb"],
      user: { id: "user-1" },
    });

    const res = await app.request("/export/activity/csv");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(mockGetExportData).toHaveBeenCalledWith(
      fakeSql,
      "activity",
      30,
      undefined, // no developerId
      ["dev-aaa", "dev-bbb"],
    );
  });

  test("returns 403 when developerId is set but viewer does not own it", async () => {
    mockGetAllDeveloperIdsForUser.mockImplementation(() => Promise.resolve(["dev-bbb"]));
    const app = buildApp({
      orgDeveloperIds: ["dev-aaa", "dev-bbb"],
      user: { id: "user-2" },
    });

    const res = await app.request("/export/activity/csv?developerId=dev-aaa");

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      error: "Per-developer detail is restricted to the developer themselves.",
    });
    expect(mockGetExportData).not.toHaveBeenCalled();
  });

  test("returns 200 with developerId-scoped CSV when viewer is self", async () => {
    mockGetAllDeveloperIdsForUser.mockImplementation(() => Promise.resolve(["dev-aaa"]));
    const app = buildApp({
      orgDeveloperIds: ["dev-aaa", "dev-bbb"],
      user: { id: "user-1" },
    });

    const res = await app.request("/export/activity/csv?developerId=dev-aaa");

    expect(res.status).toBe(200);
    expect(mockGetExportData).toHaveBeenCalledWith(
      fakeSql,
      "activity",
      30,
      "dev-aaa",
      ["dev-aaa", "dev-bbb"],
    );
  });

  test("returns 400 for invalid data type before applying the gate", async () => {
    // The gate is applied AFTER the data-type validation. This documents the order.
    const app = buildApp({
      orgDeveloperIds: ["dev-aaa"],
      user: { id: "user-1" },
    });

    const res = await app.request("/export/bogus/csv?developerId=dev-aaa");

    expect(res.status).toBe(400);
    expect(mockGetAllDeveloperIdsForUser).not.toHaveBeenCalled();
    expect(mockGetExportData).not.toHaveBeenCalled();
  });
});

describe("GET /export/:dataType/json (self-or-deny gate)", () => {
  test("returns 403 when developerId is set but viewer does not own it", async () => {
    mockGetAllDeveloperIdsForUser.mockImplementation(() => Promise.resolve([]));
    const app = buildApp({
      orgDeveloperIds: ["dev-aaa"],
      user: { id: "user-1" },
    });

    const res = await app.request("/export/activity/json?developerId=dev-aaa");

    expect(res.status).toBe(403);
    expect(mockGetExportData).not.toHaveBeenCalled();
  });
});
