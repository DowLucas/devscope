import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { SQL } from "bun";
import { requireOrgMember, requireOrgAdmin } from "../middleware/orgScope";
import { getOrgDeveloperStatuses } from "../services/developerStatus";
import { linkUserToDeveloper } from "../services/developerLink";

const teamSettingsSchema = z.object({
  inactive_threshold_days: z.number().int().min(1).max(365).optional(),
  retention_days: z.number().int().min(30).max(365).optional(),
  anonymize_on_expire: z.boolean().optional(),
});

export function teamsRoutes(sql: SQL) {
  const app = new Hono();

  // All team routes require org membership
  app.use("/*", requireOrgMember(sql));

  // GET /api/teams/members/status — developer status list for active org
  app.get("/members/status", async (c) => {
    const session = c.get("session" as never) as any;
    const orgId = session?.activeOrganizationId;
    if (!orgId) return c.json({ error: "No active organization" }, 400);

    const statuses = await getOrgDeveloperStatuses(sql, orgId);
    return c.json(statuses);
  });

  // GET /api/teams/settings — org settings
  app.get("/settings", async (c) => {
    const session = c.get("session" as never) as any;
    const orgId = session?.activeOrganizationId;
    if (!orgId) return c.json({ error: "No active organization" }, 400);

    const [settings] = await sql`
      SELECT organization_id, inactive_threshold_days, retention_days, anonymize_on_expire
      FROM organization_settings
      WHERE organization_id = ${orgId}`;

    if (!settings) {
      return c.json({ organization_id: orgId, inactive_threshold_days: 7, retention_days: 90, anonymize_on_expire: true });
    }
    return c.json(settings);
  });

  // PUT /api/teams/settings — update inactivity threshold (admin/owner only)
  app.put("/settings", requireOrgAdmin(sql), zValidator("json", teamSettingsSchema), async (c) => {
    const session = c.get("session" as never) as any;
    const orgId = session?.activeOrganizationId;
    if (!orgId) return c.json({ error: "No active organization" }, 400);

    const body = c.req.valid("json");

    // Build dynamic SET clause based on provided fields
    const updates: string[] = [];
    const values: Record<string, unknown> = {};

    if (body.inactive_threshold_days !== undefined) {
      updates.push("inactive_threshold_days");
      values.inactive_threshold_days = body.inactive_threshold_days;
    }
    if (body.retention_days !== undefined) {
      updates.push("retention_days");
      values.retention_days = body.retention_days;
    }
    if (body.anonymize_on_expire !== undefined) {
      updates.push("anonymize_on_expire");
      values.anonymize_on_expire = body.anonymize_on_expire;
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    // Use individual fields in the upsert
    const inactiveDays = body.inactive_threshold_days ?? 7;
    const retDays = body.retention_days ?? 90;
    const anonymize = body.anonymize_on_expire ?? true;

    await sql`
      INSERT INTO organization_settings (organization_id, inactive_threshold_days, retention_days, anonymize_on_expire)
      VALUES (${orgId}, ${inactiveDays}, ${retDays}, ${anonymize})
      ON CONFLICT (organization_id) DO UPDATE SET
        inactive_threshold_days = COALESCE(${body.inactive_threshold_days ?? null}::INT, organization_settings.inactive_threshold_days),
        retention_days = COALESCE(${body.retention_days ?? null}::INT, organization_settings.retention_days),
        anonymize_on_expire = COALESCE(${body.anonymize_on_expire ?? null}::BOOLEAN, organization_settings.anonymize_on_expire)`;

    const [updated] = await sql`
      SELECT organization_id, inactive_threshold_days, retention_days, anonymize_on_expire
      FROM organization_settings WHERE organization_id = ${orgId}`;

    return c.json(updated);
  });

  // POST /api/teams/link-developer — link current user to developer identity
  app.post("/link-developer", async (c) => {
    const session = c.get("session" as never) as any;
    const user = c.get("user" as never) as any;
    const orgId = session?.activeOrganizationId;
    if (!orgId || !user?.id) return c.json({ error: "No active organization" }, 400);

    const developerId = await linkUserToDeveloper(
      sql,
      user.id,
      user.email,
      user.name || "Unknown",
      orgId
    );

    return c.json({ developer_id: developerId });
  });

  return app;
}
