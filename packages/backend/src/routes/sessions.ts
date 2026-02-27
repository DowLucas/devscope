import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { getActiveSessions, getAllSessions, getSessionEvents } from "../db";

export function sessionsRoutes(db: Database) {
  const app = new Hono();

  app.get("/", (c) => {
    const limit = Number(c.req.query("limit") ?? 50);
    return c.json(getAllSessions(db, limit));
  });

  app.get("/active", (c) => {
    return c.json(getActiveSessions(db));
  });

  app.get("/:id", (c) => {
    const id = c.req.param("id");
    const events = getSessionEvents(db, id);
    return c.json({ sessionId: id, events });
  });

  return app;
}
