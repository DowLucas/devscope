import { describe, expect, test } from "bun:test";
import {
  resolveVisibility,
  teammateVisibility,
  redactSessionRow,
  redactEvent,
  filterVisibleReports,
} from "../visibility";

const owner = "dev-owner";
const viewer = "dev-viewer";

describe("resolveVisibility", () => {
  test("owner always sees their own sessions, even private and opted out", () => {
    expect(resolveVisibility({
      viewerDevIds: [viewer, owner], ownerDevId: owner, ownerShareDetails: false, privacyMode: "private",
    })).toBe("self");
  });

  test("teammate of an opted-in owner sees shared", () => {
    expect(resolveVisibility({
      viewerDevIds: [viewer], ownerDevId: owner, ownerShareDetails: true, privacyMode: "standard",
    })).toBe("shared");
  });

  test("teammate of an opted-out owner sees activity only", () => {
    expect(resolveVisibility({
      viewerDevIds: [viewer], ownerDevId: owner, ownerShareDetails: false, privacyMode: "open",
    })).toBe("activity");
  });

  test("private sessions are activity only for teammates even when opted in", () => {
    expect(resolveVisibility({
      viewerDevIds: [viewer], ownerDevId: owner, ownerShareDetails: true, privacyMode: "private",
    })).toBe("activity");
  });

  test("missing share_details and privacy mode default to activity for teammates", () => {
    expect(resolveVisibility({
      viewerDevIds: [viewer], ownerDevId: owner, ownerShareDetails: null, privacyMode: null,
    })).toBe("activity");
  });

  test("viewer with no linked developer is a teammate", () => {
    expect(resolveVisibility({
      viewerDevIds: [], ownerDevId: owner, ownerShareDetails: true, privacyMode: null,
    })).toBe("shared");
  });
});

describe("teammateVisibility", () => {
  test("shared only when opted in and not private", () => {
    expect(teammateVisibility(true, "standard")).toBe("shared");
    expect(teammateVisibility(true, null)).toBe("shared");
    expect(teammateVisibility(true, "private")).toBe("activity");
    expect(teammateVisibility(false, "open")).toBe("activity");
    expect(teammateVisibility(undefined, "open")).toBe("activity");
  });
});

const fullRow = {
  id: "s1",
  developer_id: owner,
  developer_name: "Anna",
  developer_email: "anna@example.com",
  project_path: "/home/anna/secret",
  project_name: "secret",
  started_at: "2026-09-01T10:00:00Z",
  ended_at: null,
  status: "active",
  permission_mode: "default",
  privacy_mode: "standard",
  model: "claude-opus",
  event_count: 12,
  context_clear_count: 1,
  current_title: "Fix auth redirect",
  session_intent: "bugfix",
  total_input_tokens: 100,
  estimated_cost_usd: 1.5,
  owner_share_details: false,
};

describe("redactSessionRow", () => {
  test("self and shared return the row unchanged", () => {
    expect(redactSessionRow(fullRow, "self")).toBe(fullRow);
    expect(redactSessionRow(fullRow, "shared")).toBe(fullRow);
  });

  test("activity keeps only identity and timing", () => {
    const r = redactSessionRow(fullRow, "activity");
    expect(r).toEqual({
      id: "s1",
      developer_id: owner,
      developer_name: "Anna",
      developer_email: "anna@example.com",
      started_at: "2026-09-01T10:00:00Z",
      ended_at: null,
      status: "active",
      event_count: 12,
      context_clear_count: 1,
      project_path: null,
      project_name: null,
    });
  });

  test("activity drops columns it doesn't know about", () => {
    const r = redactSessionRow({ ...fullRow, some_future_column: "leak" }, "activity");
    expect("some_future_column" in r).toBe(false);
  });
});

describe("redactEvent", () => {
  const event = {
    id: "e1",
    session_id: "s1",
    event_type: "prompt.submit",
    created_at: "2026-09-01T10:00:00Z",
    payload: { promptText: "hi", promptLength: 2 },
  };

  test("self and shared return the event unchanged", () => {
    expect(redactEvent(event, "self")).toBe(event);
    expect(redactEvent(event, "shared")).toBe(event);
  });

  test("shared drops the local transcriptPath, self keeps it", () => {
    const withPath = { ...event, payload: { promptText: "hi", transcriptPath: "/home/a/t.jsonl" } };
    expect(redactEvent(withPath, "shared").payload).toEqual({ promptText: "hi" });
    expect(redactEvent(withPath, "self")).toBe(withPath);
  });

  test("activity keeps type and time with an empty payload", () => {
    expect(redactEvent(event, "activity")).toEqual({
      id: "e1",
      session_id: "s1",
      event_type: "prompt.submit",
      created_at: "2026-09-01T10:00:00Z",
      payload: {},
    });
  });

  test("activity handles camelCase event shapes", () => {
    const ws = {
      id: "e1",
      timestamp: "2026-09-01T10:00:00Z",
      sessionId: "s1",
      developerId: owner,
      developerName: "Anna",
      projectName: "secret",
      projectPath: "/home/anna/secret",
      eventType: "tool.complete",
      payload: { toolName: "Edit", toolInput: { file_path: "/x" } },
    };
    expect(redactEvent(ws, "activity")).toEqual({
      id: "e1",
      timestamp: "2026-09-01T10:00:00Z",
      sessionId: "s1",
      developerId: owner,
      developerName: "Anna",
      eventType: "tool.complete",
      projectName: null,
      projectPath: null,
      payload: {},
    });
  });
});

describe("filterVisibleReports", () => {
  // Fake Bun.sql tag: every query returns the session visibility rows.
  const sessions = [
    { id: "s-shared", developer_id: owner, privacy_mode: "standard", owner_share_details: true },
    { id: "s-hidden", developer_id: owner, privacy_mode: "standard", owner_share_details: false },
    { id: "s-mine", developer_id: viewer, privacy_mode: "private", owner_share_details: false },
  ];
  const fakeSql = (() => Promise.resolve(sessions)) as any;
  const report = (id: string, type: string, sessionId?: string, asString = false) => {
    const ctx = sessionId ? { session_id: sessionId } : {};
    return { id, report_type: type, data_context: asString ? JSON.stringify(ctx) : ctx };
  };

  test("keeps team reports and session reports the viewer may see", async () => {
    const reports = [
      report("weekly", "weekly"),
      report("shared", "session", "s-shared"),
      report("hidden", "session", "s-hidden"),
      report("mine", "session", "s-mine", true),
      report("orphan", "session", "s-deleted"),
      report("no-ctx", "session"),
    ];
    const visible = await filterVisibleReports(fakeSql, reports, [viewer]);
    expect(visible.map((r) => r.id)).toEqual(["weekly", "shared", "mine"]);
  });
});
