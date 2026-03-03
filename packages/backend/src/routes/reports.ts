import { Hono } from "hono";
import type { SQL } from "bun";
import {
  composeExecutiveScorecard,
  composeManagerSummary,
  composeRoiMetrics,
} from "../services/reportComposers";

function clampInt(val: string | undefined, def: number, max: number): number {
  if (!val) return def;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : def;
}

export function reportsRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/scorecard", async (c) => {
    const days = clampInt(c.req.query("days"), 7, 365);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    return c.json(await composeExecutiveScorecard(sql, days, devIds));
  });

  app.get("/manager-summary", async (c) => {
    const days = clampInt(c.req.query("days"), 7, 365);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    return c.json(await composeManagerSummary(sql, days, devIds));
  });

  app.get("/roi", async (c) => {
    const days = clampInt(c.req.query("days"), 7, 365);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    return c.json(await composeRoiMetrics(sql, days, devIds));
  });

  return app;
}
