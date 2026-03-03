import type { Context, Next } from "hono";

/**
 * CSRF protection via custom header check.
 * For non-GET/HEAD/OPTIONS requests, require the x-requested-with header.
 * Skip for API-key-authenticated requests (plugins) and /api/auth/* (Better Auth handles its own CSRF).
 */
export function csrfMiddleware() {
  return async (c: Context, next: Next) => {
    const method = c.req.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next();
    }

    const path = c.req.path;
    // Skip for auth routes (Better Auth handles CSRF) and event ingestion (API key auth)
    if (path.startsWith("/api/auth/") || path.startsWith("/api/events")) {
      return next();
    }

    // Skip if request has API key (plugin requests)
    if (c.req.header("x-api-key")) {
      return next();
    }

    // Require custom header for session-based requests
    const xRequestedWith = c.req.header("x-requested-with");
    if (!xRequestedWith) {
      return c.json({ error: "Missing x-requested-with header" }, 403);
    }

    return next();
  };
}
