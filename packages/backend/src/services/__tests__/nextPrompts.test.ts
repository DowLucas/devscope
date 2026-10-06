import { describe, expect, test } from "bun:test";
import { isSuccessfulTurn, normalizePrompt, rankSuggestions, OUTCOME_BOOST } from "../nextPrompts";
import type { SuggestionRow } from "../../db/liveQueries";

const row = (over: Partial<SuggestionRow> = {}): SuggestionRow => ({
  turn_id: "t",
  prompt_text: "run the tests",
  prompt_at: "2026-10-01T00:00:00Z",
  tool_calls: 3,
  tool_failures: 0,
  project_name: "proj",
  label: null,
  has_merged_pr: false,
  ...over,
});

describe("isSuccessfulTurn", () => {
  test("clean and not labelled down", () => {
    expect(isSuccessfulTurn(row())).toBe(true);
    expect(isSuccessfulTurn(row({ tool_failures: 1 }))).toBe(false);
    expect(isSuccessfulTurn(row({ label: "down" }))).toBe(false);
    expect(isSuccessfulTurn(row({ label: "partial" }))).toBe(true);
    expect(isSuccessfulTurn(row({ prompt_text: "  \n" }))).toBe(false);
  });
});

describe("rankSuggestions", () => {
  test("orders by base score plus outcome boosts", () => {
    const out = rankSuggestions(
      [
        { row: row({ prompt_text: "a" }), base: 0.9 },
        { row: row({ prompt_text: "b", label: "up" }), base: 0.85 },
        { row: row({ prompt_text: "c", has_merged_pr: true }), base: 0.86 },
      ],
      { limit: 5 },
    );
    // b: 0.95, c: 0.91, a: 0.9
    expect(out.map((s) => s.text)).toEqual(["b", "c", "a"]);
    expect(OUTCOME_BOOST.up).toBeGreaterThan(OUTCOME_BOOST.mergedPr);
  });

  test("drops failed turns, duplicates and the prompt just sent", () => {
    const out = rankSuggestions(
      [
        { row: row({ prompt_text: "Run  the tests" }), base: 0.8 },
        { row: row({ prompt_text: "run the tests", label: "up" }), base: 0.8 },
        { row: row({ prompt_text: "deploy", tool_failures: 2 }), base: 0.99 },
        { row: row({ prompt_text: "fix the bug" }), base: 0.99 },
      ],
      { limit: 5, exclude: "Fix the  bug" },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ text: "run the tests", project: "proj" });
  });

  test("limits and trims", () => {
    const long = "x".repeat(600);
    const out = rankSuggestions(
      [
        { row: row({ prompt_text: long }), base: 1 },
        { row: row({ prompt_text: "y" }), base: 0.5 },
      ],
      { limit: 1 },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toHaveLength(500);
  });

  test("normalizePrompt folds case and whitespace", () => {
    expect(normalizePrompt("  Fix\tTHE\n bug ")).toBe("fix the bug");
  });
});
