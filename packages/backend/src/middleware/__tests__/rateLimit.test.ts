import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { rateLimitMiddleware } from "../rateLimit";

// Helper: create a mini Hono app with rate limiting and a simple OK route
function createApp(config: { maxRequests: number; windowMs: number; prefix?: string }) {
  const app = new Hono();
  app.use("*", rateLimitMiddleware(config));
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

// Helper: make a request with a specific IP via x-forwarded-for
function requestWithIp(app: Hono, ip: string) {
  return app.request("/test", {
    headers: { "x-forwarded-for": ip },
  });
}

// ---------------------------------------------------------------------------
// Basic rate limiting
// ---------------------------------------------------------------------------
describe("rateLimitMiddleware", () => {
  test("allows requests under the limit", async () => {
    const app = createApp({ maxRequests: 3, windowMs: 60_000 });
    const ip = "10.0.1.1";

    const res1 = await requestWithIp(app, ip);
    const res2 = await requestWithIp(app, ip);
    const res3 = await requestWithIp(app, ip);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(200);
  });

  test("returns 429 when count exceeds maxRequests", async () => {
    const app = createApp({ maxRequests: 2, windowMs: 60_000 });
    const ip = "10.0.1.2";

    // Requests 1 and 2 are within limit
    await requestWithIp(app, ip);
    await requestWithIp(app, ip);

    // Request 3 exceeds maxRequests (count=3 > 2)
    const res = await requestWithIp(app, ip);
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body).toEqual({ error: "Too many requests" });
  });

  test("includes Retry-After header on 429 responses", async () => {
    const app = createApp({ maxRequests: 1, windowMs: 30_000 });
    const ip = "10.0.1.3";

    // First request is fine
    await requestWithIp(app, ip);

    // Second request exceeds limit
    const res = await requestWithIp(app, ip);
    expect(res.status).toBe(429);

    const retryAfter = res.headers.get("Retry-After");
    expect(retryAfter).toBeTruthy();

    // Retry-After should be a positive number (seconds until window reset)
    const seconds = Number(retryAfter);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(30);
  });

  test("continues to return 429 for subsequent requests after limit exceeded", async () => {
    const app = createApp({ maxRequests: 1, windowMs: 60_000 });
    const ip = "10.0.1.4";

    await requestWithIp(app, ip);

    const res2 = await requestWithIp(app, ip);
    const res3 = await requestWithIp(app, ip);

    expect(res2.status).toBe(429);
    expect(res3.status).toBe(429);
  });

  // ---------------------------------------------------------------------------
  // IP isolation
  // ---------------------------------------------------------------------------
  test("different IPs have isolated rate limit windows", async () => {
    const app = createApp({ maxRequests: 1, windowMs: 60_000 });
    const ipA = "10.0.2.1";
    const ipB = "10.0.2.2";

    // Use up ipA's limit
    await requestWithIp(app, ipA);
    const resA = await requestWithIp(app, ipA);
    expect(resA.status).toBe(429);

    // ipB should still be allowed
    const resB = await requestWithIp(app, ipB);
    expect(resB.status).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // x-forwarded-for parsing
  // ---------------------------------------------------------------------------
  test("uses rightmost entry from x-forwarded-for (what the trusted proxy recorded)", async () => {
    // New behavior: take rightmost entry — the IP our trusted proxy appended from the TCP connection
    const app = createApp({ maxRequests: 1, windowMs: 60_000 });

    // "client, trusted-proxy" => key is rightmost "10.0.3.99"
    const res1 = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.3.1, 10.0.3.99" },
    });
    expect(res1.status).toBe(200);

    // Same rightmost entry => same key, rate limited
    const res2 = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.3.2, 10.0.3.99" },
    });
    expect(res2.status).toBe(429);

    // Different rightmost entry => different key, allowed
    const res3 = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.3.1, 10.0.3.88" },
    });
    expect(res3.status).toBe(200);
  });

  test("uses the only entry when x-forwarded-for has a single IP", async () => {
    // With 1 entry: index = max(0, 1-1-1) = max(0, -1) = 0
    const app = createApp({ maxRequests: 1, windowMs: 60_000 });

    const res1 = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.4.1" },
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.4.1" },
    });
    expect(res2.status).toBe(429);
  });

  test("handles x-forwarded-for with three entries (uses rightmost)", async () => {
    // 3 entries: rightmost is "10.0.5.99" (what the trusted proxy recorded)
    const app = createApp({ maxRequests: 1, windowMs: 60_000 });

    const res1 = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.5.1, 10.0.5.2, 10.0.5.99" },
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.5.1, 10.0.5.2, 10.0.5.99" },
    });
    expect(res2.status).toBe(429);
  });

  // ---------------------------------------------------------------------------
  // x-real-ip (preferred) and x-forwarded-for (fallback)
  // ---------------------------------------------------------------------------
  test("uses x-real-ip when present", async () => {
    const app = createApp({ maxRequests: 1, windowMs: 60_000 });

    const res1 = await app.request("/test", {
      headers: { "x-real-ip": "10.0.6.1" },
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request("/test", {
      headers: { "x-real-ip": "10.0.6.1" },
    });
    expect(res2.status).toBe(429);
  });

  test("falls back to 'unknown' when no IP headers are present", async () => {
    const app = createApp({ maxRequests: 1, windowMs: 60_000 });

    // First request with no headers goes to "unknown"
    const res1 = await app.request("/test");
    expect(res1.status).toBe(200);

    // Second request also maps to "unknown", should be rate limited
    const res2 = await app.request("/test");
    expect(res2.status).toBe(429);
  });

  test("x-real-ip takes precedence over x-forwarded-for", async () => {
    // New behavior: x-real-ip is preferred (set by trusted proxy from TCP connection, cannot be spoofed)
    const app = createApp({ maxRequests: 1, windowMs: 60_000 });

    // Use up limit for x-real-ip "10.0.7.2" (x-real-ip wins over x-forwarded-for)
    await app.request("/test", {
      headers: {
        "x-forwarded-for": "10.0.7.1",
        "x-real-ip": "10.0.7.2",
      },
    });

    // Same x-real-ip => same key, rate limited
    const res = await app.request("/test", {
      headers: {
        "x-forwarded-for": "10.0.7.1",
        "x-real-ip": "10.0.7.2",
      },
    });
    expect(res.status).toBe(429);

    // x-forwarded-for alone with a different IP is its own key, still allowed
    const res2 = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.7.1" },
    });
    expect(res2.status).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // Prefix isolation
  // ---------------------------------------------------------------------------
  test("prefix namespaces the rate limit window", async () => {
    const appA = createApp({ maxRequests: 1, windowMs: 60_000, prefix: "api" });
    const appB = createApp({ maxRequests: 1, windowMs: 60_000, prefix: "auth" });
    const ip = "10.0.8.1";

    // Use up limit on appA (prefix "api")
    await requestWithIp(appA, ip);
    const resA = await requestWithIp(appA, ip);
    expect(resA.status).toBe(429);

    // Same IP on appB (prefix "auth") should still be allowed
    const resB = await requestWithIp(appB, ip);
    expect(resB.status).toBe(200);
  });

  test("unprefixed and prefixed windows are isolated", async () => {
    const appNoPrefix = createApp({ maxRequests: 1, windowMs: 60_000 });
    const appWithPrefix = createApp({ maxRequests: 1, windowMs: 60_000, prefix: "special" });
    const ip = "10.0.8.2";

    // Use up limit on unprefixed app
    await requestWithIp(appNoPrefix, ip);
    const res1 = await requestWithIp(appNoPrefix, ip);
    expect(res1.status).toBe(429);

    // Prefixed app with same IP should still be allowed
    const res2 = await requestWithIp(appWithPrefix, ip);
    expect(res2.status).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // keyFn
  // ---------------------------------------------------------------------------
  test("keyFn overrides IP-based keying", async () => {
    const app = new Hono();
    app.use("*", rateLimitMiddleware({
      maxRequests: 1,
      windowMs: 60_000,
      prefix: "keyfn-test",
      keyFn: () => "fixed-user-id",
    }));
    app.get("/test", (c) => c.json({ ok: true }));

    const res1 = await app.request("/test", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(res1.status).toBe(200);

    // Same keyFn result ("fixed-user-id") regardless of IP — should be rate limited
    const res2 = await app.request("/test", { headers: { "x-forwarded-for": "5.6.7.8" } });
    expect(res2.status).toBe(429);
  });

  test("keyFn isolates windows per user ID", async () => {
    const users = ["user-a", "user-b"];
    let callCount = 0;
    const app = new Hono();
    app.use("*", rateLimitMiddleware({
      maxRequests: 1,
      windowMs: 60_000,
      prefix: "keyfn-users",
      keyFn: () => users[callCount++ % 2],
    }));
    app.get("/test", (c) => c.json({ ok: true }));

    // Requests alternate between user-a and user-b — each gets their own window
    const resA1 = await app.request("/test"); // user-a, count=1
    const resB1 = await app.request("/test"); // user-b, count=1
    expect(resA1.status).toBe(200);
    expect(resB1.status).toBe(200);

    const resA2 = await app.request("/test"); // user-a, count=2 > maxRequests(1)
    const resB2 = await app.request("/test"); // user-b, count=2 > maxRequests(1)
    expect(resA2.status).toBe(429);
    expect(resB2.status).toBe(429);
  });

  test("keyFn with prefix namespaces correctly", async () => {
    const app = new Hono();
    app.use("*", rateLimitMiddleware({
      maxRequests: 1,
      windowMs: 60_000,
      prefix: "myprefix",
      keyFn: () => "user-123",
    }));
    app.get("/test", (c) => c.json({ ok: true }));

    const res1 = await app.request("/test");
    expect(res1.status).toBe(200);

    const res2 = await app.request("/test");
    expect(res2.status).toBe(429);
  });

  // ---------------------------------------------------------------------------
  // Window expiration
  // ---------------------------------------------------------------------------
  test("resets the window after windowMs elapses", async () => {
    // Use a very short window (50ms)
    const app = createApp({ maxRequests: 1, windowMs: 50 });
    const ip = "10.0.9.1";

    await requestWithIp(app, ip);
    const blocked = await requestWithIp(app, ip);
    expect(blocked.status).toBe(429);

    // Wait for the window to expire
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should be allowed again after window reset
    const allowed = await requestWithIp(app, ip);
    expect(allowed.status).toBe(200);
  });
});
