import { describe, expect, test } from "bun:test";
import { RECALL, formatRecall, selectMatches, wordCount } from "../promptRecall";

const row = (over: Record<string, unknown>) => ({
  turn_id: "1", session_id: "s", prompt_at: "2026-09-12T10:00:00Z",
  prompt_text: "deploy the android build to play internal testing", response_text: null,
  response_tail: "Upload succeeded after bumping versionCode.", tool_calls: 38, tool_failures: 4,
  duration_ms: 1, session_title: "Android internal release", session_intent: null,
  project_name: "app", similarity: 0.93, ...over,
}) as any;

describe("promptRecall", () => {
  test("wordCount ignores extra whitespace", () => {
    expect(wordCount("  yes ")).toBe(1);
    expect(wordCount("deploy the  android app")).toBe(4);
  });

  test("keeps strong matches only, best per day, best first", () => {
    const { matches, repeatDays } = selectMatches([
      row({ similarity: 0.95, prompt_at: "2026-09-12T10:00:00Z" }),
      row({ similarity: 0.91, prompt_at: "2026-09-12T15:00:00Z" }),   // same day, weaker
      row({ similarity: 0.92, prompt_at: "2026-09-03T09:00:00Z" }),
      row({ similarity: 0.80, prompt_at: "2026-09-01T09:00:00Z" }),   // below threshold
    ]);
    expect(matches.map((m) => [m.day, m.similarity])).toEqual([["2026-09-12", 0.95], ["2026-09-03", 0.92]]);
    expect(repeatDays).toBe(2);
  });

  test("no matches means no note", () => {
    expect(formatRecall([], 0)).toBeNull();
  });

  test("note carries outcome and suggests a skill from the 3rd day", () => {
    const three = selectMatches([
      row({ prompt_at: "2026-09-12T10:00:00Z" }), row({ prompt_at: "2026-09-03T10:00:00Z" }),
      row({ prompt_at: "2026-08-20T10:00:00Z", tool_failures: 0 }),
    ]);
    const note = formatRecall(three.matches, three.repeatDays)!;
    expect(note).toContain('2026-09-12 (0.93): "deploy the android build');
    expect(note).toContain('session "Android internal release", 38 tool calls, 4 failed');
    expect(note).toContain("none failed");
    expect(note).toContain("Ended: \"Upload succeeded after bumping versionCode.\"");
    expect(note).toContain("3 separate days");
    const two = selectMatches([row({}), row({ prompt_at: "2026-09-03T10:00:00Z" })]);
    expect(formatRecall(two.matches, two.repeatDays)).not.toContain("separate days");
  });

  test("note is capped by dropping the weakest matches", () => {
    const long = "x ".repeat(400);
    const { matches, repeatDays } = selectMatches([
      row({ prompt_at: "2026-09-12T10:00:00Z", response_tail: long }),
      row({ prompt_at: "2026-09-03T10:00:00Z", response_tail: long, similarity: 0.92 }),
      row({ prompt_at: "2026-08-20T10:00:00Z", response_tail: long, similarity: 0.91 }),
    ]);
    const note = formatRecall(matches, repeatDays)!;
    expect(note.length).toBeLessThanOrEqual(RECALL.maxChars);
    expect(note).toContain("2026-09-12");
  });
});
