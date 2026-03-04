import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { SQL } from "bun";
import { requireOrgMember, requireOrgAdmin } from "../middleware/orgScope";
import {
  getConsentOverview,
  updateDeveloperPrivacy,
  createDataRequest,
  getDataRequests,
  updateDataRequestStatus,
} from "../db";
import { logEthicsEvent } from "../utils/ethicsAudit";

const preferencesSchema = z.object({
  share_details: z.boolean(),
});

const dataRequestSchema = z.object({
  request_type: z.enum(["export", "deletion"]),
});

const updateRequestSchema = z.object({
  status: z.enum(["processing", "completed", "rejected"]),
  notes: z.string().max(1000).optional(),
});

async function getUserDeveloperId(sql: SQL, userId: string): Promise<string | null> {
  const [link] = await sql`
    SELECT developer_id FROM user_developer_link
    WHERE auth_user_id = ${userId}
    LIMIT 1`;
  return (link as any)?.developer_id ?? null;
}

export function privacyRoutes(sql: SQL) {
  const app = new Hono();

  app.use("/*", requireOrgMember(sql));

  // GET /api/privacy/consent/preferences — own share_details status
  app.get("/consent/preferences", async (c) => {
    const user = c.get("user" as never) as any;
    const developerId = await getUserDeveloperId(sql, user.id);
    if (!developerId) {
      return c.json({ linked: false, share_details: false });
    }
    const [row] = await sql`SELECT share_details FROM developers WHERE id = ${developerId} LIMIT 1`;
    return c.json({ linked: true, share_details: (row as any)?.share_details ?? false });
  });

  // GET /api/privacy/consent/overview
  app.get("/consent/overview", async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const devIds = c.get("orgDeveloperIds" as never) as string[];
    const overview = await getConsentOverview(sql, orgId, devIds);
    return c.json(overview);
  });

  // PUT /api/privacy/consent/preferences — update own share_details
  app.put("/consent/preferences", zValidator("json", preferencesSchema), async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const user = c.get("user" as never) as any;

    const developerId = await getUserDeveloperId(sql, user.id);
    if (!developerId) {
      return c.json({ error: "No developer identity linked. Use the plugin first." }, 400);
    }

    const body = c.req.valid("json");
    await updateDeveloperPrivacy(sql, developerId, body.share_details);

    logEthicsEvent(sql, orgId, "data_request_processed", {
      action: "preferences_updated",
      developer_id: developerId,
      share_details: body.share_details,
    });

    return c.json({ ok: true, share_details: body.share_details });
  });

  // POST /api/privacy/consent/data-request — request export or deletion
  app.post("/consent/data-request", zValidator("json", dataRequestSchema), async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const user = c.get("user" as never) as any;

    const developerId = await getUserDeveloperId(sql, user.id);
    if (!developerId) {
      return c.json({ error: "No developer identity linked. Use the plugin first." }, 400);
    }

    const body = c.req.valid("json");
    const request = await createDataRequest(sql, developerId, orgId, body.request_type);

    logEthicsEvent(sql, orgId, "data_request_processed", {
      action: "request_created",
      request_type: body.request_type,
      request_id: request.id,
    });

    return c.json(request, 201);
  });

  // GET /api/privacy/consent/data-requests — own or all (admin)
  app.get("/consent/data-requests", async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const user = c.get("user" as never) as any;
    const role = c.get("orgRole" as never) as string | undefined;

    // Admins see all org requests; members see only their own
    if (role === "admin" || role === "owner") {
      return c.json(await getDataRequests(sql, orgId));
    }

    const developerId = await getUserDeveloperId(sql, user.id);
    if (!developerId) return c.json([]);

    return c.json(await getDataRequests(sql, orgId, developerId));
  });

  // PUT /api/privacy/consent/data-requests/:id — admin update status
  app.put("/consent/data-requests/:id", requireOrgAdmin(sql), zValidator("json", updateRequestSchema), async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const user = c.get("user" as never) as any;
    const requestId = c.req.param("id");
    const body = c.req.valid("json");

    await updateDataRequestStatus(sql, requestId, orgId, body.status, user.id, body.notes);

    logEthicsEvent(sql, orgId, "data_request_processed", {
      action: "status_updated",
      request_id: requestId,
      new_status: body.status,
    });

    return c.json({ ok: true });
  });

  return app;
}
