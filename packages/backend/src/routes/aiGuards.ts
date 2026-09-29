import type { SQL } from "bun";
import type { Context, Next } from "hono";
import { isAiAvailable } from "../ai/gemini";
import { getTodayTokenCount } from "../db";
import { getClientIp } from "../middleware/rateLimit";

export const AI_DAILY_TOKEN_BUDGET = Number(process.env.AI_DAILY_TOKEN_BUDGET ?? 1_000_000);

// In-memory rate limiter: 20 requests/minute per key
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

/** Rate-limit key: the signed-in user, the API key's owner, or the client IP. */
export function rateLimitKey(c: Context): string {
  const session = c.get("session" as never) as any;
  // API-key requests carry the key owner in `user`, not `session.user`.
  const user = c.get("user" as never) as any;
  return session?.user?.id ?? user?.id ?? getClientIp(c);
}

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(key) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateLimitMap.set(key, recent);
  return true;
}

/** Guard for endpoints that call Gemini: availability, rate limit, daily token budget. */
export function requireAi(sql: SQL) {
  return async (c: Context, next: Next) => {
    if (!isAiAvailable()) {
      return c.json({ error: "AI features unavailable: GEMINI_API_KEY not configured" }, 503);
    }
    if (!checkRateLimit(rateLimitKey(c))) {
      return c.json({ error: "Rate limit exceeded. Max 20 AI requests/minute." }, 429);
    }
    const todayTokens = await getTodayTokenCount(sql);
    if (todayTokens >= AI_DAILY_TOKEN_BUDGET) {
      return c.json({ error: "Daily AI token budget exceeded. Try again tomorrow." }, 429);
    }
    return next();
  };
}
