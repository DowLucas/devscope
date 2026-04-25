import { describe, expect, test } from "bun:test";
import { insertAuditEntry } from "../auditLogQueries";

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

describe("insertAuditEntry", () => {
  test("inserts with all fields and returns the row from RETURNING *", async () => {
    const expected = {
      id: 1,
      at: "2026-04-25T00:00:00Z",
      actor: "suggestion-worker",
      action: "artifact.publish",
      repo_installation_id: "ri-1",
      artifact_id: "a-1",
      policy_version: "v1.2.3",
      details: { reason: "ok" },
    };
    const sql = makeSql([expected]);

    const row = await insertAuditEntry(sql, {
      actor: "suggestion-worker",
      action: "artifact.publish",
      repo_installation_id: "ri-1",
      artifact_id: "a-1",
      policy_version: "v1.2.3",
      details: { reason: "ok" },
    });

    expect(row).toEqual(expected as any);
    expect(sql.calls).toHaveLength(1); // single statement, no nested fragments
    const insertCall = sql.calls[0];
    expect(insertCall.query).toMatch(/INSERT INTO audit_log/);
    expect(insertCall.query).toMatch(/RETURNING \*/);
    expect(insertCall.values).toContain("suggestion-worker");
    expect(insertCall.values).toContain("artifact.publish");
    expect(insertCall.values).toContain("ri-1");
    expect(insertCall.values).toContain("a-1");
    expect(insertCall.values).toContain("v1.2.3");
    // details serialized to JSON string and bound directly with ::jsonb cast
    expect(insertCall.values).toContain(JSON.stringify({ reason: "ok" }));
  });

  test("nullable optional fields are passed as null", async () => {
    const sql = makeSql([{ id: 2 }]);
    await insertAuditEntry(sql, {
      actor: "system",
      action: "install.suspend",
      policy_version: "v1.0.0",
    });
    expect(sql.calls).toHaveLength(1);
    const insertCall = sql.calls[0];
    expect(insertCall.query).toMatch(/INSERT INTO audit_log/);
    expect(insertCall.values).toContain(null); // repo_installation_id, artifact_id, and details
    // details omitted — no value should be a JSON-encoded object string
    const jsonBinding = insertCall.values.some(
      (v: unknown) => typeof v === "string" && (v as string).startsWith("{")
    );
    expect(jsonBinding).toBe(false);
  });
});
