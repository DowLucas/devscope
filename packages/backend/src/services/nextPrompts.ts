import type { NextPromptSuggestion } from "@devscope/shared";
import type { SuggestionRow } from "../db/liveQueries";

// "What worked next" for the devscope-live mod's ghost-text suggestions.
// Code decides what counts as a success (no tool failures, not labelled
// down). A suggestion must be a short, habitual next step: a few words, and
// one that came next and worked in several separate sessions. A prompt that
// followed once is an anecdote, not a pattern, so it is never suggested.

export const NEXT_PROMPTS = {
  /** Similar turns considered per request; more of them make support counts meaningful. */
  lookback: 40,
  /**
   * A similar situation, not the same prompt: above SEARCH.minSimilarity's
   * 0.6 where nonsense queries still score, below recall's 0.9.
   */
  minSimilarity: 0.8,
  /** A suggestion is a few words, short enough to read at a glance in the prompt box. */
  maxWords: 5,
  maxChars: 60,
  /** Characters fetched per prompt: enough to tell a long prompt from a short one. */
  fetchChars: 200,
  /** After a prompt: the suggestion came next, and worked, in at least this many sessions. */
  minSessions: 2,
  /** ...and worked in at least this share of the sessions where it came next. */
  minSuccessRate: 0.6,
  /** At session start: opened at least this many of the project's recent sessions. */
  openingMinSessions: 3,
  /** Recent sessions in the project scanned for opening prompts. */
  openingSessions: 200,
  embedTimeoutMs: 1_200,
} as const;

/** Added to a candidate's score; similarity differences are usually smaller. */
export const OUTCOME_BOOST = { up: 0.1, mergedPr: 0.05 } as const;

/** Per supporting session (capped), so a habit outranks a near-tie. */
export const SUPPORT_STEP = 0.02;
const SUPPORT_CAP = 5;

/** Spacing that orders opening prompts newest first below any outcome boost. */
export const RECENCY_STEP = 0.001;

/**
 * Answers to a question Claude asked, not next steps: they only make sense
 * right after that question, and the engine already offers them itself.
 */
const BARE_REPLIES = new Set([
  "y", "n", "yes", "no", "yep", "yeah", "nope", "ok", "okay", "sure", "yes please", "correct",
  "continue", "go", "go ahead", "proceed", "do it", "lets do it", "let's do it", "sounds good",
  "done", "thanks", "thank you", "perfect", "great", "nice", "good", "cool",
]);

export function normalizePrompt(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Short enough to suggest, and a step of its own rather than an answer or a placeholder. */
export function isSuggestible(text: string): boolean {
  const t = normalizePrompt(text);
  if (!t || t.length > NEXT_PROMPTS.maxChars) return false;
  if (t.split(" ").length > NEXT_PROMPTS.maxWords) return false;
  if (/^[a-z0-9]$/.test(t) || /^\d+[.)]?$/.test(t)) return false; // an option picked by letter or number
  if (/^\[image #\d+\]$/.test(t)) return false;
  return !BARE_REPLIES.has(t.replace(/[.!?]+$/, ""));
}

/** A turn worth suggesting: it ran clean and nobody marked it as failed. */
export function isSuccessfulTurn(row: SuggestionRow): boolean {
  return row.tool_failures === 0 && row.label !== "down" && row.prompt_text.trim() !== "";
}

/**
 * Candidates grouped by text and kept only when the text is suggestible and
 * well supported: it worked in at least `minSessions` separate sessions and in
 * at least `minSuccessRate` of those where it appeared. Best first: the best
 * `base` of a successful occurrence (the source turn's similarity, or a
 * recency rank), plus outcome boosts and a small bonus per supporting session.
 * `exclude` drops a suggestion identical to that text (the prompt just sent).
 */
export function rankSuggestions(
  candidates: Array<{ row: SuggestionRow; base: number }>,
  opts: { limit: number; exclude?: string; minSessions?: number },
): NextPromptSuggestion[] {
  const minSessions = opts.minSessions ?? NEXT_PROMPTS.minSessions;
  const excluded = opts.exclude === undefined ? null : normalizePrompt(opts.exclude);
  const groups = new Map<
    string,
    { seen: Set<string>; worked: Set<string>; best?: { row: SuggestionRow; base: number }; up: boolean; merged: boolean }
  >();
  for (const { row, base } of candidates) {
    if (!isSuggestible(row.prompt_text)) continue;
    const key = normalizePrompt(row.prompt_text);
    if (key === excluded) continue;
    const g = groups.get(key) ?? { seen: new Set(), worked: new Set(), up: false, merged: false };
    groups.set(key, g);
    g.seen.add(row.session_id);
    if (!isSuccessfulTurn(row)) continue;
    g.worked.add(row.session_id);
    g.up ||= row.label === "up";
    g.merged ||= row.has_merged_pr;
    if (!g.best || base > g.best.base) g.best = { row, base };
  }
  return [...groups.values()]
    .filter((g) => g.best && g.worked.size >= minSessions && g.worked.size / g.seen.size >= NEXT_PROMPTS.minSuccessRate)
    .map((g) => ({
      row: g.best!.row,
      score:
        g.best!.base +
        (g.up ? OUTCOME_BOOST.up : 0) +
        (g.merged ? OUTCOME_BOOST.mergedPr : 0) +
        SUPPORT_STEP * Math.min(g.worked.size, SUPPORT_CAP),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit)
    .map(({ row }) => ({ text: row.prompt_text.replace(/\s+/g, " ").trim(), project: row.project_name }));
}
