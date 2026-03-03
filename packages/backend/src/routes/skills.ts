import { Hono } from "hono";
import type { SQL } from "bun";
import {
  getTeamSessionProductivity,
  getTeamSessionOutcomes,
  getTeamPatternAdoption,
  getTeamTopPatterns,
  getTeamSkillsSummary,
} from "../db/patternQueries";
import {
  getTeamAntiPatterns,
  getTeamTopAntiPatterns,
} from "../db/antiPatternQueries";
import { getPlaybooks } from "../db/playbookQueries";
import { isAiAvailable } from "../ai/gemini";
import { runSkillInsightWorkflow } from "../ai/workflows/skillInsightWorkflow";

function clampWeeks(raw: string | undefined, defaultVal: number): number {
  const n = Number(raw ?? defaultVal);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), 52) : defaultVal;
}

function clampLimit(raw: string | undefined, defaultVal: number): number {
  const n = Number(raw ?? defaultVal);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), 500) : defaultVal;
}

export function skillsRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/summary", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[];
    const weeks = clampWeeks(c.req.query("weeks"), 4);
    const summary = await getTeamSkillsSummary(sql, devIds, weeks);
    return c.json(summary);
  });

  app.get("/productivity", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[];
    const weeks = clampWeeks(c.req.query("weeks"), 12);
    const data = await getTeamSessionProductivity(sql, devIds, weeks);
    return c.json(data);
  });

  app.get("/outcomes", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[];
    const weeks = clampWeeks(c.req.query("weeks"), 12);
    const data = await getTeamSessionOutcomes(sql, devIds, weeks);
    return c.json(data);
  });

  app.get("/patterns", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[];
    const weeks = clampWeeks(c.req.query("weeks"), 12);
    const data = await getTeamPatternAdoption(sql, devIds, weeks);
    return c.json(data);
  });

  app.get("/anti-patterns", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[];
    const weeks = clampWeeks(c.req.query("weeks"), 12);
    const data = await getTeamAntiPatterns(sql, devIds, weeks);
    return c.json(data);
  });

  app.get("/top-patterns", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[];
    const weeks = clampWeeks(c.req.query("weeks"), 12);
    const limit = clampLimit(c.req.query("limit"), 10);
    const data = await getTeamTopPatterns(sql, devIds, weeks, limit);
    return c.json(data);
  });

  app.get("/top-anti-patterns", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[];
    const weeks = clampWeeks(c.req.query("weeks"), 12);
    const limit = clampLimit(c.req.query("limit"), 10);
    const data = await getTeamTopAntiPatterns(sql, devIds, weeks, limit);
    return c.json(data);
  });

  app.get("/coaching", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[];
    const weeks = clampWeeks(c.req.query("weeks"), 12);

    const [topAntiPatterns, playbooks] = await Promise.all([
      getTeamTopAntiPatterns(sql, devIds, weeks, 5),
      getPlaybooks(sql, { status: "active", limit: 5 }),
    ]);

    return c.json({ anti_patterns: topAntiPatterns, playbooks });
  });

  app.post("/insights", async (c) => {
    if (!isAiAvailable()) {
      return c.json({ error: "AI features unavailable: GEMINI_API_KEY not configured" }, 503);
    }

    const devIds = c.get("orgDeveloperIds" as never) as string[];
    const weeks = clampWeeks(c.req.query("weeks"), 12);

    const result = await runSkillInsightWorkflow(sql, devIds, weeks);
    if (!result) {
      return c.json({ error: "Failed to generate insights" }, 500);
    }

    return c.json(result);
  });

  return app;
}
