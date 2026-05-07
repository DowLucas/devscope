#!/usr/bin/env bun
/**
 * delete-org.ts — Operator kill-switch for org-scoped data ("consent revoke").
 *
 * USAGE
 *   bun run packages/backend/scripts/delete-org.ts <organizationId> [--verify] [--dry-run] [--yes]
 *
 * MODES
 *   --verify    Only count residual rows for the org across every org-scoped
 *               table. Exits 0 if all counts are zero, 1 otherwise. Does not
 *               write anything.
 *   --dry-run   Run the full deletion plan inside a transaction, then ROLLBACK.
 *               Prints per-table delete counts. Useful before the real run.
 *   --yes       Skip the interactive confirmation prompt.
 *
 * SAFETY
 *   - Runs every DELETE inside a single transaction. On any error, nothing is
 *     committed.
 *   - Sole-org developers (linked to this org and no other) have their session
 *     tree (sessions, events, session_titles, pattern matches, alert_events,
 *     friction_alerts, claude_md_snapshots, workflow_profiles) wiped.
 *   - Shared developers (linked to multiple orgs) are kept; only their
 *     organization_developer link to this org is removed via the implicit
 *     cascade from `organization`.
 *   - auth_user accounts are NOT touched. A user may own other orgs.
 *   - API keys are user-scoped, not org-scoped, and are also untouched.
 *
 * BACKGROUND
 *   See DEV-33 for the table-by-table cascade audit.  Many org-scoped tables
 *   were created with `organization_id TEXT` and no FK constraint, so the
 *   `organization` row alone does NOT cascade them. This script deletes them
 *   explicitly.
 */

import { SQL } from "bun";

type Counts = Record<string, number>;

interface Args {
  orgId: string;
  verify: boolean;
  dryRun: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const orgId = positional[0];
  if (!orgId) {
    console.error("usage: delete-org.ts <organizationId> [--verify] [--dry-run] [--yes]");
    process.exit(2);
  }
  return {
    orgId,
    verify: flags.has("--verify"),
    dryRun: flags.has("--dry-run"),
    yes: flags.has("--yes"),
  };
}

/**
 * Every table that may hold data scoped to an organization, with the WHERE
 * clause used to count residuals. Some tables can be reached only by joining
 * through sessions / developers, so the residual check uses those joins.
 */
function residualQueries(orgId: string) {
  const o = orgId;
  return [
    // Direct org_id columns (mostly no FK — this is why we need the script)
    { table: "organization", where: `id = $1`, params: [o] },
    { table: "member", where: `"organizationId" = $1`, params: [o] },
    { table: "invitation", where: `"organizationId" = $1`, params: [o] },
    { table: "organization_developer", where: `organization_id = $1`, params: [o] },
    { table: "organization_settings", where: `organization_id = $1`, params: [o] },
    { table: "alert_rules", where: `organization_id = $1`, params: [o] },
    { table: "digests", where: `organization_id = $1`, params: [o] },
    { table: "ai_conversations", where: `organization_id = $1`, params: [o] },
    { table: "ai_insights", where: `organization_id = $1`, params: [o] },
    { table: "ai_reports", where: `organization_id = $1`, params: [o] },
    { table: "ai_token_usage", where: `organization_id = $1`, params: [o] },
    { table: "team_skills", where: `organization_id = $1`, params: [o] },
    { table: "team_tool_topology", where: `organization_id = $1`, params: [o] },
    { table: "team_skill_gaps", where: `organization_id = $1`, params: [o] },
    { table: "tooling_health_snapshots", where: `organization_id = $1`, params: [o] },
    { table: "retention_log", where: `organization_id = $1`, params: [o] },
    { table: "data_requests", where: `organization_id = $1`, params: [o] },
    { table: "friction_rules", where: `organization_id = $1`, params: [o] },
    { table: "friction_alerts", where: `organization_id = $1`, params: [o] },
    { table: "ethics_audit_log", where: `organization_id = $1`, params: [o] },
    { table: "claude_md_snapshots", where: `organization_id = $1`, params: [o] },
    { table: "claude_md_correlations", where: `organization_id = $1`, params: [o] },
    { table: "workflow_profiles", where: `organization_id = $1`, params: [o] },
    // Sole-org-developer tail: developer rows that ONLY belonged to this org.
    // After deletion, none of these should reference a developer that was a
    // sole-org member of $orgId. This residual query is best-effort: once
    // organization_developer is gone, we cannot recover the sole-org list, so
    // we instead check that no orphan developer rows exist whose only purpose
    // would have been this org. The pre-deletion plan handles this set
    // explicitly; here we just look for orphans pointing at deleted sessions.
    {
      table: "sessions (orphans)",
      where: `developer_id NOT IN (SELECT id FROM developers)`,
      params: [],
    },
    {
      table: "events (orphans)",
      where: `session_id NOT IN (SELECT id FROM sessions)`,
      params: [],
    },
  ];
}

async function countResiduals(sql: SQL, orgId: string): Promise<Counts> {
  const counts: Counts = {};
  for (const q of residualQueries(orgId)) {
    const rows = await sql.unsafe(
      `SELECT COUNT(*)::int AS n FROM ${q.table.split(" ")[0]} WHERE ${q.where}`,
      q.params,
    );
    counts[q.table] = (rows as Array<{ n: number }>)[0]?.n ?? 0;
  }
  return counts;
}

/**
 * Execute the full deletion plan inside the given transaction client.
 * Returns rows-deleted per table.
 */
async function runDeletePlan(tx: SQL, orgId: string): Promise<Counts> {
  const out: Counts = {};
  const o = orgId;

  // Step 1: identify sole-org developers (linked only to this org).
  const soleOrgDevsRows = (await tx`
    SELECT od.developer_id
    FROM organization_developer od
    WHERE od.organization_id = ${o}
      AND NOT EXISTS (
        SELECT 1 FROM organization_developer od2
        WHERE od2.developer_id = od.developer_id
          AND od2.organization_id <> ${o}
      )
  `) as Array<{ developer_id: string }>;
  const soleOrgDevs = soleOrgDevsRows.map((r) => r.developer_id);

  // Step 2: identify session ids belonging to sole-org developers.
  let soleOrgSessions: string[] = [];
  if (soleOrgDevs.length > 0) {
    const rows = (await tx`
      SELECT id FROM sessions WHERE developer_id IN ${tx(soleOrgDevs)}
    `) as Array<{ id: string }>;
    soleOrgSessions = rows.map((r) => r.id);
  }

  out["_sole_org_developers"] = soleOrgDevs.length;
  out["_sole_org_sessions"] = soleOrgSessions.length;

  // Helper: run a delete and record count
  const del = async (label: string, run: () => Promise<unknown>) => {
    const r = (await run()) as { count?: number } | undefined;
    out[label] = r?.count ?? 0;
  };

  // ---- Session-tree wipe (only if there are sole-org sessions) ----
  if (soleOrgSessions.length > 0) {
    await del(
      "alert_events",
      () => tx`DELETE FROM alert_events WHERE session_id IN ${tx(soleOrgSessions)}`,
    );
    await del(
      "session_pattern_matches",
      () => tx`DELETE FROM session_pattern_matches WHERE session_id IN ${tx(soleOrgSessions)}`,
    );
    await del(
      "session_anti_pattern_matches",
      () => tx`DELETE FROM session_anti_pattern_matches WHERE session_id IN ${tx(soleOrgSessions)}`,
    );
    await del(
      "session_titles",
      () => tx`DELETE FROM session_titles WHERE session_id IN ${tx(soleOrgSessions)}`,
    );
    await del(
      "events",
      () => tx`DELETE FROM events WHERE session_id IN ${tx(soleOrgSessions)}`,
    );
    // claude_md_snapshots/correlations may match by session OR by org. Cover both.
    await del(
      "claude_md_correlations(snapshot)",
      () => tx`
        DELETE FROM claude_md_correlations
        WHERE snapshot_id IN (
          SELECT id FROM claude_md_snapshots WHERE session_id IN ${tx(soleOrgSessions)}
        )
      `,
    );
    await del(
      "claude_md_snapshots(session)",
      () => tx`DELETE FROM claude_md_snapshots WHERE session_id IN ${tx(soleOrgSessions)}`,
    );
    await del(
      "sessions",
      () => tx`DELETE FROM sessions WHERE id IN ${tx(soleOrgSessions)}`,
    );
  }

  if (soleOrgDevs.length > 0) {
    // alert_events also has developer_id without FK — cover any rows we missed
    await del(
      "alert_events(dev)",
      () => tx`DELETE FROM alert_events WHERE developer_id IN ${tx(soleOrgDevs)}`,
    );
    await del(
      "friction_alerts(dev)",
      () => tx`DELETE FROM friction_alerts WHERE developer_id IN ${tx(soleOrgDevs)}`,
    );
    await del(
      "workflow_profiles(dev)",
      () => tx`DELETE FROM workflow_profiles WHERE developer_id IN ${tx(soleOrgDevs)}`,
    );
    // user_developer_link cascades from developers, but be explicit.
    await del(
      "user_developer_link",
      () => tx`DELETE FROM user_developer_link WHERE developer_id IN ${tx(soleOrgDevs)}`,
    );
    await del(
      "developers",
      () => tx`DELETE FROM developers WHERE id IN ${tx(soleOrgDevs)}`,
    );
  }

  // ---- Org-scoped tables (no FK to organization) ----
  await del("alert_rules", () => tx`DELETE FROM alert_rules WHERE organization_id = ${o}`);
  await del("digests", () => tx`DELETE FROM digests WHERE organization_id = ${o}`);
  // ai_messages cascade from ai_conversations, so deleting conversations is enough.
  await del(
    "ai_conversations",
    () => tx`DELETE FROM ai_conversations WHERE organization_id = ${o}`,
  );
  await del("ai_insights", () => tx`DELETE FROM ai_insights WHERE organization_id = ${o}`);
  await del("ai_reports", () => tx`DELETE FROM ai_reports WHERE organization_id = ${o}`);
  await del(
    "ai_token_usage",
    () => tx`DELETE FROM ai_token_usage WHERE organization_id = ${o}`,
  );
  // team_skill_pattern_links cascades from team_skills.
  await del("team_skills", () => tx`DELETE FROM team_skills WHERE organization_id = ${o}`);
  await del(
    "team_tool_topology",
    () => tx`DELETE FROM team_tool_topology WHERE organization_id = ${o}`,
  );
  await del(
    "team_skill_gaps",
    () => tx`DELETE FROM team_skill_gaps WHERE organization_id = ${o}`,
  );
  await del(
    "tooling_health_snapshots",
    () => tx`DELETE FROM tooling_health_snapshots WHERE organization_id = ${o}`,
  );
  await del("retention_log", () => tx`DELETE FROM retention_log WHERE organization_id = ${o}`);
  await del("data_requests", () => tx`DELETE FROM data_requests WHERE organization_id = ${o}`);
  await del("friction_rules", () => tx`DELETE FROM friction_rules WHERE organization_id = ${o}`);
  await del(
    "friction_alerts(org)",
    () => tx`DELETE FROM friction_alerts WHERE organization_id = ${o}`,
  );
  // Ethics audit log: per consent-revoke promise we delete the org's audit
  // entries. If a future compliance review wants these retained-but-anonymized
  // instead, change this to UPDATE ... SET organization_id = NULL.
  await del(
    "ethics_audit_log",
    () => tx`DELETE FROM ethics_audit_log WHERE organization_id = ${o}`,
  );
  await del(
    "claude_md_correlations(org)",
    () => tx`DELETE FROM claude_md_correlations WHERE organization_id = ${o}`,
  );
  await del(
    "claude_md_snapshots(org)",
    () => tx`DELETE FROM claude_md_snapshots WHERE organization_id = ${o}`,
  );
  await del(
    "workflow_profiles(org)",
    () => tx`DELETE FROM workflow_profiles WHERE organization_id = ${o}`,
  );

  // ---- Finally drop the org row.  Cascades:
  //        member, invitation, organization_developer, organization_settings ----
  await del("organization", () => tx`DELETE FROM organization WHERE id = ${o}`);

  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Refusing to run.");
    process.exit(2);
  }
  const sql = new SQL({ url, max: 4 });

  if (args.verify) {
    const counts = await countResiduals(sql, args.orgId);
    const residual = Object.entries(counts).filter(([, n]) => n > 0);
    console.log(JSON.stringify({ orgId: args.orgId, counts, residual }, null, 2));
    await sql.close();
    process.exit(residual.length === 0 ? 0 : 1);
  }

  if (!args.yes && !args.dryRun) {
    console.error(
      `About to HARD DELETE all data for organization ${args.orgId}.\n` +
        `Run with --dry-run first, then re-run with --yes to confirm.`,
    );
    process.exit(2);
  }

  // Execute the plan inside a transaction. Bun.sql exposes sql.begin().
  let counts: Counts = {};
  let rolledBack = false;
  try {
    await sql.begin(async (tx: SQL) => {
      counts = await runDeletePlan(tx, args.orgId);
      if (args.dryRun) {
        // Force rollback by throwing a sentinel error
        rolledBack = true;
        throw new Error("__dry_run_rollback__");
      }
    });
  } catch (err) {
    if (rolledBack && (err as Error).message === "__dry_run_rollback__") {
      // expected — swallow
    } else {
      throw err;
    }
  }

  console.log(
    JSON.stringify(
      {
        orgId: args.orgId,
        mode: args.dryRun ? "dry-run (rolled back)" : "committed",
        deleted: counts,
      },
      null,
      2,
    ),
  );

  if (!args.dryRun) {
    const residual = await countResiduals(sql, args.orgId);
    const nonzero = Object.entries(residual).filter(([, n]) => n > 0);
    console.log("post-delete residual:", JSON.stringify(residual, null, 2));
    if (nonzero.length > 0) {
      console.error("RESIDUAL ROWS DETECTED — investigate:", nonzero);
      await sql.close();
      process.exit(1);
    }
  }

  await sql.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
