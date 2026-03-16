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
import { addClient, removeClient, getClientCount, getOrgClientCount, broadcastToOrg } from "./ws/handler";
import { startStaleSessionCleanup } from "./jobs/cleanupStaleSessions";
import { startDigestGeneration } from "./jobs/digestGeneration";
import { startAiInsightGeneration } from "./jobs/aiInsights";
import { startPatternAnalysis } from "./jobs/patternAnalysis";
import { startSessionTitleGeneration } from "./jobs/sessionTitleGeneration";
import { startDataRetention } from "./jobs/dataRetention";
import { startToolingHealthCheck } from "./jobs/toolingHealth";
import { startMaturitySnapshotJob } from "./jobs/maturitySnapshot";
import { startBenchmarkComputation } from "./jobs/benchmarkComputation";
import { aiRoutes } from "./routes/ai";
import { patternsRoutes } from "./routes/patterns";
import { skillsRoutes } from "./routes/skills";
import { playbooksRoutes } from "./routes/playbooks";
import { teamSkillsRoutes } from "./routes/teamSkills";
import { ethicsRoutes } from "./routes/ethics";
import { privacyRoutes } from "./routes/privacy";
import { accountRoutes } from "./routes/account";
import { marketplaceRoutes } from "./routes/marketplace";
import { waitlistRoutes } from "./routes/waitlist";
import { orgScopeMiddleware } from "./middleware/orgScope";
import { rateLimitMiddleware, getClientIp } from "./middleware/rateLimit";
import { csrfMiddleware } from "./middleware/csrf";
import { getPublicStats } from "./db/queries";
import { flushEthicsAudit } from "./utils/ethicsAudit";
import type { Context, Next } from "hono";

const sql = await initializeDatabase();

// Refuse to start with default secrets in production
const isProduction = process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT;
if (isProduction) {
  const secret = process.env.BETTER_AUTH_SECRET;
  const dangerousDefaults = ["devscope-dev-secret-change-in-production", "changeme", "changeme123!"];
  if (!secret || dangerousDefaults.includes(secret)) {
    console.error("[devscope] FATAL: BETTER_AUTH_SECRET is not set or uses a default value. Set a strong random secret.");
    process.exit(1);
  }
  const adminPassword = process.env.DEVSCOPE_ADMIN_PASSWORD;
  if (!adminPassword || dangerousDefaults.includes(adminPassword)) {
    console.error("[devscope] FATAL: DEVSCOPE_ADMIN_PASSWORD is not set or uses a default value. Set a secure password in production.");
    process.exit(1);
  }
}

await seedDefaultAdmin(sql);
startStaleSessionCleanup(sql);
startDigestGeneration(sql);
startAiInsightGeneration(sql);
startPatternAnalysis(sql);
startSessionTitleGeneration(sql);
startDataRetention(sql);
startToolingHealthCheck(sql);
startMaturitySnapshotJob(sql);
startBenchmarkComputation(sql);

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
    origin: (origin) => allowedOrigins.includes(origin) ? origin : "",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-api-key", "x-requested-with"],
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

app.use("/api/*", csrfMiddleware());

// --- Public routes (no auth, rate-limited) ---
app.use("/api/public/*", rateLimitMiddleware({ maxRequests: 30, windowMs: 60_000 }));

let cachedStats: { data: unknown; expiresAt: number } | null = null;

app.route("/api/public/waitlist", waitlistRoutes(sql));

app.get("/api/public/stats", async (c) => {
  const now = Date.now();
  if (!cachedStats || cachedStats.expiresAt <= now) {
    cachedStats = { data: await getPublicStats(sql), expiresAt: now + 30_000 };
  }
  return c.json(cachedStats.data);
});

// --- better-auth handler (pass raw Request untouched) ---
app.use("/api/auth/sign-in/*", rateLimitMiddleware({ maxRequests: 10, windowMs: 60_000, prefix: "signin" }));
app.use("/api/auth/sign-up/*", rateLimitMiddleware({ maxRequests: 5, windowMs: 60_000, prefix: "signup" }));

// Block sign-up and OAuth callbacks when the user limit is reached
const userLimit = Number(process.env.USER_LIMIT ?? 100);
async function registrationGuard(c: Context, next: Next) {
  const [row] = await sql`SELECT COUNT(*)::INT as cnt FROM auth_user`;
  if (((row as any).cnt as number) >= userLimit) {
    return c.json({ error: "Registration is closed" }, 403);
  }
  return next();
}
app.use("/api/auth/sign-up/*", registrationGuard);
app.use("/api/auth/callback/*", registrationGuard);

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
// Rate limit event ingestion (120 req/min per IP)
app.use("/api/events", rateLimitMiddleware({ maxRequests: 120, windowMs: 60_000, prefix: "events" }));

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

// Global rate limit for all authenticated routes: 300 req/min per user
app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  if (
    path === "/api/health" ||
    path === "/api/verify-connection" ||
    path.startsWith("/api/auth/") ||
    path.startsWith("/api/events") ||
    path.startsWith("/api/public/")
  ) {
    return next();
  }
  const user = c.get("user" as never) as any;
  return rateLimitMiddleware({
    maxRequests: 300,
    windowMs: 60_000,
    prefix: "auth",
    keyFn: () => user?.id ?? getClientIp(c),
  })(c, next);
});

// Org scope middleware — resolves active org's developer IDs onto context
app.use("/api/events/recent", orgScopeMiddleware(sql));
app.use("/api/sessions/*", orgScopeMiddleware(sql));
app.use("/api/sessions", orgScopeMiddleware(sql));
app.use("/api/developers/*", orgScopeMiddleware(sql));
app.use("/api/developers", orgScopeMiddleware(sql));
app.use("/api/insights/*", orgScopeMiddleware(sql));
app.use("/api/insights", orgScopeMiddleware(sql));
app.use("/api/patterns/*", orgScopeMiddleware(sql));
app.use("/api/patterns", orgScopeMiddleware(sql));
app.use("/api/playbooks/*", orgScopeMiddleware(sql));
app.use("/api/playbooks", orgScopeMiddleware(sql));
app.use("/api/skills/*", orgScopeMiddleware(sql));
app.use("/api/skills", orgScopeMiddleware(sql));
app.use("/api/alerts/*", orgScopeMiddleware(sql));
app.use("/api/alerts", orgScopeMiddleware(sql));
app.use("/api/export/*", rateLimitMiddleware({
  maxRequests: 10,
  windowMs: 60_000,
  prefix: "export",
  keyFn: (c) => (c.get("user" as never) as any)?.id ?? getClientIp(c),
}));
app.use("/api/export", rateLimitMiddleware({
  maxRequests: 10,
  windowMs: 60_000,
  prefix: "export",
  keyFn: (c) => (c.get("user" as never) as any)?.id ?? getClientIp(c),
}));
app.use("/api/export/*", orgScopeMiddleware(sql));
app.use("/api/export", orgScopeMiddleware(sql));
app.use("/api/ai/*", orgScopeMiddleware(sql));
app.use("/api/ai", orgScopeMiddleware(sql));
app.use("/api/team-skills/*", orgScopeMiddleware(sql));
app.use("/api/team-skills", orgScopeMiddleware(sql));
app.use("/api/ethics/*", orgScopeMiddleware(sql));
app.use("/api/ethics", orgScopeMiddleware(sql));
app.use("/api/privacy/*", orgScopeMiddleware(sql));
app.use("/api/privacy", orgScopeMiddleware(sql));
app.use("/api/marketplace/*", orgScopeMiddleware(sql));
app.use("/api/marketplace", orgScopeMiddleware(sql));

app.route("/api/events", eventsRoutes(sql));
app.route("/api/sessions", sessionsRoutes(sql));
app.route("/api/developers", developersRoutes(sql));
app.route("/api/insights", insightsRoutes(sql));
app.route("/api/alerts", alertsRoutes(sql));
app.route("/api/export", exportRoutes(sql));
app.route("/api/ai", aiRoutes(sql));
app.route("/api/teams", teamsRoutes(sql));
app.route("/api/patterns", patternsRoutes(sql));
app.route("/api/skills", skillsRoutes(sql));
app.route("/api/playbooks", playbooksRoutes(sql));
app.route("/api/team-skills", teamSkillsRoutes(sql));
app.route("/api/ethics", ethicsRoutes(sql));
app.route("/api/privacy", privacyRoutes(sql));
app.route("/api/account", accountRoutes(sql));
app.route("/api/marketplace", marketplaceRoutes(sql));

app.get("/api/health", (c) =>
  c.json({ status: "ok", clients: getClientCount() })
);

app.use("/api/verify-connection", rateLimitMiddleware({ maxRequests: 10, windowMs: 60_000, prefix: "verify" }));

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

const MAX_WS_CLIENTS = 500;
const MAX_WS_CLIENTS_PER_ORG = 20;

app.get(
  "/ws",
  async (c, next) => {
    // Global safety cap
    if (getClientCount() >= MAX_WS_CLIENTS) {
      return c.text("Too many connections", 503);
    }
    // Verify session cookie for WebSocket
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.text("Unauthorized", 401);
    }
    // Per-org connection limit
    const orgId = (session.session as any).activeOrganizationId as string | undefined;
    if (orgId && getOrgClientCount(orgId) >= MAX_WS_CLIENTS_PER_ORG) {
      return c.text("Too many connections for this organization", 503);
    }
    // Store orgId for use in onOpen
    c.set("wsOrgId" as never, orgId as never);
    return next();
  },
  upgradeWebSocket((c) => {
    const orgId = (c as any).get?.("wsOrgId") as string | undefined;
    return {
      onOpen(_event, ws) {
        addClient(ws, orgId);
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
    };
  })
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
async function shutdown(signal: string) {
  console.log(`[devscope] Received ${signal}, shutting down...`);
  try {
    await flushEthicsAudit();
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
  idleTimeout: 120, // AI workflows (skill generation, insights) need longer than the 10s default
};
