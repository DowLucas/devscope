import { Hono } from "hono";
import type { SQL } from "bun";
import {
  getDeveloperToolMastery,
  getDeveloperPatternAdoption,
  getDeveloperSessionQuality,
} from "../db/patternQueries";
import { getDeveloperAntiPatterns } from "../db/antiPatternQueries";

/**
 * Resolve the authenticated user's developer ID.
 * The plugin derives developer ID as SHA256(git config user.email),
 * so we look up the developer by matching the auth user's email.
 */
async function resolveDeveloperId(sql: SQL, userEmail: string): Promise<string | null> {
  const [dev] = await sql`
    SELECT id FROM developers WHERE email = ${userEmail} LIMIT 1`;
  return (dev as any)?.id ?? null;
}

export function skillsRoutes(sql: SQL) {
  const app = new Hono();

  // All routes are developer self-view only
  app.use("*", async (c, next) => {
    const user = c.get("user" as never) as any;
    if (!user?.email) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const developerId = await resolveDeveloperId(sql, user.email);
    if (!developerId) {
      return c.json({ error: "No developer profile found for your account" }, 404);
    }

    c.set("developerId" as never, developerId as never);
    return next();
  });

  app.get("/mastery", async (c) => {
    const developerId = c.get("developerId" as never) as string;
    const weeks = Number(c.req.query("weeks") ?? 12);
    const mastery = await getDeveloperToolMastery(sql, developerId, weeks);
    return c.json(mastery);
  });

  app.get("/patterns", async (c) => {
    const developerId = c.get("developerId" as never) as string;
    const weeks = Number(c.req.query("weeks") ?? 12);
    const patterns = await getDeveloperPatternAdoption(sql, developerId, weeks);
    return c.json(patterns);
  });

  app.get("/anti-patterns", async (c) => {
    const developerId = c.get("developerId" as never) as string;
    const weeks = Number(c.req.query("weeks") ?? 12);
    const antiPatterns = await getDeveloperAntiPatterns(sql, developerId, weeks);
    return c.json(antiPatterns);
  });

  app.get("/quality", async (c) => {
    const developerId = c.get("developerId" as never) as string;
    const weeks = Number(c.req.query("weeks") ?? 12);
    const quality = await getDeveloperSessionQuality(sql, developerId, weeks);
    return c.json(quality);
  });

  app.get("/summary", async (c) => {
    const developerId = c.get("developerId" as never) as string;

    const [mastery, patterns, antiPatterns, quality] = await Promise.all([
      getDeveloperToolMastery(sql, developerId, 4),
      getDeveloperPatternAdoption(sql, developerId, 4),
      getDeveloperAntiPatterns(sql, developerId, 4),
      getDeveloperSessionQuality(sql, developerId, 4),
    ]);

    // Compute summary metrics
    const recentMastery = mastery.length > 0
      ? mastery.reduce((sum, m) => sum + m.success_rate * m.total, 0) /
        Math.max(mastery.reduce((sum, m) => sum + m.total, 0), 1)
      : 0;

    const totalAntiPatterns = antiPatterns.reduce((sum, w) => sum + w.count, 0);
    const totalEffective = patterns.reduce((sum, w) => sum + w.effective_count, 0);
    const totalIneffective = patterns.reduce((sum, w) => sum + w.ineffective_count, 0);

    const avgQuality = quality.length > 0
      ? quality.reduce((sum, q) => sum + q.avg_success_rate, 0) / quality.length
      : 0;

    return c.json({
      tool_mastery_rate: Math.round(recentMastery * 1000) / 1000,
      anti_pattern_count: totalAntiPatterns,
      effective_patterns_used: totalEffective,
      ineffective_patterns_used: totalIneffective,
      avg_session_quality: Math.round(avgQuality * 1000) / 1000,
      period_weeks: 4,
    });
  });

  return app;
}
