import { describe, expect, test, mock, beforeEach } from "bun:test";
import { developerLinkStubs } from "../../__test_helpers__/mockStubs";

// ---------------------------------------------------------------------------
// Mocks – must be set up BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockGetAllDeveloperIdsForUser = mock(() =>
  Promise.resolve([] as string[]),
);

mock.module("../../services/developerLink", () =>
  developerLinkStubs({
    getAllDeveloperIdsForUser: mockGetAllDeveloperIdsForUser,
  }),
);

// Import AFTER mocks are registered
const { gateSelfDeveloperId } = await import("../selfDeveloperGate");

// ---------------------------------------------------------------------------
// Helpers — mirror the makeContext pattern from orgScope.test.ts but also
// model `req.query(name)` since the gate reads the developerId query param.
// ---------------------------------------------------------------------------

function makeContext(opts: {
  query?: Record<string, string>;
  vars?: Record<string, unknown>;
}) {
  const store = new Map<string, unknown>(Object.entries(opts.vars ?? {}));
  const query = opts.query ?? {};

  return {
    get(key: string) {
      return store.get(key);
    },
    set(key: string, value: unknown) {
      store.set(key, value);
    },
    json(body: unknown, status?: number) {
      return { __type: "response", body, status } as unknown as Response;
    },
    req: {
      query(name: string) {
        return query[name];
      },
    },
  };
}

const fakeSql = {} as any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGetAllDeveloperIdsForUser.mockReset();
  mockGetAllDeveloperIdsForUser.mockImplementation(() => Promise.resolve([]));
});

describe("gateSelfDeveloperId", () => {
  test("allows team-aggregate request when no developerId is set", async () => {
    const c = makeContext({ query: {}, vars: { user: { id: "user-1" } } });
    const result = await gateSelfDeveloperId(c as any, fakeSql);

    expect(result.allow).toBe(true);
    if (result.allow) expect(result.developerId).toBeUndefined();
    // Must not even bother resolving viewer hashes when there's nothing to gate.
    expect(mockGetAllDeveloperIdsForUser).not.toHaveBeenCalled();
  });

  test("allows when requester owns the requested developerId and it's in org", async () => {
    mockGetAllDeveloperIdsForUser.mockImplementation(() =>
      Promise.resolve(["dev-aaa"]),
    );
    const c = makeContext({
      query: { developerId: "dev-aaa" },
      vars: {
        user: { id: "user-1" },
        orgDeveloperIds: ["dev-aaa", "dev-bbb"],
      },
    });

    const result = await gateSelfDeveloperId(c as any, fakeSql);

    expect(result.allow).toBe(true);
    if (result.allow) expect(result.developerId).toBe("dev-aaa");
  });

  test("denies (403) when requester does NOT own the requested developerId", async () => {
    // Viewer owns dev-bbb but is asking for dev-aaa.
    mockGetAllDeveloperIdsForUser.mockImplementation(() =>
      Promise.resolve(["dev-bbb"]),
    );
    const c = makeContext({
      query: { developerId: "dev-aaa" },
      vars: {
        user: { id: "user-2" },
        orgDeveloperIds: ["dev-aaa", "dev-bbb"],
      },
    });

    const result = (await gateSelfDeveloperId(c as any, fakeSql)) as {
      allow: false;
      response: { body: unknown; status: number };
    };

    expect(result.allow).toBe(false);
    expect(result.response.status).toBe(403);
    expect(result.response.body).toEqual({
      error: "Per-developer detail is restricted to the developer themselves.",
    });
  });

  test("denies (403) when no user is on the context (anonymous-like)", async () => {
    const c = makeContext({
      query: { developerId: "dev-aaa" },
      vars: { orgDeveloperIds: ["dev-aaa"] },
    });

    const result = (await gateSelfDeveloperId(c as any, fakeSql)) as {
      allow: false;
      response: { status: number };
    };

    expect(result.allow).toBe(false);
    expect(result.response.status).toBe(403);
    // No user → no DB lookup, just 403.
    expect(mockGetAllDeveloperIdsForUser).not.toHaveBeenCalled();
  });

  test("denies (403) when requested developerId is owned but not in the active org", async () => {
    // Viewer is multi-org-linked: owns dev-aaa, but this active org only has dev-bbb.
    mockGetAllDeveloperIdsForUser.mockImplementation(() =>
      Promise.resolve(["dev-aaa", "dev-bbb"]),
    );
    const c = makeContext({
      query: { developerId: "dev-aaa" },
      vars: {
        user: { id: "user-1" },
        orgDeveloperIds: ["dev-bbb"], // dev-aaa not in this org
      },
    });

    const result = (await gateSelfDeveloperId(c as any, fakeSql)) as {
      allow: false;
      response: { status: number };
    };

    expect(result.allow).toBe(false);
    expect(result.response.status).toBe(403);
  });

  test("allows when org scoping is absent (orgDeveloperIds undefined)", async () => {
    // Some routes may not have org scoping wired. Self-ownership alone is the gate.
    mockGetAllDeveloperIdsForUser.mockImplementation(() =>
      Promise.resolve(["dev-aaa"]),
    );
    const c = makeContext({
      query: { developerId: "dev-aaa" },
      vars: { user: { id: "user-1" } /* no orgDeveloperIds */ },
    });

    const result = await gateSelfDeveloperId(c as any, fakeSql);

    expect(result.allow).toBe(true);
    if (result.allow) expect(result.developerId).toBe("dev-aaa");
  });
});
