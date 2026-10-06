import { describe, expect, test, beforeEach, setSystemTime } from "bun:test";
import {
  recordToolResult,
  identicalFailCount,
  shouldDedupNudge,
  clearStuckState,
  setPendingNudge,
  takePendingNudge,
  __resetAllStuckState,
} from "../sessionStuckState";

beforeEach(() => __resetAllStuckState());

describe("identicalFailCount", () => {
  test("returns 0 for unknown session", () => {
    expect(identicalFailCount("unknown", "Bash", "h1")).toBe(0);
  });

  test("counts consecutive identical failures", () => {
    recordToolResult("s1", "Bash", "h1", false);
    recordToolResult("s1", "Bash", "h1", false);
    expect(identicalFailCount("s1", "Bash", "h1")).toBe(2);
  });

  test("ignores non-matching tool/hash entries between failures", () => {
    recordToolResult("s1", "Bash", "h1", false);
    recordToolResult("s1", "Read", "hX", true);
    recordToolResult("s1", "Bash", "h1", false);
    expect(identicalFailCount("s1", "Bash", "h1")).toBe(2);
  });

  test("resets when an identical successful call appears", () => {
    recordToolResult("s1", "Bash", "h1", false);
    recordToolResult("s1", "Bash", "h1", false);
    recordToolResult("s1", "Bash", "h1", true);
    recordToolResult("s1", "Bash", "h1", false);
    expect(identicalFailCount("s1", "Bash", "h1")).toBe(1);
  });

  test("scopes by session", () => {
    recordToolResult("s1", "Bash", "h1", false);
    recordToolResult("s2", "Bash", "h1", false);
    expect(identicalFailCount("s1", "Bash", "h1")).toBe(1);
    expect(identicalFailCount("s2", "Bash", "h1")).toBe(1);
  });
});

describe("shouldDedupNudge", () => {
  test("returns false on first call, true on second within TTL", () => {
    expect(shouldDedupNudge("s1", "rule_a")).toBe(false);
    expect(shouldDedupNudge("s1", "rule_a")).toBe(true);
  });

  test("different rules don't dedupe each other", () => {
    expect(shouldDedupNudge("s1", "rule_a")).toBe(false);
    expect(shouldDedupNudge("s1", "rule_b")).toBe(false);
  });
});

describe("clearStuckState", () => {
  test("removes all session state", () => {
    recordToolResult("s1", "Bash", "h1", false);
    expect(identicalFailCount("s1", "Bash", "h1")).toBe(1);
    clearStuckState("s1");
    expect(identicalFailCount("s1", "Bash", "h1")).toBe(0);
  });
});

describe("pending nudge", () => {
  const nudge = { rule: "repeated_failure", severity: "warning", message: "Read the error first" };

  test("taken once", () => {
    setPendingNudge("s1", nudge);
    expect(takePendingNudge("s1")).toEqual(nudge);
    expect(takePendingNudge("s1")).toBeNull();
  });

  test("null for an unknown session", () => {
    expect(takePendingNudge("nope")).toBeNull();
  });

  test("stale after two minutes", () => {
    setSystemTime(new Date("2026-10-06T10:00:00Z"));
    setPendingNudge("s1", nudge);
    setSystemTime(new Date("2026-10-06T10:02:01Z"));
    expect(takePendingNudge("s1")).toBeNull();
    setSystemTime();
  });

  test("cleared with the session's stuck state", () => {
    setPendingNudge("s1", nudge);
    clearStuckState("s1");
    expect(takePendingNudge("s1")).toBeNull();
  });
});
