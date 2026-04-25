/**
 * Tests for /api/github/install routes.
 *
 * The route module reaches into three lower layers — repo install queries,
 * audit log, and the GitHub App service. We mock all three at the module
 * boundary so the route logic (admin checks, state HMAC, redirect shape) is
 * what's actually under test.
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Mocks — must be installed BEFORE importing the route under test.
// ---------------------------------------------------------------------------

const mockUpsertRepoInstallation = mock((_sql: any, input: any) =>
  Promise.resolve({
    id: input.id,
    organizationId: input.organizationId,
    githubInstallId: input.githubInstallId,
    owner: input.owner,
    repo: input.repo,
    defaultBranch: input.defaultBranch,
    cwdPatterns: [],
    isLive: false,
    autoOpenPrKinds: [],
    conventionProfile: {},
    installedAt: "2026-04-25T00:00:00Z",
    suspendedAt: null,
  })
);
const mockSuspendRepoInstallation = mock((_sql: any, id: string) =>
  Promise.resolve({ id, organizationId: "org-1", suspendedAt: "2026-04-25T11:00:00Z" })
);
const mockGetRepoInstallation = mock((_sql: any, _id: string) =>
  Promise.resolve(null as any)
);

mock.module("../../db/repoInstallationQueries", () => ({
  upsertRepoInstallation: mockUpsertRepoInstallation,
  suspendRepoInstallation: mockSuspendRepoInstallation,
  getRepoInstallation: mockGetRepoInstallation,
  // Other exports — never touched by the route, but supplied so other test
  // files that import the real module still see a complete shape.
  insertRepoInstallation: mock(() => Promise.resolve(null)),
  getRepoInstallationByGithubId: mock(() => Promise.resolve(null)),
  listRepoInstallationsForOrg: mock(() => Promise.resolve([])),
  updateRepoInstallation: mock(() => Promise.resolve()),
  deleteRepoInstallation: mock(() => Promise.resolve()),
  upsertInstallationToken: mock(() => Promise.resolve()),
  getInstallationToken: mock(() => Promise.resolve(null)),
  deleteInstallationToken: mock(() => Promise.resolve()),
}));

const mockInsertAuditEntry = mock((_sql: any, input: any) =>
  Promise.resolve({
    id: 1,
    at: "2026-04-25T00:00:00Z",
    actor: input.actor,
    action: input.action,
    repoInstallationId: input.repoInstallationId ?? null,
    artifactId: input.artifactId ?? null,
    policyVersion: input.policyVersion,
    details: input.details ?? null,
  })
);

mock.module("../../db/auditLogQueries", () => ({
  insertAuditEntry: mockInsertAuditEntry,
}));

// Default repos handed back by the GitHub App when listing installation repos.
let mockReposPayload: Array<{ owner: { login: string }; name: string; default_branch: string }> = [];
const mockOctokitRequest = mock((_route: string, _params: unknown) =>
  Promise.resolve({ data: { repositories: mockReposPayload } })
);
const mockOctokitForInstallation = mock((_sql: any, _id: number) =>
  Promise.resolve({ request: mockOctokitRequest } as any)
);

mock.module("../../services/githubApp", () => ({
  octokitForInstallation: mockOctokitForInstallation,
  POLICY_VERSION: "v1-test",
  // Other exports the real module exposes — supplied so unrelated tests don't
  // break if they import the real module.
  signAppJwt: mock(() => "test-jwt"),
  getInstallationToken: mock(() => Promise.resolve("test-token")),
  GithubInstallationUnavailableError: class extends Error {},
  _resetJwtCacheForTests: mock(() => {}),
  _resetOctokitCacheForTests: mock(() => {}),
}));

// Import the route + state helpers AFTER mocks are registered.
const { githubInstallRoutes, buildStateToken, verifyStateToken } = await import("../githubInstall");

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ORIGINAL_SECRET = process.env.BETTER_AUTH_SECRET;
const ORIGINAL_APP = process.env.GITHUB_APP_NAME;
const ORIGINAL_DASHBOARD = process.env.DASHBOARD_URL;

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-state-hmac";
  process.env.GITHUB_APP_NAME = "devscope-test";
  process.env.DASHBOARD_URL = "http://localhost:5173";

  mockUpsertRepoInstallation.mockClear();
  mockSuspendRepoInstallation.mockClear();
  mockGetRepoInstallation.mockClear();
  mockInsertAuditEntry.mockClear();
  mockOctokitRequest.mockClear();
  mockOctokitForInstallation.mockClear();
  mockReposPayload = [];
});

/**
 * Tagged-template SQL mock. Routes hit `sql` only for the role lookup
 * (admin check). We dispatch on the query text.
 */
function makeSql(opts: { role?: string | null } = {}) {
  const role = opts.role === undefined ? "admin" : opts.role;
  return mock((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const q = strings.join("?");
    if (q.includes("FROM member")) {
      return Promise.resolve(role === null ? [] : [{ role }]);
    }
    return Promise.resolve([]);
  });
}

function buildApp(
  sql: any,
  opts: { user?: { id: string } | null; activeOrg?: string | null } = {}
) {
  const app = new Hono();
  app.use("/*", async (c, next) => {
    if (opts.user !== undefined && opts.user !== null) {
      c.set("user" as never, opts.user as never);
    }
    if (opts.activeOrg !== undefined && opts.activeOrg !== null) {
      c.set("session" as never, { activeOrganizationId: opts.activeOrg } as never);
    }
    await next();
  });
  app.route("/", githubInstallRoutes(sql));
  return app;
}

// ---------------------------------------------------------------------------
// State token helpers
// ---------------------------------------------------------------------------

describe("state token", () => {
  test("buildStateToken + verifyStateToken roundtrip", async () => {
    const tok = await buildStateToken("org-1", "user-1");
    const v = await verifyStateToken(tok);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.payload.organizationId).toBe("org-1");
      expect(v.payload.userId).toBe("user-1");
      expect(v.payload.nonce).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  test("verifyStateToken rejects tampered signature", async () => {
    const tok = await buildStateToken("org-1", "user-1");
    const tampered = tok.slice(0, -2) + (tok.slice(-2) === "AA" ? "BB" : "AA");
    const v = await verifyStateToken(tampered);
    expect(v.ok).toBe(false);
  });

  test("verifyStateToken rejects expired tokens", async () => {
    // Build a token in the past (expired).
    const past = Date.now() - 30 * 60 * 1000;
    const tok = await buildStateToken("org-1", "user-1", past);
    const v = await verifyStateToken(tok);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/expired/i);
  });
});

// ---------------------------------------------------------------------------
// GET /start
// ---------------------------------------------------------------------------

describe("GET /start", () => {
  test("returns 403 when no active org", async () => {
    const sql = makeSql();
    const app = buildApp(sql, { user: { id: "u1" } });
    const res = await app.request("/start");
    expect(res.status).toBe(403);
  });

  test("returns 403 when caller is not admin/owner", async () => {
    const sql = makeSql({ role: "member" });
    const app = buildApp(sql, { user: { id: "u1" }, activeOrg: "org-1" });
    const res = await app.request("/start");
    expect(res.status).toBe(403);
    expect(mockInsertAuditEntry).not.toHaveBeenCalled();
  });

  test("admin gets a 302 to GitHub with a verifiable state and writes audit log", async () => {
    const sql = makeSql({ role: "admin" });
    const app = buildApp(sql, { user: { id: "u1" }, activeOrg: "org-1" });
    const res = await app.request("/start", { redirect: "manual" });

    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("https://github.com/apps/devscope-test/installations/new");
    const url = new URL(loc);
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();

    const verified = await verifyStateToken(state!);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.organizationId).toBe("org-1");
      expect(verified.payload.userId).toBe("u1");
    }

    expect(mockInsertAuditEntry).toHaveBeenCalledTimes(1);
    expect(mockInsertAuditEntry.mock.calls[0][1]).toMatchObject({
      actor: "u1",
      action: "github.install.start",
      policyVersion: "v1-test",
      details: { organizationId: "org-1" },
    });
  });

  test("owner role is also allowed", async () => {
    const sql = makeSql({ role: "owner" });
    const app = buildApp(sql, { user: { id: "u1" }, activeOrg: "org-1" });
    const res = await app.request("/start", { redirect: "manual" });
    expect(res.status).toBe(302);
  });
});

// ---------------------------------------------------------------------------
// GET /callback
// ---------------------------------------------------------------------------

describe("GET /callback", () => {
  test("returns 400 when state is missing or malformed", async () => {
    const sql = makeSql();
    const app = buildApp(sql);
    const res = await app.request("/callback?installation_id=42&state=garbage");
    expect(res.status).toBe(400);
  });

  test("returns 400 when state is expired", async () => {
    const sql = makeSql();
    const expired = await buildStateToken("org-1", "u1", Date.now() - 30 * 60 * 1000);
    const app = buildApp(sql);
    const res = await app.request(
      `/callback?installation_id=42&state=${encodeURIComponent(expired)}`
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 when installation_id is invalid", async () => {
    const sql = makeSql();
    const tok = await buildStateToken("org-1", "u1");
    const app = buildApp(sql);
    const res = await app.request(
      `/callback?installation_id=abc&state=${encodeURIComponent(tok)}`
    );
    expect(res.status).toBe(400);
  });

  test("returns 403 when admin role was revoked between start and callback", async () => {
    const sql = makeSql({ role: "member" }); // no longer admin
    const tok = await buildStateToken("org-1", "u1");
    const app = buildApp(sql);
    const res = await app.request(
      `/callback?installation_id=42&state=${encodeURIComponent(tok)}`
    );
    expect(res.status).toBe(403);
    expect(mockUpsertRepoInstallation).not.toHaveBeenCalled();
  });

  test("happy path: bulk-upserts each repo, writes one audit entry per upsert, redirects with count", async () => {
    mockReposPayload = [
      { owner: { login: "acme" }, name: "widgets", default_branch: "main" },
      { owner: { login: "acme" }, name: "gadgets", default_branch: "develop" },
    ];
    const sql = makeSql({ role: "admin" });
    const tok = await buildStateToken("org-1", "u1");
    const app = buildApp(sql);

    const res = await app.request(
      `/callback?installation_id=42&state=${encodeURIComponent(tok)}&setup_action=install`,
      { redirect: "manual" }
    );

    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/dashboard/proposed-changes/settings?installed=1&count=2");

    expect(mockOctokitForInstallation).toHaveBeenCalledWith(sql, 42);
    expect(mockUpsertRepoInstallation).toHaveBeenCalledTimes(2);
    expect(mockUpsertRepoInstallation.mock.calls[0][1]).toMatchObject({
      organizationId: "org-1",
      githubInstallId: 42,
      owner: "acme",
      repo: "widgets",
      defaultBranch: "main",
      cwdPatterns: [],
      isLive: false,
      autoOpenPrKinds: [],
      conventionProfile: {},
    });
    expect(mockUpsertRepoInstallation.mock.calls[1][1]).toMatchObject({
      owner: "acme",
      repo: "gadgets",
      defaultBranch: "develop",
    });

    // One audit entry per repo upsert, all with the install policy version.
    const callbackEntries = mockInsertAuditEntry.mock.calls
      .map((c: any) => c[1])
      .filter((e: any) => e.action === "github.install.callback");
    expect(callbackEntries).toHaveLength(2);
    for (const entry of callbackEntries) {
      expect(entry.policyVersion).toBe("v1-test");
      expect(entry.actor).toBe("u1");
      expect(entry.repoInstallationId).toBeTruthy();
      expect(entry.details).toMatchObject({ githubInstallId: 42 });
    }
  });

  test("redirects with count=0 when GitHub returns no repos", async () => {
    mockReposPayload = [];
    const sql = makeSql({ role: "admin" });
    const tok = await buildStateToken("org-1", "u1");
    const app = buildApp(sql);
    const res = await app.request(
      `/callback?installation_id=42&state=${encodeURIComponent(tok)}`,
      { redirect: "manual" }
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("count=0");
    expect(mockUpsertRepoInstallation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DELETE /:id
// ---------------------------------------------------------------------------

describe("DELETE /:id", () => {
  test("returns 404 when install does not exist", async () => {
    mockGetRepoInstallation.mockImplementationOnce(() => Promise.resolve(null));
    const sql = makeSql();
    const app = buildApp(sql, { user: { id: "u1" } });
    const res = await app.request("/ri-missing", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  test("returns 403 when caller is not admin of the install's owning org", async () => {
    mockGetRepoInstallation.mockImplementationOnce(() =>
      Promise.resolve({
        id: "ri-1",
        organizationId: "org-OTHER",
        githubInstallId: 42,
        owner: "acme",
        repo: "widgets",
        defaultBranch: "main",
        cwdPatterns: [],
        isLive: false,
        autoOpenPrKinds: [],
        conventionProfile: {},
        installedAt: "2026-04-25T00:00:00Z",
        suspendedAt: null,
      } as any)
    );
    const sql = makeSql({ role: "member" });
    const app = buildApp(sql, { user: { id: "u1" } });
    const res = await app.request("/ri-1", { method: "DELETE" });
    expect(res.status).toBe(403);
    expect(mockSuspendRepoInstallation).not.toHaveBeenCalled();
  });

  test("admin marks suspended and returns 200 with id + suspendedAt; audits the action", async () => {
    mockGetRepoInstallation.mockImplementationOnce(() =>
      Promise.resolve({
        id: "ri-1",
        organizationId: "org-1",
        githubInstallId: 42,
        owner: "acme",
        repo: "widgets",
        defaultBranch: "main",
        cwdPatterns: [],
        isLive: false,
        autoOpenPrKinds: [],
        conventionProfile: {},
        installedAt: "2026-04-25T00:00:00Z",
        suspendedAt: null,
      } as any)
    );
    const sql = makeSql({ role: "admin" });
    const app = buildApp(sql, { user: { id: "u1" } });
    const res = await app.request("/ri-1", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "ri-1",
      suspendedAt: "2026-04-25T11:00:00Z",
    });
    expect(mockSuspendRepoInstallation).toHaveBeenCalledWith(sql, "ri-1");

    const suspendEntries = mockInsertAuditEntry.mock.calls
      .map((c: any) => c[1])
      .filter((e: any) => e.action === "github.install.suspend");
    expect(suspendEntries).toHaveLength(1);
    expect(suspendEntries[0]).toMatchObject({
      actor: "u1",
      policyVersion: "v1-test",
      repoInstallationId: "ri-1",
    });
  });
});

// Restore env on completion (best-effort — Bun runs each test file in isolation).
if (ORIGINAL_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
else process.env.BETTER_AUTH_SECRET = ORIGINAL_SECRET;
if (ORIGINAL_APP === undefined) delete process.env.GITHUB_APP_NAME;
else process.env.GITHUB_APP_NAME = ORIGINAL_APP;
if (ORIGINAL_DASHBOARD === undefined) delete process.env.DASHBOARD_URL;
else process.env.DASHBOARD_URL = ORIGINAL_DASHBOARD;
