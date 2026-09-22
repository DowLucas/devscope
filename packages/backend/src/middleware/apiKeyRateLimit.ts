/**
 * Translate better-auth's API-key rate limit into an HTTP 429.
 *
 * `auth.api.verifyApiKey` does not throw when a key is over its limit. It
 * returns `{ valid: false, error: { code: "RATE_LIMITED", details: {
 * tryAgainIn } } }`, where `tryAgainIn` is in milliseconds. Treated as an
 * ordinary invalid key, the request fell through to the session check and was
 * answered 401 — and the plugin drops any 4xx other than 429 as a permanently
 * bad event. After every backend restart the plugin replays its outage queue
 * in a burst, trips the limit, and those events were silently lost.
 *
 * Note the limit's shape: better-auth resets the count only after a gap longer
 * than the window since the *previous* request, so it caps an unbroken run of
 * requests less than a window apart, not requests per window.
 */
export function apiKeyRateLimitRetryAfter(result: unknown): number | null {
  const error = (result as { error?: { code?: unknown; details?: { tryAgainIn?: unknown } } } | null)
    ?.error;
  if (error?.code !== "RATE_LIMITED") return null;
  const ms = Number(error.details?.tryAgainIn);
  // Retry-After is whole seconds; never advertise 0, which invites a hot loop.
  return Number.isFinite(ms) && ms > 0 ? Math.max(1, Math.ceil(ms / 1000)) : 1;
}
