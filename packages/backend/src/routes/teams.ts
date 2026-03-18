import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { SQL } from "bun";
import { requireOrgMember, requireOrgAdmin } from "../middleware/orgScope";
import { getOrgDeveloperStatuses } from "../services/developerStatus";
import {
  linkUserToDeveloper,
  linkAdditionalEmail,
  unlinkDeveloperFromUser,
  getLinkedDevelopersForUser,
  computeDeveloperId,
} from "../services/developerLink";

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

    if (body.inactive_threshold_days === undefined &&
        body.retention_days === undefined &&
        body.anonymize_on_expire === undefined) {
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

  // GET /api/teams/my-linked-developers — list all developer identities linked to current user
  app.get("/my-linked-developers", async (c) => {
    const user = c.get("user" as never) as any;
    if (!user?.id) return c.json({ error: "Unauthorized" }, 401);

    const developers = await getLinkedDevelopersForUser(sql, user.id);
    return c.json(developers);
  });

  // POST /api/teams/link-email — link an additional git email to current user
  app.post(
    "/link-email",
    zValidator("json", z.object({ email: z.string().email() })),
    async (c) => {
      const session = c.get("session" as never) as any;
      const user = c.get("user" as never) as any;
      const orgId = session?.activeOrganizationId;
      if (!orgId || !user?.id) return c.json({ error: "No active organization" }, 400);

      const { email } = c.req.valid("json");
      const result = await linkAdditionalEmail(sql, user.id, email, orgId);

      if ("error" in result) return c.json({ error: result.error }, 400);
      return c.json({ developer_id: result.developerId });
    }
  );

  // DELETE /api/teams/unlink-email — unlink a developer email from current user
  app.delete(
    "/unlink-email",
    zValidator("json", z.object({ developer_id: z.string() })),
    async (c) => {
      const user = c.get("user" as never) as any;
      if (!user?.id) return c.json({ error: "Unauthorized" }, 401);

      const { developer_id } = c.req.valid("json");

      // Prevent unlinking primary (auth) email
      const primaryDevId = computeDeveloperId(user.email);
      if (developer_id === primaryDevId) {
        return c.json({ error: "Cannot unlink your primary email" }, 400);
      }

      const unlinked = await unlinkDeveloperFromUser(sql, user.id, developer_id);
      if (!unlinked) return c.json({ error: "Developer not linked to your account" }, 404);
      return c.json({ success: true });
    }
  );

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
