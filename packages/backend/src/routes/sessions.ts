import { Hono } from "hono";
import type { SQL } from "bun";
import { getActiveSessions, getActiveAgents, getAllSessions, getSessionDetail, getSessionTitleHistory } from "../db";
import { getViewerDevIds, redactEvent, redactSessionListRow, redactSessionRow, visibilityForRow } from "../services/visibility";

function clampInt(val: string | undefined, def: number, max: number): number {
  if (!val) return def;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : def;
}

function mapSession(row: any) {
  return {
    id: row.id,
    developerId: row.developer_id,
    projectPath: row.project_path ?? null,
    projectName: row.project_name ?? null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    permissionMode: row.permission_mode ?? null,
    privacyMode: row.privacy_mode ?? null,
    model: row.model ?? null,
    developerName: row.developer_name,
    developerEmail: row.developer_email,
    eventCount: row.event_count ?? 0,
    contextClearCount: row.context_clear_count ?? 0,
    currentTitle: row.current_title ?? null,
    totalInputTokens: Number(row.total_input_tokens ?? 0),
    totalOutputTokens: Number(row.total_output_tokens ?? 0),
    totalCacheCreationTokens: Number(row.total_cache_creation_tokens ?? 0),
    totalCacheReadTokens: Number(row.total_cache_read_tokens ?? 0),
    estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
  };
}

/**
 * Map a session row after redacting it for this viewer; carries `visibility`.
 * Lists also drop other people's tokens and cost.
 */
function mapSessionFor(row: any, viewerDevIds: string[], opts: { list: boolean }) {
  const visibility = visibilityForRow(row, viewerDevIds);
  const redact = opts.list ? redactSessionListRow : redactSessionRow;
  return { ...mapSession(redact(row, visibility)), visibility };
}

export function sessionsRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/", async (c) => {
    const limit = clampInt(c.req.query("limit"), 50, 500);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    const rows = await getAllSessions(sql, limit, devIds);
    const viewerDevIds = await getViewerDevIds(sql, c);
    return c.json((rows as any[]).map((row) => mapSessionFor(row, viewerDevIds, { list: true })));
  });

  app.get("/active", async (c) => {
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    const sessionsRaw = await getActiveSessions(sql, devIds);
    const viewerDevIds = await getViewerDevIds(sql, c);
    const sessions = (sessionsRaw as any[]).map((row) => mapSessionFor(row, viewerDevIds, { list: true }));
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
        // Agent names hint at what the session is doing — hidden for activity-only.
        activeAgents: s.visibility === "activity" ? [] : agentsBySession.get(s.id) ?? [],
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
    if (devIds && !devIds.includes((detail.session as any).developer_id)) {
      return c.json({ error: "Session not found" }, 404);
    }

    const viewerDevIds = await getViewerDevIds(sql, c);
    const visibility = visibilityForRow(detail.session, viewerDevIds);

    return c.json({
      session: mapSessionFor(detail.session, viewerDevIds, { list: false }),
      visibility,
      isSelfView: visibility === "self",
      events: (detail.events as any[]).map((e) => redactEvent({
        id: e.id,
        event_type: e.event_type,
        payload: typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload,
        created_at: e.created_at,
      }, visibility)),
    });
  });

  app.get("/:id/titles", async (c) => {
    const id = c.req.param("id");
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;

    // Verify session exists and belongs to org
    const detail = await getSessionDetail(sql, id);
    if (!detail) {
      return c.json({ error: "Session not found" }, 404);
    }
    if (devIds && !devIds.includes((detail.session as any).developer_id)) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Titles summarise what the session was about — hidden from activity-only viewers.
    if (visibilityForRow(detail.session, await getViewerDevIds(sql, c)) === "activity") {
      return c.json([]);
    }

    const titles = await getSessionTitleHistory(sql, id);
    return c.json(
      (titles as any[]).map((t) => ({
        id: t.id,
        sessionId: t.session_id,
        title: t.title,
        generatedAt: t.generated_at,
      }))
    );
  });

  return app;
}
