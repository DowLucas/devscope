import type { Context, Next } from "hono";

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  prefix?: string;
  keyFn?: (c: Context) => string;
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

export function getClientIp(c: Context): string {
  // Only headers our own front proxy sets or overwrites can be trusted; anything
  // else is client-controlled and would let a caller pick their own rate-limit
  // bucket. The two supported front doors:
  //   - Cloudflare Tunnel (production): Cloudflare always overwrites
  //     CF-Connecting-IP, but passes a client-sent X-Real-IP through untouched.
  //   - Caddy / nginx (self-hosted compose): they overwrite X-Real-IP with the
  //     TCP peer and strip CF-Connecting-IP (docker/Caddyfile, docker/nginx).
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) return cfIp;

  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp;

  // Fallback: X-Forwarded-For for environments without either header.
  // Take the rightmost entry, which is what our trusted proxy recorded from the TCP connection.
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map(s => s.trim());
    return parts[parts.length - 1] || "unknown";
  }
  return "unknown";
}

export function rateLimitMiddleware(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    const rawKey = config.keyFn ? config.keyFn(c) : getClientIp(c);
    const key = config.prefix ? `${config.prefix}:${rawKey}` : rawKey;
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
