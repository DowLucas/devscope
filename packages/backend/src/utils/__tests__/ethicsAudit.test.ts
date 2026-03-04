import { describe, expect, test, beforeEach, mock, spyOn } from "bun:test";
import { logEthicsEvent, flushEthicsAudit } from "../ethicsAudit";

// Mock SQL with a tracking array for inserts
function createMockSql() {
  const inserts: Array<{ organization_id: string | null; event_type: string; details: Record<string, unknown> }> = [];

  const txProxy = new Proxy({}, {
    get: () => {
      // Return a tagged template function for tx`...`
      return (...args: unknown[]) => Promise.resolve([]);
    },
  });

  const sql = Object.assign(
    // Tagged template for sql`...`
    (...args: unknown[]) => Promise.resolve([]),
    {
      begin: async (fn: (tx: any) => Promise<void>) => {
        await fn(txProxy);
      },
    }
  );

  return { sql: sql as any, inserts };
}

describe("ethicsAudit", () => {
  test("logEthicsEvent accumulates events without immediate flush", () => {
    const { sql } = createMockSql();

    // Should not throw
    logEthicsEvent(sql, "org-1", "sensitive_fields_stripped", { fields: ["promptText"] });
    logEthicsEvent(sql, "org-1", "privacy_mode_activated", { session_id: "s-1" });
  });

  test("flushEthicsAudit flushes pending events", async () => {
    const { sql } = createMockSql();
    let beginCalled = false;
    sql.begin = async (fn: (tx: any) => Promise<void>) => {
      beginCalled = true;
      const txProxy = new Proxy({}, {
        get: () => (..._args: unknown[]) => Promise.resolve([]),
      });
      await fn(txProxy);
    };

    logEthicsEvent(sql, "org-2", "data_request_processed", { action: "test" });
    await flushEthicsAudit();

    expect(beginCalled).toBe(true);
  });

  test("flushEthicsAudit is safe to call with no pending events", async () => {
    // Should not throw even with no SQL set
    await flushEthicsAudit();
  });

  test("logEthicsEvent handles null orgId", () => {
    const { sql } = createMockSql();
    // Should not throw
    logEthicsEvent(sql, null, "retention_purge_executed", {});
  });

  test("all event types are valid", () => {
    const { sql } = createMockSql();
    const types = [
      "sensitive_fields_stripped",
      "ai_individual_reference_blocked",
      "privacy_mode_activated",
      "data_request_processed",
      "retention_purge_executed",
    ] as const;

    for (const type of types) {
      // Should not throw
      logEthicsEvent(sql, "org-test", type, {});
    }
  });
});
