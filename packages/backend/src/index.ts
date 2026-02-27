import { Hono } from "hono";
import { cors } from "hono/cors";
import { upgradeWebSocket, websocket } from "hono/bun";
import { initializeDatabase } from "./db";
import { eventsRoutes } from "./routes/events";
import { sessionsRoutes } from "./routes/sessions";
import { developersRoutes } from "./routes/developers";
import { addClient, removeClient, getClientCount } from "./ws/handler";

const db = initializeDatabase();
const app = new Hono();

app.use("/api/*", cors({ origin: "*" }));

app.route("/api/events", eventsRoutes(db));
app.route("/api/sessions", sessionsRoutes(db));
app.route("/api/developers", developersRoutes(db));

app.get("/api/health", (c) =>
  c.json({ status: "ok", clients: getClientCount() })
);

app.get(
  "/ws",
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
  }))
);

const PORT = Number(process.env.PORT ?? 3001);

console.log("[groundcontrol] Backend running on http://localhost:" + PORT);
console.log("[groundcontrol] WebSocket on ws://localhost:" + PORT + "/ws");

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
};
