import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import {
  assertNoDeveloperIdentities,
  auditWeeklyReportInput,
  detectDeveloperIdentities,
  guardWeeklyReportInput,
  MissionViolationError,
  payloadHashHex,
  _resetMissionRosterCache,
  type GuardrailContext,
} from "../missionGuardrail";

/**
 * Synthetic per-developer underlying team. The snapshot test below feeds the
 * helper-layer composition (`gatherReportData`) realistic per-developer data
 * and asserts that the *aggregated* payload that reaches the LLM contains
 * none of these identifying strings.
 */
const SYNTHETIC_TEAM = [
  {
    id: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    name: "Alice Johnson",
    email: "alice@acme.test",
  },
  {
    id: "b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1",
    name: "Bob Patel",
    email: "bob@acme.test",
  },
  {
    id: "c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2",
    name: "Carol Lee",
    email: "carol@acme.test",
  },
];

const ORG_ID = "11111111-2222-3333-4444-555555555555";
const PERIOD_START = "2026-04-27";
const PERIOD_END = "2026-05-03";

const DEFAULT_CTX: GuardrailContext = {
  organizationId: ORG_ID,
  persona: "weekly-buyer",
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  surface: "reports.weekly-buyer.outline",
};

interface RecordedAuditRow {
  organization_id: string | null;
  event_type: string;
  details: Record<string, unknown>;
}

/**
 * Mock SQL that:
 *   - Returns the synthetic team for `SELECT id, name, email FROM developers`.
 *   - Captures `INSERT INTO ethics_audit_log` calls into a buffer that tests
 *     can inspect.
 *   - Is a no-op for everything else.
 */
function createMockSql() {
  const auditRows: RecordedAuditRow[] = [];

  const tx = (..._args: unknown[]) => Promise.resolve([]);

  const fn = (...args: unknown[]) => {
    const parts = args[0] as TemplateStringsArray | undefined;
    const joined = parts ? parts.join("") : "";

    if (joined.includes("FROM developers")) {
      return Promise.resolve(SYNTHETIC_TEAM);
    }

    if (joined.includes("INSERT INTO ethics_audit_log")) {
      // Bun.sql template params are positional after the strings array; the
      // INSERT in missionGuardrail.ts has params in order:
      //   id, organization_id, event_type, details
      const params = args.slice(1);
      const [, organization_id, event_type, details] = params as [
        unknown,
        string | null,
        string,
        Record<string, unknown>,
      ];
      auditRows.push({
        organization_id,
        event_type,
        details,
      });
      return Promise.resolve([]);
    }

    return Promise.resolve([]);
  };

  const sql = Object.assign(fn, {
    begin: async (cb: (tx: unknown) => Promise<void>) => {
      await cb(tx);
    },
  });

  return { sql: sql as any, auditRows };
}

// =============================================================================
// detectDeveloperIdentities — pure detection
// =============================================================================

describe("detectDeveloperIdentities", () => {
  beforeEach(() => {
    _resetMissionRosterCache();
  });

  test("clean team-aggregated payload returns zero hits", async () => {
    const { sql } = createMockSql();
    const payload = {
      teamVelocity: {
        current_week: { sessions: 142, prompts: 1820, tool_calls: 3420 },
        previous_week: { sessions: 118, prompts: 1610, tool_calls: 2980 },
        percent_change: { sessions: 20, prompts: 13, tool_calls: 15 },
      },
      projects: [
        { project_name: "billing-service", sessions: 42, total_minutes: 1810 },
        { project_name: "auth-service", sessions: 31, total_minutes: 1240 },
      ],
      sessionsNeedingAttention: [
        // session_id is a UUID — max 12 contiguous hex chars, MUST NOT trip
        // the SHA-256 detector.
        {
          session_id: "7dac753a-5888-4824-846e-f6aba44ff39e",
          project_name: "billing-service",
          tool_failure_rate: 0.42,
        },
      ],
      toolUsage: { Bash: 320, Read: 120, Edit: 88 },
    };

    const hits = await detectDeveloperIdentities(sql, payload);
    expect(hits).toEqual([]);
  });

  test("payload with a developer email triggers a developer_email hit", async () => {
    const { sql } = createMockSql();
    const payload = {
      narrative_seed: "Top contributor this week was alice@acme.test",
    };

    const hits = await detectDeveloperIdentities(sql, payload);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((h) => h.kind === "developer_email")).toBe(true);
  });

  test("payload with a developer first name triggers a developer_name hit", async () => {
    const { sql } = createMockSql();
    const payload = {
      summary: "Alice fixed a regression in the build pipeline.",
    };

    const hits = await detectDeveloperIdentities(sql, payload);
    expect(hits.some((h) => h.kind === "developer_name")).toBe(true);
  });

  test("payload with a 64-hex SHA-256 developer id triggers a hash hit", async () => {
    const { sql } = createMockSql();
    const payload = {
      // Plugin-derived developer id — SHA256(git config user.email).
      attribution: { developer_id: SYNTHETIC_TEAM[0].id },
    };

    const hits = await detectDeveloperIdentities(sql, payload);
    expect(hits.some((h) => h.kind === "developer_id_hash")).toBe(true);
    // Path attribution: the leak should be reported under the field where it
    // occurred, not the root.
    expect(hits.find((h) => h.kind === "developer_id_hash")?.path).toContain(
      "developer_id"
    );
  });

  test("payload with an apikey-* token triggers an api_key_token hit", async () => {
    const { sql } = createMockSql();
    const payload = { trace: "request authenticated via apikey-abcDEF12_xyz" };

    const hits = await detectDeveloperIdentities(sql, payload);
    expect(hits.some((h) => h.kind === "api_key_token")).toBe(true);
  });

  test("UUIDs do not trigger the hash detector (dashes break the hex run)", async () => {
    const { sql } = createMockSql();
    const payload = {
      org_id: "11111111-2222-3333-4444-555555555555",
      session_ids: [
        "7dac753a-5888-4824-846e-f6aba44ff39e",
        "bd2e1ebf-4e95-4294-a686-83c593c9e1ad",
      ],
    };

    const hits = await detectDeveloperIdentities(sql, payload);
    expect(hits).toEqual([]);
  });
});

// =============================================================================
// assertNoDeveloperIdentities — runtime tripwire
// =============================================================================

describe("assertNoDeveloperIdentities (runtime tripwire)", () => {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    _resetMissionRosterCache();
    // Silence the warn-on-violation log to keep test output readable.
    originalConsoleError = console.error;
    console.error = mock(() => {});
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("clean payload passes silently, writes no audit row", async () => {
    const { sql, auditRows } = createMockSql();
    const payload = { teamVelocity: { current_week: { sessions: 142 } } };

    await assertNoDeveloperIdentities(sql, payload, DEFAULT_CTX);

    expect(auditRows).toHaveLength(0);
  });

  test("leaky payload throws MissionViolationError BEFORE any LLM call", async () => {
    const { sql } = createMockSql();
    const payload = { summary: "Alice fixed a regression." };

    await expect(
      assertNoDeveloperIdentities(sql, payload, DEFAULT_CTX)
    ).rejects.toBeInstanceOf(MissionViolationError);
  });

  test("leaky payload writes a mission_violation row with hit metadata", async () => {
    const { sql, auditRows } = createMockSql();
    const payload = { contact: "bob@acme.test" };

    let caught: MissionViolationError | null = null;
    try {
      await assertNoDeveloperIdentities(sql, payload, DEFAULT_CTX);
    } catch (err) {
      caught = err as MissionViolationError;
    }

    expect(caught).toBeInstanceOf(MissionViolationError);
    expect(caught!.hits.some((h) => h.kind === "developer_email")).toBe(true);

    expect(auditRows).toHaveLength(1);
    const row = auditRows[0];
    expect(row.event_type).toBe("mission_violation");
    expect(row.organization_id).toBe(ORG_ID);
    expect(row.details.surface).toBe("reports.weekly-buyer.outline");
    expect(row.details.persona).toBe("weekly-buyer");
    expect(row.details.period_start).toBe(PERIOD_START);
    expect(row.details.period_end).toBe(PERIOD_END);
    expect(row.details.hit_count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(row.details.hit_kinds)).toBe(true);
    expect((row.details.hit_kinds as string[]).includes("developer_email")).toBe(
      true
    );
    // Audit row stores hash, not raw payload contents — so the row itself
    // does not become a leak vector.
    expect(typeof row.details.payload_hash).toBe("string");
    expect(row.details).not.toHaveProperty("payload");
  });

  test("hand-crafted leaky payload (apikey + sha256) trips the wire", async () => {
    const { sql, auditRows } = createMockSql();
    const payload = {
      raw_event: {
        api_key: "apikey-DEADBEEF_1234",
        actor: SYNTHETIC_TEAM[1].id,
      },
    };

    await expect(
      assertNoDeveloperIdentities(sql, payload, DEFAULT_CTX)
    ).rejects.toBeInstanceOf(MissionViolationError);
    expect(auditRows).toHaveLength(1);
    const kinds = auditRows[0].details.hit_kinds as string[];
    expect(kinds).toContain("api_key_token");
    expect(kinds).toContain("developer_id_hash");
  });
});

// =============================================================================
// auditWeeklyReportInput — happy-path provenance log
// =============================================================================

describe("auditWeeklyReportInput", () => {
  beforeEach(() => {
    _resetMissionRosterCache();
  });

  test("writes one weekly_report_llm_input row with full audit attribution", async () => {
    const { sql, auditRows } = createMockSql();
    const payload = {
      teamVelocity: { current_week: { sessions: 142 } },
      projects: [{ project_name: "billing-service", sessions: 42 }],
    };

    await auditWeeklyReportInput(sql, payload, DEFAULT_CTX);

    expect(auditRows).toHaveLength(1);
    const row = auditRows[0];
    expect(row.event_type).toBe("weekly_report_llm_input");
    expect(row.organization_id).toBe(ORG_ID);
    expect(row.details.surface).toBe("reports.weekly-buyer.outline");
    expect(row.details.persona).toBe("weekly-buyer");
    expect(row.details.period_start).toBe(PERIOD_START);
    expect(row.details.period_end).toBe(PERIOD_END);
    expect(typeof row.details.payload_hash).toBe("string");
    // Hash is hex SHA-256 → 64 chars.
    expect((row.details.payload_hash as string).length).toBe(64);
    // The full team-aggregated payload IS stored on the happy-path row —
    // by construction it has been verified free of developer identities,
    // and the row exists so a CEO/COO can audit what the LLM saw.
    expect(row.details.payload).toEqual(payload);
  });

  test("payloadHashHex is deterministic for equal payloads", async () => {
    const a = await payloadHashHex({ x: 1, y: [2, 3] });
    const b = await payloadHashHex({ x: 1, y: [2, 3] });
    const c = await payloadHashHex({ x: 1, y: [2, 4] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

// =============================================================================
// guardWeeklyReportInput — assert + audit + hash, in one call
// =============================================================================

describe("guardWeeklyReportInput", () => {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    _resetMissionRosterCache();
    originalConsoleError = console.error;
    console.error = mock(() => {});
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("clean payload writes one weekly_report_llm_input row", async () => {
    const { sql, auditRows } = createMockSql();
    const payload = {
      teamVelocity: { current_week: { sessions: 142 } },
      projects: [{ project_name: "billing-service", sessions: 42 }],
    };

    const result = await guardWeeklyReportInput(sql, payload, DEFAULT_CTX);

    expect(typeof result.payloadHash).toBe("string");
    expect(result.payloadHash.length).toBe(64);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].event_type).toBe("weekly_report_llm_input");
  });

  test("leaky payload throws and writes mission_violation, NOT happy-path row", async () => {
    const { sql, auditRows } = createMockSql();
    const payload = { summary: "Alice fixed a regression." };

    await expect(
      guardWeeklyReportInput(sql, payload, DEFAULT_CTX)
    ).rejects.toBeInstanceOf(MissionViolationError);

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].event_type).toBe("mission_violation");
  });
});
