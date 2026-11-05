import type { SQL } from "bun";
import { Hono } from "hono";
import type { CommandGroup, CommandScope } from "@devscope/shared";
import { getCommandProjects, getCommandSummary, getCommandTrend } from "../db/commandQueries";
import { getOrgDevIds, getOwnOrgDevIds, getViewerDevIds } from "../services/visibility";

// Bash command timing (command_runs, migration 058): which commands the
// sessions wait on, per project, over time. Every answer is about commands and
// projects; none carries a developer. `scope=me` is the caller's own runs in
// the active org (there is no developerId parameter, so nobody can ask for a
// colleague's), `team` the org's.

function intParam(v: string | undefined, def: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), min), max) : def;
}

function textParam(v: string | undefined, max = 200): string | null {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

export function commandsRoutes(sql: SQL) {
  const app = new Hono();

  async function readScope(c: any) {
    const scope: CommandScope = c.req.query("scope") === "me" ? "me" : "team";
    const group: CommandGroup = c.req.query("group") === "program" ? "program" : "signature";
    const days = intParam(c.req.query("days"), 30, 1, 365);
    const project = textParam(c.req.query("project"));
    const viewerDevIds = await getViewerDevIds(sql, c);
    const devIds = scope === "me" ? await getOwnOrgDevIds(sql, c) : getOrgDevIds(c);
    return { scope, group, days, project, viewerDevIds, devIds };
  }

  /** Commands by time waited on them, with the period before for comparison. */
  app.get("/summary", async (c) => {
    const s = await readScope(c);
    const limit = intParam(c.req.query("limit"), 50, 1, 200);
    const summary = await getCommandSummary(sql, s, s.group, limit);
    return c.json({ ...summary, scope: s.scope });
  });

  /** One command (or all of them) per day or week. */
  app.get("/trend", async (c) => {
    const s = await readScope(c);
    const bucket = c.req.query("bucket") === "week" ? "week" : "day";
    const command = textParam(c.req.query("command"), 100);
    const trend = await getCommandTrend(sql, s, s.group, command, bucket);
    return c.json({ ...trend, days: s.days });
  });

  /** Projects with command runs the caller may see, for the project filter. */
  app.get("/projects", async (c) => {
    const s = await readScope(c);
    return c.json(await getCommandProjects(sql, s));
  });

  return app;
}
