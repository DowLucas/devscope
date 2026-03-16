import type { SQL } from "bun";
import { Hono } from "hono";
import { getFrictionAlerts, acknowledgeFrictionAlert, getFrictionRules } from "../db";

export function frictionRoutes(sql: SQL) {
  const app = new Hono();

  // GET / — list friction alerts for org
  app.get("/", async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const sessionId = c.req.query("session_id");
    const acknowledged = c.req.query("acknowledged");
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

    const alerts = await getFrictionAlerts(sql, orgId, {
      sessionId: sessionId || undefined,
      acknowledged: acknowledged !== undefined ? acknowledged === "true" : undefined,
      limit,
    });
    return c.json(alerts);
  });

  // POST /:id/acknowledge
  app.post("/:id/acknowledge", async (c) => {
    const id = c.req.param("id");
    const orgId = c.get("orgId" as never) as string;
    const alert = await acknowledgeFrictionAlert(sql, id, orgId);
    if (!alert) return c.json({ error: "Alert not found" }, 404);
    return c.json(alert);
  });

  // GET /rules
  app.get("/rules", async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const rules = await getFrictionRules(sql, orgId);
    return c.json(rules);
  });

  return app;
}
