import { Hono } from "hono";
import type { SQL } from "bun";
import { getActiveSessions, getActiveAgents, getAllSessions, getSessionDetail } from "../db";

function clampInt(val: string | undefined, def: number, max: number): number {
  if (!val) return def;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : def;
}

function mapSession(row: any) {
  return {
    id: row.id,
    developerId: row.developer_id,
    projectPath: row.project_path,
    projectName: row.project_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    permissionMode: row.permission_mode,
    developerName: row.developer_name,
    developerEmail: row.developer_email,
    eventCount: row.event_count,
    contextClearCount: row.context_clear_count ?? 0,
  };
}

export function sessionsRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/", async (c) => {
    const limit = clampInt(c.req.query("limit"), 50, 500);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    const rows = await getAllSessions(sql, limit, devIds);
    return c.json((rows as any[]).map(mapSession));
  });

  app.get("/active", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    const sessionsRaw = await getActiveSessions(sql, devIds);
    const sessions = (sessionsRaw as any[]).map(mapSession);
    const agentsRaw = await getActiveAgents(sql);
    const agents = (agentsRaw as any[]).map((row) => ({
      agentId: row.agent_id,
      agentType: row.agent_type,
      sessionId: row.session_id,
      startedAt: row.started_at,
    }));

    const agentsBySession = new Map<string, typeof agents>();
    for (const agent of agents) {
      const list = agentsBySession.get(agent.sessionId) ?? [];
      list.push(agent);
      agentsBySession.set(agent.sessionId, list);
    }

    return c.json(
      sessions.map((s: any) => ({
        ...s,
        activeAgents: agentsBySession.get(s.id) ?? [],
      })),
    );
  });

  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const detail = await getSessionDetail(sql, id);
    if (!detail) {
      return c.json({ error: "Session not found" }, 404);
    }
    // Org-scope validation: check developer belongs to org
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    if (devIds && devIds.length > 0 && !devIds.includes((detail.session as any).developer_id)) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json({
      session: mapSession(detail.session),
      events: (detail.events as any[]).map((e) => ({
        id: e.id,
        event_type: e.event_type,
        payload: typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload,
        created_at: e.created_at,
      })),
    });
  });

  return app;
}
