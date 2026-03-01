import { Hono } from "hono";
import { cors } from "hono/cors";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { upgradeWebSocket, websocket } from "hono/bun";
import { initializeDatabase } from "./db";
import { eventsRoutes } from "./routes/events";
import { sessionsRoutes } from "./routes/sessions";
import { developersRoutes } from "./routes/developers";
import { insightsRoutes } from "./routes/insights";
import { alertsRoutes } from "./routes/alerts";
import { exportRoutes } from "./routes/export";
import { addClient, removeClient, getClientCount } from "./ws/handler";
import { startStaleSessionCleanup } from "./jobs/cleanupStaleSessions";
import { startDigestGeneration } from "./jobs/digestGeneration";
import { startAiInsightGeneration } from "./jobs/aiInsights";
import { aiRoutes } from "./routes/ai";

const sql = await initializeDatabase();
startStaleSessionCleanup(sql);
startDigestGeneration(sql);
startAiInsightGeneration(sql);

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
  })
);

// --- Secure headers ---
app.use("/api/*", secureHeaders());

// --- Body size limit (256 KB) ---
app.use("/api/*", bodyLimit({ maxSize: 256 * 1024 }));

// --- Bearer auth (conditional: only when GC_API_KEY is set) ---
const GC_API_KEY = process.env.GC_API_KEY;
if (GC_API_KEY) {
  app.use("/api/*", async (c, next) => {
    // Skip auth for health check
    if (c.req.path === "/api/health") return next();
    return bearerAuth({ token: GC_API_KEY })(c, next);
  });
  console.log("[devscope] API key authentication enabled");
}

app.route("/api/events", eventsRoutes(sql));
app.route("/api/sessions", sessionsRoutes(sql));
app.route("/api/developers", developersRoutes(sql));
app.route("/api/insights", insightsRoutes(sql));
app.route("/api/alerts", alertsRoutes(sql));
app.route("/api/export", exportRoutes(sql));
app.route("/api/ai", aiRoutes(sql));

app.get("/api/health", (c) =>
  c.json({ status: "ok", clients: getClientCount() })
);

const MAX_WS_CLIENTS = 100;

app.get(
  "/ws",
  (c, next) => {
    // Connection limit
    if (getClientCount() >= MAX_WS_CLIENTS) {
      return c.text("Too many connections", 503);
    }
    // Token auth for WebSocket (if API key is set)
    if (GC_API_KEY) {
      const token = new URL(c.req.url).searchParams.get("token");
      if (token !== GC_API_KEY) {
        return c.text("Unauthorized", 401);
      }
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

const PORT = Number(process.env.PORT ?? 3001);

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
