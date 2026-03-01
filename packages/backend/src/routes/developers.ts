import { Hono } from "hono";
import type { SQL } from "bun";
import { getAllDevelopers } from "../db";

function mapDeveloper(row: any) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    activeSessions: row.active_sessions,
  };
}

export function developersRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/", async (c) => {
    const rows = await getAllDevelopers(sql);
    return c.json((rows as any[]).map(mapDeveloper));
  });

  return app;
}
