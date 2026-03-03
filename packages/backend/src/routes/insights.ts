import { Hono } from "hono";
import type { SQL } from "bun";
import {
  getDeveloperActivityOverTime,
  getToolUsageBreakdown,
  getSessionStats,
  getSessionStatsSummary,
  getProjectActivity,
  getTeamActivitySummary,
  getHourlyDistribution,
  getPeriodComparison,
  getToolFailureRates,
  getFailureClusters,
  getTeamHealth,
  getProjectsOverview,
  getProjectContributors,
  getProjectToolUsage,
  getProjectActivityOverTime,
  getActivityPerMinute,
} from "../db";

function clampInt(val: string | undefined, def: number, max: number): number {
  if (!val) return def;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : def;
}

export function insightsRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/team-activity", async (c) => {
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getTeamActivitySummary(sql, days));
  });

  app.get("/activity", async (c) => {
    const developerId = c.req.query("developerId") || undefined;
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getDeveloperActivityOverTime(sql, developerId, days));
  });

  app.get("/tools", async (c) => {
    const developerId = c.req.query("developerId") || undefined;
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getToolUsageBreakdown(sql, developerId, days));
  });

  app.get("/sessions", async (c) => {
    const developerId = c.req.query("developerId") || undefined;
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getSessionStats(sql, developerId, days));
  });

  app.get("/sessions/summary", async (c) => {
    const developerId = c.req.query("developerId") || undefined;
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getSessionStatsSummary(sql, developerId, days));
  });

  app.get("/projects", async (c) => {
    const developerId = c.req.query("developerId") || undefined;
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getProjectActivity(sql, developerId, days));
  });

  app.get("/hourly", async (c) => {
    const developerId = c.req.query("developerId") || undefined;
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getHourlyDistribution(sql, developerId, days));
  });

  app.get("/activity-per-minute", async (c) => {
    const hours = clampInt(c.req.query("hours"), 24, 2160);
    return c.json(await getActivityPerMinute(sql, hours));
  });

  // --- Period Comparison ---
  app.get("/period-comparison", async (c) => {
    const days = clampInt(c.req.query("days"), 7, 365);
    const developerId = c.req.query("developerId") || undefined;
    return c.json(await getPeriodComparison(sql, days, developerId));
  });

  // --- Failure Analysis ---
  app.get("/failures", async (c) => {
    const days = clampInt(c.req.query("days"), 30, 365);
    const developerId = c.req.query("developerId") || undefined;
    return c.json(await getToolFailureRates(sql, days, developerId));
  });

  app.get("/failure-clusters", async (c) => {
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getFailureClusters(sql, days));
  });

  // --- Team Health ---
  app.get("/team-health", async (c) => {
    return c.json(await getTeamHealth(sql));
  });

  // --- Project Board ---
  app.get("/projects/overview", async (c) => {
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getProjectsOverview(sql, days));
  });

  app.get("/projects/:name/contributors", async (c) => {
    const name = c.req.param("name");
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getProjectContributors(sql, name, days));
  });

  app.get("/projects/:name/tools", async (c) => {
    const name = c.req.param("name");
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getProjectToolUsage(sql, name, days));
  });

  app.get("/projects/:name/activity", async (c) => {
    const name = c.req.param("name");
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getProjectActivityOverTime(sql, name, days));
  });

  return app;
}
