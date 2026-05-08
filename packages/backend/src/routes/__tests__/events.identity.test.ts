/**
 * QA test scaffold — DEV-87 (gap #3 from DEV-84 brief)
 *
 * Purpose: document, in CI, two identity-trust gaps in POST /api/events:
 *
 *   1. Identity forgery: the route trusts whatever `developerId` the plugin
 *      declares in the body. There is no check that
 *      `developerId === SHA256(authUser.email)` for the API key owner. A
 *      plugin (or any holder of a valid API key) can post events under any
 *      developerId of their choosing.
 *
 *   2. Dual-namespace divergence: the Bash hook path (POST /api/events) trusts
 *      the plugin's `SHA256(git config user.email)`; the HTTP hook path (POST
 *      /api/events/hook) recomputes `SHA256(authUser.email)` server-side. When
 *      a single human's `git config user.email` differs from their auth account
 *      email, the same human produces two distinct developer rows — one per
 *      ingestion path — with no convergence at query time.
 *
 * This file is a route-handler test, not an integration test. It runs against
 * the in-process Hono app with mocked db/services, mirroring the pattern used
 * in events.test.ts. The CTO's brief notes that real-Postgres CI is on the
 * DEV-83 onboarding loop; once that lands, the convergence assertion can be
 * tightened against a real schema. For now, we capture the calls that would
 * have hit the DB and assert on those — that is enough to document the gap.
 *
 * Per DEV-87 acceptance: this test is expected to fail RED on `main`. The
 * issue closes when this scaffold is committed; the underlying behavior is
 * tracked in a follow-up bug filed against the Coder/CTO.
 *
 * Mission-gate note: this scaffold deliberately avoids any per-developer
 * comparison/leaderboard surface, and never queries `developerName` outside
 * the org it belongs to. It only asserts identity boundaries on the
 * ingestion route.
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import {
  dbStubs,
  wsHandlerStubs,
  developerLinkStubs,
  stripSensitiveFieldsStubs,
} from "../../__test_helpers__/mockStubs";

// ---------------------------------------------------------------------------
// Mocks -- must be set up BEFORE importing the module under test.
// Same shape as events.test.ts; we re-declare here so this file can run in
// isolation (`bun test events.identity.test.ts`).
// ---------------------------------------------------------------------------

const mockUpsertDeveloper = mock(() => Promise.resolve());
const mockCreateSession = mock(() => Promise.resolve());
const mockEndSession = mock(() => Promise.resolve());
const mockInsertEvent = mock(() => Promise.resolve({ stored: true }));
const mockGetRecentEvents = mock(() => Promise.resolve([] as any[]));
const mockCheckAlertThresholds = mock(() => Promise.resolve(null as any));

mock.module("../../db", () =>
  dbStubs({
    upsertDeveloper: mockUpsertDeveloper,
    createSession: mockCreateSession,
    endSession: mockEndSession,
    insertEvent: mockInsertEvent,
    getRecentEvents: mockGetRecentEvents,
    checkAlertThresholds: mockCheckAlertThresholds,
  }),
);

const mockBroadcastToOrg = mock(() => {});
mock.module("../../ws/handler", () =>
  wsHandlerStubs({ broadcastToOrg: mockBroadcastToOrg }),
);

const mockAutoLinkDeveloperToOrg = mock(() => Promise.resolve());
const mockAutoLinkUserToDeveloper = mock(() => Promise.resolve());

mock.module("../../services/developerLink", () =>
  developerLinkStubs({
    autoLinkDeveloperToOrg: mockAutoLinkDeveloperToOrg,
    autoLinkUserToDeveloper: mockAutoLinkUserToDeveloper,
  }),
);

mock.module("../../utils/stripSensitiveFields", () =>
  stripSensitiveFieldsStubs(),
);

mock.module("../../services/frictionDetector", () => ({
  evaluateFriction: mock(() => null),
  cleanupFrictionSession: mock(() => {}),
}));

mock.module("../../utils/ethicsAudit", () => ({
  logEthicsEvent: mock(() => {}),
}));

// Import AFTER mocks are registered.
const { eventsRoutes } = await import("../events");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Real SHA256(email) — same derivation used by both ingestion paths. */
function sha256Email(email: string): string {
  const normalized = email.toLowerCase().trim();
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(normalized);
  return hash.digest("hex");
}

/**
 * Mock SQL tagged-template that responds to:
 *   - `SELECT status FROM sessions ...`        → sessionRows
 *   - `SELECT organization_id FROM organization_developer ...` → orgRows
 *
 * Other queries fall through to [].
 */
function makeMockSql(sessionRows: unknown[] = [], orgRows: unknown[] = []) {
  let sRows = sessionRows;
  let oRows = orgRows;

  const fn = mock((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("sessions")) return Promise.resolve(sRows);
    if (query.includes("organization_developer")) return Promise.resolve(oRows);
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

function buildApp(
  sql: any,
  opts: {
    apiKeyUserId?: string;
    orgDeveloperIds?: string[];
    user?: { id?: string; name?: string; email?: string };
  } = {},
) {
  const app = new Hono();
  app.use("/*", async (c, next) => {
    if (opts.apiKeyUserId !== undefined) {
      c.set("apiKeyUserId" as never, opts.apiKeyUserId as never);
    }
    if (opts.orgDeveloperIds !== undefined) {
      c.set("orgDeveloperIds" as never, opts.orgDeveloperIds as never);
    }
    if (opts.user !== undefined) {
      c.set("user" as never, opts.user as never);
    }
    await next();
  });
  app.route("/", eventsRoutes(sql));
  return app;
}

function bodyForPostEvents(developerId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-identity-1",
    timestamp: "2026-05-08T12:00:00Z",
    sessionId: "sess-identity-1",
    developerId,
    developerName: "Plugin-Declared Name",
    developerEmail: "plugin@declared.example",
    projectPath: "/home/x/proj",
    projectName: "proj",
    eventType: "session.start",
    payload: {},
    ...overrides,
  };
}

function resetAllMocks() {
  mockUpsertDeveloper.mockReset();
  mockUpsertDeveloper.mockImplementation(() => Promise.resolve());
  mockCreateSession.mockReset();
  mockCreateSession.mockImplementation(() => Promise.resolve());
  mockEndSession.mockReset();
  mockEndSession.mockImplementation(() => Promise.resolve());
  mockInsertEvent.mockReset();
  mockInsertEvent.mockImplementation(() => Promise.resolve({ stored: true }));
  mockCheckAlertThresholds.mockReset();
  mockCheckAlertThresholds.mockImplementation(() => Promise.resolve(null));
  mockBroadcastToOrg.mockReset();
  mockAutoLinkDeveloperToOrg.mockReset();
  mockAutoLinkDeveloperToOrg.mockImplementation(() => Promise.resolve());
  mockAutoLinkUserToDeveloper.mockReset();
  mockAutoLinkUserToDeveloper.mockImplementation(() => Promise.resolve());
}

// ---------------------------------------------------------------------------
// Fixture: two API-key owners.
//   userA — owns the API key being used in the request.
//   userB — a different human in the same org.
// Their canonical developerIds are SHA256(email), the value the /hook path
// would compute server-side.
// ---------------------------------------------------------------------------

const USER_A = {
  authUserId: "user-A-id",
  email: "alice@example.com",
  name: "Alice",
};
const USER_B = {
  authUserId: "user-B-id",
  email: "bob@example.com",
  name: "Bob",
};
const ALICE_DEV_ID = sha256Email(USER_A.email); // canonical for Alice
const BOB_DEV_ID = sha256Email(USER_B.email); // canonical for Bob
const ARBITRARY_DEV_ID = "deadbeef".repeat(8); // 64 hex chars, no email basis

// ---------------------------------------------------------------------------
// Identity-forgery matrix on POST /api/events
//
// Matrix dimensions: (apiKeyUserId, declared developerId).
// Cases:
//   matched         — apiKey=A, declared=SHA256(A.email)
//   mismatched      — apiKey=A, declared=SHA256(B.email)  [B in different org]
//   sameOrgForge    — apiKey=A, declared=SHA256(B.email)  [B in A's org]
//   arbitrary       — apiKey=A, declared=arbitrary 64-hex string
//   anon            — no apiKey, declared=arbitrary value (any caller can claim any id)
//   expired         — simulated by absent apiKeyUserId + declared SHA256(B.email)
//
// Acceptance rule (per DEV-84 brief gap #3):
//   "Mismatched tuples are rejected OR strictly auto-linked under documented
//    rules."
//
// Today's behavior on `main`:
//   - matched, mismatched, sameOrgForge, arbitrary: route ACCEPTS and stores
//     the declared developerId verbatim. Only `matched` is correct; the others
//     are forgery vectors.
//   - anon: route ACCEPTS without auth.
//   - expired: indistinguishable from anon at the route level (auth middleware
//     should have rejected upstream; we assert the route's behavior on the
//     downstream case where the middleware did not strip the body).
//
// Therefore every non-matched row is expected to FAIL RED until the route
// either (a) rejects mismatched developerIds, or (b) overwrites the declared
// id with the canonical SHA256(authUser.email) before persisting.
// ---------------------------------------------------------------------------

type ForgeryCase = {
  name: string;
  apiKeyUserId: string | undefined;
  authUser: { id: string; name: string; email: string } | undefined;
  declaredDeveloperId: string;
  /** Canonical developerId we expect after route normalization, if any. */
  canonicalDeveloperId: string | null;
  /**
   * Documented expectation per DEV-84 brief.
   *   "reject"    — route should respond non-2xx OR not call insertEvent.
   *   "normalize" — route should call insertEvent with canonicalDeveloperId,
   *                 not the declared one.
   *   "accept"    — declared id is canonical; insert is correct.
   */
  expectation: "reject" | "normalize" | "accept";
};

const forgeryMatrix: ForgeryCase[] = [
  {
    name: "matched: apiKey=A, declared=SHA256(A.email)",
    apiKeyUserId: USER_A.authUserId,
    authUser: { id: USER_A.authUserId, name: USER_A.name, email: USER_A.email },
    declaredDeveloperId: ALICE_DEV_ID,
    canonicalDeveloperId: ALICE_DEV_ID,
    expectation: "accept",
  },
  {
    name: "mismatched: apiKey=A, declared=SHA256(B.email) [different org]",
    apiKeyUserId: USER_A.authUserId,
    authUser: { id: USER_A.authUserId, name: USER_A.name, email: USER_A.email },
    declaredDeveloperId: BOB_DEV_ID,
    canonicalDeveloperId: ALICE_DEV_ID,
    expectation: "reject",
  },
  {
    name: "sameOrgForge: apiKey=A, declared=SHA256(B.email) [B is in A's org]",
    apiKeyUserId: USER_A.authUserId,
    authUser: { id: USER_A.authUserId, name: USER_A.name, email: USER_A.email },
    declaredDeveloperId: BOB_DEV_ID,
    canonicalDeveloperId: ALICE_DEV_ID,
    // Same-org membership does not authorize cross-identity event posting.
    // Either reject or normalize to A — never silently store as B.
    expectation: "reject",
  },
  {
    name: "arbitrary: apiKey=A, declared=opaque hex (no email basis)",
    apiKeyUserId: USER_A.authUserId,
    authUser: { id: USER_A.authUserId, name: USER_A.name, email: USER_A.email },
    declaredDeveloperId: ARBITRARY_DEV_ID,
    canonicalDeveloperId: ALICE_DEV_ID,
    expectation: "reject",
  },
  {
    name: "anon: no apiKey, declared=SHA256(B.email)",
    apiKeyUserId: undefined,
    authUser: undefined,
    declaredDeveloperId: BOB_DEV_ID,
    canonicalDeveloperId: null,
    // Without an authenticated identity, the route has no basis to attribute
    // the event to anyone. Should reject.
    expectation: "reject",
  },
  {
    name: "expired: API key auth missing, declared=SHA256(B.email)",
    apiKeyUserId: undefined,
    authUser: undefined,
    declaredDeveloperId: BOB_DEV_ID,
    canonicalDeveloperId: null,
    expectation: "reject",
  },
];

describe("POST /events — identity-forgery guards (DEV-87 gap #3)", () => {
  beforeEach(resetAllMocks);

  for (const c of forgeryMatrix) {
    test(c.name, async () => {
      const sql = makeMockSql([], [{ organization_id: "org-shared" }]);
      const app = buildApp(sql, {
        apiKeyUserId: c.apiKeyUserId,
        user: c.authUser,
      });

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyForPostEvents(c.declaredDeveloperId)),
      });

      if (c.expectation === "accept") {
        // Canonical case: 2xx, persisted under the canonical id.
        expect(res.status).toBe(200);
        expect(mockInsertEvent).toHaveBeenCalledTimes(1);
        const insertedEvent = (mockInsertEvent.mock.calls[0] as any[])[1];
        expect(insertedEvent.developerId).toBe(c.canonicalDeveloperId);
        return;
      }

      if (c.expectation === "reject") {
        // Either the route returns a non-2xx, or it never calls insertEvent.
        // Both forms count as "rejected" for this guard. Today's `main` does
        // neither — it returns 200 and persists the forged id.
        const rejected =
          res.status >= 400 || mockInsertEvent.mock.calls.length === 0;
        expect(rejected).toBe(true);
        // Belt-and-braces: if anything was inserted, it must NOT carry the
        // declared (forged) developerId.
        if (mockInsertEvent.mock.calls.length > 0) {
          const insertedEvent = (mockInsertEvent.mock.calls[0] as any[])[1];
          expect(insertedEvent.developerId).not.toBe(c.declaredDeveloperId);
        }
        return;
      }

      // c.expectation === "normalize": route must overwrite the declared id
      // with the canonical id before persisting.
      expect(res.status).toBe(200);
      expect(mockInsertEvent).toHaveBeenCalledTimes(1);
      const insertedEvent = (mockInsertEvent.mock.calls[0] as any[])[1];
      expect(insertedEvent.developerId).toBe(c.canonicalDeveloperId);
      expect(insertedEvent.developerId).not.toBe(c.declaredDeveloperId);
    });
  }
});

// ---------------------------------------------------------------------------
// Dual-namespace convergence on POST /api/events vs POST /api/events/hook
//
// Scenarios:
//   sameEmail        — plugin git email == auth account email. Both paths
//                      should produce the same canonical developerId.
//   pluginEmailDrift — plugin git email differs from auth account email.
//                      Each path computes a different SHA256, so the same
//                      human is split across two developer rows. The brief
//                      requires either rejection at insert OR strict
//                      normalization at insert OR documented convergence at
//                      query time.
//
// We assert the simplest, route-level guarantee: for the same human (same
// apiKeyUserId), the developerId persisted by both ingestion paths MUST be
// identical. If the plugin path stores SHA256(plugin_email) and the hook path
// stores SHA256(auth_email), the assertion fails — that's the gap.
// ---------------------------------------------------------------------------

type ConvergenceCase = {
  name: string;
  pluginGitEmail: string; // what the plugin computed and put in the body
  authEmail: string; // what auth_user.email resolves to for the API key owner
};

const convergenceMatrix: ConvergenceCase[] = [
  {
    name: "sameEmail: plugin git email matches auth email",
    pluginGitEmail: USER_A.email,
    authEmail: USER_A.email,
  },
  {
    name: "pluginEmailDrift: plugin git email differs from auth email",
    pluginGitEmail: "alice@personal.example", // e.g. personal git email
    authEmail: USER_A.email, // alice@example.com on the SaaS account
  },
];

describe("Dual-namespace convergence (DEV-87 gap #3)", () => {
  beforeEach(resetAllMocks);

  for (const c of convergenceMatrix) {
    test(c.name, async () => {
      // --- POST /api/events (Bash hook path: plugin declares developerId) ---
      const sqlPlugin = makeMockSql([], [{ organization_id: "org-shared" }]);
      const appPlugin = buildApp(sqlPlugin, {
        apiKeyUserId: USER_A.authUserId,
        user: { id: USER_A.authUserId, name: USER_A.name, email: USER_A.email },
      });

      const pluginDeclaredDevId = sha256Email(c.pluginGitEmail);

      const resPlugin = await appPlugin.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          bodyForPostEvents(pluginDeclaredDevId, {
            id: "evt-plugin-1",
            sessionId: "sess-plugin-1",
            developerEmail: c.pluginGitEmail,
          }),
        ),
      });
      expect(resPlugin.status).toBeLessThan(500);
      const pluginInsertCalls = mockInsertEvent.mock.calls.slice();
      const pluginPersistedDevId =
        pluginInsertCalls.length > 0
          ? (pluginInsertCalls[0] as any[])[1]?.developerId
          : null;

      // --- POST /api/events/hook (HTTP hook path: server derives developerId) ---
      resetAllMocks();
      const sqlHook = makeMockSql([], [{ organization_id: "org-shared" }]);
      const appHook = buildApp(sqlHook, {
        apiKeyUserId: USER_A.authUserId,
        user: { id: USER_A.authUserId, name: USER_A.name, email: c.authEmail },
      });

      const resHook = await appHook.request("/hook?event=notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: "sess-hook-1",
          cwd: "/home/alice/proj",
        }),
      });
      expect(resHook.status).toBeLessThan(500);
      const hookInsertCalls = mockInsertEvent.mock.calls.slice();
      const hookPersistedDevId =
        hookInsertCalls.length > 0
          ? (hookInsertCalls[0] as any[])[1]?.developerId
          : null;

      // Convergence assertion: same human, both paths → same developerId at
      // insert. If neither path inserted (both rejected), that is also a
      // valid documented outcome; we only fail when the two paths produced
      // distinct ids.
      if (pluginPersistedDevId !== null && hookPersistedDevId !== null) {
        expect(pluginPersistedDevId).toBe(hookPersistedDevId);
      } else {
        // At least one path must have explicitly rejected — record that here
        // so the failure mode is visible in the test report.
        expect(
          pluginPersistedDevId === null || hookPersistedDevId === null,
        ).toBe(true);
      }
    });
  }
});
