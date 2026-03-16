import type { SQL } from "bun";
import { Hono } from "hono";
import { getClaudeMdProjects, getClaudeMdTimeline } from "../db";

export function claudeMdRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/projects", async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const projects = await getClaudeMdProjects(sql, orgId);
    return c.json(projects);
  });

  app.get("/timeline", async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const projectPath = c.req.query("project_path");
    if (!projectPath) return c.json({ error: "project_path required" }, 400);
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const timeline = await getClaudeMdTimeline(sql, projectPath, orgId, limit);
    return c.json(timeline);
  });

  return app;
}
