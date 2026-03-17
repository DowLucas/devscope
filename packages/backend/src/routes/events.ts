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
  insertFrictionAlert,
  getFrictionRules,
  upsertClaudeMdSnapshot,
} from "../db";
import { broadcastToOrg } from "../ws/handler";
import { autoLinkDeveloperToOrg } from "../services/developerLink";
import { stripSensitivePayload } from "../utils/stripSensitiveFields";
import { logEthicsEvent } from "../utils/ethicsAudit";
import { evaluateFriction, cleanupFrictionSession } from "../services/frictionDetector";

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
    "worktree.remove", "config.change", "compact.complete",
    "elicitation.request", "elicitation.response",
    "instructions.loaded", "teammate.idle",
  ]),
  payload: z.record(z.unknown()),
});

/**
 * Sanitize a timestamp string before inserting into PostgreSQL.
 * Fixes malformed timestamps like "2026-03-04T07:50:30.3NZ" produced by
 * plugins using `date +%3N` on macOS where %N (nanoseconds) is unsupported
 * and outputs the literal character "N".
 */
function sanitizeTimestamp(timestamp: string): string {
  const d = new Date(timestamp);
  if (!isNaN(d.getTime())) return d.toISOString();

  // Fix fractional seconds containing non-digit chars (e.g. ".3NZ" → ".3Z")
  const fixed = timestamp.replace(/\.(\d+)[A-Za-z]*Z$/, ".$1Z");
  const d2 = new Date(fixed);
  if (!isNaN(d2.getTime())) return d2.toISOString();

  // Last resort: use current time
  return new Date().toISOString();
}

function clampInt(val: string | undefined, def: number, max: number): number {
  if (!val) return def;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : def;
}

export function eventsRoutes(sql: SQL) {
  const app = new Hono();

  app.post("/", zValidator("json", eventSchema), async (c) => {
    const event = c.req.valid("json") as unknown as DevscopeEvent;
    event.timestamp = sanitizeTimestamp(event.timestamp);

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
    const privacyMode = event.eventType === "session.start"
      ? (event.payload as { privacyMode?: string }).privacyMode ?? null
      : null;
    const shouldCreateOrReactivate = !existingSession || wasEnded || event.eventType === "session.start";
    if (shouldCreateOrReactivate) {
      await createSession(sql, event.sessionId, event.developerId, event.projectPath, event.projectName, permissionMode, privacyMode);
    }

    // Log ethics event when privacy mode is activated
    if (event.eventType === "session.start" && privacyMode === "private") {
      const orgIds = await sql`SELECT organization_id FROM organization_developer WHERE developer_id = ${event.developerId}`;
      for (const row of orgIds as any[]) {
        logEthicsEvent(sql, row.organization_id, "privacy_mode_activated", {
          session_id: event.sessionId,
        });
      }
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
      }
      // No fallback broadcast -- events from unlinked developers are not broadcast
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
    const rawPayload = event.payload as Record<string, unknown>;
    const hadSensitiveFields = "promptText" in rawPayload || "toolInput" in rawPayload || "responseText" in rawPayload;
    broadcastToDevOrgs({
      type: "event.new",
      data: {
        ...event,
        payload: stripSensitivePayload(rawPayload),
      },
    });

    // Log ethics event when sensitive fields were stripped
    if (hadSensitiveFields && devOrgs.length > 0) {
      const strippedFields = ["promptText", "toolInput", "responseText"].filter((f) => f in rawPayload);
      for (const row of devOrgs as any[]) {
        logEthicsEvent(sql, row.organization_id, "sensitive_fields_stripped", {
          fields: strippedFields,
          event_type: event.eventType,
        });
      }
    }

    // Check alert thresholds on tool failures
    if (event.eventType === "tool.fail") {
      const toolName = (event.payload as { toolName?: string }).toolName ?? "unknown";
      const alert = await checkAlertThresholds(sql, event.sessionId, toolName);
      if (alert) {
        broadcastToDevOrgs({ type: "alert.triggered", data: alert });
      }
    }

    // Capture CLAUDE.md files on session start (after devOrgs is available)
    if (event.eventType === "session.start") {
      const claudeMdFiles = (event.payload as any).claudeMdFiles;
      if (Array.isArray(claudeMdFiles)) {
        for (const row of devOrgs as any[]) {
          for (const file of claudeMdFiles.slice(0, 10)) {
            try {
              await upsertClaudeMdSnapshot(sql, {
                organization_id: row.organization_id,
                project_name: event.projectName,
                project_path: event.projectPath,
                content_hash: file.hash,
                content_size: file.size,
                content_text: privacyMode === "private" ? null : (file.content ?? null),
                session_id: event.sessionId,
                developer_id: event.developerId,
              });
            } catch {
              // Ignore snapshot errors — don't block event ingestion
            }
          }
        }
      }
    }

    // Increment compaction count on compact.complete
    if (event.eventType === "compact.complete") {
      try {
        await sql`UPDATE sessions SET compaction_count = compaction_count + 1 WHERE id = ${event.sessionId}`;
      } catch {
        // Don't block event ingestion
      }
    }

    // Capture instruction files on instructions.loaded (reuses CLAUDE.md snapshot logic)
    if (event.eventType === "instructions.loaded") {
      const files = (event.payload as any).files;
      if (Array.isArray(files)) {
        for (const row of devOrgs as any[]) {
          for (const file of files.slice(0, 10)) {
            try {
              await upsertClaudeMdSnapshot(sql, {
                organization_id: row.organization_id,
                project_name: event.projectName,
                project_path: event.projectPath,
                content_hash: file.hash,
                content_size: file.size,
                content_text: file.content ?? null,
                file_type: file.type ?? "claude_md",
                session_id: event.sessionId,
                developer_id: event.developerId,
              });
            } catch {
              // Ignore snapshot errors
            }
          }
        }
      }
    }

    // Friction detection for active sessions
    if (["tool.fail", "prompt.submit", "tool.complete", "response.complete"].includes(event.eventType)) {
      try {
        for (const row of devOrgs as any[]) {
          const orgId = row.organization_id;
          const rules = await getFrictionRules(sql, orgId);
          const frictionAlert = evaluateFriction(event.sessionId, event, rules);
          if (frictionAlert) {
            const saved = await insertFrictionAlert(sql, { ...frictionAlert, organization_id: orgId });
            broadcastToDevOrgs({ type: "friction.alert", data: saved });
          }
        }
      } catch {
        // Don't block event ingestion on friction errors
      }
    }

    // Clean up friction state on session end
    if (event.eventType === "session.end") {
      cleanupFrictionSession(event.sessionId);
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

  // --- HTTP Hook Endpoint ---
  // Accepts raw Claude Code hook JSON and normalizes it into a DevscopeEvent.
  // Used by HTTP-type hooks (Notification, TaskCompleted, PermissionRequest,
  // WorktreeCreate, WorktreeRemove, ConfigChange, TeammateIdle).
  const hookEventMap: Record<string, string> = {
    "notification": "notification",
    "task.completed": "task.completed",
    "permission.request": "permission.request",
    "worktree.create": "worktree.create",
    "worktree.remove": "worktree.remove",
    "config.change": "config.change",
    "teammate.idle": "teammate.idle",
  };

  // Map snake_case hook fields to camelCase payload fields per event type
  function normalizeHookPayload(eventType: string, raw: Record<string, unknown>): Record<string, unknown> {
    switch (eventType) {
      case "notification":
        return {
          notificationType: raw.notification_type ?? raw.notificationType ?? "info",
          title: raw.title ?? "",
          message: typeof raw.message === "string" ? raw.message.slice(0, 100) : "",
        };
      case "task.completed":
        return {
          taskId: raw.task_id ?? raw.taskId ?? "",
          taskSubject: raw.task_subject ?? raw.taskSubject ?? "",
          taskDescription: raw.task_description ?? raw.taskDescription ?? "",
          teammateName: raw.teammate_name ?? raw.teammateName ?? "",
          teamName: raw.team_name ?? raw.teamName ?? "",
        };
      case "permission.request":
        return {
          toolName: raw.tool_name ?? raw.toolName ?? "unknown",
        };
      case "worktree.create":
        return {
          worktreeName: raw.name ?? raw.worktreeName ?? "",
        };
      case "worktree.remove":
        return {
          worktreePath: raw.path ?? raw.worktreePath ?? "",
        };
      case "config.change":
        return {
          source: raw.source ?? "",
          filePath: raw.file_path ?? raw.filePath ?? "",
        };
      case "teammate.idle":
        return {
          teammateName: raw.teammate_name ?? raw.teammateName ?? "",
          teamName: raw.team_name ?? raw.teamName ?? "",
          agentId: raw.agent_id ?? raw.agentId ?? undefined,
          idleReason: raw.idle_reason ?? raw.idleReason ?? undefined,
        };
      default:
        return raw;
    }
  }

  app.post("/hook", async (c) => {
    const eventParam = c.req.query("event");
    if (!eventParam || !hookEventMap[eventParam]) {
      return c.json({ error: "Missing or invalid 'event' query parameter" }, 400);
    }

    const eventType = hookEventMap[eventParam];

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Derive developer identity from API key owner
    const apiKeyUserId = c.get("apiKeyUserId" as never) as string | undefined;
    if (!apiKeyUserId) {
      return c.json({ error: "HTTP hooks require API key authentication" }, 401);
    }

    // Require session_id from Claude Code hook input
    const sessionId = body.session_id ?? body.sessionId;
    if (!sessionId || typeof sessionId !== "string") {
      return c.json({ error: "Missing required field 'session_id'. Claude Code hooks must supply session_id for proper session grouping." }, 400);
    }

    // Extract cwd from raw hook JSON
    const cwd = String(body.cwd ?? "");
    const projectName = cwd ? cwd.split("/").pop() ?? "unknown" : "unknown";

    // Use API key user ID directly as developer identity
    const developerId = `apikey-${apiKeyUserId}`;
    const developerName = "API Key User";

    // Build the normalized event
    const event: DevscopeEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      sessionId,
      developerId,
      developerName,
      developerEmail: "",
      projectPath: cwd,
      projectName,
      eventType: eventType as any,
      payload: normalizeHookPayload(eventType, body),
    };

    // Upsert developer
    await upsertDeveloper(sql, event.developerId, event.developerName, "");
    await autoLinkDeveloperToOrg(sql, apiKeyUserId, event.developerId);

    // Ensure session exists and is active (mirrors main POST / handler behavior)
    const [existingSession] = await sql`SELECT status FROM sessions WHERE id = ${event.sessionId}`;
    if (!existingSession) {
      await createSession(sql, event.sessionId, event.developerId, event.projectPath, event.projectName, null, null);
    } else if ((existingSession as any).status === "ended") {
      // Reactivate ended session — same pattern as the main event handler
      await createSession(sql, event.sessionId, event.developerId, event.projectPath, event.projectName, null, null);
    }

    // Insert the event
    await insertEvent(sql, event);

    // Broadcast to org
    const devOrgs = await sql`SELECT organization_id FROM organization_developer WHERE developer_id = ${event.developerId}`;
    for (const row of devOrgs as any[]) {
      broadcastToOrg(row.organization_id, {
        type: "event.new",
        data: { ...event, payload: stripSensitivePayload(event.payload as Record<string, unknown>) },
      });
    }

    return c.json({ ok: true });
  });

  return app;
}
