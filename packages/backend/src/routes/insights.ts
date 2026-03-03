import { Hono } from "hono";
import type { SQL } from "bun";
import {
  getDeveloperActivityOverTime,
  getToolUsageBreakdown,
  getSessionStats,
  getSessionStatsSummary,
  getProjectActivity,
  getDeveloperLeaderboard,
  getHourlyDistribution,
  getPeriodComparison,
  getDeveloperComparison,
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

  app.get("/leaderboard", async (c) => {
    const days = clampInt(c.req.query("days"), 30, 365);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    return c.json(await getDeveloperLeaderboard(sql, days, devIds));
  });

  app.get("/activity", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    let developerId = c.req.query("developerId") || undefined;
    if (developerId && devIds && devIds.length > 0 && !devIds.includes(developerId)) {
      developerId = undefined; // Not in org, ignore
    }
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getDeveloperActivityOverTime(sql, developerId, days, devIds));
  });

  app.get("/tools", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    let developerId = c.req.query("developerId") || undefined;
    if (developerId && devIds && devIds.length > 0 && !devIds.includes(developerId)) {
      developerId = undefined;
    }
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getToolUsageBreakdown(sql, developerId, days, devIds));
  });

  app.get("/sessions", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    let developerId = c.req.query("developerId") || undefined;
    if (developerId && devIds && devIds.length > 0 && !devIds.includes(developerId)) {
      developerId = undefined;
    }
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getSessionStats(sql, developerId, days, devIds));
  });

  app.get("/sessions/summary", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    let developerId = c.req.query("developerId") || undefined;
    if (developerId && devIds && devIds.length > 0 && !devIds.includes(developerId)) {
      developerId = undefined;
    }
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getSessionStatsSummary(sql, developerId, days, devIds));
  });

  app.get("/projects", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    let developerId = c.req.query("developerId") || undefined;
    if (developerId && devIds && devIds.length > 0 && !devIds.includes(developerId)) {
      developerId = undefined;
    }
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getProjectActivity(sql, developerId, days, devIds));
  });

  app.get("/hourly", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    let developerId = c.req.query("developerId") || undefined;
    if (developerId && devIds && devIds.length > 0 && !devIds.includes(developerId)) {
      developerId = undefined;
    }
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getHourlyDistribution(sql, developerId, days, devIds));
  });

  app.get("/activity-per-minute", async (c) => {
    const hours = clampInt(c.req.query("hours"), 24, 2160);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    return c.json(await getActivityPerMinute(sql, hours, devIds));
  });

  // --- Period Comparison ---
  app.get("/period-comparison", async (c) => {
    const days = clampInt(c.req.query("days"), 7, 365);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    let developerId = c.req.query("developerId") || undefined;
    if (developerId && devIds && devIds.length > 0 && !devIds.includes(developerId)) {
      developerId = undefined;
    }
    return c.json(await getPeriodComparison(sql, days, developerId, devIds));
  });

  // --- Developer Comparison ---
  app.get("/comparison", async (c) => {
    const developerIdsRaw = c.req.query("developerIds") || "";
    let developerIds = developerIdsRaw.split(",").filter(Boolean);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    if (devIds && devIds.length > 0) {
      developerIds = developerIds.filter((id) => devIds.includes(id));
    }
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getDeveloperComparison(sql, developerIds, days));
  });

  // --- Failure Analysis ---
  app.get("/failures", async (c) => {
    const days = clampInt(c.req.query("days"), 30, 365);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    let developerId = c.req.query("developerId") || undefined;
    if (developerId && devIds && devIds.length > 0 && !devIds.includes(developerId)) {
      developerId = undefined;
    }
    return c.json(await getToolFailureRates(sql, days, developerId, devIds));
  });

  app.get("/failure-clusters", async (c) => {
    const days = clampInt(c.req.query("days"), 30, 365);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    return c.json(await getFailureClusters(sql, days, devIds));
  });

  // --- Team Health ---
  app.get("/team-health", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    return c.json(await getTeamHealth(sql, devIds));
  });

  // --- Project Board ---
  app.get("/projects/overview", async (c) => {
    const days = clampInt(c.req.query("days"), 30, 365);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    return c.json(await getProjectsOverview(sql, days, devIds));
  });

  app.get("/projects/:name/contributors", async (c) => {
    const name = c.req.param("name");
    const days = clampInt(c.req.query("days"), 30, 365);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    return c.json(await getProjectContributors(sql, name, days, devIds));
  });

  app.get("/projects/:name/tools", async (c) => {
    const name = c.req.param("name");
    const days = clampInt(c.req.query("days"), 30, 365);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    return c.json(await getProjectToolUsage(sql, name, days, devIds));
  });

  app.get("/projects/:name/activity", async (c) => {
    const name = c.req.param("name");
    const days = clampInt(c.req.query("days"), 30, 365);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    return c.json(await getProjectActivityOverTime(sql, name, days, devIds));
  });

  return app;
}
