import type { SQL } from "bun";
import { Hono } from "hono";
import { getTeamToolTopology, getTeamSkillGaps } from "../db";

export function topologyRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/", async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const data = await getTeamToolTopology(sql, orgId);
    return c.json(data);
  });

  app.get("/gaps", async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const gaps = await getTeamSkillGaps(sql, orgId);
    return c.json(gaps);
  });

  return app;
}
