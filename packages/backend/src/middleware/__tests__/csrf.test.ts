import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { csrfMiddleware } from "../csrf";

/**
 * Build a minimal Hono app with the CSRF middleware and a catch-all handler
 * that returns 200 for any route/method that passes through.
 */
function createApp() {
  const app = new Hono();
  app.use("*", csrfMiddleware());
  app.all("*", (c) => c.json({ ok: true }, 200));
  return app;
}

// ---------------------------------------------------------------------------
// Safe methods — GET, HEAD, OPTIONS should always pass through
// ---------------------------------------------------------------------------
describe("csrfMiddleware — safe methods", () => {
  const app = createApp();

  test("GET passes through without x-requested-with header", async () => {
    const res = await app.request("/api/some-route", { method: "GET" });
    expect(res.status).toBe(200);
  });

  test("HEAD passes through without x-requested-with header", async () => {
    const res = await app.request("/api/some-route", { method: "HEAD" });
    expect(res.status).toBe(200);
  });

  test("OPTIONS passes through without x-requested-with header", async () => {
    const res = await app.request("/api/some-route", { method: "OPTIONS" });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Exempted paths — /api/auth/* and /api/events (exact)
// ---------------------------------------------------------------------------
describe("csrfMiddleware — exempted paths", () => {
  const app = createApp();

  test("POST to /api/auth/ sub-route passes through without header", async () => {
    const res = await app.request("/api/auth/sign-in", { method: "POST" });
    expect(res.status).toBe(200);
  });

  test("POST to /api/auth/callback/google passes through without header", async () => {
    const res = await app.request("/api/auth/callback/google", {
      method: "POST",
    });
    expect(res.status).toBe(200);
  });

  test("POST to exact /api/events passes through without header", async () => {
    const res = await app.request("/api/events", { method: "POST" });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Non-exempted paths — should require x-requested-with header
// ---------------------------------------------------------------------------
describe("csrfMiddleware — non-exempted mutation requests", () => {
  const app = createApp();

  test("POST without x-requested-with header returns 403", async () => {
    const res = await app.request("/api/settings", { method: "POST" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Missing x-requested-with header");
  });

  test("PUT without x-requested-with header returns 403", async () => {
    const res = await app.request("/api/settings", { method: "PUT" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Missing x-requested-with header");
  });

  test("DELETE without x-requested-with header returns 403", async () => {
    const res = await app.request("/api/resources/123", { method: "DELETE" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Missing x-requested-with header");
  });

  test("PATCH without x-requested-with header returns 403", async () => {
    const res = await app.request("/api/settings", { method: "PATCH" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Missing x-requested-with header");
  });
});

// ---------------------------------------------------------------------------
// Header present — mutation requests should pass through
// ---------------------------------------------------------------------------
describe("csrfMiddleware — header present", () => {
  const app = createApp();

  test("POST with x-requested-with header passes through", async () => {
    const res = await app.request("/api/settings", {
      method: "POST",
      headers: { "x-requested-with": "XMLHttpRequest" },
    });
    expect(res.status).toBe(200);
  });

  test("PUT with x-requested-with header passes through", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "x-requested-with": "XMLHttpRequest" },
    });
    expect(res.status).toBe(200);
  });

  test("DELETE with x-requested-with header passes through", async () => {
    const res = await app.request("/api/resources/123", {
      method: "DELETE",
      headers: { "x-requested-with": "XMLHttpRequest" },
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — /api/events/recent is NOT exempted (only exact /api/events)
// ---------------------------------------------------------------------------
describe("csrfMiddleware — edge cases", () => {
  const app = createApp();

  test("POST to /api/events/recent is NOT exempted (returns 403)", async () => {
    const res = await app.request("/api/events/recent", { method: "POST" });
    expect(res.status).toBe(403);
  });

  test("POST to /api/events/batch is NOT exempted (returns 403)", async () => {
    const res = await app.request("/api/events/batch", { method: "POST" });
    expect(res.status).toBe(403);
  });

  test("POST to /api/auth (no trailing slash) is NOT exempted", async () => {
    const res = await app.request("/api/auth", { method: "POST" });
    expect(res.status).toBe(403);
  });

  test("x-requested-with header with any non-empty value passes", async () => {
    const res = await app.request("/api/settings", {
      method: "POST",
      headers: { "x-requested-with": "fetch" },
    });
    expect(res.status).toBe(200);
  });
});
