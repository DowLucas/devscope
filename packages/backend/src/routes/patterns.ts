import { Hono } from "hono";
import type { SQL } from "bun";
import {
  getPatterns,
  getPatternById,
  getPatternStats,
} from "../db/patternQueries";
import { withoutContext } from "../db/utils";
import {
  getAntiPatterns,
  getAntiPatternById,
  getAntiPatternStats,
  getAntiPatternTrends,
} from "../db/antiPatternQueries";
import { isAiAvailable } from "../ai/gemini";
import { runPatternWorkflow } from "../ai/workflows/patternWorkflow";
import { runAntiPatternWorkflow } from "../ai/workflows/antiPatternWorkflow";

const VALID_EFFECTIVENESS = new Set(["effective", "neutral", "ineffective"]);
const VALID_SEVERITY = new Set(["info", "warning", "critical"]);

export function patternsRoutes(sql: SQL) {
  const app = new Hono();

  // Patterns are owned by one org (organization_id); every read and analysis is scoped to the caller's.
  const orgOf = (c: { get: (k: never) => unknown }) => c.get("orgId" as never) as string;

  // --- Patterns ---

  app.get("/", async (c) => {
    const effectiveness = c.req.query("effectiveness");
    const category = c.req.query("category");
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 500);

    if (effectiveness && !VALID_EFFECTIVENESS.has(effectiveness)) {
      return c.json({ error: "Invalid effectiveness parameter" }, 400);
    }

    const patterns = await getPatterns(sql, orgOf(c), {
      effectiveness: effectiveness || undefined,
      category: category || undefined,
      limit,
    });
    return c.json(patterns.map(withoutContext));
  });

  app.get("/stats", async (c) => {
    const days = Math.min(Math.max(Number(c.req.query("days") ?? 30), 1), 365);
    const stats = await getPatternStats(sql, orgOf(c), days);
    return c.json({ ...stats, top_patterns: stats.top_patterns.map(withoutContext) });
  });

  app.get("/anti", async (c) => {
    const severity = c.req.query("severity");
    const detection_rule = c.req.query("detection_rule");
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 500);

    if (severity && !VALID_SEVERITY.has(severity)) {
      return c.json({ error: "Invalid severity parameter" }, 400);
    }

    const antiPatterns = await getAntiPatterns(sql, orgOf(c), {
      severity: severity || undefined,
      detection_rule: detection_rule || undefined,
      limit,
    });
    return c.json(antiPatterns.map(withoutContext));
  });

  app.get("/anti/stats", async (c) => {
    const days = Math.min(Math.max(Number(c.req.query("days") ?? 30), 1), 365);
    const stats = await getAntiPatternStats(sql, orgOf(c), days);
    return c.json({ ...stats, top_anti_patterns: stats.top_anti_patterns.map(withoutContext) });
  });

  app.get("/anti/trends", async (c) => {
    const days = Math.min(Math.max(Number(c.req.query("days") ?? 30), 1), 365);
    const trends = await getAntiPatternTrends(sql, orgOf(c), days);
    return c.json(trends);
  });

  app.get("/anti/:id", async (c) => {
    const ap = await getAntiPatternById(sql, orgOf(c), c.req.param("id"));
    if (!ap) return c.json({ error: "Not found" }, 404);
    return c.json(withoutContext(ap));
  });

  app.post("/analyze", async (c) => {
    if (!isAiAvailable()) {
      return c.json({ error: "AI features unavailable" }, 503);
    }

    try {
      const patterns = await runPatternWorkflow(sql, orgOf(c), 7);
      const antiPatterns = await runAntiPatternWorkflow(sql, orgOf(c), 7);
      return c.json({
        patterns: patterns.map(withoutContext),
        antiPatterns: antiPatterns.map(withoutContext),
      });
    } catch (err) {
      console.error("[patterns] Manual analysis failed:", err);
      return c.json({ error: "Analysis failed" }, 500);
    }
  });

  app.get("/:id", async (c) => {
    const pattern = await getPatternById(sql, orgOf(c), c.req.param("id"));
    if (!pattern) return c.json({ error: "Not found" }, 404);
    return c.json(withoutContext(pattern));
  });

  return app;
}
