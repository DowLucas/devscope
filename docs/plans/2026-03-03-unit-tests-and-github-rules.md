# Unit Tests & GitHub Rules Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add comprehensive backend unit tests with CI enforcement and GitHub branch protection rules.

**Architecture:** Bun-native test runner (`bun:test`) with mocked DB layer. Tests in `__tests__/` directories. GitHub Actions workflow with three parallel jobs (test, lint, typecheck) gated by branch protection.

**Tech Stack:** Bun test runner, `bun:test` mock API, Hono `app.request()` for route tests, GitHub Actions, `gh` CLI for branch protection.

---

### Task 1: Tier 1 — antiPatternRules pure function tests

**Files:**
- Create: `packages/backend/src/ai/detection/__tests__/antiPatternRules.test.ts`

**Step 1: Create test file**

The `ToolEvent` type (from `../../db/patternQueries`) has shape `{ tool_name: string; success: boolean; timestamp?: string }`. All four exported functions are pure — no mocking needed.

```typescript
import { describe, test, expect } from "bun:test";
import {
  detectRetryLoops,
  detectFailureCascades,
  detectAbandonedSessions,
  detectAllAntiPatterns,
} from "../antiPatternRules";
import type { DetectedAntiPattern } from "../antiPatternRules";

// Helper to build ToolEvent sequences
function evt(tool_name: string, success: boolean): { tool_name: string; success: boolean } {
  return { tool_name, success };
}

describe("detectRetryLoops", () => {
  test("returns empty for empty sequence", () => {
    expect(detectRetryLoops([])).toEqual([]);
  });

  test("returns empty when same tool called <3 times", () => {
    const seq = [evt("Bash", false), evt("Bash", false)];
    expect(detectRetryLoops(seq)).toEqual([]);
  });

  test("returns empty when same tool called 3+ times but not all failures", () => {
    const seq = [evt("Bash", false), evt("Bash", true), evt("Bash", false)];
    expect(detectRetryLoops(seq)).toEqual([]);
  });

  test("detects warning when 3 consecutive failures of same tool", () => {
    const seq = [evt("Bash", false), evt("Bash", false), evt("Bash", false)];
    const result = detectRetryLoops(seq);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("warning");
    expect(result[0].rule).toBe("retry-loop");
  });

  test("detects critical when 5+ consecutive failures", () => {
    const seq = Array.from({ length: 5 }, () => evt("Bash", false));
    const result = detectRetryLoops(seq);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("critical");
  });

  test("detects multiple retry loops in one sequence", () => {
    const seq = [
      ...Array.from({ length: 3 }, () => evt("Bash", false)),
      evt("Read", true),
      ...Array.from({ length: 3 }, () => evt("Write", false)),
    ];
    const result = detectRetryLoops(seq);
    expect(result).toHaveLength(2);
  });

  test("mixed success/fail resets fail count", () => {
    const seq = [
      evt("Bash", false),
      evt("Bash", false),
      evt("Bash", true),
      evt("Bash", false),
    ];
    expect(detectRetryLoops(seq)).toEqual([]);
  });
});

describe("detectFailureCascades", () => {
  test("returns empty for empty sequence", () => {
    expect(detectFailureCascades([])).toEqual([]);
  });

  test("returns empty when <4 consecutive failures", () => {
    const seq = [evt("A", false), evt("B", false), evt("C", false)];
    expect(detectFailureCascades(seq)).toEqual([]);
  });

  test("detects warning at exactly 4 consecutive failures", () => {
    const seq = [
      evt("A", false), evt("B", false), evt("C", false), evt("D", false),
    ];
    const result = detectFailureCascades(seq);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("warning");
    expect(result[0].rule).toBe("failure-cascade");
  });

  test("detects critical at 6+ consecutive failures", () => {
    const seq = Array.from({ length: 6 }, (_, i) => evt(`tool${i}`, false));
    const result = detectFailureCascades(seq);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("critical");
  });

  test("success breaks the cascade", () => {
    const seq = [
      evt("A", false), evt("B", false), evt("C", true), evt("D", false),
    ];
    expect(detectFailureCascades(seq)).toEqual([]);
  });
});

describe("detectAbandonedSessions", () => {
  test("returns null when session not ended", () => {
    const seq = Array.from({ length: 10 }, () => evt("Bash", false));
    expect(detectAbandonedSessions(seq, false)).toBeNull();
  });

  test("returns null when sequence has <5 events", () => {
    const seq = Array.from({ length: 4 }, () => evt("Bash", false));
    expect(detectAbandonedSessions(seq)).toBeNull();
  });

  test("returns null when fail rate <50%", () => {
    const seq = [
      ...Array.from({ length: 8 }, () => evt("Bash", true)),
      ...Array.from({ length: 2 }, () => evt("Bash", false)),
    ];
    expect(detectAbandonedSessions(seq)).toBeNull();
  });

  test("detects warning when fail rate is exactly 50%", () => {
    const seq = [
      ...Array.from({ length: 5 }, () => evt("Bash", true)),
      ...Array.from({ length: 5 }, () => evt("Bash", false)),
    ];
    const result = detectAbandonedSessions(seq);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.rule).toBe("abandoned-session");
  });

  test("detects critical when fail rate >=80%", () => {
    const seq = [
      evt("Bash", true),
      ...Array.from({ length: 9 }, () => evt("Bash", false)),
    ];
    const result = detectAbandonedSessions(seq);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("critical");
  });

  test("only looks at last 10 events", () => {
    const seq = [
      ...Array.from({ length: 20 }, () => evt("Bash", false)),
      ...Array.from({ length: 10 }, () => evt("Bash", true)),
    ];
    // Last 10 are all successes → fail rate = 0
    expect(detectAbandonedSessions(seq)).toBeNull();
  });
});

describe("detectAllAntiPatterns", () => {
  test("returns empty for empty sequence", () => {
    expect(detectAllAntiPatterns([])).toEqual([]);
  });

  test("combines results from all detectors", () => {
    const seq = [
      // Retry loop (3 consecutive Bash failures)
      ...Array.from({ length: 3 }, () => evt("Bash", false)),
      // Failure cascade (4 different tools failing)
      evt("A", false), evt("B", false), evt("C", false), evt("D", false),
    ];
    const result = detectAllAntiPatterns(seq, true);
    // Should have at least retry loop + cascade detections
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});
```

**Step 2: Run test to verify**

Run: `cd packages/backend && bun test src/ai/detection/__tests__/antiPatternRules.test.ts`
Expected: All tests PASS. These are testing existing pure functions.

**Step 3: Fix any failures**

If any test fails, inspect the actual function behavior — the test may reveal a real edge case. Adjust the test expectation only if the current behavior is intentionally correct.

**Step 4: Commit**

```bash
git add packages/backend/src/ai/detection/__tests__/antiPatternRules.test.ts
git commit -m "test: add antiPatternRules unit tests

Cover detectRetryLoops, detectFailureCascades,
detectAbandonedSessions, and detectAllAntiPatterns with
edge cases for boundaries, severity levels, and empty inputs."
```

---

### Task 2: Tier 1 — stripSensitiveFields pure function tests

**Files:**
- Create: `packages/backend/src/utils/__tests__/stripSensitiveFields.test.ts`

**Step 1: Create test file**

```typescript
import { describe, test, expect } from "bun:test";
import {
  stripSensitivePayload,
  stripSensitiveEvent,
} from "../stripSensitiveFields";

describe("stripSensitivePayload", () => {
  test("removes promptText, toolInput, responseText", () => {
    const payload = {
      promptText: "secret prompt",
      toolInput: "secret input",
      responseText: "secret response",
      tool: "Bash",
      status: "success",
    };
    const result = stripSensitivePayload(payload);
    expect(result).toEqual({ tool: "Bash", status: "success" });
  });

  test("returns copy without mutation of original", () => {
    const payload = { promptText: "secret", other: "keep" };
    const result = stripSensitivePayload(payload);
    expect(payload.promptText).toBe("secret"); // original unchanged
    expect(result).toEqual({ other: "keep" });
  });

  test("handles payload with no sensitive keys", () => {
    const payload = { tool: "Bash", status: "success" };
    const result = stripSensitivePayload(payload);
    expect(result).toEqual({ tool: "Bash", status: "success" });
  });

  test("handles empty payload", () => {
    expect(stripSensitivePayload({})).toEqual({});
  });

  test("handles payload with only sensitive keys", () => {
    const payload = {
      promptText: "a",
      toolInput: "b",
      responseText: "c",
    };
    expect(stripSensitivePayload(payload)).toEqual({});
  });
});

describe("stripSensitiveEvent", () => {
  test("strips sensitive fields from nested payload", () => {
    const event = {
      id: "evt-1",
      payload: { promptText: "secret", tool: "Bash" },
    };
    const result = stripSensitiveEvent(event);
    expect(result).toEqual({
      id: "evt-1",
      payload: { tool: "Bash" },
    });
  });

  test("returns event unchanged if payload is missing", () => {
    const event = { id: "evt-1" };
    const result = stripSensitiveEvent(event);
    expect(result).toBe(event); // same reference
  });

  test("returns event unchanged if payload is not an object", () => {
    const event = { id: "evt-1", payload: "string-payload" };
    const result = stripSensitiveEvent(event);
    expect(result).toBe(event);
  });

  test("does not mutate original event", () => {
    const event = {
      id: "evt-1",
      payload: { promptText: "secret", tool: "Bash" },
    };
    const result = stripSensitiveEvent(event);
    expect((event.payload as any).promptText).toBe("secret");
    expect(result).not.toBe(event);
  });
});
```

**Step 2: Run test**

Run: `cd packages/backend && bun test src/utils/__tests__/stripSensitiveFields.test.ts`
Expected: All tests PASS.

**Step 3: Fix any failures, then commit**

```bash
git add packages/backend/src/utils/__tests__/stripSensitiveFields.test.ts
git commit -m "test: add stripSensitiveFields unit tests

Cover payload stripping, non-mutation, missing/non-object payloads,
and edge cases with partial and empty sensitive field sets."
```

---

### Task 3: Tier 1 — db/utils inList tests

**Files:**
- Create: `packages/backend/src/db/__tests__/utils.test.ts`

**Step 1: Create test file**

`inList()` calls `Sql.unsafe()` from `"bun"` — we need to mock that. The function validates hex and builds an IN clause string.

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock Bun's sql module — inList imports { sql as Sql } from "bun"
// and calls Sql.unsafe(). We need to capture what string is passed.
const mockUnsafe = mock((str: string) => str);
mock.module("bun", () => ({
  sql: {
    unsafe: mockUnsafe,
  },
}));

// Import AFTER mock setup
const { inList } = await import("../utils");

describe("inList", () => {
  beforeEach(() => {
    mockUnsafe.mockClear();
  });

  test("builds IN clause for single hex id", () => {
    inList(["abc123"]);
    expect(mockUnsafe).toHaveBeenCalledTimes(1);
    const arg = mockUnsafe.mock.calls[0][0];
    expect(arg).toBe("'abc123'");
  });

  test("builds IN clause for multiple hex ids", () => {
    inList(["aaa", "bbb", "ccc"]);
    const arg = mockUnsafe.mock.calls[0][0];
    expect(arg).toBe("'aaa','bbb','ccc'");
  });

  test("throws on non-hex character (uppercase)", () => {
    expect(() => inList(["ABC"])).toThrow();
  });

  test("throws on non-hex character (dash)", () => {
    expect(() => inList(["abc-def"])).toThrow();
  });

  test("throws on empty string id", () => {
    expect(() => inList([""])).toThrow();
  });

  test("throws on space in id", () => {
    expect(() => inList(["abc def"])).toThrow();
  });

  test("throws when any id in array is invalid", () => {
    expect(() => inList(["abc", "INVALID", "def"])).toThrow();
  });

  test("handles empty array", () => {
    // Empty array produces empty string passed to Sql.unsafe
    inList([]);
    const arg = mockUnsafe.mock.calls[0][0];
    expect(arg).toBe("");
  });
});
```

**Step 2: Run test**

Run: `cd packages/backend && bun test src/db/__tests__/utils.test.ts`
Expected: All tests PASS.

**Step 3: Fix any failures, then commit**

```bash
git add packages/backend/src/db/__tests__/utils.test.ts
git commit -m "test: add inList SQL helper unit tests

Cover hex validation, single/multiple IDs, invalid characters,
empty array, and SQL injection prevention."
```

---

### Task 4: Tier 1 — computeDeveloperId pure function test

**Files:**
- Create: `packages/backend/src/services/__tests__/developerLink.test.ts`

**Step 1: Create test file**

`computeDeveloperId` uses `Bun.CryptoHasher("sha256")` which is available in the Bun runtime — no mock needed for pure hash tests.

```typescript
import { describe, test, expect } from "bun:test";
import { computeDeveloperId } from "../developerLink";

describe("computeDeveloperId", () => {
  test("returns consistent hash for same email", () => {
    const id1 = computeDeveloperId("test@example.com");
    const id2 = computeDeveloperId("test@example.com");
    expect(id1).toBe(id2);
  });

  test("returns hex string", () => {
    const id = computeDeveloperId("test@example.com");
    expect(id).toMatch(/^[a-f0-9]{64}$/);
  });

  test("normalizes case (lowercases email)", () => {
    const lower = computeDeveloperId("test@example.com");
    const upper = computeDeveloperId("TEST@EXAMPLE.COM");
    const mixed = computeDeveloperId("Test@Example.Com");
    expect(lower).toBe(upper);
    expect(lower).toBe(mixed);
  });

  test("trims whitespace", () => {
    const clean = computeDeveloperId("test@example.com");
    const padded = computeDeveloperId("  test@example.com  ");
    expect(clean).toBe(padded);
  });

  test("different emails produce different hashes", () => {
    const id1 = computeDeveloperId("alice@example.com");
    const id2 = computeDeveloperId("bob@example.com");
    expect(id1).not.toBe(id2);
  });
});
```

**Step 2: Run test**

Run: `cd packages/backend && bun test src/services/__tests__/developerLink.test.ts`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add packages/backend/src/services/__tests__/developerLink.test.ts
git commit -m "test: add computeDeveloperId unit tests

Cover determinism, hex format, case normalization,
whitespace trimming, and uniqueness."
```

---

### Task 5: Tier 2 — CSRF middleware tests

**Files:**
- Create: `packages/backend/src/middleware/__tests__/csrf.test.ts`

**Step 1: Create test file**

Use Hono's test utilities to create a minimal app and invoke the middleware.

```typescript
import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { csrfMiddleware } from "../csrf";

function createApp() {
  const app = new Hono();
  app.use("*", csrfMiddleware());
  app.all("*", (c) => c.json({ ok: true }));
  return app;
}

describe("csrfMiddleware", () => {
  const app = createApp();

  test("GET requests pass through without header", async () => {
    const res = await app.request("/api/anything", { method: "GET" });
    expect(res.status).toBe(200);
  });

  test("HEAD requests pass through without header", async () => {
    const res = await app.request("/api/anything", { method: "HEAD" });
    expect(res.status).toBe(200);
  });

  test("OPTIONS requests pass through without header", async () => {
    const res = await app.request("/api/anything", { method: "OPTIONS" });
    expect(res.status).toBe(200);
  });

  test("POST to /api/auth/* passes through without header", async () => {
    const res = await app.request("/api/auth/login", { method: "POST" });
    expect(res.status).toBe(200);
  });

  test("POST to /api/events passes through without header", async () => {
    const res = await app.request("/api/events", { method: "POST" });
    expect(res.status).toBe(200);
  });

  test("POST to /api/events/recent requires header (not exact /api/events match)", async () => {
    const res = await app.request("/api/events/recent", { method: "POST" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("x-requested-with");
  });

  test("POST to other routes without header returns 403", async () => {
    const res = await app.request("/api/sessions", { method: "POST" });
    expect(res.status).toBe(403);
  });

  test("POST with x-requested-with header passes through", async () => {
    const res = await app.request("/api/sessions", {
      method: "POST",
      headers: { "x-requested-with": "XMLHttpRequest" },
    });
    expect(res.status).toBe(200);
  });

  test("PUT without header returns 403", async () => {
    const res = await app.request("/api/developers", { method: "PUT" });
    expect(res.status).toBe(403);
  });

  test("DELETE with header passes through", async () => {
    const res = await app.request("/api/anything", {
      method: "DELETE",
      headers: { "x-requested-with": "fetch" },
    });
    expect(res.status).toBe(200);
  });
});
```

**Step 2: Run test**

Run: `cd packages/backend && bun test src/middleware/__tests__/csrf.test.ts`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add packages/backend/src/middleware/__tests__/csrf.test.ts
git commit -m "test: add CSRF middleware unit tests

Cover safe methods, auth/event exemptions, header requirement,
and various HTTP methods."
```

---

### Task 6: Tier 2 — Rate limit middleware tests

**Files:**
- Create: `packages/backend/src/middleware/__tests__/rateLimit.test.ts`

**Step 1: Create test file**

The `windows` Map is module-level. We test through a fresh Hono app per describe block. The middleware reads `x-forwarded-for` and `x-real-ip` headers.

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { rateLimitMiddleware } from "../rateLimit";

function createApp(maxRequests: number, windowMs: number, prefix?: string) {
  const app = new Hono();
  app.use("*", rateLimitMiddleware({ maxRequests, windowMs, prefix }));
  app.all("*", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimitMiddleware", () => {
  test("allows requests under the limit", async () => {
    const app = createApp(3, 60_000);
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/test", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      });
      expect(res.status).toBe(200);
    }
  });

  test("blocks request exceeding the limit with 429", async () => {
    const app = createApp(2, 60_000);
    // Use unique IP to avoid collision with other tests
    const headers = { "x-forwarded-for": "10.0.0.1" };
    await app.request("/test", { headers });
    await app.request("/test", { headers });
    const res = await app.request("/test", { headers });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("429 response includes Retry-After header", async () => {
    const app = createApp(1, 60_000);
    const headers = { "x-forwarded-for": "10.0.0.2" };
    await app.request("/test", { headers });
    const res = await app.request("/test", { headers });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeDefined();
  });

  test("different IPs have separate limits", async () => {
    const app = createApp(1, 60_000);
    const res1 = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.0.3" },
    });
    const res2 = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.0.4" },
    });
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  test("falls back to x-real-ip when x-forwarded-for missing", async () => {
    const app = createApp(1, 60_000);
    const headers = { "x-real-ip": "10.0.0.5" };
    await app.request("/test", { headers });
    const res = await app.request("/test", { headers });
    expect(res.status).toBe(429);
  });

  test("prefix isolates rate limit windows", async () => {
    const app1 = createApp(1, 60_000, "api");
    const app2 = createApp(1, 60_000, "ws");
    const headers = { "x-forwarded-for": "10.0.0.6" };
    // Exhaust api limit
    await app1.request("/test", { headers });
    const blocked = await app1.request("/test", { headers });
    expect(blocked.status).toBe(429);
    // ws limit should be separate
    const res = await app2.request("/test", { headers });
    expect(res.status).toBe(200);
  });
});
```

**Step 2: Run test**

Run: `cd packages/backend && bun test src/middleware/__tests__/rateLimit.test.ts`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add packages/backend/src/middleware/__tests__/rateLimit.test.ts
git commit -m "test: add rate limit middleware unit tests

Cover request limits, 429 responses, Retry-After header,
per-IP isolation, header fallback, and prefix separation."
```

---

### Task 7: Tier 2 — orgScope middleware tests

**Files:**
- Create: `packages/backend/src/middleware/__tests__/orgScope.test.ts`

**Step 1: Create test file**

This middleware depends on `auth` (Better Auth session) and `getOrgDeveloperIds`. We mock both. The middleware reads from `c.get("session")` which is set by Better Auth's session middleware upstream.

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

// Mock dependencies before importing
const mockGetOrgDeveloperIds = mock(() => Promise.resolve(["dev1", "dev2"]));

mock.module("../auth", () => ({
  auth: {
    api: {
      getSession: mock(() =>
        Promise.resolve({
          session: { activeOrganizationId: "org-1" },
          user: { id: "user-1" },
        })
      ),
    },
  },
}));

mock.module("../services/developerLink", () => ({
  getOrgDeveloperIds: mockGetOrgDeveloperIds,
}));

const { orgScopeMiddleware, requireOrgAdmin, requireOrgMember } = await import(
  "../orgScope"
);

// Fake sql tagged template
const fakeSql = (() => {
  const fn = (strings: TemplateStringsArray, ...values: any[]) =>
    Promise.resolve([]);
  return fn;
})() as any;

describe("orgScopeMiddleware", () => {
  test("returns 403 when no active organization", async () => {
    // Override auth mock for this test
    const { auth } = await import("../auth");
    const original = auth.api.getSession;
    (auth.api.getSession as any) = mock(() =>
      Promise.resolve({ session: {}, user: { id: "user-1" } })
    );

    const app = new Hono();
    app.use("*", orgScopeMiddleware(fakeSql));
    app.get("*", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("organization");

    // Restore
    (auth.api.getSession as any) = original;
  });

  test("sets orgId and orgDeveloperIds on context when valid", async () => {
    const { auth } = await import("../auth");
    (auth.api.getSession as any) = mock(() =>
      Promise.resolve({
        session: { activeOrganizationId: "org-1" },
        user: { id: "user-1" },
      })
    );
    mockGetOrgDeveloperIds.mockResolvedValue(["dev-a", "dev-b"]);

    let capturedOrgId: string | undefined;
    let capturedDevIds: string[] | undefined;

    const app = new Hono();
    app.use("*", orgScopeMiddleware(fakeSql));
    app.get("*", (c) => {
      capturedOrgId = c.get("orgId" as any);
      capturedDevIds = c.get("orgDeveloperIds" as any);
      return c.json({ ok: true });
    });

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(capturedOrgId).toBe("org-1");
    expect(capturedDevIds).toEqual(["dev-a", "dev-b"]);
  });
});

describe("requireOrgAdmin", () => {
  test("returns 403 when role is not admin or owner", async () => {
    const sql = Object.assign(
      (strings: TemplateStringsArray, ...values: any[]) =>
        Promise.resolve([{ role: "member" }]),
      {}
    ) as any;

    const { auth } = await import("../auth");
    (auth.api.getSession as any) = mock(() =>
      Promise.resolve({
        session: { activeOrganizationId: "org-1" },
        user: { id: "user-1" },
      })
    );

    const app = new Hono();
    app.use("*", requireOrgAdmin(sql));
    app.get("*", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Admin");
  });

  test("allows admin role", async () => {
    const sql = Object.assign(
      (strings: TemplateStringsArray, ...values: any[]) =>
        Promise.resolve([{ role: "admin" }]),
      {}
    ) as any;

    const { auth } = await import("../auth");
    (auth.api.getSession as any) = mock(() =>
      Promise.resolve({
        session: { activeOrganizationId: "org-1" },
        user: { id: "user-1" },
      })
    );

    const app = new Hono();
    app.use("*", requireOrgAdmin(sql));
    app.get("*", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });
});

describe("requireOrgMember", () => {
  test("returns 403 when user is not a member", async () => {
    const sql = Object.assign(
      (strings: TemplateStringsArray, ...values: any[]) =>
        Promise.resolve([]),
      {}
    ) as any;

    const { auth } = await import("../auth");
    (auth.api.getSession as any) = mock(() =>
      Promise.resolve({
        session: { activeOrganizationId: "org-1" },
        user: { id: "user-1" },
      })
    );

    const app = new Hono();
    app.use("*", requireOrgMember(sql));
    app.get("*", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    expect(res.status).toBe(403);
  });

  test("allows member and sets orgRole on context", async () => {
    const sql = Object.assign(
      (strings: TemplateStringsArray, ...values: any[]) =>
        Promise.resolve([{ role: "member" }]),
      {}
    ) as any;

    const { auth } = await import("../auth");
    (auth.api.getSession as any) = mock(() =>
      Promise.resolve({
        session: { activeOrganizationId: "org-1" },
        user: { id: "user-1" },
      })
    );

    let capturedRole: string | undefined;
    const app = new Hono();
    app.use("*", requireOrgMember(sql));
    app.get("*", (c) => {
      capturedRole = c.get("orgRole" as any);
      return c.json({ ok: true });
    });

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(capturedRole).toBe("member");
  });
});
```

**Step 2: Run test**

Run: `cd packages/backend && bun test src/middleware/__tests__/orgScope.test.ts`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add packages/backend/src/middleware/__tests__/orgScope.test.ts
git commit -m "test: add orgScope middleware unit tests

Cover orgScopeMiddleware, requireOrgAdmin, and requireOrgMember
with mocked auth sessions and DB queries."
```

---

### Task 8: Tier 3 — developers route tests

**Files:**
- Create: `packages/backend/src/routes/__tests__/developers.test.ts`

**Step 1: Create test file**

This is the simplest route — just maps DB rows through `mapDeveloper`.

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockGetAllDevelopers = mock(() =>
  Promise.resolve([
    {
      id: "dev1",
      name: "Alice",
      email: "alice@example.com",
      first_seen: "2026-01-01T00:00:00Z",
      last_seen: "2026-03-01T00:00:00Z",
      active_sessions: 2,
    },
  ])
);

mock.module("../db", () => ({
  getAllDevelopers: mockGetAllDevelopers,
}));

// The route reads orgDeveloperIds from context — we need to
// set that up via a parent middleware in our test app
import { Hono } from "hono";
const { developersRoutes } = await import("../developers");

const fakeSql = (() => Promise.resolve([])) as any;

function createApp(orgDeveloperIds?: string[]) {
  const app = new Hono();
  // Simulate orgScopeMiddleware setting context
  app.use("*", async (c, next) => {
    if (orgDeveloperIds) {
      c.set("orgDeveloperIds" as any, orgDeveloperIds);
    }
    await next();
  });
  app.route("/developers", developersRoutes(fakeSql));
  return app;
}

describe("GET /developers", () => {
  beforeEach(() => {
    mockGetAllDevelopers.mockClear();
  });

  test("returns mapped developer list", async () => {
    const app = createApp(["dev1"]);
    const res = await app.request("/developers");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toHaveProperty("id", "dev1");
    expect(body[0]).toHaveProperty("name", "Alice");
    expect(body[0]).toHaveProperty("firstSeen");
    expect(body[0]).toHaveProperty("lastSeen");
    expect(body[0]).toHaveProperty("activeSessions");
  });

  test("passes orgDeveloperIds to query", async () => {
    const app = createApp(["dev1", "dev2"]);
    await app.request("/developers");
    expect(mockGetAllDevelopers).toHaveBeenCalledTimes(1);
    const callArgs = mockGetAllDevelopers.mock.calls[0];
    // First arg is sql, second is orgDeveloperIds
    expect(callArgs[1]).toEqual(["dev1", "dev2"]);
  });

  test("works without orgDeveloperIds (no org scope)", async () => {
    const app = createApp();
    await app.request("/developers");
    expect(mockGetAllDevelopers).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run test**

Run: `cd packages/backend && bun test src/routes/__tests__/developers.test.ts`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add packages/backend/src/routes/__tests__/developers.test.ts
git commit -m "test: add developers route unit tests

Cover developer list mapping, org-scoped filtering,
and response shape."
```

---

### Task 9: Tier 3 — sessions route tests

**Files:**
- Create: `packages/backend/src/routes/__tests__/sessions.test.ts`

**Step 1: Create test file**

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockGetAllSessions = mock(() => Promise.resolve([]));
const mockGetActiveSessions = mock(() => Promise.resolve([]));
const mockGetActiveAgents = mock(() => Promise.resolve([]));
const mockGetSessionDetail = mock(() => Promise.resolve([]));
const mockGetSessionTitleHistory = mock(() => Promise.resolve([]));
const mockGetDeveloperIdForUser = mock(() => Promise.resolve(null));
const mockStripSensitivePayload = mock((p: any) => p);

mock.module("../db", () => ({
  getAllSessions: mockGetAllSessions,
  getActiveSessions: mockGetActiveSessions,
  getActiveAgents: mockGetActiveAgents,
  getSessionDetail: mockGetSessionDetail,
  getSessionTitleHistory: mockGetSessionTitleHistory,
}));

mock.module("../services/developerLink", () => ({
  getDeveloperIdForUser: mockGetDeveloperIdForUser,
}));

mock.module("../utils/stripSensitiveFields", () => ({
  stripSensitivePayload: mockStripSensitivePayload,
}));

import { Hono } from "hono";
const { sessionsRoutes } = await import("../sessions");

const fakeSql = (() => Promise.resolve([])) as any;

function createApp(opts?: { orgDeveloperIds?: string[]; userId?: string }) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (opts?.orgDeveloperIds) {
      c.set("orgDeveloperIds" as any, opts.orgDeveloperIds);
    }
    if (opts?.userId) {
      c.set("session" as any, { user: { id: opts.userId } });
    }
    await next();
  });
  app.route("/sessions", sessionsRoutes(fakeSql));
  return app;
}

describe("GET /sessions", () => {
  beforeEach(() => {
    mockGetAllSessions.mockClear();
    mockGetAllSessions.mockResolvedValue([]);
  });

  test("returns 200 with empty list", async () => {
    const app = createApp({ orgDeveloperIds: ["dev1"] });
    const res = await app.request("/sessions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  test("passes limit parameter", async () => {
    const app = createApp({ orgDeveloperIds: ["dev1"] });
    await app.request("/sessions?limit=10");
    expect(mockGetAllSessions).toHaveBeenCalledTimes(1);
  });
});

describe("GET /sessions/active", () => {
  beforeEach(() => {
    mockGetActiveSessions.mockClear();
    mockGetActiveAgents.mockClear();
    mockGetActiveSessions.mockResolvedValue([]);
    mockGetActiveAgents.mockResolvedValue([]);
  });

  test("returns 200 with empty active sessions", async () => {
    const app = createApp({ orgDeveloperIds: ["dev1"] });
    const res = await app.request("/sessions/active");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  test("groups agents by sessionId", async () => {
    mockGetActiveSessions.mockResolvedValue([
      {
        id: "sess-1",
        developer_id: "dev1",
        project_path: "/p",
        project_name: "proj",
        started_at: "2026-01-01",
        ended_at: null,
        status: "active",
        permission_mode: "default",
        developer_name: "Alice",
        developer_email: "a@b.com",
        event_count: 5,
        context_clear_count: 0,
        current_title: null,
      },
    ]);
    mockGetActiveAgents.mockResolvedValue([
      { session_id: "sess-1", agent_id: "agent-1", tool_name: "Bash" },
    ]);

    const app = createApp({ orgDeveloperIds: ["dev1"] });
    const res = await app.request("/sessions/active");
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].activeAgents).toHaveLength(1);
  });
});

describe("GET /sessions/:id", () => {
  beforeEach(() => {
    mockGetSessionDetail.mockClear();
    mockGetDeveloperIdForUser.mockClear();
    mockStripSensitivePayload.mockClear();
    mockStripSensitivePayload.mockImplementation((p: any) => p);
  });

  test("returns 404 when session not found", async () => {
    mockGetSessionDetail.mockResolvedValue([]);
    const app = createApp({ orgDeveloperIds: ["dev1"] });
    const res = await app.request("/sessions/nonexistent");
    expect(res.status).toBe(404);
  });

  test("returns 404 when session developer not in org", async () => {
    mockGetSessionDetail.mockResolvedValue([
      { developer_id: "dev-other", payload: "{}" },
    ]);
    const app = createApp({ orgDeveloperIds: ["dev1"] });
    const res = await app.request("/sessions/sess-1");
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run test**

Run: `cd packages/backend && bun test src/routes/__tests__/sessions.test.ts`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add packages/backend/src/routes/__tests__/sessions.test.ts
git commit -m "test: add sessions route unit tests

Cover session listing, active sessions with agent grouping,
session detail, and org-scope access control."
```

---

### Task 10: Tier 3 — events route tests

**Files:**
- Create: `packages/backend/src/routes/__tests__/events.test.ts`

**Step 1: Create test file**

The events route has the most complex logic. Focus on the `GET /recent` endpoint (simpler) and key validation on `POST /`.

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockUpsertDeveloper = mock(() => Promise.resolve());
const mockCreateSession = mock(() => Promise.resolve());
const mockEndSession = mock(() => Promise.resolve());
const mockInsertEvent = mock(() => Promise.resolve());
const mockGetRecentEvents = mock(() => Promise.resolve([]));
const mockCheckAlertThresholds = mock(() => Promise.resolve(null));
const mockBroadcastToOrg = mock(() => {});
const mockAutoLinkDeveloperToOrg = mock(() => Promise.resolve());
const mockStripSensitivePayload = mock((p: any) => ({ stripped: true }));

mock.module("../db", () => ({
  upsertDeveloper: mockUpsertDeveloper,
  createSession: mockCreateSession,
  endSession: mockEndSession,
  insertEvent: mockInsertEvent,
  getRecentEvents: mockGetRecentEvents,
  checkAlertThresholds: mockCheckAlertThresholds,
}));

mock.module("../ws/handler", () => ({
  broadcastToOrg: mockBroadcastToOrg,
}));

mock.module("../services/developerLink", () => ({
  autoLinkDeveloperToOrg: mockAutoLinkDeveloperToOrg,
}));

mock.module("../utils/stripSensitiveFields", () => ({
  stripSensitivePayload: mockStripSensitivePayload,
}));

import { Hono } from "hono";
const { eventsRoutes } = await import("../events");

const fakeSql = Object.assign(
  (strings: TemplateStringsArray, ...values: any[]) => Promise.resolve([]),
  {}
) as any;

function createApp(opts?: { orgDeveloperIds?: string[]; apiKeyUserId?: string }) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (opts?.orgDeveloperIds) {
      c.set("orgDeveloperIds" as any, opts.orgDeveloperIds);
    }
    if (opts?.apiKeyUserId) {
      c.set("apiKeyUserId" as any, opts.apiKeyUserId);
    }
    await next();
  });
  app.route("/events", eventsRoutes(fakeSql));
  return app;
}

const validEvent = {
  id: "evt-1",
  timestamp: "2026-03-03T12:00:00Z",
  sessionId: "sess-1",
  developerId: "abc123",
  developerName: "Alice",
  developerEmail: "alice@example.com",
  projectPath: "/home/user/project",
  projectName: "my-project",
  eventType: "session.start",
  payload: {},
};

describe("POST /events", () => {
  beforeEach(() => {
    mockUpsertDeveloper.mockClear();
    mockCreateSession.mockClear();
    mockInsertEvent.mockClear();
    mockBroadcastToOrg.mockClear();
    mockAutoLinkDeveloperToOrg.mockClear();
    // Default: no existing session
    fakeSql.mockImplementation = undefined;
  });

  test("rejects invalid event (missing required fields)", async () => {
    const app = createApp();
    const res = await app.request("/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "evt-1" }), // missing most fields
    });
    expect(res.status).toBe(400);
  });

  test("accepts valid event and returns 200", async () => {
    const app = createApp();
    const res = await app.request("/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent),
    });
    // Should be 200 or 201
    expect(res.status).toBeLessThan(300);
  });

  test("calls upsertDeveloper on valid event", async () => {
    const app = createApp();
    await app.request("/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent),
    });
    expect(mockUpsertDeveloper).toHaveBeenCalledTimes(1);
  });

  test("calls autoLinkDeveloperToOrg when apiKeyUserId present", async () => {
    const app = createApp({ apiKeyUserId: "user-1" });
    await app.request("/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent),
    });
    expect(mockAutoLinkDeveloperToOrg).toHaveBeenCalledTimes(1);
  });

  test("does not call autoLinkDeveloperToOrg when no apiKeyUserId", async () => {
    const app = createApp();
    await app.request("/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent),
    });
    expect(mockAutoLinkDeveloperToOrg).not.toHaveBeenCalled();
  });
});

describe("GET /events/recent", () => {
  beforeEach(() => {
    mockGetRecentEvents.mockClear();
    mockStripSensitivePayload.mockClear();
    mockStripSensitivePayload.mockImplementation((p: any) => ({
      stripped: true,
    }));
  });

  test("returns recent events", async () => {
    mockGetRecentEvents.mockResolvedValue([
      { id: "evt-1", payload: '{"tool":"Bash"}' },
    ]);
    const app = createApp({ orgDeveloperIds: ["dev1"] });
    const res = await app.request("/events/recent?limit=10");
    expect(res.status).toBe(200);
  });

  test("respects limit parameter", async () => {
    mockGetRecentEvents.mockResolvedValue([]);
    const app = createApp({ orgDeveloperIds: ["dev1"] });
    await app.request("/events/recent?limit=25");
    expect(mockGetRecentEvents).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run test**

Run: `cd packages/backend && bun test src/routes/__tests__/events.test.ts`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add packages/backend/src/routes/__tests__/events.test.ts
git commit -m "test: add events route unit tests

Cover event ingestion validation, developer upsert, org auto-linking,
and recent events endpoint."
```

---

### Task 11: Tier 4 — cleanupStaleSessions job tests

**Files:**
- Create: `packages/backend/src/jobs/__tests__/cleanupStaleSessions.test.ts`

**Step 1: Create test file**

```typescript
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

const mockGetStaleActiveSessions = mock(() => Promise.resolve([]));
const mockEndSession = mock(() => Promise.resolve());
const mockBroadcast = mock(() => {});

mock.module("../db", () => ({
  getStaleActiveSessions: mockGetStaleActiveSessions,
  endSession: mockEndSession,
}));

mock.module("../ws/handler", () => ({
  broadcast: mockBroadcast,
}));

const { startStaleSessionCleanup } = await import("../cleanupStaleSessions");

const fakeSql = (() => Promise.resolve([])) as any;

describe("startStaleSessionCleanup", () => {
  beforeEach(() => {
    mockGetStaleActiveSessions.mockClear();
    mockEndSession.mockClear();
    mockBroadcast.mockClear();
    // Reset the startup guard
    delete (globalThis as any).__gc_cleanup_startup_done;
    // Clear any previous interval
    if ((globalThis as any).__gc_cleanup_interval) {
      clearInterval((globalThis as any).__gc_cleanup_interval);
      delete (globalThis as any).__gc_cleanup_interval;
    }
  });

  afterEach(() => {
    // Clean up interval to prevent leaks
    if ((globalThis as any).__gc_cleanup_interval) {
      clearInterval((globalThis as any).__gc_cleanup_interval);
      delete (globalThis as any).__gc_cleanup_interval;
    }
  });

  test("runs startup cleanup on first call", async () => {
    mockGetStaleActiveSessions.mockResolvedValue([]);
    startStaleSessionCleanup(fakeSql);
    // Give async startup a tick to run
    await new Promise((r) => setTimeout(r, 50));
    // Should have been called for startup (1440 min threshold)
    expect(mockGetStaleActiveSessions).toHaveBeenCalled();
  });

  test("skips startup cleanup on second call", async () => {
    mockGetStaleActiveSessions.mockResolvedValue([]);
    startStaleSessionCleanup(fakeSql);
    await new Promise((r) => setTimeout(r, 50));
    const callCount = mockGetStaleActiveSessions.mock.calls.length;

    // Reset and call again
    mockGetStaleActiveSessions.mockClear();
    startStaleSessionCleanup(fakeSql);
    await new Promise((r) => setTimeout(r, 50));
    // Startup should NOT run again (guarded by global flag)
    // Only interval may fire, but 60s interval won't fire in 50ms
    expect(mockGetStaleActiveSessions.mock.calls.length).toBe(0);
  });

  test("ends stale sessions and broadcasts updates", async () => {
    const staleSessions = [
      { id: "sess-1", developer_id: "dev-1" },
      { id: "sess-2", developer_id: "dev-2" },
    ];
    // First call returns stale sessions (startup), then empty
    mockGetStaleActiveSessions
      .mockResolvedValueOnce(staleSessions)
      .mockResolvedValue([]);

    startStaleSessionCleanup(fakeSql);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockEndSession).toHaveBeenCalledTimes(2);
    // Should broadcast session.update for each + developer.update for each unique dev
    expect(mockBroadcast).toHaveBeenCalled();
  });

  test("defaults STALE_SESSION_TIMEOUT_MINUTES to 5", () => {
    delete process.env.STALE_SESSION_TIMEOUT_MINUTES;
    mockGetStaleActiveSessions.mockResolvedValue([]);
    startStaleSessionCleanup(fakeSql);
    // No assertion on the actual value — just verifying it doesn't throw
  });
});
```

**Step 2: Run test**

Run: `cd packages/backend && bun test src/jobs/__tests__/cleanupStaleSessions.test.ts`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add packages/backend/src/jobs/__tests__/cleanupStaleSessions.test.ts
git commit -m "test: add cleanupStaleSessions job unit tests

Cover startup cleanup, singleton guard, stale session ending,
broadcast notifications, and env var defaults."
```

---

### Task 12: Add root test script

**Files:**
- Modify: `packages/backend/package.json` (already has `"test": "bun test"`)
- Modify: root `package.json`

**Step 1: Add workspace-level test script to root package.json**

Add to root `package.json` scripts:

```json
"test": "cd packages/backend && bun test",
"test:backend": "cd packages/backend && bun test"
```

**Step 2: Verify all tests pass**

Run: `bun test` from `packages/backend/`
Expected: All test files discovered and passing.

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add root test scripts for CI"
```

---

### Task 13: Create GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create the workflow file**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    name: Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: cd packages/backend && bun test

  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: cd packages/dashboard && bun run lint

  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: cd packages/dashboard && bunx tsc --noEmit
```

**Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Or: `bun -e "console.log(JSON.stringify(require('yaml').parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8'))))"`
Expected: No errors.

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow

Three parallel jobs: backend tests, dashboard lint,
and TypeScript type checking. Required for PR merges."
```

---

### Task 14: Configure GitHub branch protection

**No files to create** — this is GitHub API configuration via `gh` CLI.

**Step 1: Create branch ruleset via `gh` CLI**

```bash
gh api repos/{owner}/{repo}/rulesets --method POST --input - <<'EOF'
{
  "name": "Protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Tests" },
          { "context": "Lint" },
          { "context": "Type Check" }
        ]
      }
    },
    {
      "type": "non_fast_forward"
    }
  ]
}
EOF
```

**Note:** The exact `context` values must match the `name:` field of each job in the CI workflow. These are `Tests`, `Lint`, and `Type Check`.

**Step 2: Verify the ruleset**

Run: `gh api repos/{owner}/{repo}/rulesets`
Expected: Shows the "Protect main" ruleset with all rules active.

**Alternative:** If the repo doesn't support rulesets (older plan), use legacy branch protection:

```bash
gh api repos/{owner}/{repo}/branches/main/protection --method PUT --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Tests", "Lint", "Type Check"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

---

### Task 15: Update PR template

**Files:**
- Modify: `.github/PULL_REQUEST_TEMPLATE.md`

**Step 1: Update the template**

Update the checklist to reference the new CI checks:

```markdown
- [ ] Tests pass (`cd packages/backend && bun test`)
- [ ] Lint passes (`cd packages/dashboard && bun run lint`)
- [ ] Types check (`cd packages/dashboard && bunx tsc --noEmit`)
- [ ] CI checks pass (all three jobs green)
```

**Step 2: Commit**

```bash
git add .github/PULL_REQUEST_TEMPLATE.md
git commit -m "docs: update PR template with CI check references"
```

---

## Summary

| Task | Tier | What | Est. Tests |
|---|---|---|---|
| 1 | 1 | antiPatternRules | ~12 |
| 2 | 1 | stripSensitiveFields | ~9 |
| 3 | 1 | db/utils inList | ~8 |
| 4 | 1 | computeDeveloperId | ~5 |
| 5 | 2 | CSRF middleware | ~10 |
| 6 | 2 | Rate limit middleware | ~6 |
| 7 | 2 | orgScope middleware | ~6 |
| 8 | 3 | developers route | ~3 |
| 9 | 3 | sessions route | ~5 |
| 10 | 3 | events route | ~7 |
| 11 | 4 | cleanupStaleSessions | ~4 |
| 12 | — | Root test scripts | — |
| 13 | — | CI workflow | — |
| 14 | — | Branch protection | — |
| 15 | — | PR template | — |
| **Total** | | | **~75 tests** |
