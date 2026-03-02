import { Hono } from "hono";
import type { SQL } from "bun";
import { requireOrgMember, requireOrgAdmin } from "../middleware/orgScope";
import { getOrgDeveloperStatuses } from "../services/developerStatus";
import { linkUserToDeveloper } from "../services/developerLink";

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
      SELECT organization_id, inactive_threshold_days
      FROM organization_settings
      WHERE organization_id = ${orgId}`;

    if (!settings) {
      return c.json({ organization_id: orgId, inactive_threshold_days: 7 });
    }
    return c.json(settings);
  });

  // PUT /api/teams/settings — update inactivity threshold (admin/owner only)
  app.put("/settings", requireOrgAdmin(sql), async (c) => {
    const session = c.get("session" as never) as any;
    const orgId = session?.activeOrganizationId;
    if (!orgId) return c.json({ error: "No active organization" }, 400);

    const body = await c.req.json();
    const days = Number(body.inactive_threshold_days);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      return c.json({ error: "inactive_threshold_days must be between 1 and 365" }, 400);
    }

    await sql`
      INSERT INTO organization_settings (organization_id, inactive_threshold_days)
      VALUES (${orgId}, ${days})
      ON CONFLICT (organization_id) DO UPDATE SET inactive_threshold_days = ${days}`;

    return c.json({ organization_id: orgId, inactive_threshold_days: days });
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
