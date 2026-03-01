import { Hono } from "hono";
import type { SQL } from "bun";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  getAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  getRecentAlerts,
  acknowledgeAlert,
} from "../db";

const alertRuleCreateSchema = z.object({
  rule_type: z.enum(["failure_threshold"]).default("failure_threshold"),
  threshold: z.number().int().min(1).max(100).default(3),
  window_minutes: z.number().int().min(1).max(1440).default(10),
  tool_name: z.string().max(200).nullable().default(null),
  enabled: z.boolean().default(true),
});

const alertRuleUpdateSchema = z.object({
  rule_type: z.enum(["failure_threshold"]).optional(),
  threshold: z.number().int().min(1).max(100).optional(),
  window_minutes: z.number().int().min(1).max(1440).optional(),
  tool_name: z.string().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
});

function clampInt(val: string | undefined, def: number, max: number): number {
  if (!val) return def;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : def;
}

export function alertsRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/rules", async (c) => {
    return c.json(await getAlertRules(sql));
  });

  app.post("/rules", zValidator("json", alertRuleCreateSchema), async (c) => {
    const body = c.req.valid("json");
    const rule = await createAlertRule(sql, {
      rule_type: body.rule_type,
      threshold: body.threshold,
      window_minutes: body.window_minutes,
      tool_name: body.tool_name,
      enabled: body.enabled,
    });
    return c.json(rule, 201);
  });

  app.put("/rules/:id", zValidator("json", alertRuleUpdateSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    await updateAlertRule(sql, id, body);
    return c.json({ ok: true });
  });

  app.delete("/rules/:id", async (c) => {
    const id = c.req.param("id");
    await deleteAlertRule(sql, id);
    return c.json({ ok: true });
  });

  app.get("/recent", async (c) => {
    const limit = clampInt(c.req.query("limit"), 50, 500);
    return c.json(await getRecentAlerts(sql, limit));
  });

  app.post("/:id/acknowledge", async (c) => {
    const id = c.req.param("id");
    await acknowledgeAlert(sql, id);
    return c.json({ ok: true });
  });

  return app;
}
