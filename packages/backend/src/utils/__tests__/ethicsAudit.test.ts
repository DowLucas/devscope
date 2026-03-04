import { describe, expect, test, beforeEach } from "bun:test";
import { logEthicsEvent, flushEthicsAudit } from "../ethicsAudit";

// Mock SQL with a tracking array for inserts
function createMockSql() {
  let beginCalled = false;

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
        beginCalled = true;
        await fn(txProxy);
      },
    }
  );

  return { sql: sql as any, wasBeginCalled: () => beginCalled };
}

describe("ethicsAudit", () => {
  // Flush any leftover pending events between tests
  beforeEach(async () => {
    await flushEthicsAudit();
  });

  test("logEthicsEvent accumulates events without immediate flush", () => {
    const { sql } = createMockSql();

    // Should not throw
    logEthicsEvent(sql, "org-1", "sensitive_fields_stripped", { fields: ["promptText"] });
    logEthicsEvent(sql, "org-1", "privacy_mode_activated", { session_id: "s-1" });
  });

  test("flushEthicsAudit flushes pending events", async () => {
    const { sql, wasBeginCalled } = createMockSql();

    logEthicsEvent(sql, "org-2", "data_request_processed", { action: "test" });
    await flushEthicsAudit();

    expect(wasBeginCalled()).toBe(true);
  });

  test("flushEthicsAudit is safe to call with no pending events", async () => {
    // Should not throw even with no events pending
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
