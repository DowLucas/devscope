import { describe, expect, test, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Mocks – must be set up BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockGetOrgDeveloperIds = mock(() => Promise.resolve([] as string[]));

mock.module("../../services/developerLink", () => ({
  getOrgDeveloperIds: mockGetOrgDeveloperIds,
}));

// auth is not used directly by orgScope (session comes from context),
// but it's imported by the module – we still need to satisfy the import.
mock.module("../../auth", () => ({
  auth: {
    api: { getSession: mock(() => Promise.resolve(null)) },
  },
}));

// Import AFTER mocks are registered
const { orgScopeMiddleware, requireOrgAdmin, requireOrgMember } = await import(
  "../orgScope"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Hono-like context object. */
function makeContext(vars: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(vars));
  let responseBody: unknown = undefined;
  let responseStatus: number | undefined = undefined;

  return {
    get(key: string) {
      return store.get(key);
    },
    set(key: string, value: unknown) {
      store.set(key, value);
    },
    json(body: unknown, status?: number) {
      responseBody = body;
      responseStatus = status;
      return { __type: "response", body, status };
    },
    req: {
      raw: { headers: new Headers() },
    },
    // Test helpers
    _store: store,
    _getResponseBody: () => responseBody,
    _getResponseStatus: () => responseStatus,
  };
}

/**
 * Create a mock `sql` tagged-template function that resolves to `rows`.
 * Calling `mockSql._setRows(newRows)` changes what subsequent calls return.
 */
function makeMockSql(initialRows: unknown[] = []) {
  let rows = initialRows;
  const fn = mock((_strings: TemplateStringsArray, ..._values: unknown[]) =>
    Promise.resolve(rows)
  );
  (fn as any)._setRows = (r: unknown[]) => {
    rows = r;
  };
  return fn as typeof fn & { _setRows: (r: unknown[]) => void };
}

// ---------------------------------------------------------------------------
// orgScopeMiddleware
// ---------------------------------------------------------------------------

describe("orgScopeMiddleware", () => {
  beforeEach(() => {
    mockGetOrgDeveloperIds.mockReset();
    mockGetOrgDeveloperIds.mockImplementation(() => Promise.resolve([]));
  });

  test("returns 403 when session has no activeOrganizationId", async () => {
    const sql = makeMockSql();
    const mw = orgScopeMiddleware(sql as any);
    const c = makeContext({ session: {} });
    const next = mock(() => Promise.resolve());

    const result = await mw(c as any, next);

    expect(result).toBeDefined();
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "No active organization" });
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 403 when session is undefined", async () => {
    const sql = makeMockSql();
    const mw = orgScopeMiddleware(sql as any);
    const c = makeContext({}); // no session at all
    const next = mock(() => Promise.resolve());

    const result = await mw(c as any, next);

    expect(result.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("sets orgId and orgDeveloperIds on context for valid org", async () => {
    const devIds = ["dev-aaa", "dev-bbb"];
    mockGetOrgDeveloperIds.mockImplementation(() => Promise.resolve(devIds));

    const sql = makeMockSql();
    const mw = orgScopeMiddleware(sql as any);
    const c = makeContext({
      session: { activeOrganizationId: "org-123" },
    });
    const next = mock(() => Promise.resolve());

    await mw(c as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(c._store.get("orgId")).toBe("org-123");
    expect(c._store.get("orgDeveloperIds")).toEqual(devIds);
  });

  test("passes sql to getOrgDeveloperIds", async () => {
    const sql = makeMockSql();
    const mw = orgScopeMiddleware(sql as any);
    const c = makeContext({
      session: { activeOrganizationId: "org-456" },
    });
    const next = mock(() => Promise.resolve());

    await mw(c as any, next);

    expect(mockGetOrgDeveloperIds).toHaveBeenCalledWith(sql, "org-456");
  });
});

// ---------------------------------------------------------------------------
// requireOrgAdmin
// ---------------------------------------------------------------------------

describe("requireOrgAdmin", () => {
  test("returns 403 when no activeOrganizationId", async () => {
    const sql = makeMockSql();
    const mw = requireOrgAdmin(sql as any);
    const c = makeContext({
      session: {},
      user: { id: "user-1" },
    });
    const next = mock(() => Promise.resolve());

    const result = await mw(c as any, next);

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "No active organization" });
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 403 when no user id", async () => {
    const sql = makeMockSql();
    const mw = requireOrgAdmin(sql as any);
    const c = makeContext({
      session: { activeOrganizationId: "org-1" },
      user: {},
    });
    const next = mock(() => Promise.resolve());

    const result = await mw(c as any, next);

    expect(result.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 403 when user has 'member' role (not admin)", async () => {
    const sql = makeMockSql([{ role: "member" }]);
    const mw = requireOrgAdmin(sql as any);
    const c = makeContext({
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    });
    const next = mock(() => Promise.resolve());

    const result = await mw(c as any, next);

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "Admin access required" });
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 403 when no membership row found", async () => {
    const sql = makeMockSql([]); // empty — no membership
    const mw = requireOrgAdmin(sql as any);
    const c = makeContext({
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    });
    const next = mock(() => Promise.resolve());

    const result = await mw(c as any, next);

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "Admin access required" });
    expect(next).not.toHaveBeenCalled();
  });

  test("calls next() when user has 'admin' role", async () => {
    const sql = makeMockSql([{ role: "admin" }]);
    const mw = requireOrgAdmin(sql as any);
    const c = makeContext({
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    });
    const next = mock(() => Promise.resolve());

    await mw(c as any, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test("calls next() when user has 'owner' role", async () => {
    const sql = makeMockSql([{ role: "owner" }]);
    const mw = requireOrgAdmin(sql as any);
    const c = makeContext({
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    });
    const next = mock(() => Promise.resolve());

    await mw(c as any, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// requireOrgMember
// ---------------------------------------------------------------------------

describe("requireOrgMember", () => {
  test("returns 403 when no activeOrganizationId", async () => {
    const sql = makeMockSql();
    const mw = requireOrgMember(sql as any);
    const c = makeContext({
      session: {},
      user: { id: "user-1" },
    });
    const next = mock(() => Promise.resolve());

    const result = await mw(c as any, next);

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "No active organization" });
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 403 when no user id", async () => {
    const sql = makeMockSql();
    const mw = requireOrgMember(sql as any);
    const c = makeContext({
      session: { activeOrganizationId: "org-1" },
      user: {},
    });
    const next = mock(() => Promise.resolve());

    const result = await mw(c as any, next);

    expect(result.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 403 when no membership found", async () => {
    const sql = makeMockSql([]); // no rows
    const mw = requireOrgMember(sql as any);
    const c = makeContext({
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    });
    const next = mock(() => Promise.resolve());

    const result = await mw(c as any, next);

    expect(result.status).toBe(403);
    expect(result.body).toEqual({
      error: "Not a member of this organization",
    });
    expect(next).not.toHaveBeenCalled();
  });

  test("calls next() and sets orgRole for valid member", async () => {
    const sql = makeMockSql([{ role: "member" }]);
    const mw = requireOrgMember(sql as any);
    const c = makeContext({
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    });
    const next = mock(() => Promise.resolve());

    await mw(c as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(c._store.get("orgRole")).toBe("member");
  });

  test("sets orgRole to 'admin' for admin member", async () => {
    const sql = makeMockSql([{ role: "admin" }]);
    const mw = requireOrgMember(sql as any);
    const c = makeContext({
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    });
    const next = mock(() => Promise.resolve());

    await mw(c as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(c._store.get("orgRole")).toBe("admin");
  });

  test("sets orgRole to 'owner' for owner member", async () => {
    const sql = makeMockSql([{ role: "owner" }]);
    const mw = requireOrgMember(sql as any);
    const c = makeContext({
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    });
    const next = mock(() => Promise.resolve());

    await mw(c as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(c._store.get("orgRole")).toBe("owner");
  });
});
