import { Hono } from "hono";
import type { SQL } from "bun";
import {
  getDeveloperToolMastery,
  getDeveloperPatternAdoption,
  getDeveloperSessionQuality,
  getPatternStats,
} from "../db/patternQueries";
import {
  getDeveloperAntiPatterns,
  getAntiPatternStats,
} from "../db/antiPatternQueries";
import { auth } from "../auth";
import crypto from "crypto";

function clampInt(val: string | undefined, def: number, max: number): number {
  if (!val) return def;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : def;
}

async function resolveDeveloperId(sql: SQL, userEmail: string): Promise<string | null> {
  // Developer ID is SHA256 of email (same as plugin)
  const hash = crypto.createHash("sha256").update(userEmail).digest("hex");
  const [dev] = await sql`SELECT id FROM developers WHERE id = ${hash} LIMIT 1`;
  return (dev as any)?.id ?? null;
}

export function skillsRoutes(sql: SQL) {
  const app = new Hono();

  // Resolve developer ID from auth session
  app.use("/*", async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user?.email) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const devId = await resolveDeveloperId(sql, session.user.email);
    c.set("developerId" as never, devId as never);
    return next();
  });

  app.get("/mastery", async (c) => {
    const devId = c.get("developerId" as never) as string | null;
    if (!devId) return c.json([]);
    const weeks = clampInt(c.req.query("weeks"), 12, 52);
    return c.json(await getDeveloperToolMastery(sql, devId, weeks));
  });

  app.get("/patterns", async (c) => {
    const devId = c.get("developerId" as never) as string | null;
    if (!devId) return c.json([]);
    const weeks = clampInt(c.req.query("weeks"), 12, 52);
    return c.json(await getDeveloperPatternAdoption(sql, devId, weeks));
  });

  app.get("/anti-patterns", async (c) => {
    const devId = c.get("developerId" as never) as string | null;
    if (!devId) return c.json([]);
    const weeks = clampInt(c.req.query("weeks"), 12, 52);
    return c.json(await getDeveloperAntiPatterns(sql, devId, weeks));
  });

  app.get("/quality", async (c) => {
    const devId = c.get("developerId" as never) as string | null;
    if (!devId) return c.json([]);
    const weeks = clampInt(c.req.query("weeks"), 12, 52);
    return c.json(await getDeveloperSessionQuality(sql, devId, weeks));
  });

  app.get("/summary", async (c) => {
    const devId = c.get("developerId" as never) as string | null;
    const [patternStats, antiPatternStats] = await Promise.all([
      getPatternStats(sql),
      getAntiPatternStats(sql),
    ]);

    let personalStats = null;
    if (devId) {
      const [mastery, quality] = await Promise.all([
        getDeveloperToolMastery(sql, devId, 4),
        getDeveloperSessionQuality(sql, devId, 4),
      ]);

      const recentQuality = quality.length > 0 ? quality[quality.length - 1] : null;
      const toolCount = new Set(mastery.map((m) => m.tool_name)).size;
      const avgSuccessRate = mastery.length > 0
        ? Math.round((mastery.reduce((sum, m) => sum + m.success_rate, 0) / mastery.length) * 1000) / 1000
        : 0;

      personalStats = {
        tools_used: toolCount,
        avg_success_rate: avgSuccessRate,
        recent_sessions: recentQuality?.sessions ?? 0,
        recent_quality: recentQuality?.avg_success_rate ?? 0,
      };
    }

    return c.json({
      patterns: patternStats,
      antiPatterns: antiPatternStats,
      personal: personalStats,
    });
  });

  return app;
}
