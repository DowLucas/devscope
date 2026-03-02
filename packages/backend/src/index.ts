import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { upgradeWebSocket, websocket } from "hono/bun";
import { serveStatic } from "hono/bun";
import { initializeDatabase } from "./db";
import { auth } from "./auth";
import { seedDefaultAdmin } from "./auth/seedAdmin";
import { eventsRoutes } from "./routes/events";
import { sessionsRoutes } from "./routes/sessions";
import { developersRoutes } from "./routes/developers";
import { insightsRoutes } from "./routes/insights";
import { alertsRoutes } from "./routes/alerts";
import { exportRoutes } from "./routes/export";
import { teamsRoutes } from "./routes/teams";
import { addClient, removeClient, getClientCount } from "./ws/handler";
import { startStaleSessionCleanup } from "./jobs/cleanupStaleSessions";
import { startDigestGeneration } from "./jobs/digestGeneration";
import { aiRoutes } from "./routes/ai";
import { reportsRoutes } from "./routes/reports";
import { orgScopeMiddleware } from "./middleware/orgScope";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { getPublicStats } from "./db/queries";
import type { Context, Next } from "hono";

const sql = await initializeDatabase();
await seedDefaultAdmin(sql);
startStaleSessionCleanup(sql);
startDigestGeneration(sql);

// Seed a default alert rule if none exist
const [existingRules] = await sql`SELECT COUNT(*)::INT as cnt FROM alert_rules`;
if ((existingRules as any)?.cnt === 0) {
  await sql`
    INSERT INTO alert_rules (id, rule_type, threshold, window_minutes, tool_name, enabled)
    VALUES (${crypto.randomUUID()}, 'failure_threshold', 3, 10, NULL, TRUE)`;
  console.log("[devscope] Seeded default alert rule (3 failures in 10 minutes)");
}

const app = new Hono();

// --- CORS: restrict origins (default localhost:5173; comma-separated via env) ---
const corsRaw = process.env.GC_CORS_ORIGIN ?? "http://localhost:5173";
const allowedOrigins = corsRaw.split(",").map((o) => o.trim()).filter(Boolean);

app.use(
  "/api/*",
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-api-key"],
    credentials: true,
  })
);

// --- Secure headers ---
app.use("/api/*", secureHeaders());

// --- Body size limit (256 KB) — skip auth routes (better-auth reads body directly) ---
app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/auth/")) return next();
  return bodyLimit({ maxSize: 256 * 1024 })(c, next);
});

// --- Public routes (no auth, rate-limited) ---
app.use("/api/public/*", rateLimitMiddleware({ maxRequests: 30, windowMs: 60_000 }));

let cachedStats: { data: unknown; expiresAt: number } | null = null;

app.get("/api/public/stats", async (c) => {
  const now = Date.now();
  if (!cachedStats || cachedStats.expiresAt <= now) {
    cachedStats = { data: await getPublicStats(sql), expiresAt: now + 30_000 };
  }
  return c.json(cachedStats.data);
});

// --- better-auth handler (pass raw Request untouched) ---
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

// --- Auth middleware helpers ---
async function requireSession(c: Context, next: Next) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("user" as never, session.user as never);
  c.set("session" as never, session.session as never);
  return next();
}

async function requireApiKeyOrSession(c: Context, next: Next) {
  const apiKeyHeader = c.req.header("x-api-key");
  if (apiKeyHeader) {
    try {
      const result = await auth.api.verifyApiKey({ body: { key: apiKeyHeader } });
      if (result?.valid) {
        // Resolve the API key owner's userId for auto-linking developers to their org
        const key = (result as any).key;
        if (key?.referenceId) {
          c.set("apiKeyUserId" as never, key.referenceId as never);
        }
        return next();
      }
    } catch {
      // Fall through to session check
    }
  }
  // Fall back to session cookie
  return requireSession(c, next);
}

// --- Protected routes ---
// Event ingestion accepts API keys or session cookies
app.use("/api/events/*", requireApiKeyOrSession);
app.use("/api/events", requireApiKeyOrSession);

// All other API routes require a session (skip health, auth, and events — events use apikey middleware above)
app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  if (path === "/api/health" || path === "/api/verify-connection" || path.startsWith("/api/auth/") || path.startsWith("/api/events") || path.startsWith("/api/public/")) {
    return next();
  }
  return requireSession(c, next);
});

// Org scope middleware — resolves active org's developer IDs onto context
app.use("/api/events/recent", orgScopeMiddleware(sql));
app.use("/api/sessions/*", orgScopeMiddleware(sql));
app.use("/api/sessions", orgScopeMiddleware(sql));
app.use("/api/developers/*", orgScopeMiddleware(sql));
app.use("/api/developers", orgScopeMiddleware(sql));
app.use("/api/insights/*", orgScopeMiddleware(sql));
app.use("/api/insights", orgScopeMiddleware(sql));

app.route("/api/events", eventsRoutes(sql));
app.route("/api/sessions", sessionsRoutes(sql));
app.route("/api/developers", developersRoutes(sql));
app.route("/api/insights", insightsRoutes(sql));
app.route("/api/alerts", alertsRoutes(sql));
app.route("/api/export", exportRoutes(sql));
app.route("/api/ai", aiRoutes(sql));
app.route("/api/reports", reportsRoutes(sql));
app.route("/api/teams", teamsRoutes(sql));

app.get("/api/health", (c) =>
  c.json({ status: "ok", clients: getClientCount() })
);

app.post("/api/verify-connection", async (c) => {
  const key = c.req.header("x-api-key");
  if (!key) {
    return c.json({ valid: false, error: "Missing x-api-key header" }, 400);
  }
  try {
    const result = await auth.api.verifyApiKey({ body: { key } });
    if (result?.valid) {
      return c.json({ valid: true });
    }
    return c.json({ valid: false, error: "Invalid API key" });
  } catch {
    return c.json({ valid: false, error: "Invalid API key" });
  }
});

const MAX_WS_CLIENTS = 100;

app.get(
  "/ws",
  async (c, next) => {
    // Connection limit
    if (getClientCount() >= MAX_WS_CLIENTS) {
      return c.text("Too many connections", 503);
    }
    // Verify session cookie for WebSocket
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.text("Unauthorized", 401);
    }
    return next();
  },
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      addClient(ws);
      console.log("[ws] Client connected (" + getClientCount() + " total)");
    },
    onMessage(event, _ws) {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.type === "subscribe") {
          console.log("[ws] Client subscribed");
        }
      } catch {
        // Ignore non-JSON messages
      }
    },
    onClose(_event, ws) {
      removeClient(ws);
      console.log("[ws] Client disconnected (" + getClientCount() + " total)");
    },
    onError(_event, ws) {
      removeClient(ws);
      console.log("[ws] Client error (" + getClientCount() + " total)");
    },
  }))
);

// --- Static file serving (Railway / single-container production) ---
if (process.env.SERVE_STATIC === "true") {
  const staticRoot = process.env.STATIC_ROOT || "./packages/backend/dist";
  app.use("/assets/*", serveStatic({ root: staticRoot }));
  app.use("*", serveStatic({ root: staticRoot }));
  app.use("*", serveStatic({ root: staticRoot, path: "index.html" }));
  console.log(`[devscope] Serving static dashboard from ${staticRoot}`);
}

const PORT = Number(process.env.PORT ?? 6767);

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[devscope] Received ${signal}, shutting down...`);
  try {
    sql.close();
    console.log("[devscope] Database connection closed");
  } catch (err) {
    console.error("[devscope] Error during shutdown:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log("[devscope] Backend running on http://localhost:" + PORT);
console.log("[devscope] WebSocket on ws://localhost:" + PORT + "/ws");

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
};
