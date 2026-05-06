import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { SQL } from "bun";
import { getOrgDeveloperIds } from "../services/developerLink";
import { inList } from "../db/utils";
import { logEthicsEvent } from "../utils/ethicsAudit";

/**
 * Gate the route to a system administrator (CEO or designated operator).
 *
 * "System admin" is identified by an email match against DEVSCOPE_ADMIN_EMAIL,
 * the same env var used to seed the default owner. This is a deliberate
 * operational shortcut — DevScope does not have a global admin role. If the
 * env var is unset, the route refuses (no implicit admin).
 */
function requireSystemAdmin() {
  return async (c: Context, next: Next) => {
    const adminEmail = process.env.DEVSCOPE_ADMIN_EMAIL;
    if (!adminEmail) {
      return c.json({ error: "Admin export disabled (DEVSCOPE_ADMIN_EMAIL unset)" }, 403);
    }
    const user = c.get("user" as never) as { email?: string } | undefined;
    const userEmail = user?.email?.toLowerCase();
    if (!userEmail || userEmail !== adminEmail.toLowerCase()) {
      return c.json({ error: "System admin access required" }, 403);
    }
    return next();
  };
}

export function adminRoutes(sql: SQL) {
  const app = new Hono();

  app.use("*", requireSystemAdmin());

  /**
   * Per-org data dump. Pilot-offboarding tool.
   *
   * Returns a single JSON document containing every pilot-relevant table
   * scoped to the given orgId. Format chosen for ease of implementation —
   * the dump can be loaded directly into jq, a notebook, or a spreadsheet
   * by way of `jq -r '.sessions[] | [.id, .project_name] | @csv'`.
   */
  app.get("/export/org/:orgId", async (c) => {
    const orgId = c.req.param("orgId");
    const user = c.get("user" as never) as { id?: string; email?: string } | undefined;

    const [org] = await sql`
      SELECT id, name, slug, "createdAt"
      FROM organization
      WHERE id = ${orgId}
      LIMIT 1` as Array<Record<string, unknown>>;

    if (!org) {
      return c.json({ error: "Organization not found" }, 404);
    }

    const developerIds = await getOrgDeveloperIds(sql, orgId);

    const developers = developerIds.length > 0
      ? await sql`
          SELECT id, name, email, first_seen, last_seen
          FROM developers
          WHERE id IN (${inList(developerIds)})
          ORDER BY first_seen` as Array<Record<string, unknown>>
      : [];

    const sessions = developerIds.length > 0
      ? await sql`
          SELECT id, developer_id, project_path, project_name,
                 started_at, ended_at, status, permission_mode
          FROM sessions
          WHERE developer_id IN (${inList(developerIds)})
          ORDER BY started_at` as Array<Record<string, unknown>>
      : [];

    const sessionIds = sessions.map((s) => s.id as string);
    const events = sessionIds.length > 0
      ? await sql`
          SELECT id, session_id, event_type, payload, created_at
          FROM events
          WHERE session_id IN (${inList(sessionIds)})
          ORDER BY created_at` as Array<Record<string, unknown>>
      : [];

    const aiInsights = await sql`
      SELECT *
      FROM ai_insights
      WHERE organization_id = ${orgId}
      ORDER BY created_at` as Array<Record<string, unknown>>;

    const aiReports = await sql`
      SELECT *
      FROM ai_reports
      WHERE organization_id = ${orgId}
      ORDER BY created_at` as Array<Record<string, unknown>>;

    const aiConversations = await sql`
      SELECT *
      FROM ai_conversations
      WHERE organization_id = ${orgId}
      ORDER BY created_at` as Array<Record<string, unknown>>;

    const digests = await sql`
      SELECT *
      FROM digests
      WHERE organization_id = ${orgId}
      ORDER BY period_start` as Array<Record<string, unknown>>;

    const alertRules = await sql`
      SELECT *
      FROM alert_rules
      WHERE organization_id = ${orgId}
      ORDER BY created_at` as Array<Record<string, unknown>>;

    const alertEvents = await sql`
      SELECT *
      FROM alert_events
      WHERE organization_id = ${orgId}
      ORDER BY triggered_at` as Array<Record<string, unknown>>;

    const exportedAt = new Date().toISOString();
    const counts = {
      developers: developers.length,
      sessions: sessions.length,
      events: events.length,
      ai_insights: aiInsights.length,
      ai_reports: aiReports.length,
      ai_conversations: aiConversations.length,
      digests: digests.length,
      alert_rules: alertRules.length,
      alert_events: alertEvents.length,
    };

    console.log(
      `[admin-export] org=${orgId} by=${user?.email ?? "unknown"} `
      + `counts=${JSON.stringify(counts)}`
    );
    logEthicsEvent(sql, orgId, "admin_org_export_executed", {
      requested_by_user_id: user?.id ?? null,
      requested_by_email: user?.email ?? null,
      counts,
    });

    c.header("Content-Type", "application/json");
    c.header(
      "Content-Disposition",
      `attachment; filename="devscope-org-${orgId}-${exportedAt.slice(0, 10)}.json"`
    );

    return c.json({
      schema_version: 1,
      exported_at: exportedAt,
      exported_by: { id: user?.id ?? null, email: user?.email ?? null },
      org,
      counts,
      developers,
      sessions,
      events,
      ai_insights: aiInsights,
      ai_reports: aiReports,
      ai_conversations: aiConversations,
      digests,
      alert_rules: alertRules,
      alert_events: alertEvents,
    });
  });

  return app;
}
