import { describe, expect, test } from "bun:test";
import type { ToolEvent } from "../../../db/patternQueries";
import {
  detectRetryLoops,
  detectFailureCascades,
  detectAbandonedSessions,
  detectAllAntiPatterns,
  type DetectedAntiPattern,
} from "../antiPatternRules";

// --- Helpers ---

function makeEvent(
  tool_name: string,
  success: boolean,
  created_at: string = "2026-03-03T00:00:00Z"
): ToolEvent {
  return {
    tool_name,
    event_type: success ? "tool_complete" : "tool_error",
    success,
    created_at,
  };
}

function makeFailures(tool: string, count: number): ToolEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeEvent(tool, false, `2026-03-03T00:0${i}:00Z`)
  );
}

function makeSuccesses(tool: string, count: number): ToolEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeEvent(tool, true, `2026-03-03T00:0${i}:00Z`)
  );
}

// --- detectRetryLoops ---

describe("detectRetryLoops", () => {
  test("returns empty array for empty sequence", () => {
    expect(detectRetryLoops([])).toEqual([]);
  });

  test("returns empty array when no retries exist", () => {
    const seq = [
      makeEvent("bash", true),
      makeEvent("read", true),
      makeEvent("write", true),
    ];
    expect(detectRetryLoops(seq)).toEqual([]);
  });

  test("does not trigger for 2 consecutive same-tool failures (below threshold)", () => {
    const seq = [makeEvent("bash", false), makeEvent("bash", false)];
    expect(detectRetryLoops(seq)).toEqual([]);
  });

  test("does not trigger for 3 consecutive calls with only 2 failures", () => {
    const seq = [
      makeEvent("bash", false),
      makeEvent("bash", true),
      makeEvent("bash", false),
    ];
    expect(detectRetryLoops(seq)).toEqual([]);
  });

  test("triggers at exactly 3 consecutive same-tool calls with 3 failures", () => {
    const seq = makeFailures("bash", 3);
    const results = detectRetryLoops(seq);
    expect(results).toHaveLength(1);
    expect(results[0].rule).toBe("retry_loop");
    expect(results[0].severity).toBe("warning");
    expect(results[0].details.tool_name).toBe("bash");
    expect(results[0].details.consecutive_calls).toBe(3);
    expect(results[0].details.consecutive_failures).toBe(3);
    expect(results[0].details.start_index).toBe(0);
  });

  test("severity is warning for 3-4 consecutive calls", () => {
    const seq = makeFailures("bash", 4);
    const results = detectRetryLoops(seq);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe("warning");
    expect(results[0].details.consecutive_calls).toBe(4);
  });

  test("severity is critical at 5+ consecutive calls", () => {
    const seq = makeFailures("bash", 5);
    const results = detectRetryLoops(seq);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe("critical");
    expect(results[0].details.consecutive_calls).toBe(5);
  });

  test("severity is critical for 7 consecutive calls", () => {
    const seq = makeFailures("bash", 7);
    const results = detectRetryLoops(seq);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe("critical");
    expect(results[0].details.consecutive_calls).toBe(7);
  });

  test("counts consecutive calls including successes but requires >=3 failures", () => {
    // 4 consecutive calls of the same tool, but only 1 failure
    const seq = [
      makeEvent("bash", true),
      makeEvent("bash", true),
      makeEvent("bash", false),
      makeEvent("bash", true),
    ];
    const results = detectRetryLoops(seq);
    expect(results).toEqual([]);
  });

  test("triggers when 3 consecutive calls have exactly 3 failures (mixed success)", () => {
    // 5 consecutive calls, 3 failures
    const seq = [
      makeEvent("bash", false),
      makeEvent("bash", false),
      makeEvent("bash", true),
      makeEvent("bash", true),
      makeEvent("bash", false),
    ];
    const results = detectRetryLoops(seq);
    expect(results).toHaveLength(1);
    expect(results[0].details.consecutive_calls).toBe(5);
    expect(results[0].details.consecutive_failures).toBe(3);
  });

  test("skips past matched run and detects multiple retry loops", () => {
    const seq = [
      ...makeFailures("bash", 3),
      ...makeFailures("read", 4),
    ];
    const results = detectRetryLoops(seq);
    expect(results).toHaveLength(2);
    expect(results[0].details.tool_name).toBe("bash");
    expect(results[0].details.start_index).toBe(0);
    expect(results[1].details.tool_name).toBe("read");
    expect(results[1].details.start_index).toBe(3);
  });

  test("does not create overlapping detections for different tools", () => {
    const seq = [
      ...makeFailures("bash", 3),
      makeEvent("read", true),
      ...makeFailures("write", 5),
    ];
    const results = detectRetryLoops(seq);
    expect(results).toHaveLength(2);
    expect(results[0].details.tool_name).toBe("bash");
    expect(results[0].severity).toBe("warning");
    expect(results[1].details.tool_name).toBe("write");
    expect(results[1].severity).toBe("critical");
  });

  test("single event does not trigger", () => {
    const seq = [makeEvent("bash", false)];
    expect(detectRetryLoops(seq)).toEqual([]);
  });

  test("name and description contain the tool name", () => {
    const seq = makeFailures("my_tool", 3);
    const results = detectRetryLoops(seq);
    expect(results[0].name).toContain("my_tool");
    expect(results[0].description).toContain("my_tool");
  });
});

// --- detectFailureCascades ---

describe("detectFailureCascades", () => {
  test("returns empty array for empty sequence", () => {
    expect(detectFailureCascades([])).toEqual([]);
  });

  test("returns empty array when all events succeed", () => {
    const seq = makeSuccesses("bash", 10);
    expect(detectFailureCascades(seq)).toEqual([]);
  });

  test("does not trigger for 3 consecutive failures (below threshold)", () => {
    const seq = makeFailures("bash", 3);
    expect(detectFailureCascades(seq)).toEqual([]);
  });

  test("triggers at exactly 4 consecutive failures", () => {
    const seq = makeFailures("bash", 4);
    const results = detectFailureCascades(seq);
    expect(results).toHaveLength(1);
    expect(results[0].rule).toBe("failure_cascade");
    expect(results[0].severity).toBe("warning");
    expect(results[0].details.cascade_length).toBe(4);
    expect(results[0].details.trigger_tool).toBe("bash");
    expect(results[0].details.start_index).toBe(0);
  });

  test("severity is warning for 4-5 consecutive failures", () => {
    const seq = makeFailures("bash", 5);
    const results = detectFailureCascades(seq);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe("warning");
  });

  test("severity is critical at 6+ consecutive failures", () => {
    const seq = makeFailures("bash", 6);
    const results = detectFailureCascades(seq);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe("critical");
    expect(results[0].details.cascade_length).toBe(6);
  });

  test("triggers across multiple different tools", () => {
    const seq = [
      makeEvent("bash", false),
      makeEvent("read", false),
      makeEvent("write", false),
      makeEvent("grep", false),
    ];
    const results = detectFailureCascades(seq);
    expect(results).toHaveLength(1);
    expect(results[0].details.trigger_tool).toBe("bash");
    expect(results[0].details.tools_involved).toEqual(["bash", "read", "write", "grep"]);
  });

  test("tools_involved contains unique tool names only", () => {
    const seq = [
      makeEvent("bash", false),
      makeEvent("bash", false),
      makeEvent("read", false),
      makeEvent("bash", false),
    ];
    const results = detectFailureCascades(seq);
    expect(results).toHaveLength(1);
    expect(results[0].details.tools_involved).toEqual(["bash", "read"]);
  });

  test("a success breaks the cascade", () => {
    const seq = [
      makeEvent("bash", false),
      makeEvent("bash", false),
      makeEvent("bash", true), // break
      makeEvent("read", false),
      makeEvent("read", false),
    ];
    expect(detectFailureCascades(seq)).toEqual([]);
  });

  test("detects multiple non-overlapping cascades", () => {
    const seq = [
      ...makeFailures("bash", 4),
      makeEvent("read", true), // break
      ...makeFailures("write", 6),
    ];
    const results = detectFailureCascades(seq);
    expect(results).toHaveLength(2);
    expect(results[0].details.cascade_length).toBe(4);
    expect(results[0].severity).toBe("warning");
    expect(results[0].details.start_index).toBe(0);
    expect(results[1].details.cascade_length).toBe(6);
    expect(results[1].severity).toBe("critical");
    expect(results[1].details.start_index).toBe(5);
  });

  test("skips past cascade to avoid overlapping detections", () => {
    // 8 consecutive failures should produce exactly 1 cascade, not multiple
    const seq = makeFailures("bash", 8);
    const results = detectFailureCascades(seq);
    expect(results).toHaveLength(1);
    expect(results[0].details.cascade_length).toBe(8);
  });

  test("name is 'Failure Cascade'", () => {
    const seq = makeFailures("bash", 4);
    const results = detectFailureCascades(seq);
    expect(results[0].name).toBe("Failure Cascade");
  });
});

// --- detectAbandonedSessions ---

describe("detectAbandonedSessions", () => {
  test("returns null for empty sequence", () => {
    expect(detectAbandonedSessions([], true)).toBeNull();
  });

  test("returns null when sessionEnded is false", () => {
    const seq = makeFailures("bash", 10);
    expect(detectAbandonedSessions(seq, false)).toBeNull();
  });

  test("returns null when sessionEnded defaults to true but sequence too short", () => {
    const seq = makeFailures("bash", 4);
    expect(detectAbandonedSessions(seq)).toBeNull();
  });

  test("returns null for sequence with exactly 4 events (below threshold)", () => {
    const seq = makeFailures("bash", 4);
    expect(detectAbandonedSessions(seq, true)).toBeNull();
  });

  test("returns null for 5 events with < 50% failure rate", () => {
    const seq = [
      makeEvent("bash", false),
      makeEvent("bash", false),
      makeEvent("bash", true),
      makeEvent("bash", true),
      makeEvent("bash", true),
    ];
    // 2/5 = 40% < 50%
    expect(detectAbandonedSessions(seq, true)).toBeNull();
  });

  test("triggers at exactly 50% failure rate with 5 events", () => {
    const seq = [
      makeEvent("bash", true),
      makeEvent("bash", true),
      makeEvent("bash", false),
      makeEvent("bash", false),
      makeEvent("bash", false),
    ];
    // 3/5 = 60% >= 50% (must trigger)
    const result = detectAbandonedSessions(seq, true);
    expect(result).not.toBeNull();
    expect(result!.rule).toBe("abandoned_session");
    expect(result!.severity).toBe("warning");
  });

  test("triggers at exactly 50% failure rate", () => {
    // 5 out of 10 failing = exactly 50%
    const seq = [
      ...makeSuccesses("bash", 5),
      ...makeFailures("bash", 5),
    ];
    const result = detectAbandonedSessions(seq, true);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.details.failure_rate).toBe(0.5);
  });

  test("severity is warning for 50-79% failure rate", () => {
    // 7/10 = 70%
    const seq = [
      ...makeSuccesses("bash", 3),
      ...makeFailures("bash", 7),
    ];
    const result = detectAbandonedSessions(seq, true);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
  });

  test("severity is critical at >= 80% failure rate", () => {
    // 8/10 = 80%
    const seq = [
      ...makeSuccesses("bash", 2),
      ...makeFailures("bash", 8),
    ];
    const result = detectAbandonedSessions(seq, true);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("critical");
    expect(result!.details.failure_rate).toBe(0.8);
  });

  test("severity is critical at 100% failure rate", () => {
    const seq = makeFailures("bash", 10);
    const result = detectAbandonedSessions(seq, true);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("critical");
    expect(result!.details.failure_rate).toBe(1);
  });

  test("looks at only the last 10 events even if sequence is longer", () => {
    // 20 events: first 10 all fail, last 10 all succeed
    const seq = [...makeFailures("bash", 10), ...makeSuccesses("bash", 10)];
    // Last 10 are all successes => should not trigger
    expect(detectAbandonedSessions(seq, true)).toBeNull();
  });

  test("looks at last 10 events when sequence is longer - triggering case", () => {
    // 20 events: first 10 succeed, last 10 all fail
    const seq = [...makeSuccesses("bash", 10), ...makeFailures("bash", 10)];
    // Last 10 are all failures => critical
    const result = detectAbandonedSessions(seq, true);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("critical");
    expect(result!.details.last_tool_count).toBe(10);
  });

  test("uses all events when sequence has fewer than 10", () => {
    // 5 events, 3 failures => 60%
    const seq = [
      makeEvent("bash", true),
      makeEvent("bash", true),
      makeEvent("bash", false),
      makeEvent("bash", false),
      makeEvent("bash", false),
    ];
    const result = detectAbandonedSessions(seq, true);
    expect(result).not.toBeNull();
    expect(result!.details.last_tool_count).toBe(5);
    expect(result!.details.fail_count).toBe(3);
  });

  test("sessionEnded defaults to true", () => {
    const seq = makeFailures("bash", 5);
    const result = detectAbandonedSessions(seq);
    expect(result).not.toBeNull();
  });

  test("details include last_tools mapping", () => {
    const seq = [
      makeEvent("bash", true),
      makeEvent("read", false),
      makeEvent("bash", false),
      makeEvent("write", false),
      makeEvent("grep", false),
    ];
    const result = detectAbandonedSessions(seq, true);
    expect(result).not.toBeNull();
    expect(result!.details.last_tools).toEqual([
      { tool: "bash", success: true },
      { tool: "read", success: false },
      { tool: "bash", success: false },
      { tool: "write", success: false },
      { tool: "grep", success: false },
    ]);
  });

  test("failure_rate is rounded to 3 decimal places", () => {
    // 3 out of 7 = 0.42857... which rounds to 0.429 (below 0.5, no trigger)
    // 4 out of 7 = 0.57142... which rounds to 0.571
    const seq = [
      ...makeSuccesses("bash", 3),
      ...makeFailures("bash", 4),
    ];
    const result = detectAbandonedSessions(seq, true);
    expect(result).not.toBeNull();
    expect(result!.details.failure_rate).toBe(0.571);
  });
});

// --- detectAllAntiPatterns ---

describe("detectAllAntiPatterns", () => {
  test("returns empty array for empty sequence", () => {
    expect(detectAllAntiPatterns([])).toEqual([]);
  });

  test("returns empty array when no patterns detected", () => {
    const seq = makeSuccesses("bash", 10);
    expect(detectAllAntiPatterns(seq)).toEqual([]);
  });

  test("detects retry loops", () => {
    const seq = makeFailures("bash", 3);
    const results = detectAllAntiPatterns(seq, false);
    expect(results.some(r => r.rule === "retry_loop")).toBe(true);
  });

  test("detects failure cascades", () => {
    const seq = [
      makeEvent("bash", false),
      makeEvent("read", false),
      makeEvent("write", false),
      makeEvent("grep", false),
    ];
    const results = detectAllAntiPatterns(seq, false);
    expect(results.some(r => r.rule === "failure_cascade")).toBe(true);
  });

  test("detects abandoned sessions when sessionEnded is true", () => {
    const seq = makeFailures("bash", 5);
    const results = detectAllAntiPatterns(seq, true);
    expect(results.some(r => r.rule === "abandoned_session")).toBe(true);
  });

  test("does not detect abandoned sessions when sessionEnded is false", () => {
    const seq = makeFailures("bash", 5);
    const results = detectAllAntiPatterns(seq, false);
    expect(results.some(r => r.rule === "abandoned_session")).toBe(false);
  });

  test("detects multiple pattern types simultaneously", () => {
    // 6 consecutive bash failures: triggers retry_loop + failure_cascade + abandoned_session
    const seq = makeFailures("bash", 6);
    const results = detectAllAntiPatterns(seq, true);
    const rules = results.map(r => r.rule);
    expect(rules).toContain("retry_loop");
    expect(rules).toContain("failure_cascade");
    expect(rules).toContain("abandoned_session");
  });

  test("sessionEnded defaults to true", () => {
    const seq = makeFailures("bash", 5);
    const results = detectAllAntiPatterns(seq);
    expect(results.some(r => r.rule === "abandoned_session")).toBe(true);
  });

  test("complex scenario with mixed patterns", () => {
    const seq = [
      ...makeSuccesses("bash", 3),        // no pattern
      ...makeFailures("read", 5),          // retry_loop (critical) + failure_cascade (warning)
      makeEvent("bash", true),             // break
      ...makeFailures("write", 3),         // retry_loop (warning) but not failure_cascade (only 3)
    ];
    const results = detectAllAntiPatterns(seq, false);

    const retryLoops = results.filter(r => r.rule === "retry_loop");
    expect(retryLoops).toHaveLength(2);
    expect(retryLoops[0].details.tool_name).toBe("read");
    expect(retryLoops[0].severity).toBe("critical");
    expect(retryLoops[1].details.tool_name).toBe("write");
    expect(retryLoops[1].severity).toBe("warning");

    const cascades = results.filter(r => r.rule === "failure_cascade");
    expect(cascades).toHaveLength(1);
    expect(cascades[0].details.cascade_length).toBe(5);
  });
});
