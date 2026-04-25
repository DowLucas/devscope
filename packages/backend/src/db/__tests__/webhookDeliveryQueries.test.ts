import { describe, expect, test } from "bun:test";
import { recordDelivery } from "../webhookDeliveryQueries";

type Call = { query: string; values: unknown[] };

function makeSql(rows: unknown[] = []) {
  const calls: Call[] = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join("?"), values });
    return Promise.resolve(rows);
  }) as any;
  fn.calls = calls;
  return fn;
}

describe("recordDelivery", () => {
  test("returns true when delivery was newly inserted (RETURNING produced a row)", async () => {
    const sql = makeSql([{ delivery_id: "d-1" }]);
    const result = await recordDelivery(sql, "d-1", "pull_request");
    expect(result).toBe(true);
    expect(sql.calls[0].query).toMatch(/INSERT INTO webhook_deliveries/);
    expect(sql.calls[0].query).toMatch(/ON CONFLICT \(delivery_id\) DO NOTHING/);
    expect(sql.calls[0].query).toMatch(/RETURNING delivery_id/);
    expect(sql.calls[0].values).toContain("d-1");
    expect(sql.calls[0].values).toContain("pull_request");
  });

  test("returns false when duplicate (RETURNING produced zero rows)", async () => {
    const sql = makeSql([]);
    const result = await recordDelivery(sql, "d-1", "pull_request");
    expect(result).toBe(false);
  });

  test("uses a single SQL statement", async () => {
    const sql = makeSql([]);
    await recordDelivery(sql, "d-2", "push");
    expect(sql.calls).toHaveLength(1);
  });
});
