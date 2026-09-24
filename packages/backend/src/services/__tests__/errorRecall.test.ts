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
  response_tail: null,
  session_title: null,
  ...over,
});

describe("selectErrorMatches", () => {
  test("drops weak matches and keeps the best one per session", () => {
    const out = selectErrorMatches([
      row({ similarity: 0.91 }),
      row({ similarity: 0.97 }),
      row({ session_id: "s2", similarity: ERROR_RECALL.minSimilarity - 0.01 }),
    ] as any);
    expect(out).toHaveLength(1);
    expect(out[0]!.similarity).toBe(0.97);
  });

  test("puts resolved matches first, then by similarity, capped", () => {
    const out = selectErrorMatches([
      row({ session_id: "a", similarity: 0.99 }),
      row({ session_id: "b", similarity: 0.9, resolved: true }),
      row({ session_id: "c", similarity: 0.95 }),
      row({ session_id: "d", similarity: 0.93 }),
    ] as any);
    expect(out.map((m) => m.similarity)).toEqual([0.9, 0.99, 0.95]);
  });
});

describe("formatErrorRecall", () => {
  test("null without matches", () => {
    expect(formatErrorRecall([])).toBeNull();
  });

  test("names outcome and how the turn ended, within the cap", () => {
    const [m] = selectErrorMatches([row({ resolved: true, response_tail: "Added it to devDependencies." })] as any);
    const note = formatErrorRecall([m!])!;
    expect(note).toContain("resolved shortly after");
    expect(note).toContain("Added it to devDependencies.");
    const many = Array.from({ length: 3 }, () => ({ ...m!, ended: "x".repeat(400) }));
    expect(formatErrorRecall(many)!.length).toBeLessThanOrEqual(ERROR_RECALL.maxChars);
  });
});
