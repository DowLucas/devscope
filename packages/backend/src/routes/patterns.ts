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
import { isAiAvailable } from "../ai/gemini";
import { runPatternWorkflow } from "../ai/workflows/patternWorkflow";
import { runAntiPatternWorkflow } from "../ai/workflows/antiPatternWorkflow";

export function patternsRoutes(sql: SQL) {
  const app = new Hono();

  // --- Patterns ---

  app.get("/", async (c) => {
    const effectiveness = c.req.query("effectiveness");
    const category = c.req.query("category");
    const limit = Number(c.req.query("limit") ?? 50);

    const patterns = await getPatterns(sql, {
      effectiveness: effectiveness || undefined,
      category: category || undefined,
      limit,
    });
    return c.json(patterns);
  });

  app.get("/stats", async (c) => {
    const days = Number(c.req.query("days") ?? 30);
    const stats = await getPatternStats(sql, days);
    return c.json(stats);
  });

  app.get("/anti", async (c) => {
    const severity = c.req.query("severity");
    const detection_rule = c.req.query("detection_rule");
    const limit = Number(c.req.query("limit") ?? 50);

    const antiPatterns = await getAntiPatterns(sql, {
      severity: severity || undefined,
      detection_rule: detection_rule || undefined,
      limit,
    });
    return c.json(antiPatterns);
  });

  app.get("/anti/stats", async (c) => {
    const days = Number(c.req.query("days") ?? 30);
    const stats = await getAntiPatternStats(sql, days);
    return c.json(stats);
  });

  app.get("/anti/trends", async (c) => {
    const days = Number(c.req.query("days") ?? 30);
    const trends = await getAntiPatternTrends(sql, days);
    return c.json(trends);
  });

  app.get("/anti/:id", async (c) => {
    const ap = await getAntiPatternById(sql, c.req.param("id"));
    if (!ap) return c.json({ error: "Not found" }, 404);
    return c.json(ap);
  });

  app.post("/analyze", async (c) => {
    if (!isAiAvailable()) {
      return c.json({ error: "AI features unavailable" }, 503);
    }

    try {
      const patterns = await runPatternWorkflow(sql, 7);
      const antiPatterns = await runAntiPatternWorkflow(sql, 7);
      return c.json({ patterns, antiPatterns });
    } catch (err) {
      console.error("[patterns] Manual analysis failed:", err);
      return c.json({ error: "Analysis failed" }, 500);
    }
  });

  app.get("/:id", async (c) => {
    const pattern = await getPatternById(sql, c.req.param("id"));
    if (!pattern) return c.json({ error: "Not found" }, 404);
    return c.json(pattern);
  });

  return app;
}
