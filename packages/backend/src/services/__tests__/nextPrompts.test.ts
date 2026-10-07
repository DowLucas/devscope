import { describe, expect, test } from "bun:test";
import { NEXT_PROMPTS, OUTCOME_BOOST, isSuccessfulTurn, isSuggestible, normalizePrompt, rankSuggestions } from "../nextPrompts";
import type { SuggestionRow } from "../../db/liveQueries";

const row = (over: Partial<SuggestionRow> = {}): SuggestionRow => ({
  turn_id: "t",
  session_id: "s1",
  prompt_text: "run the tests",
  prompt_at: "2026-10-01T00:00:00Z",
  tool_calls: 3,
  tool_failures: 0,
  project_name: "proj",
  label: null,
  has_merged_pr: false,
  ...over,
});

/** The same prompt following in several sessions: a habit. */
const habit = (text: string, sessions: number, base: number, over: Partial<SuggestionRow> = {}) =>
  Array.from({ length: sessions }, (_, i) => ({ row: row({ prompt_text: text, session_id: `${text}-${i}`, ...over }), base }));

describe("isSuccessfulTurn", () => {
  test("clean and not labelled down", () => {
    expect(isSuccessfulTurn(row())).toBe(true);
    expect(isSuccessfulTurn(row({ tool_failures: 1 }))).toBe(false);
    expect(isSuccessfulTurn(row({ label: "down" }))).toBe(false);
    expect(isSuccessfulTurn(row({ label: "partial" }))).toBe(true);
    expect(isSuccessfulTurn(row({ prompt_text: "  \n" }))).toBe(false);
  });
});

describe("isSuggestible", () => {
  test("a few words that are a step of their own", () => {
    for (const ok of ["push", "commit and push", "/code-review high", "/create-pr lucas, dev", "check logs"]) {
      expect(isSuggestible(ok)).toBe(true);
    }
  });

  test("never long prompts", () => {
    expect(isSuggestible("please go through the open review comments")).toBe(false); // 7 words
    expect(isSuggestible(`/x ${"a".repeat(NEXT_PROMPTS.maxChars)}`)).toBe(false);
  });

  test("never bare answers to a question, option picks or image placeholders", () => {
    for (const no of ["yes", "Yes please!", "a", "B", "2", "1.", "continue", "do it", "lets do it", "done", "[Image #1]", ""]) {
      expect(isSuggestible(no)).toBe(false);
    }
  });
});

describe("rankSuggestions", () => {
  test("needs the prompt to have worked in at least two sessions", () => {
    expect(rankSuggestions(habit("push", 1, 0.95), { limit: 1 })).toEqual([]);
    expect(rankSuggestions(habit("push", 2, 0.85), { limit: 1 })).toEqual([{ text: "push", project: "proj" }]);
    // Twice in one session is still one session.
    const sameSession = [{ row: row({ prompt_text: "push" }), base: 0.9 }, { row: row({ prompt_text: "push" }), base: 0.9 }];
    expect(rankSuggestions(sameSession, { limit: 1 })).toEqual([]);
  });

  test("opening prompts take their own, higher bar", () => {
    expect(rankSuggestions(habit("start backend", 2, 0), { limit: 1, minSessions: 3 })).toEqual([]);
    expect(rankSuggestions(habit("start backend", 3, 0), { limit: 1, minSessions: 3 })).toHaveLength(1);
  });

  test("drops a prompt that usually failed", () => {
    const mixed = habit("deploy", 2, 0.9);
    const failing = Array.from({ length: 3 }, (_, i) => ({ row: row({ prompt_text: "deploy", session_id: `f${i}`, tool_failures: 1 }), base: 0.9 }));
    // Worked in 2 of 5 sessions: below the 60% bar.
    expect(rankSuggestions([...mixed, ...failing], { limit: 1 })).toEqual([]);
  });

  test("orders by similarity, outcome boosts and support", () => {
    const out = rankSuggestions(
      [...habit("push", 2, 0.9), ...habit("merge it", 2, 0.85, { label: "up" }), ...habit("check logs", 5, 0.85)],
      { limit: 3 },
    );
    // merge it: 0.85 + 0.1 + 0.04; check logs: 0.85 + 0.1 (5 sessions); push: 0.9 + 0.04
    expect(out.map((s) => s.text)).toEqual(["merge it", "check logs", "push"]);
    expect(OUTCOME_BOOST.up).toBeGreaterThan(OUTCOME_BOOST.mergedPr);
  });

  test("drops the prompt just sent, folding case and whitespace", () => {
    expect(rankSuggestions(habit("Push  it", 3, 0.9), { limit: 1, exclude: "push it" })).toEqual([]);
  });

  test("normalizePrompt folds case and whitespace", () => {
    expect(normalizePrompt("  Fix\tTHE\n bug ")).toBe("fix the bug");
  });
});
