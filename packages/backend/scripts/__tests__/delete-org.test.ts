/**
 * Integration test for delete-org.ts.
 *
 * Gated on TEST_DATABASE_URL — the unit suite has no live DB.  To run:
 *
 *   TEST_DATABASE_URL=postgres://devscope:devscope@localhost:5432/devscope_test \
 *     bun test packages/backend/scripts/__tests__/delete-org.test.ts
 *
 * The test seeds a minimal but representative org across every org-scoped
 * table, runs the deletion plan, and asserts zero residual rows. If the
 * env var is unset the suite is skipped.
 */
import { describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { initializeDatabase } from "../../src/db/schema";

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

d("delete-org integration", () => {
  test("hard-deletes every org-scoped row across all tables", async () => {
    const sql = await initializeDatabase(dbUrl!);
    const orgId = `t-org-${crypto.randomUUID()}`;
    const userId = `t-user-${crypto.randomUUID()}`;
    const devId = `t-dev-${crypto.randomUUID()}`;
    const sessionId = `t-sess-${crypto.randomUUID()}`;
    const otherOrgId = `t-org-other-${crypto.randomUUID()}`;
    const sharedDevId = `t-dev-shared-${crypto.randomUUID()}`;

    // ---- seed ----
    await sql`INSERT INTO auth_user (id, name, email) VALUES (${userId}, 'T', ${`${userId}@e.x`})`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${orgId}, 'T', ${orgId})`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${otherOrgId}, 'O', ${otherOrgId})`;
    await sql`INSERT INTO organization_settings (organization_id) VALUES (${orgId})`;
    await sql`INSERT INTO member (id, "organizationId", "userId", role) VALUES (${`m-${orgId}`}, ${orgId}, ${userId}, 'owner')`;
    await sql`INSERT INTO invitation (id, "organizationId", email, role, "inviterId", "expiresAt") VALUES (${`i-${orgId}`}, ${orgId}, 'p@x.io', 'member', ${userId}, NOW() + INTERVAL '7 days')`;
    await sql`INSERT INTO developers (id, name, email) VALUES (${devId}, 'D', ${`${devId}@e.x`})`;
    await sql`INSERT INTO developers (id, name, email) VALUES (${sharedDevId}, 'S', ${`${sharedDevId}@e.x`})`;
    await sql`INSERT INTO organization_developer (organization_id, developer_id) VALUES (${orgId}, ${devId})`;
    // shared dev is in BOTH orgs and must NOT be deleted
    await sql`INSERT INTO organization_developer (organization_id, developer_id) VALUES (${orgId}, ${sharedDevId})`;
    await sql`INSERT INTO organization_developer (organization_id, developer_id) VALUES (${otherOrgId}, ${sharedDevId})`;
    await sql`INSERT INTO user_developer_link (auth_user_id, developer_id) VALUES (${userId}, ${devId})`;

    await sql`INSERT INTO sessions (id, developer_id, project_path, project_name) VALUES (${sessionId}, ${devId}, '/p', 'p')`;
    await sql`INSERT INTO events (id, session_id, event_type, payload) VALUES (${`e1-${sessionId}`}, ${sessionId}, 'tool.use', '{}'::jsonb)`;
    await sql`INSERT INTO session_titles (id, session_id, title) VALUES (${`st-${sessionId}`}, ${sessionId}, 't')`;

    // patterns / anti-patterns matches (session_id linkage)
    await sql`INSERT INTO session_patterns (id, name, description, tool_sequence) VALUES ('p-x', 'p', 'd', ARRAY['Bash'])`.catch(()=>{});
    await sql`INSERT INTO session_pattern_matches (id, session_id, pattern_id) VALUES (${`spm-${sessionId}`}, ${sessionId}, 'p-x')`.catch(()=>{});
    await sql`INSERT INTO anti_patterns (id, name, description, detection_rule, suggestion) VALUES ('ap-x', 'a', 'd', 'r', 's')`.catch(()=>{});
    await sql`INSERT INTO session_anti_pattern_matches (id, session_id, anti_pattern_id) VALUES (${`sapm-${sessionId}`}, ${sessionId}, 'ap-x')`.catch(()=>{});

    // org-scoped derived tables
    await sql`INSERT INTO alert_rules (id, organization_id, rule_type) VALUES (${`ar-${orgId}`}, ${orgId}, 'failure_threshold')`;
    await sql`INSERT INTO alert_events (id, rule_id, session_id, developer_id, tool_name, failure_count, organization_id) VALUES (${`ae-${orgId}`}, ${`ar-${orgId}`}, ${sessionId}, ${devId}, 'Bash', 1, ${orgId})`;
    await sql`INSERT INTO digests (id, digest_type, period_start, period_end, organization_id) VALUES (${`dg-${orgId}`}, 'daily', NOW(), NOW(), ${orgId})`;
    await sql`INSERT INTO ai_conversations (id, title, organization_id) VALUES (${`aic-${orgId}`}, 't', ${orgId})`;
    await sql`INSERT INTO ai_messages (id, conversation_id, role, content) VALUES (${`aim-${orgId}`}, ${`aic-${orgId}`}, 'user', 'hi')`;
    await sql`INSERT INTO ai_insights (id, type, severity, title, narrative, organization_id) VALUES (${`aii-${orgId}`}, 'trend', 'info', 't', 'n', ${orgId})`;
    await sql`INSERT INTO ai_reports (id, report_type, title, organization_id) VALUES (${`air-${orgId}`}, 'daily', 't', ${orgId})`;
    await sql`INSERT INTO ai_token_usage (id, source, model, organization_id) VALUES (${`aitu-${orgId}`}, 's', 'm', ${orgId})`;
    await sql`INSERT INTO team_skills (id, organization_id, name, description, skill_body) VALUES (${`ts-${orgId}`}, ${orgId}, 'n', 'd', 'b')`;
    await sql`INSERT INTO team_tool_topology (id, organization_id, tool_name, period_start, period_end) VALUES (${`ttt-${orgId}`}, ${orgId}, 'Bash', NOW(), NOW())`;
    await sql`INSERT INTO team_skill_gaps (id, organization_id, tool_name, gap_type, description) VALUES (${`tsg-${orgId}`}, ${orgId}, 'Bash', 'low_proficiency', 'd')`;
    await sql`INSERT INTO tooling_health_snapshots (id, organization_id, tool_name) VALUES (${`ths-${orgId}`}, ${orgId}, 'Bash')`;
    await sql`INSERT INTO retention_log (id, organization_id) VALUES (${`rl-${orgId}`}, ${orgId})`;
    await sql`INSERT INTO data_requests (id, developer_id, organization_id, request_type) VALUES (${`dr-${orgId}`}, ${devId}, ${orgId}, 'deletion')`;
    await sql`INSERT INTO friction_rules (id, organization_id, rule_name, rule_type) VALUES (${`fr-${orgId}`}, ${orgId}, 'r', 'spike')`;
    await sql`INSERT INTO friction_alerts (id, organization_id, session_id, developer_id, rule_type, title, description) VALUES (${`fa-${orgId}`}, ${orgId}, ${sessionId}, ${devId}, 'spike', 't', 'd')`;
    await sql`INSERT INTO ethics_audit_log (id, organization_id, event_type) VALUES (${`eal-${orgId}`}, ${orgId}, 'sensitive_fields_stripped')`;
    await sql`INSERT INTO claude_md_snapshots (id, organization_id, project_name, project_path, content_hash, content_size, session_id, developer_id) VALUES (${`cms-${orgId}`}, ${orgId}, 'p', '/p', 'h', 0, ${sessionId}, ${devId})`;
    await sql`INSERT INTO claude_md_correlations (id, organization_id, project_path, snapshot_id, window_start, window_end) VALUES (${`cmc-${orgId}`}, ${orgId}, '/p', ${`cms-${orgId}`}, NOW(), NOW())`;
    await sql`INSERT INTO workflow_profiles (id, organization_id, developer_id, period_start, period_end) VALUES (${`wp-${orgId}`}, ${orgId}, ${devId}, NOW(), NOW())`;

    // ---- run deletion script ----
    const proc = Bun.spawn(
      [
        "bun",
        "run",
        new URL("../delete-org.ts", import.meta.url).pathname,
        orgId,
        "--yes",
      ],
      { env: { ...process.env, DATABASE_URL: dbUrl! } },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exit = await proc.exited;
    expect({ exit, stdout, stderr }).toMatchObject({ exit: 0 });

    // ---- assertions: zero residual rows everywhere ----
    const tables = [
      "organization",
      "member",
      "invitation",
      "organization_developer",
      "organization_settings",
      "alert_rules",
      "digests",
      "ai_conversations",
      "ai_insights",
      "ai_reports",
      "ai_token_usage",
      "team_skills",
      "team_tool_topology",
      "team_skill_gaps",
      "tooling_health_snapshots",
      "retention_log",
      "data_requests",
      "friction_rules",
      "friction_alerts",
      "ethics_audit_log",
      "claude_md_snapshots",
      "claude_md_correlations",
      "workflow_profiles",
    ];
    for (const t of tables) {
      const col = t === "organization" ? "id" : t === "member" || t === "invitation" ? `"organizationId"` : "organization_id";
      const rows = (await sql.unsafe(
        `SELECT COUNT(*)::int AS n FROM ${t} WHERE ${col} = $1`,
        [orgId],
      )) as Array<{ n: number }>;
      expect({ table: t, n: rows[0].n }).toEqual({ table: t, n: 0 });
    }

    // sole-org developer is gone, shared dev survives
    const devLeft = (await sql`SELECT id FROM developers WHERE id = ${devId}`) as Array<unknown>;
    expect(devLeft).toHaveLength(0);
    const sharedLeft = (await sql`SELECT id FROM developers WHERE id = ${sharedDevId}`) as Array<unknown>;
    expect(sharedLeft).toHaveLength(1);

    // session/event tree gone
    const sessLeft = (await sql`SELECT id FROM sessions WHERE id = ${sessionId}`) as Array<unknown>;
    expect(sessLeft).toHaveLength(0);
    const evLeft = (await sql`SELECT id FROM events WHERE session_id = ${sessionId}`) as Array<unknown>;
    expect(evLeft).toHaveLength(0);

    // user account NOT touched
    const userLeft = (await sql`SELECT id FROM auth_user WHERE id = ${userId}`) as Array<unknown>;
    expect(userLeft).toHaveLength(1);

    // cleanup the other org we created
    await sql`DELETE FROM organization_developer WHERE organization_id = ${otherOrgId}`;
    await sql`DELETE FROM developers WHERE id = ${sharedDevId}`;
    await sql`DELETE FROM organization WHERE id = ${otherOrgId}`;
    await sql`DELETE FROM auth_user WHERE id = ${userId}`;

    await sql.close();
  }, 30_000);
});
