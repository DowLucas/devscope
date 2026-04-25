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
    // The INSERT is one statement; the conditional `${... ? sql\`x::jsonb\` : sql\`NULL\`}`
    // adds one nested tagged-template fragment call, so we look up by query text.
    const insertCall = sql.calls.find((c: Call) => /INSERT INTO audit_log/.test(c.query));
    expect(insertCall).toBeDefined();
    expect(insertCall!.query).toMatch(/RETURNING \*/);
    expect(insertCall!.values).toContain("suggestion-worker");
    expect(insertCall!.values).toContain("artifact.publish");
    expect(insertCall!.values).toContain("ri-1");
    expect(insertCall!.values).toContain("a-1");
    expect(insertCall!.values).toContain("v1.2.3");
    // The serialized JSON string is bound by the inner fragment's tagged-template call.
    const fragmentCall = sql.calls.find((c: Call) =>
      c.values.some(v => typeof v === "string" && v === JSON.stringify({ reason: "ok" }))
    );
    expect(fragmentCall).toBeDefined();
  });

  test("nullable optional fields are passed as null", async () => {
    const sql = makeSql([{ id: 2 }]);
    await insertAuditEntry(sql, {
      actor: "system",
      action: "install.suspend",
      policy_version: "v1.0.0",
    });
    const insertCall = sql.calls.find((c: Call) => /INSERT INTO audit_log/.test(c.query));
    expect(insertCall).toBeDefined();
    expect(insertCall!.values).toContain(null); // repo_installation_id and artifact_id
    // details omitted — no fragment call should bind a JSON-string value
    const jsonBinding = sql.calls.some((c: Call) =>
      c.values.some((v: unknown) => typeof v === "string" && (v as string).startsWith("{"))
    );
    expect(jsonBinding).toBe(false);
  });
});
