import { Hono } from "hono";
import type { SQL } from "bun";
import type { DevscopeEvent } from "@devscope/shared";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  upsertDeveloper,
  createSession,
  endSession,
  insertEvent,
  getRecentEvents,
  checkAlertThresholds,
} from "../db";
import { broadcast, broadcastToOrg } from "../ws/handler";
import { autoLinkDeveloperToOrg } from "../services/developerLink";
import { stripSensitivePayload } from "../utils/stripSensitiveFields";

const eventSchema = z.object({
  id: z.string().min(1).max(200),
  timestamp: z.string().min(1).max(50),
  sessionId: z.string().min(1).max(200),
  developerId: z.string().min(1).max(200),
  developerName: z.string().min(1).max(200),
  developerEmail: z.string().max(500).optional().default(""),
  projectPath: z.string().max(1000),
  projectName: z.string().max(200),
  eventType: z.enum([
    "session.start", "session.end", "prompt.submit", "tool.start",
    "tool.complete", "tool.fail", "agent.start", "agent.stop",
    "response.complete", "notification", "compact.pending",
    "task.completed", "permission.request", "worktree.create",
    "worktree.remove", "config.change",
  ]),
  payload: z.record(z.unknown()),
});

function clampInt(val: string | undefined, def: number, max: number): number {
  if (!val) return def;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : def;
}

export function eventsRoutes(sql: SQL) {
  const app = new Hono();

  app.post("/", zValidator("json", eventSchema), async (c) => {
    const event = c.req.valid("json") as unknown as DevscopeEvent;

    await upsertDeveloper(sql, event.developerId, event.developerName, event.developerEmail ?? "");

    // Auto-link plugin developer to the API key owner's org
    const apiKeyUserId = c.get("apiKeyUserId" as never) as string | undefined;
    if (apiKeyUserId) {
      await autoLinkDeveloperToOrg(sql, apiKeyUserId, event.developerId);
    }

    // Check if this event is reactivating an ended session (e.g. after backend restart)
    const [existingSession] = await sql`SELECT status FROM sessions WHERE id = ${event.sessionId}`;
    const wasEnded = (existingSession as any)?.status === "ended";

    // Only create/reactivate sessions on explicit session.start or when
    // no session record exists yet.
    const permissionMode = event.eventType === "session.start"
      ? (event.payload as { permissionMode?: string }).permissionMode ?? null
      : null;
    const shouldCreateOrReactivate = !existingSession || wasEnded || event.eventType === "session.start";
    if (shouldCreateOrReactivate) {
      await createSession(sql, event.sessionId, event.developerId, event.projectPath, event.projectName, permissionMode);
    }

    // Track what to broadcast — we emit AFTER insertEvent so that
    // getActiveAgents() finds recently-inserted agent events when
    // the frontend refetches in response to the broadcast.
    let broadcastSessionActive = false;
    let broadcastSessionEnded = false;

    if (shouldCreateOrReactivate && (event.eventType === "session.start" || wasEnded)) {
      broadcastSessionActive = true;
    } else if (event.eventType === "session.end") {
      const endReason = (event.payload as { endReason?: string }).endReason;
      const isContinuation = ["clear", "resume", "compact"].includes(endReason ?? "");

      if (!isContinuation) {
        await endSession(sql, event.sessionId);
        broadcastSessionEnded = true;
      }
    }

    await insertEvent(sql, event);

    // Look up developer's orgs for scoped broadcasting
    const devOrgs = await sql`SELECT organization_id FROM organization_developer WHERE developer_id = ${event.developerId}`;

    function broadcastToDevOrgs(msg: any) {
      if (devOrgs.length > 0) {
        for (const row of devOrgs as any[]) {
          broadcastToOrg(row.organization_id, msg);
        }
      } else {
        broadcast(msg);
      }
    }

    // Broadcasts after DB insert
    if (broadcastSessionActive) {
      broadcastToDevOrgs({ type: "session.update", data: { sessionId: event.sessionId, status: "active" } });
      broadcastToDevOrgs({ type: "developer.update", data: { developerId: event.developerId } });
    } else if (broadcastSessionEnded) {
      broadcastToDevOrgs({ type: "session.update", data: { sessionId: event.sessionId, status: "ended" } });
      broadcastToDevOrgs({ type: "developer.update", data: { developerId: event.developerId } });
    }

    // Strip opt-in sensitive fields (promptText, toolInput) from broadcasts.
    // WebSocket goes to all dashboard viewers — we can't scope to self-view here.
    broadcastToDevOrgs({
      type: "event.new",
      data: {
        ...event,
        payload: stripSensitivePayload(event.payload as Record<string, unknown>),
      },
    });

    // Check alert thresholds on tool failures
    if (event.eventType === "tool.fail") {
      const toolName = (event.payload as { toolName?: string }).toolName ?? "unknown";
      const alert = await checkAlertThresholds(sql, event.sessionId, toolName);
      if (alert) {
        broadcastToDevOrgs({ type: "alert.triggered", data: alert });
      }
    }

    return c.json({ ok: true });
  });

  app.get("/recent", async (c) => {
    const limit = clampInt(c.req.query("limit"), 50, 500);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    const rows = await getRecentEvents(sql, limit, devIds);
    // Strip opt-in sensitive fields from the team-visible recent events feed.
    // Prompt text and tool inputs are only visible in the self-view session detail.
    const events = (rows as any[]).map((row: any) => {
      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      return {
        id: row.id,
        timestamp: row.created_at,
        sessionId: row.session_id,
        developerId: row.developer_id ?? "",
        developerName: row.developer_name,
        developerEmail: row.developer_email,
        projectPath: row.project_path ?? "",
        projectName: row.project_name,
        eventType: row.event_type,
        payload: stripSensitivePayload(payload),
      };
    });
    return c.json(events);
  });

  return app;
}
