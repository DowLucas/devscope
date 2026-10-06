import type { NextPromptSuggestion } from "@devscope/shared";
import type { SuggestionRow } from "../db/liveQueries";

// "What worked next" for the devscope-live mod's ghost-text suggestions.
// Code decides what counts as a success (no tool failures, not labelled
// down); ranking is similarity plus small boosts for outcome signals.

export const NEXT_PROMPTS = {
  /** Similar turns considered per request. */
  lookback: 30,
  /**
   * Looser than recall's 0.9 (a similar situation, not the same prompt),
   * well above SEARCH.minSimilarity's 0.6 where nonsense queries still score.
   */
  minSimilarity: 0.75,
  /** Characters of suggestion text returned. */
  maxChars: 500,
  /** Recent sessions in the project scanned for opening prompts. */
  openingSessions: 200,
  embedTimeoutMs: 1_200,
} as const;

/** Added to a candidate's score; similarity differences are usually smaller. */
export const OUTCOME_BOOST = { up: 0.1, mergedPr: 0.05 } as const;

/** Spacing that orders opening prompts newest first below any outcome boost. */
export const RECENCY_STEP = 0.001;

export function normalizePrompt(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** A turn worth suggesting: it ran clean and nobody marked it as failed. */
export function isSuccessfulTurn(row: SuggestionRow): boolean {
  return row.tool_failures === 0 && row.label !== "down" && row.prompt_text.trim() !== "";
}

/**
 * Successful candidates, deduplicated by text (best score kept), best first.
 * `base` is the candidate's own score: the source turn's similarity, or a
 * recency rank. `exclude` drops a suggestion identical to that text (the
 * prompt the developer just sent).
 */
export function rankSuggestions(
  candidates: Array<{ row: SuggestionRow; base: number }>,
  opts: { limit: number; exclude?: string },
): NextPromptSuggestion[] {
  const excluded = opts.exclude === undefined ? null : normalizePrompt(opts.exclude);
  const best = new Map<string, { row: SuggestionRow; score: number }>();
  for (const { row, base } of candidates) {
    if (!isSuccessfulTurn(row)) continue;
    const key = normalizePrompt(row.prompt_text);
    if (key === excluded) continue;
    const score =
      base + (row.label === "up" ? OUTCOME_BOOST.up : 0) + (row.has_merged_pr ? OUTCOME_BOOST.mergedPr : 0);
    const prev = best.get(key);
    if (!prev || score > prev.score) best.set(key, { row, score });
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit)
    .map(({ row }) => ({
      text: row.prompt_text.slice(0, NEXT_PROMPTS.maxChars),
      project: row.project_name,
      sessionTitle: row.session_title,
      toolCalls: row.tool_calls,
      label: row.label,
    }));
}
