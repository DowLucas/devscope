import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import type { GroundcontrolEvent } from "@groundcontrol/shared";
import {
  upsertDeveloper,
  createSession,
  endSession,
  insertEvent,
  getRecentEvents,
} from "../db";
import { broadcast } from "../ws/handler";

export function eventsRoutes(db: Database) {
  const app = new Hono();

  app.post("/", async (c) => {
    const event = await c.req.json<GroundcontrolEvent>();

    upsertDeveloper(db, event.developerId, event.developerName, event.developerEmail);

    if (event.eventType === "session.start") {
      const payload = event.payload as { permissionMode?: string };
      createSession(
        db,
        event.sessionId,
        event.developerId,
        event.projectPath,
        event.projectName,
        payload.permissionMode ?? null
      );
      broadcast({ type: "session.update", data: { sessionId: event.sessionId, status: "active" } });
      broadcast({ type: "developer.update", data: { developerId: event.developerId } });
    } else if (event.eventType === "session.end") {
      endSession(db, event.sessionId);
      broadcast({ type: "session.update", data: { sessionId: event.sessionId, status: "ended" } });
      broadcast({ type: "developer.update", data: { developerId: event.developerId } });
    }

    insertEvent(db, event);

    broadcast({
      type: "event.new",
      data: event,
    });

    return c.json({ ok: true });
  });

  app.get("/recent", (c) => {
    const limit = Number(c.req.query("limit") ?? 50);
    const events = getRecentEvents(db, limit);
    return c.json(events);
  });

  return app;
}
