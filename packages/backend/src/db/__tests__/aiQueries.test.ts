/**
 * Integration tests for ai_reports org-scoped query path (DEV-43).
 *
 * Gated on TEST_DATABASE_URL — the unit suite has no live DB. To run:
 *
 *   TEST_DATABASE_URL=postgres://devscope:devscope@localhost:5432/devscope_test \
 *     bun test packages/backend/src/db/__tests__/aiQueries.test.ts
 *
 * If the env var is unset the suite is skipped, mirroring delete-org.test.ts.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { initializeDatabase } from "../schema";
import {
  createReport,
  createReportIfAbsent,
  getReports,
  getReportsForOrg,
} from "../aiQueries";

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

d("aiQueries — org-scoped report path (DEV-43)", () => {
  // Lazily initialised so describe.skip doesn't try to connect.
  let sqlPromise: ReturnType<typeof initializeDatabase> | null = null;
  const getSql = () => (sqlPromise ??= initializeDatabase(dbUrl!));

  const orgA = `t-org-a-${crypto.randomUUID()}`;
  const orgB = `t-org-b-${crypto.randomUUID()}`;

  afterAll(async () => {
    if (!sqlPromise) return;
    const sql = await sqlPromise;
    await sql`DELETE FROM ai_reports WHERE organization_id IN (${orgA}, ${orgB})`;
    await sql`DELETE FROM organization WHERE id IN (${orgA}, ${orgB})`;
  });

  test("seeds two orgs", async () => {
    const sql = await getSql();
    await sql`INSERT INTO organization (id, name, slug) VALUES (${orgA}, 'A', ${orgA}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${orgB}, 'B', ${orgB}) ON CONFLICT (id) DO NOTHING`;
  });

  test("getReports filters by organization_id", async () => {
    const sql = await getSql();

    await createReport(sql, {
      report_type: "weekly",
      title: "A — week 1",
      period_start: "2026-04-27T00:00:00Z",
      period_end: "2026-05-04T00:00:00Z",
      orgId: orgA,
    });
    await createReport(sql, {
      report_type: "weekly",
      title: "B — week 1",
      period_start: "2026-04-27T00:00:00Z",
      period_end: "2026-05-04T00:00:00Z",
      orgId: orgB,
    });

    const aReports = await getReports(sql, 50, orgA);
    const bReports = await getReports(sql, 50, orgB);

    expect(aReports.every((r: any) => r.organization_id === orgA)).toBe(true);
    expect(bReports.every((r: any) => r.organization_id === orgB)).toBe(true);
    // Cross-org leakage check.
    expect(aReports.some((r: any) => r.organization_id === orgB)).toBe(false);
  });

  test("getReportsForOrg returns the row for (org, type, period)", async () => {
    const sql = await getSql();
    const row = await getReportsForOrg(
      sql,
      orgA,
      "weekly",
      "2026-04-27T00:00:00Z"
    );
    expect(row).not.toBeNull();
    expect((row as any).organization_id).toBe(orgA);
    expect((row as any).report_type).toBe("weekly");
  });

  test("getReportsForOrg is null for an unknown period", async () => {
    const sql = await getSql();
    const row = await getReportsForOrg(
      sql,
      orgA,
      "weekly",
      "1999-01-01T00:00:00Z"
    );
    expect(row).toBeNull();
  });

  test("createReportIfAbsent skips writes when the weekly-dedup index trips", async () => {
    const sql = await getSql();
    const period = "2026-05-04T00:00:00Z";

    const first = await createReportIfAbsent(sql, {
      report_type: "weekly",
      title: "A — dedup first",
      period_start: period,
      orgId: orgA,
    });
    expect(first).not.toBeNull();

    const second = await createReportIfAbsent(sql, {
      report_type: "weekly",
      title: "A — dedup second",
      period_start: period,
      orgId: orgA,
    });
    // Cron foundation: second insert silently skipped, no exception thrown.
    expect(second).toBeNull();

    // Same (type, period) is allowed for a different org.
    const otherOrg = await createReportIfAbsent(sql, {
      report_type: "weekly",
      title: "B — same period",
      period_start: period,
      orgId: orgB,
    });
    expect(otherOrg).not.toBeNull();
  });
});
