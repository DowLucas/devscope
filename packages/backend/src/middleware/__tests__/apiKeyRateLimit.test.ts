import { describe, expect, test } from "bun:test";
import { apiKeyRateLimitRetryAfter, apiKeyRateLimitRetryAfterFromError } from "../apiKeyRateLimit";

// Shape returned by better-auth's verifyApiKey (@better-auth/api-key 1.5).
const limited = (tryAgainIn: unknown) => ({
  valid: false,
  error: { message: "Rate limit exceeded.", code: "RATE_LIMITED", details: { tryAgainIn } },
  key: null,
});

describe("apiKeyRateLimitRetryAfter", () => {
  test("rate limited -> Retry-After in whole seconds, rounded up", () => {
    expect(apiKeyRateLimitRetryAfter(limited(250))).toBe(1);
    expect(apiKeyRateLimitRetryAfter(limited(1000))).toBe(1);
    expect(apiKeyRateLimitRetryAfter(limited(1001))).toBe(2);
  });

  test("never advertises 0 or garbage", () => {
    expect(apiKeyRateLimitRetryAfter(limited(0))).toBe(1);
    expect(apiKeyRateLimitRetryAfter(limited(null))).toBe(1);
    expect(apiKeyRateLimitRetryAfter(limited("soon"))).toBe(1);
  });

  test("anything else is not a rate limit, so it stays a 401", () => {
    expect(apiKeyRateLimitRetryAfter({ valid: false, error: { code: "KEY_NOT_FOUND" } })).toBeNull();
    expect(apiKeyRateLimitRetryAfter({ valid: false, error: { code: "INVALID_API_KEY" } })).toBeNull();
    expect(apiKeyRateLimitRetryAfter({ valid: true, key: {} })).toBeNull();
    expect(apiKeyRateLimitRetryAfter(null)).toBeNull();
    expect(apiKeyRateLimitRetryAfter(undefined)).toBeNull();
  });
});

describe("apiKeyRateLimitRetryAfterFromError", () => {
  // What better-auth 1.5's verifyApiKey throws (the prod log: status UNAUTHORIZED, code RATE_LIMITED).
  const thrown = (body: unknown) => Object.assign(new Error("Rate limit exceeded."), { status: "UNAUTHORIZED", statusCode: 401, body });

  test("a thrown rate limit is a 429 with Retry-After, not a 401", () => {
    expect(apiKeyRateLimitRetryAfterFromError(thrown({ message: "Rate limit exceeded.", code: "RATE_LIMITED", details: { tryAgainIn: 1500 } }))).toBe(2);
  });

  test("other errors stay errors", () => {
    expect(apiKeyRateLimitRetryAfterFromError(thrown({ code: "INVALID_API_KEY" }))).toBeNull();
    expect(apiKeyRateLimitRetryAfterFromError(new Error("db down"))).toBeNull();
    expect(apiKeyRateLimitRetryAfterFromError(null)).toBeNull();
  });
});
