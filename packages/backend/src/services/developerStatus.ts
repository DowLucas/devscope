import type { SQL } from "bun";
import type { OrgMemberStatus } from "@devscope/shared";

export async function getOrgDeveloperStatuses(
  sql: SQL,
  orgId: string
): Promise<OrgMemberStatus[]> {
  const rows = await sql`
    WITH org_devs AS (
      SELECT od.developer_id
      FROM organization_developer od
      WHERE od.organization_id = ${orgId}
    ),
    dev_stats AS (
      SELECT
        s.developer_id,
        COUNT(DISTINCT s.id) AS total_sessions,
        COUNT(e.id) AS total_events,
        MAX(e.created_at) AS last_activity
      FROM sessions s
      LEFT JOIN events e ON e.session_id = s.id
      WHERE s.developer_id IN (SELECT developer_id FROM org_devs)
      GROUP BY s.developer_id
    ),
    threshold AS (
      SELECT COALESCE(
        (SELECT inactive_threshold_days FROM organization_settings WHERE organization_id = ${orgId}),
        7
      ) AS days
    )
    SELECT
      d.id AS developer_id,
      d.name AS developer_name,
      d.email AS developer_email,
      udl.auth_user_id,
      (udl.auth_user_id IS NOT NULL) AS has_dashboard_account,
      (udl.auth_user_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM apikey ak
        WHERE ak."referenceId" = udl.auth_user_id AND ak.enabled = TRUE
      )) AS onboarding_complete,
      EXISTS (
        SELECT 1 FROM apikey ak
        WHERE udl.auth_user_id IS NOT NULL
          AND ak."referenceId" = udl.auth_user_id
          AND ak.enabled = TRUE
          AND (ak."expiresAt" IS NULL OR ak."expiresAt" > NOW())
      ) AS has_active_api_key,
      ds.last_activity,
      CASE
        WHEN ds.last_activity IS NULL THEN TRUE
        WHEN ds.last_activity < NOW() - (t.days || ' days')::INTERVAL THEN TRUE
        ELSE FALSE
      END AS is_inactive,
      COALESCE(ds.total_sessions, 0)::INT AS total_sessions,
      COALESCE(ds.total_events, 0)::INT AS total_events,
      COALESCE(m.role, 'member') AS role,
      (
        SELECT COUNT(*)::INT FROM user_developer_link udl2
        WHERE udl2.auth_user_id = udl.auth_user_id
      ) AS linked_email_count
    FROM org_devs od
    JOIN developers d ON d.id = od.developer_id
    LEFT JOIN user_developer_link udl ON udl.developer_id = d.id
    LEFT JOIN member m ON m."userId" = udl.auth_user_id AND m."organizationId" = ${orgId}
    LEFT JOIN dev_stats ds ON ds.developer_id = d.id
    CROSS JOIN threshold t
    ORDER BY d.name ASC`;

  return rows as unknown as OrgMemberStatus[];
}
