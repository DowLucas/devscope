import { describe, expect, test } from "bun:test";
import { apiKeyRateLimitRetryAfter } from "../apiKeyRateLimit";

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
