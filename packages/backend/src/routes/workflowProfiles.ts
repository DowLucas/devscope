import type { SQL } from "bun";
import { Hono } from "hono";
import {
  getWorkflowProfile,
  getWorkflowProfileHistory,
  getTeamWorkflowSummary,
} from "../db";
import { getDeveloperIdForUser } from "../services/developerLink";

export function workflowProfileRoutes(sql: SQL) {
  const app = new Hono();

  // GET /me — current user's latest profile
  app.get("/me", async (c) => {
    const user = c.get("user" as never) as any;
    const devId = user?.id ? await getDeveloperIdForUser(sql, user.id) : null;
    if (!devId) return c.json({ error: "Developer profile not found" }, 404);
    const profile = await getWorkflowProfile(sql, devId);
    if (!profile) return c.json({ error: "No workflow profile computed yet" }, 404);
    return c.json(profile);
  });

  // GET /me/history — personal evolution
  app.get("/me/history", async (c) => {
    const user = c.get("user" as never) as any;
    const devId = user?.id ? await getDeveloperIdForUser(sql, user.id) : null;
    if (!devId) return c.json({ error: "Developer profile not found" }, 404);
    const limit = Math.min(Number(c.req.query("limit") ?? 10), 50);
    const history = await getWorkflowProfileHistory(sql, devId, limit);
    return c.json(history);
  });

  // GET /team-summary — anonymous team aggregates
  app.get("/team-summary", async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    if (!devIds || devIds.length === 0)
      return c.json({ error: "No team members" }, 404);
    const summary = await getTeamWorkflowSummary(sql, orgId, devIds);
    return c.json(summary);
  });

  return app;
}
