import { describe, expect, test } from "bun:test";
import { ERROR_RECALL, formatErrorRecall, selectErrorMatches } from "../errorRecall";

const row = (over: Record<string, unknown> = {}) => ({
  event_id: "e",
  session_id: "s1",
  created_at: "2026-07-01T10:00:00Z",
  tool: "Bash",
  message: "tsc: command not found",
  similarity: 0.95,
  resolved: false,
  fix_input: null,
  session_title: null,
  ...over,
});

describe("selectErrorMatches", () => {
  test("drops weak matches and keeps the best one per session", () => {
    const out = selectErrorMatches([
      row({ similarity: 0.93 }),
      row({ similarity: 0.97 }),
      row({ session_id: "s2", similarity: ERROR_RECALL.minSimilarity - 0.01 }),
    ] as any);
    expect(out).toHaveLength(1);
    expect(out[0]!.similarity).toBe(0.97);
  });

  test("puts resolved matches first, then by similarity, capped", () => {
    const out = selectErrorMatches([
      row({ session_id: "a", similarity: 0.99 }),
      row({ session_id: "b", similarity: 0.925, resolved: true }),
      row({ session_id: "c", similarity: 0.95 }),
      row({ session_id: "d", similarity: 0.93 }),
    ] as any);
    expect(out.map((m) => m.similarity)).toEqual([0.93, 0.99, 0.95]);
  });
});

describe("formatErrorRecall", () => {
  test("null without matches", () => {
    expect(formatErrorRecall([])).toBeNull();
  });

  test("shows the call that worked next, or that none did, within the cap", () => {
    const [m] = selectErrorMatches([row({ resolved: true, fix_input: "bunx tsc --noEmit" })] as any);
    const note = formatErrorRecall([m!])!;
    expect(note).toContain("the next Bash call that worked: `bunx tsc --noEmit`");
    const [none] = selectErrorMatches([row()] as any);
    expect(formatErrorRecall([none!])).toContain("no successful retry within 30 min");
    const many = Array.from({ length: 3 }, () => ({ ...m!, fix: "x".repeat(400) }));
    expect(formatErrorRecall(many)!.length).toBeLessThanOrEqual(ERROR_RECALL.maxChars);
  });
});
