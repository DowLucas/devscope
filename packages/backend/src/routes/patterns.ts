import { Hono } from "hono";
import type { SQL } from "bun";
import {
  getPatterns,
  getPatternById,
  getPatternStats,
} from "../db/patternQueries";
import {
  getAntiPatterns,
  getAntiPatternById,
  getAntiPatternStats,
  getAntiPatternTrends,
} from "../db/antiPatternQueries";
import { runPatternWorkflow } from "../ai/workflows/patternWorkflow";
import { runAntiPatternWorkflow } from "../ai/workflows/antiPatternWorkflow";

function clampInt(val: string | undefined, def: number, max: number): number {
  if (!val) return def;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : def;
}

export function patternsRoutes(sql: SQL) {
  const app = new Hono();

  // --- Session Patterns ---

  app.get("/", async (c) => {
    const effectiveness = c.req.query("effectiveness") || undefined;
    const category = c.req.query("category") || undefined;
    const limit = clampInt(c.req.query("limit"), 50, 200);
    const minOccurrences = clampInt(c.req.query("min_occurrences"), 1, 1000);
    return c.json(await getPatterns(sql, { effectiveness, category, limit, minOccurrences }));
  });

  app.get("/stats", async (c) => {
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getPatternStats(sql, days));
  });

  app.get("/:id", async (c) => {
    const pattern = await getPatternById(sql, c.req.param("id"));
    if (!pattern) return c.json({ error: "Pattern not found" }, 404);
    return c.json(pattern);
  });

  app.post("/analyze", async (c) => {
    const days = clampInt(c.req.query("days"), 1, 30);
    try {
      const patterns = await runPatternWorkflow(sql, days);
      return c.json({ patterns, count: patterns.length });
    } catch (err) {
      console.error("[patterns] Analysis failed:", err);
      return c.json({ error: "Pattern analysis failed" }, 500);
    }
  });

  // --- Anti-Patterns ---

  app.get("/anti", async (c) => {
    const severity = c.req.query("severity") || undefined;
    const detection_rule = c.req.query("detection_rule") || undefined;
    const limit = clampInt(c.req.query("limit"), 50, 200);
    return c.json(await getAntiPatterns(sql, { severity, detection_rule, limit }));
  });

  app.get("/anti/stats", async (c) => {
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getAntiPatternStats(sql, days));
  });

  app.get("/anti/trends", async (c) => {
    const days = clampInt(c.req.query("days"), 30, 365);
    return c.json(await getAntiPatternTrends(sql, days));
  });

  app.get("/anti/:id", async (c) => {
    const ap = await getAntiPatternById(sql, c.req.param("id"));
    if (!ap) return c.json({ error: "Anti-pattern not found" }, 404);
    return c.json(ap);
  });

  app.post("/anti/analyze", async (c) => {
    const days = clampInt(c.req.query("days"), 1, 30);
    try {
      const antiPatterns = await runAntiPatternWorkflow(sql, days);
      return c.json({ antiPatterns, count: antiPatterns.length });
    } catch (err) {
      console.error("[patterns] Anti-pattern analysis failed:", err);
      return c.json({ error: "Anti-pattern analysis failed" }, 500);
    }
  });

  return app;
}
