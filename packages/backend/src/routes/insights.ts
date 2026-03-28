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
  getProjectsOverview,
  getProjectContributors,
  getProjectToolUsage,
  getProjectActivityOverTime,
  getActivityPerMinute,
  getSkillUsageBreakdown,
  getTokenUsageSummary,
  getTokenUsageOverTime,
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
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    return c.json(await getTeamActivitySummary(sql, days, devIds));
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

  app.get("/skills", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    let developerId = c.req.query("developerId") || undefined;
    if (developerId && devIds && devIds.length > 0 && !devIds.includes(developerId)) {
      developerId = undefined;
    }
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getSkillUsageBreakdown(sql, developerId, days, devIds));
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

  // --- Token Usage ---

  app.get("/tokens", async (c) => {
    const days = clampInt(c.req.query("days"), 30, 365);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    if (!devIds || devIds.length === 0) return c.json({ total_input_tokens: 0, total_output_tokens: 0, total_cache_creation_tokens: 0, total_cache_read_tokens: 0, total_estimated_cost_usd: 0, avg_cost_per_session_usd: 0, cache_hit_rate: 0, sessions_with_token_data: 0 });
    return c.json(await getTokenUsageSummary(sql, days, devIds));
  });

  app.get("/tokens/over-time", async (c) => {
    const days = clampInt(c.req.query("days"), 30, 365);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    if (!devIds || devIds.length === 0) return c.json([]);
    return c.json(await getTokenUsageOverTime(sql, days, devIds));
  });

  return app;
}
