import { Hono } from "hono";
import type { SQL } from "bun";
import { getEthicsAuditLog, getEthicsAuditSummary } from "../db";

function clampInt(val: string | undefined, def: number, max: number): number {
  if (!val) return def;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : def;
}

export function ethicsRoutes(sql: SQL) {
  const app = new Hono();

  // GET /api/ethics/audit — paginated audit log
  app.get("/audit", async (c) => {
    const orgId = c.get("orgId" as never) as string | undefined;
    if (!orgId) return c.json({ error: "No active organization" }, 400);

    const limit = clampInt(c.req.query("limit"), 50, 500);
    const offset = clampInt(c.req.query("offset"), 0, 100000);
    const eventType = c.req.query("event_type") || undefined;

    const entries = await getEthicsAuditLog(sql, orgId, limit, offset, eventType);
    return c.json(entries);
  });

  // GET /api/ethics/summary — aggregate counts by event type
  app.get("/summary", async (c) => {
    const orgId = c.get("orgId" as never) as string | undefined;
    if (!orgId) return c.json({ error: "No active organization" }, 400);

    const days = clampInt(c.req.query("days"), 7, 365);
    const summary = await getEthicsAuditSummary(sql, orgId, days);
    return c.json(summary);
  });

  return app;
}
