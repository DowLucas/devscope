import type { Context, Next } from "hono";

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  prefix?: string;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();

// Periodic cleanup every 5 minutes to prevent unbounded Map growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows) {
    if (entry.resetAt <= now) windows.delete(key);
  }
}, 5 * 60 * 1000);

function getClientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map(s => s.trim());
    return parts[parts.length - 1] || "unknown";
  }
  return c.req.header("x-real-ip") || "unknown";
}

export function rateLimitMiddleware(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    const ip = getClientIp(c);
    const key = config.prefix ? `${config.prefix}:${ip}` : ip;
    const now = Date.now();
    let entry = windows.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + config.windowMs };
      windows.set(key, entry);
    }

    entry.count++;

    if (entry.count > config.maxRequests) {
      return c.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)) } },
      );
    }

    return next();
  };
}
