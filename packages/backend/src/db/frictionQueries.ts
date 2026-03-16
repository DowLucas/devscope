import type { SQL } from "bun";
import type { FrictionAlert, FrictionRule } from "@devscope/shared";

// --- Friction Alerts ---

export async function insertFrictionAlert(
  sql: SQL,
  alert: Omit<FrictionAlert, "id" | "triggered_at">
): Promise<FrictionAlert> {
  const id = crypto.randomUUID();
  const [row] = await sql`
    INSERT INTO friction_alerts (
      id,
      organization_id,
      session_id,
      developer_id,
      rule_id,
      rule_type,
      severity,
      title,
      description,
      data_context,
      acknowledged
    ) VALUES (
      ${id},
      ${alert.organization_id ?? null},
      ${alert.session_id},
      ${alert.developer_id},
      ${alert.rule_id ?? null},
      ${alert.rule_type},
      ${alert.severity},
      ${alert.title},
      ${alert.description},
      ${JSON.stringify(alert.data_context)}::jsonb,
      ${alert.acknowledged}
    )
    RETURNING *
  `;
  return row as FrictionAlert;
}

export async function getFrictionAlerts(
  sql: SQL,
  orgId: string,
  opts: {
    sessionId?: string;
    acknowledged?: boolean;
    limit?: number;
  } = {}
): Promise<FrictionAlert[]> {
  const limit = opts.limit ?? 50;

  if (opts.sessionId !== undefined && opts.acknowledged !== undefined) {
    const rows = await sql`
      SELECT * FROM friction_alerts
      WHERE organization_id = ${orgId}
        AND session_id = ${opts.sessionId}
        AND acknowledged = ${opts.acknowledged}
      ORDER BY triggered_at DESC
      LIMIT ${limit}
    `;
    return rows as FrictionAlert[];
  }

  if (opts.sessionId !== undefined) {
    const rows = await sql`
      SELECT * FROM friction_alerts
      WHERE organization_id = ${orgId}
        AND session_id = ${opts.sessionId}
      ORDER BY triggered_at DESC
      LIMIT ${limit}
    `;
    return rows as FrictionAlert[];
  }

  if (opts.acknowledged !== undefined) {
    const rows = await sql`
      SELECT * FROM friction_alerts
      WHERE organization_id = ${orgId}
        AND acknowledged = ${opts.acknowledged}
      ORDER BY triggered_at DESC
      LIMIT ${limit}
    `;
    return rows as FrictionAlert[];
  }

  const rows = await sql`
    SELECT * FROM friction_alerts
    WHERE organization_id = ${orgId}
    ORDER BY triggered_at DESC
    LIMIT ${limit}
  `;
  return rows as FrictionAlert[];
}

export async function acknowledgeFrictionAlert(
  sql: SQL,
  alertId: string
): Promise<FrictionAlert | null> {
  const [row] = await sql`
    UPDATE friction_alerts
    SET acknowledged = TRUE
    WHERE id = ${alertId}
    RETURNING *
  `;
  return (row as FrictionAlert) ?? null;
}

// --- Friction Rules ---

export async function getFrictionRules(
  sql: SQL,
  orgId: string
): Promise<FrictionRule[]> {
  const rows = await sql`
    SELECT * FROM friction_rules
    WHERE organization_id = ${orgId}
       OR organization_id IS NULL
    ORDER BY organization_id NULLS FIRST, rule_name ASC
  `;
  return rows as FrictionRule[];
}

// --- Seed default rules ---

const DEFAULT_RULES: Array<{
  id: string;
  rule_name: string;
  rule_type: string;
  config: Record<string, unknown>;
}> = [
  {
    id: "default-repeated-failure",
    rule_name: "Repeated Failure",
    rule_type: "repeated_failure",
    config: { threshold: 3, windowMinutes: 5 },
  },
  {
    id: "default-escalating-prompts",
    rule_name: "Escalating Prompts",
    rule_type: "escalating_prompts",
    config: { increasePercent: 50, minPrompts: 3 },
  },
  {
    id: "default-no-progress",
    rule_name: "No Progress",
    rule_type: "no_progress",
    config: { timeoutMinutes: 10 },
  },
  {
    id: "default-failure-cascade",
    rule_name: "Failure Cascade",
    rule_type: "failure_cascade",
    config: { uniqueTools: 3, windowMinutes: 5 },
  },
  {
    id: "default-stuck-loop",
    rule_name: "Stuck Loop",
    rule_type: "stuck_loop",
    config: { cycles: 4 },
  },
];

export async function seedDefaultFrictionRules(sql: SQL): Promise<void> {
  for (const rule of DEFAULT_RULES) {
    await sql`
      INSERT INTO friction_rules (id, organization_id, rule_name, rule_type, config, enabled)
      VALUES (
        ${rule.id},
        NULL,
        ${rule.rule_name},
        ${rule.rule_type},
        ${JSON.stringify(rule.config)}::jsonb,
        TRUE
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
}
