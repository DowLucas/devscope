import { describe, expect, test } from "bun:test";
import { getSuppression, upsertSuppression } from "../suppressionQueries";

type Call = { query: string; values: unknown[] };

function makeSql(rowsByMatch: Array<{ match: RegExp; rows: unknown[] }> = []) {
  const calls: Call[] = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    const hit = rowsByMatch.find(r => r.match.test(query));
    return Promise.resolve(hit ? hit.rows : []);
  }) as any;
  fn.calls = calls;
  return fn;
}

describe("getSuppression", () => {
  test("returns null when no row", async () => {
    const sql = makeSql();
    expect(await getSuppression(sql, "sk-missing")).toBeNull();
  });

  test("returns the canonical (camelCase) row when present", async () => {
    const dbRow = {
      suppression_key: "sk-1",
      repo_installation_id: "ri-1",
      kind: "claude_md",
      last_rejected_at: "2026-04-01T00:00:00Z",
      rejection_reason: "noisy",
      rejection_count: 3,
      next_eligible_at: "2026-05-01T00:00:00Z",
    };
    const sql = makeSql([{ match: /SELECT \* FROM suppression_ledger/, rows: [dbRow] }]);
    const row = await getSuppression(sql, "sk-1");
    expect(row).toEqual({
      suppressionKey: "sk-1",
      repoInstallationId: "ri-1",
      kind: "claude_md",
      lastRejectedAt: "2026-04-01T00:00:00Z",
      rejectionReason: "noisy",
      rejectionCount: 3,
      nextEligibleAt: "2026-05-01T00:00:00Z",
    });
  });
});

describe("upsertSuppression", () => {
  test("first call inserts a fresh row (count=1)", async () => {
    const dbRow = {
      suppression_key: "sk-1",
      repo_installation_id: "ri-1",
      kind: "claude_md",
      last_rejected_at: "2026-04-25T00:00:00Z",
      rejection_reason: "first reject",
      rejection_count: 1,
      next_eligible_at: "2026-05-01T00:00:00Z",
    };
    const sql = makeSql([{ match: /SELECT \* FROM suppression_ledger/, rows: [dbRow] }]);

    const row = await upsertSuppression(sql, {
      suppressionKey: "sk-1",
      repoInstallationId: "ri-1",
      kind: "claude_md",
      nextEligibleAt: "2026-05-01T00:00:00Z",
      rejectionReason: "first reject",
    });

    expect(row.suppressionKey).toBe("sk-1");
    expect(row.rejectionCount).toBe(1);
    expect(row.nextEligibleAt).toBe("2026-05-01T00:00:00Z");
    const insertCall = sql.calls.find((c: Call) => /INSERT INTO suppression_ledger/.test(c.query));
    expect(insertCall).toBeDefined();
    expect(insertCall!.query).toMatch(/ON CONFLICT \(suppression_key\) DO UPDATE/);
    // The conflict branch must extend the cooldown (GREATEST), never shrink.
    expect(insertCall!.query).toMatch(/GREATEST\(suppression_ledger\.next_eligible_at, EXCLUDED\.next_eligible_at\)/);
    // …and increment the rejection_count
    expect(insertCall!.query).toMatch(/rejection_count\s*=\s*suppression_ledger\.rejection_count \+ 1/);
  });

  test("conflict branch extends cooldown and bumps count via SQL (single statement)", async () => {
    // Verify that the upsert is a single INSERT statement (not select-then-update).
    const dbRow = {
      suppression_key: "sk-1",
      repo_installation_id: "ri-1",
      kind: "claude_md",
      last_rejected_at: "2026-04-25T00:00:00Z",
      rejection_reason: null,
      rejection_count: 2,
      next_eligible_at: "2026-06-01T00:00:00Z",
    };
    const sql = makeSql([{ match: /SELECT \* FROM suppression_ledger/, rows: [dbRow] }]);
    await upsertSuppression(sql, {
      suppressionKey: "sk-1",
      repoInstallationId: "ri-1",
      kind: "claude_md",
      nextEligibleAt: "2026-06-01T00:00:00Z",
    });
    const writes = sql.calls.filter((c: Call) => /INSERT|UPDATE/.test(c.query));
    expect(writes).toHaveLength(1); // single atomic write
  });
});
